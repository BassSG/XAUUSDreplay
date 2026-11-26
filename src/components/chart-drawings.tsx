import {useEffect, useId, useRef, useState} from 'react';
import type {PointerEvent as ReactPointerEvent} from 'react';
import {createPortal} from 'react-dom';
import {Check, Magnet, Plus, Undo2, X} from 'lucide-react';
import type {IChartApi, ISeriesApi, MouseEventParams} from 'lightweight-charts';
import type {Bar, Drawing, DrawingKind, DrawingPoint} from '../lib/engine';
import {logicalAtTime, moveDrawing, timeAtLogical, type XY} from '../lib/chart-tools';
import {defaultRetracement, drawingTools, isStroke, strokeMax, variableDrawingsMax} from '../lib/drawing-definitions';
import {drawingGeometry, placementError, positionMetrics, type DrawingMark, type DrawingView} from '../lib/drawing-geometry';

type Api = {chart: IChartApi; series: ISeriesApi<'Candlestick'>};
type Props = {
  api: Api | null; host: HTMLDivElement | null; controlsHost?: HTMLDivElement | null;
  confirmPlacement?: boolean; readOnly?: boolean; timeline: Bar[]; offset: number; seconds: number;
  drawings: Drawing[]; mode: DrawingKind | null; hidden: boolean; magnet: boolean;
  selected: string | null; pricePicking: boolean;
  onSelect: (id: string | null) => void; onCreate: (d: Drawing) => void; onChange: (d: Drawing) => void;
  onEdit?: (id: string) => void;
  onCancel: () => void; onDelete: () => void; onUndo: () => void; onRedo: () => void;
  onDragStart: () => void; onDragEnd: () => void; onToggleMagnet?: () => void;
};
type Draft = {anchors: DrawingPoint[]; candidate: DrawingPoint | null; hover: DrawingPoint | null; price: string};
type DrawingDrag = {
  original: Drawing; start: DrawingPoint; handle: number | null; target: Element; pointerId: number;
  clientX: number; clientY: number; moved: boolean;
};
type DrawingPress = {id: string; pointerId: number; x: number; y: number};
type Stroke = {pointerId: number; x: number; y: number};
const emptyDraft: Draft = {anchors: [], candidate: null, hover: null, price: ''};
const gold = '#d7b46a';
const dateTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Bangkok', day: '2-digit', month: 'short', year: 'numeric',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
});

function projectedMark(mark: DrawingMark, drawing: Drawing, selected: boolean, hit: boolean) {
  const visual = drawing.style;
  const stroke = mark.kind === 'label' && mark.customText
    ? drawing.textColor ?? mark.color ?? (drawingTools[drawing.kind].text ? drawing.color ?? gold : '#e7edf5')
    : drawing.fib && mark.color ? mark.color
    : (drawing.kind === 'long' || drawing.kind === 'short' ? mark.color : drawing.color) ?? mark.color ?? drawing.color ?? gold;
  const strokeWidth = visual?.width ?? mark.width ?? (selected ? 2 : 1.5);
  const strokeDasharray = visual?.line === 'solid' ? undefined : visual?.line === 'dashed' ? '6 4' : visual?.line === 'dotted' ? '1 4' : mark.dash;
  const style = hit ? {
    stroke: 'transparent', strokeWidth: Math.max(17, strokeWidth), fill: mark.fill ? 'transparent' : 'none',
    pointerEvents: mark.fill ? 'all' : 'stroke',
  } : {
    stroke: mark.noStroke ? 'none' : stroke, strokeWidth, fill: mark.fill ? drawing.fillColor ?? stroke : 'none',
    fillOpacity: mark.fill ? mark.noStroke ? mark.fill : visual?.fillOpacity ?? mark.fill : undefined,
    strokeOpacity: visual?.opacity, opacity: mark.opacity,
    strokeDasharray, vectorEffect: 'non-scaling-stroke', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
  };
  if (mark.kind === 'label') {
    const {x, y} = mark.at;
    const lines = mark.value.split(/\r?\n/);
    const size = mark.customText ? visual?.textSize ?? 12 : 11;
    const step = size + 3;
    const baseline = mark.centered ? y + size * .33 - (lines.length - 1) * step / 2 : y;
    const width = Math.max(26, ...lines.map(line => line.length * size * .63 + 10));
    const left = mark.centered ? x - width / 2 : x - 4;
    if (hit) return mark.centered ? null : <rect x={left} y={baseline - size - 2} width={width}
      height={step * lines.length + 5} fill="transparent" pointerEvents="all"/>;
    return <>
      {mark.background && <rect x={left} y={baseline - size} width={width} height={step * lines.length + 1} rx={3} fill="#10151d" fillOpacity={.92}/>}
      <text x={x} y={baseline} textAnchor={mark.centered ? 'middle' : 'start'} fontFamily="Segoe UI, sans-serif"
        fontSize={size} fontWeight={mark.customText && visual?.bold ? 700 : undefined}
        fontStyle={mark.customText && visual?.italic ? 'italic' : undefined} fill={stroke}>
        {lines.map((line, index) => <tspan key={index} x={x} dy={index ? step : 0}>{line || '\u00a0'}</tspan>)}
      </text>
    </>;
  }
  if (mark.kind === 'curve') return <path d={mark.d} {...style}/>;
  if (mark.kind === 'ellipse') return <ellipse cx={mark.center.x} cy={mark.center.y} rx={mark.rx} ry={mark.ry} {...style}/>;
  const points = mark.points.map(({x, y}) => x + ',' + y).join(' ');
  if (mark.closed) return <polygon points={points} {...style}/>;
  return <polyline points={points} {...style}/>;
}

function roundPrice(price: number) {
  return Math.round(price * 100) / 100;
}

function completeDrawing(kind: DrawingKind, points: DrawingPoint[], live: boolean): Drawing {
  return {id: crypto.randomUUID(), kind, points,
    ...(drawingTools[kind].text ? {text: live ? 'ข้อความ' : 'Note'} : {}),
    ...(live && kind === 'fib' ? {fib:defaultRetracement()} : {})};
}

export default function ChartDrawings(props: Props) {
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [moving, setMoving] = useState<Drawing | null>(null);
  const [coarsePointer, setCoarsePointer] = useState(() => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches === true);
  const state = useRef(props);
  const draftRef = useRef(draft);
  const movingRef = useRef(moving);
  const active = useRef<DrawingDrag | null>(null);
  const press = useRef<DrawingPress | null>(null);
  const lastTap = useRef<{id: string; x: number; y: number; at: number} | null>(null);
  const candidateDrag = useRef<{id:number; dx:number; dy:number} | null>(null);
  const stroke = useRef<Stroke | null>(null);
  const ctrlMagnet = useRef(false);
  const hoverLocation = useRef<XY | null>(null);
  const aimLocation = useRef<XY | null>(null);
  const touchConfirm = useRef<{id:number;x:number;y:number} | null>(null);
  const lastTouchConfirm = useRef(-Infinity);
  const clipId = useId();
  const confirmPlacement = Boolean(props.confirmPlacement && coarsePointer);
  state.current = props;

  useEffect(() => {
    const media = window.matchMedia('(pointer: coarse)');
    const update = () => setCoarsePointer(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  function updateDraft(next: Draft) {
    draftRef.current = next;
    setDraft(next);
  }

  function resetDraft() {
    candidateDrag.current = null;
    stroke.current = null;
    aimLocation.current = null;
    updateDraft(emptyDraft);
  }

  function chooseCandidate(point: DrawingPoint, location: XY | null = null) {
    aimLocation.current = location;
    updateDraft({...draftRef.current, candidate: point, hover: null, price: point.price.toFixed(2)});
  }

  function indexAt(time: number) {
    const {timeline, seconds} = state.current;
    return logicalAtTime(time, timeline, seconds);
  }

  function pointAt(x: number, y: number, temporaryMagnet = ctrlMagnet.current): DrawingPoint | null {
    const {api, timeline, offset, seconds, magnet, mode} = state.current;
    if (!api || !timeline.length) return null;
    if (x < 0 || x > api.chart.timeScale().width() || y < 0 || y > api.chart.panes()[0].getHeight()) return null;
    const logical = api.chart.timeScale().coordinateToLogical(x);
    const price = api.series.coordinateToPrice(y);
    if (logical === null || price === null || !Number.isFinite(price) || price < .01) return null;
    const bar = timeline[Math.round(logical + offset)];
    if (mode === 'vwap' && bar) return {time: bar.time, price: roundPrice(bar.close)};
    if ((magnet || temporaryMagnet) && bar) {
      const snap = [bar.open, bar.high, bar.low, bar.close].sort((a, b) =>
        Math.abs(a - price) - Math.abs(b - price))[0];
      if (Math.abs((api.series.priceToCoordinate(snap) ?? Infinity) - y) <= 14) return {time: bar.time, price: roundPrice(snap)};
    }
    const time = timeAtLogical(logical + offset, timeline, seconds);
    return time > 0 ? {time, price: roundPrice(price)} : null;
  }

  function coordinates(event: Pick<PointerEvent, 'clientX' | 'clientY'>) {
    const rect = state.current.host?.getBoundingClientRect();
    return rect ? {x: event.clientX - rect.left, y: event.clientY - rect.top} : null;
  }

  function eventPoint(event: ReactPointerEvent) {
    const p = coordinates(event);
    return p ? pointAt(p.x, p.y, event.ctrlKey) : null;
  }

  function setMovingDrawing(next: Drawing | null) {
    movingRef.current = next;
    setMoving(next);
  }

  function cancelDrag() {
    const drag = active.current;
    active.current = null;
    if (drag) {
      if (drag.target.hasPointerCapture(drag.pointerId)) drag.target.releasePointerCapture(drag.pointerId);
      if (drag.moved) state.current.onDragEnd();
    }
    setMovingDrawing(null);
  }

  function save(kind: DrawingKind, points: DrawingPoint[]) {
    const p = state.current;
    resetDraft();
    p.onCreate(completeDrawing(kind, points, Boolean(p.confirmPlacement)));
  }

  function accept(point: DrawingPoint, keepAim = false) {
    const {mode, timeline} = state.current;
    if (!mode) return;
    const {anchors} = draftRef.current;
    const points = [...anchors, point];
    if (placementError(mode, points, timeline, indexAt)) return;
    const tool = drawingTools[mode];
    if (points.length === (tool.variable ? variableDrawingsMax : tool.points.length)) save(mode, points);
    else {
      aimLocation.current = null;
      updateDraft({...emptyDraft, anchors: points,
        ...(keepAim ? {candidate:point, price:point.price.toFixed(2)} : {})});
    }
  }

  function confirm() {
    const current = draftRef.current;
    const {mode} = state.current;
    if (!mode) return;
    if (isStroke(mode)) {
      if (!stroke.current && current.anchors.length >= 2) save(mode, current.anchors);
    } else if (current.candidate && roundPrice(Number(current.price)) > 0 && Number.isFinite(Number(current.price))) {
      accept(current.candidate, true);
    }
  }

  function undoPoint() {
    const current = draftRef.current;
    const mode = state.current.mode;
    if (!mode) return;
    if (isStroke(mode)) resetDraft();
    else updateDraft({...current, anchors: current.anchors.slice(0, -1)});
  }

  useEffect(() => {
    resetDraft();
    cancelPress();
    hoverLocation.current = null;
  }, [props.mode, props.hidden, props.seconds]);

  useEffect(() => {
    const mode = props.mode;
    if (!confirmPlacement || !mode || isStroke(mode) || props.hidden || draftRef.current.candidate || draftRef.current.anchors.length) return;
    const frame = requestAnimationFrame(() => {
      if (draftRef.current.candidate || !state.current.api) return;
      const {chart} = state.current.api;
      const location = {x:chart.timeScale().width() * .52,y:chart.panes()[0].getHeight() * .45};
      const center = pointAt(location.x,location.y);
      if (center) chooseCandidate(center,location);
    });
    return () => cancelAnimationFrame(frame);
  }, [confirmPlacement, props.api, props.hidden, props.mode, props.seconds, props.timeline.length]);

  useEffect(() => {
    const location = aimLocation.current;
    if (!confirmPlacement || !location || !draftRef.current.candidate) return;
    const point = pointAt(location.x, location.y);
    if (point) chooseCandidate(point, location);
  }, [confirmPlacement, props.magnet]);

  useEffect(() => {
    if (props.selected && !props.drawings.some(d => d.id === props.selected)) props.onSelect(null);
  }, [props.drawings, props.selected]);

  useEffect(() => {
    const api = props.api;
    if (!api || props.readOnly) return;
    const click = (event: MouseEventParams) => {
      const p = state.current;
      if (!event.point || (event.paneIndex ?? 0) !== 0 || p.hidden) return;
      if (!p.mode) {
        p.onSelect(null);
        return;
      }
      if (isStroke(p.mode)) return;
      if (p.confirmPlacement) return;
      const point = pointAt(event.point.x, event.point.y);
      if (point) accept(point);
    };
    const move = (event: MouseEventParams) => {
      const {mode, hidden} = state.current;
      const current = draftRef.current;
      if (!mode || hidden || current.candidate || isStroke(mode)) return;
      const location = event.point && (event.paneIndex ?? 0) === 0 ? event.point : null;
      hoverLocation.current = location;
      const point = location ? pointAt(location.x, location.y) : null;
      if (current.hover?.time === point?.time && current.hover?.price === point?.price) return;
      updateDraft({...current, hover: point});
    };
    api.chart.subscribeClick(click);
    api.chart.subscribeCrosshairMove(move);
    return () => {
      api.chart.unsubscribeClick(click);
      api.chart.unsubscribeCrosshairMove(move);
    };
  }, [props.api, props.readOnly]);

  useEffect(() => {
    const host = props.host;
    if (!host || !props.confirmPlacement || props.readOnly) return;
    let start: {id: number; x: number; y: number} | null = null;
    const startTap = (event: PointerEvent) => {
      const {mode, hidden} = state.current;
      if (!mode || hidden || isStroke(mode) || !event.isPrimary || event.button !== 0) {
        start = null;
        return;
      }
      start = {id: event.pointerId, x: event.clientX, y: event.clientY};
    };
    const moveTap = (event: PointerEvent) => {
      if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 7) start = null;
    };
    const endTap = (event: PointerEvent) => {
      if (!start || start.id !== event.pointerId) return;
      start = null;
      const position = coordinates(event);
      const point = position ? pointAt(position.x, position.y, event.ctrlKey) : null;
      const {mode, hidden} = state.current;
      if (!point || !mode || hidden || isStroke(mode)) return;
      // The chart library can consume the second click of a fast pair as a double click.
      if (confirmPlacement) chooseCandidate(point, position);
      else accept(point);
    };
    const cancelTap = () => { start = null; };
    host.addEventListener('pointerdown', startTap, true);
    host.addEventListener('pointermove', moveTap, true);
    host.addEventListener('pointerup', endTap, true);
    host.addEventListener('pointercancel', cancelTap, true);
    return () => {
      host.removeEventListener('pointerdown', startTap, true);
      host.removeEventListener('pointermove', moveTap, true);
      host.removeEventListener('pointerup', endTap, true);
      host.removeEventListener('pointercancel', cancelTap, true);
    };
  }, [props.host, props.confirmPlacement, confirmPlacement, props.mode, props.readOnly]);

  useEffect(() => {
    const pan = !props.mode || (confirmPlacement && !isStroke(props.mode));
    props.api?.chart.applyOptions({handleScroll: {
      pressedMouseMove: pan, horzTouchDrag: pan, vertTouchDrag: !confirmPlacement && !props.mode, mouseWheel: true,
    }});
  }, [props.api, props.mode, confirmPlacement]);

  useEffect(() => {
    if (props.readOnly) return;
    function setCtrlMagnet(pressed: boolean) {
      if (ctrlMagnet.current === pressed) return;
      ctrlMagnet.current = pressed;
      const location = hoverLocation.current;
      const current = draftRef.current;
      const {mode, hidden} = state.current;
      if (!location || !mode || hidden || current.candidate || isStroke(mode)) return;
      updateDraft({...current, hover:pointAt(location.x, location.y)});
    }
    const key = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.altKey || target?.isContentEditable || document.querySelector('[aria-modal="true"]')) return;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName ?? '')) return;
      if (event.key === 'Control') setCtrlMagnet(true);
      const p = state.current;
      if (event.key === 'Escape') {
        if (active.current) cancelDrag();
        else {
          resetDraft();
          p.onCancel();
        }
      } else if (event.key === 'Enter' && p.mode && confirmPlacement && !target?.closest('button, a')) {
        event.preventDefault();
        confirm();
      } else if (event.key.startsWith('Arrow') && p.mode && confirmPlacement && draftRef.current.candidate) {
        const candidate = draftRef.current.candidate;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          const index = Math.round(indexAt(candidate.time)) + (event.key === 'ArrowLeft' ? -1 : 1);
          const time = timeAtLogical(index, p.timeline, p.seconds);
          const bar = p.timeline[index];
          if (time > 0) chooseCandidate({time, price: p.mode === 'vwap' && bar ? roundPrice(bar.close) : candidate.price});
        } else if (p.mode !== 'vwap') {
          chooseCandidate({...candidate, price: Math.max(.01, roundPrice(candidate.price + (event.key === 'ArrowUp' ? .01 : -.01)))});
        }
        event.preventDefault();
      } else if ((event.key === 'Delete' || event.key === 'Backspace') && p.selected) {
        event.preventDefault();
        p.onDelete();
      } else if ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) {
        event.preventDefault();
        resetDraft();
        p.onCancel();
        if (event.shiftKey || event.key.toLowerCase() === 'y') p.onRedo();
        else p.onUndo();
      }
    };
    const release = (event: KeyboardEvent) => { if (!event.ctrlKey) setCtrlMagnet(false); };
    const blur = () => setCtrlMagnet(false);
    window.addEventListener('keydown', key);
    window.addEventListener('keyup', release);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', key);
      window.removeEventListener('keyup', release);
      window.removeEventListener('blur', blur);
      cancelDrag();
    };
  }, [confirmPlacement, props.readOnly]);

  function beginMove(event: ReactPointerEvent<SVGGElement>, drawing: Drawing, handle: number | null) {
    const p = state.current;
    if (event.button !== 0 || p.mode || p.pricePicking || active.current) return;
    event.preventDefault();
    event.stopPropagation();
    p.onSelect(drawing.id);
    press.current = {id: drawing.id, pointerId: event.pointerId, x:event.clientX, y:event.clientY};
    if (drawing.locked) return;
    const point = eventPoint(event);
    if (!point) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    active.current = {original: drawing, start: point, handle, target: event.currentTarget, pointerId: event.pointerId,
      clientX: event.clientX, clientY: event.clientY, moved:false};
  }

  function dragDrawing(event: ReactPointerEvent<SVGGElement>) {
    const drag = active.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.clientX, event.clientY - drag.clientY) < 4) return;
    const end = eventPoint(event);
    if (!end) return;
    const p = state.current;
    if (!drag.moved) {
      drag.moved = true;
      lastTap.current = null;
      p.onDragStart();
    }
    const next = moveDrawing(drag.original, drag.start, end, drag.handle, p.timeline, p.seconds);
    if (p.confirmPlacement && placementError(next.kind, next.points, p.timeline, indexAt)) return;
    setMovingDrawing(next);
  }

  function endMove(event: ReactPointerEvent<SVGGElement>) {
    const pending = press.current;
    press.current = null;
    const drag = active.current;
    if (drag?.pointerId === event.pointerId) {
      const next = movingRef.current;
      cancelDrag();
      if (next && next.points.some((p, i) => p.time !== drag.original.points[i].time || p.price !== drag.original.points[i].price)) {
        state.current.onChange(next);
      }
    }
    const {onEdit} = state.current;
    if (!onEdit || !pending || pending.pointerId !== event.pointerId || drag?.moved
      || Math.hypot(pending.x - event.clientX, pending.y - event.clientY) > 7) return;
    const previous = lastTap.current;
    const at = performance.now();
    if (previous?.id === pending.id && at - previous.at <= 450
      && Math.hypot(previous.x - pending.x, previous.y - pending.y) <= 20) {
      lastTap.current = null;
      onEdit(pending.id);
    } else lastTap.current = {...pending, at};
  }

  function cancelPress() {
    press.current = null;
    lastTap.current = null;
    cancelDrag();
  }

  function moveCandidate(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = candidateDrag.current;
    const position = coordinates(event);
    const chart = state.current.api?.chart;
    if (drag?.id !== event.pointerId || !position || !chart) return;
    const x = Math.max(0, Math.min(chart.timeScale().width(), position.x + drag.dx));
    const y = Math.max(0, Math.min(chart.panes()[0].getHeight(), position.y + drag.dy));
    const point = pointAt(x, y, event.ctrlKey);
    if (point) chooseCandidate(point, {x,y});
  }

  function startStroke(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || stroke.current) return;
    const position = coordinates(event);
    if (!position) return;
    const point = pointAt(position.x, position.y, event.ctrlKey);
    if (!point) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    stroke.current = {...position, pointerId: event.pointerId};
    updateDraft({...emptyDraft, anchors: [point]});
  }

  function moveStroke(event: ReactPointerEvent<HTMLDivElement>) {
    const path = stroke.current;
    if (!path || path.pointerId !== event.pointerId) return;
    const position = coordinates(event);
    if (!position || Math.hypot(position.x - path.x, position.y - path.y) < 4) return;
    const point = pointAt(position.x, position.y, event.ctrlKey);
    if (!point) return;
    const points = draftRef.current.anchors;
    const retained = points.length >= strokeMax ? points.filter((_, i) => i % 2 === 0) : points;
    stroke.current = {...position, pointerId: event.pointerId};
    updateDraft({...emptyDraft, anchors: [...retained, point]});
  }

  function stopStroke(event: ReactPointerEvent<HTMLDivElement>) {
    if (stroke.current?.pointerId !== event.pointerId) return;
    stroke.current = null;
    updateDraft({...draftRef.current});
    if (!confirmPlacement && state.current.mode && draftRef.current.anchors.length >= 2) {
      save(state.current.mode, draftRef.current.anchors);
    }
  }

  const api = props.api;
  if (!api) return null;
  const scale = api.chart.timeScale();
  const width = scale.width();
  const height = api.chart.panes()[0].getHeight();
  const range = scale.getVisibleLogicalRange();
  const atIndex = (index: number, price: number): XY => ({
    x: scale.logicalToCoordinate((index - props.offset) as Parameters<typeof scale.logicalToCoordinate>[0]) ?? NaN,
    y: api.series.priceToCoordinate(price) ?? NaN,
  });
  const xy = (p: DrawingPoint) => atIndex(indexAt(p.time), p.price);
  const view: DrawingView = {width, height, bars: props.timeline, index: indexAt, at: xy, atIndex,
    visibleFrom: (range?.from ?? 0) + props.offset, visibleTo: (range?.to ?? props.timeline.length) + props.offset};

  const mode = props.hidden ? null : props.mode;
  const tool = mode ? drawingTools[mode] : null;
  const freehand = Boolean(mode && isStroke(mode));
  const cursor = draft.candidate ?? draft.hover;
  const aim = cursor ? xy(cursor) : null;
  const previewPoints = cursor ? [...draft.anchors, cursor] : draft.anchors;
  const canDragAim = Boolean(draft.candidate && confirmPlacement);
  const candidateError = draft.candidate && mode
    ? roundPrice(Number(draft.price)) <= 0 || !Number.isFinite(Number(draft.price)) ? 'ใส่ราคาตั้งแต่ 0.01' : placementError(mode, previewPoints, props.timeline, indexAt)
    : null;
  const directError = !confirmPlacement && draft.hover && mode
    ? placementError(mode, previewPoints, props.timeline, indexAt) : null;
  const ready = freehand ? draft.anchors.length >= 2 && !stroke.current : Boolean(draft.candidate && !candidateError);
  const metrics = (mode === 'long' || mode === 'short') ? positionMetrics(mode, previewPoints) : null;
  const previousAnchor = draft.anchors.at(-1);
  const aimOnAnchor = previousAnchor && draft.candidate?.time === previousAnchor.time && draft.candidate.price === previousAnchor.price;
  const controls = mode && tool && confirmPlacement && <section className="live-placement" aria-label="วางจุดบนกราฟ">
    <div className="live-placement-info">
      <strong>{tool.name}</strong>
      <span role="status">{(aimOnAnchor ? 'ลากเป้าไปจุดถัดไป' : candidateError) ?? (freehand
        ? ready ? 'พร้อมวางเส้น' : 'ลากนิ้วเพื่อวาดเส้น'
        : (tool.variable ? 'จุดที่ ' + (draft.anchors.length + 1) : tool.points[draft.anchors.length] ?? tool.points[0])
          + (draft.candidate ? ' · ลากเป้าหรือแตะกราฟ' : ' · แตะกราฟเพื่อเล็ง'))}</span>
    </div>
    <div className="live-placement-actions">
      {!freehand && <label className="live-placement-price">
        <span>ราคา</span>
        <input type="number" inputMode="decimal" min={.01} step={.01} value={draft.price}
          placeholder="—" disabled={!draft.candidate || mode === 'vwap'} aria-label="ราคาจุดตัวอย่าง"
          onChange={event => {
            const current = draftRef.current;
            const value = event.target.valueAsNumber;
            const price = roundPrice(value);
            aimLocation.current = null;
            if (current.candidate) updateDraft({...current, price: event.target.value,
              candidate: Number.isFinite(price) && price > 0 ? {...current.candidate, price} : current.candidate});
          }} onKeyDown={event => {
            if (event.key === 'Enter') {
              event.preventDefault();
              if (ready) confirm();
            }
            if (event.key === 'Escape') props.onCancel();
          }}/>
      </label>}
      {!freehand && props.onToggleMagnet && <button type="button" aria-label="แม่เหล็กดูดราคาแท่ง"
        title="แม่เหล็กดูดราคาแท่ง" aria-pressed={props.magnet} onClick={props.onToggleMagnet}><Magnet size={17}/></button>}
      <button type="button" className="live-place-confirm" disabled={!ready}
        onPointerDown={event => {
          if (event.pointerType === 'touch' && event.isPrimary) {
            touchConfirm.current = {id:event.pointerId, x:event.clientX, y:event.clientY};
          }
        }}
        onPointerCancel={() => { touchConfirm.current = null; }}
        onPointerUp={event => {
          const touch = touchConfirm.current;
          touchConfirm.current = null;
          if (touch?.id !== event.pointerId || Math.hypot(event.clientX-touch.x,event.clientY-touch.y) > 12) return;
          // A browser can omit the synthetic click after dragging the aim point.
          lastTouchConfirm.current = performance.now();
          event.preventDefault();
          confirm();
        }}
        onClick={event => {
          if (event.detail !== 0 && performance.now() - lastTouchConfirm.current < 500) return;
          confirm();
        }}>
        <Plus size={17}/>{freehand ? 'วางเส้น' : 'วางจุด'}
      </button>
      {tool.variable && <button type="button" disabled={draft.anchors.length < 2}
        title="จบเส้น" aria-label="จบเส้น" onClick={() => save(mode, draftRef.current.anchors)}><Check size={17}/></button>}
      <button type="button" disabled={!draft.anchors.length} title="ย้อนจุด" aria-label="ย้อนจุด" onClick={undoPoint}><Undo2 size={17}/></button>
      <button type="button" title="ยกเลิกการวาด" aria-label="ยกเลิกการวาด" onClick={props.onCancel}><X size={17}/></button>
    </div>
    {!freehand && <div className="live-placement-coordinate">
      {draft.candidate && dateTime.format(draft.candidate.time * 1000) + ' กรุงเทพฯ'}
      {metrics && <span>Reward/Risk {metrics.ratio.toFixed(2)}</span>}
    </div>}
  </section>;

  const draw = (drawing: Drawing, preview = false) => {
    const selected = !preview && props.selected === drawing.id;
    const color = drawing.color || gold;
    const interactive = !props.readOnly && !preview && !mode && !props.pricePicking;
    const marks = drawingGeometry(drawing, view);
    const body = marks.find(mark => mark.kind === 'path' && mark.closed);
    const captionClip = body?.kind === 'path' && marks.some(mark => mark.kind === 'label' && mark.centered)
      ? clipId + '-caption-' + drawing.id : undefined;
    const handles = isStroke(drawing.kind)
      ? [0, drawing.points.length - 1].filter((index, i, self) => self.indexOf(index) === i)
      : drawing.points.map((_, i) => i);
    return <g key={drawing.id} data-drawing-id={preview ? undefined : drawing.id} data-kind={drawing.kind}
      data-selected={selected || undefined} data-drawing-interaction={preview ? 'preview' : undefined}
      opacity={preview ? .78 : 1}>
      {captionClip && body?.kind === 'path' && <clipPath id={captionClip}>
        <polygon points={body.points.map(({x, y}) => x + ',' + y).join(' ')}/>
      </clipPath>}
      <g pointerEvents="none">{marks.map((mark, index) => <g key={index}
        clipPath={captionClip && mark.kind === 'label' && mark.centered ? 'url(#' + captionClip + ')' : undefined}>
        {projectedMark(mark, drawing, selected, false)}
      </g>)}</g>
      {interactive && <g data-drawing-interaction="body" className={drawing.locked ? 'drawing-locked' : 'drawing-hit'}
        onPointerDown={event => beginMove(event, drawing, null)} onPointerMove={dragDrawing}
        onPointerUp={endMove} onPointerCancel={cancelPress} onLostPointerCapture={() => { if (active.current) cancelPress(); }}>
        {marks.map((mark, index) => <g key={index}>{projectedMark(mark, drawing, selected, true)}</g>)}
        {!marks.length && drawing.points.slice(0, 3).map((point, index) => {
          const {x, y} = xy(point);
          return Number.isFinite(x) && Number.isFinite(y)
            ? <circle key={index} cx={x} cy={y} r={10} fill="transparent" pointerEvents="all"/> : null;
        })}
      </g>}
      {(selected || preview) && handles.map(i => {
        if (preview && cursor && i === drawing.points.length - 1 && !freehand) return null;
        const {x, y} = xy(drawing.points[i]);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        const cx = drawing.kind === 'hline' ? Math.max(10, Math.min(width - 10, x)) : x;
        const cy = drawing.kind === 'vline' ? Math.max(10, Math.min(height - 10, y)) : y;
        return <g key={i} data-drawing-interaction="handle" data-handle={i} onPointerDown={event => beginMove(event, drawing, i)}
          onPointerMove={dragDrawing} onPointerUp={endMove} onPointerCancel={cancelPress}
          onLostPointerCapture={() => { if (active.current) cancelPress(); }}>
          <circle cx={cx} cy={cy} r={selected ? 5 : 4} fill="#10151d" stroke={color} strokeWidth="2"/>
          <circle cx={cx} cy={cy} r="14" fill="transparent"
            pointerEvents={selected && !drawing.locked && interactive ? 'all' : 'none'} className="drawing-anchor"/>
        </g>;
      })}
    </g>;
  };

  return <>
    <svg className="user-drawing-overlay" width={width} height={height} aria-label="เส้นและวัตถุที่วาดบนกราฟ">
      <defs><clipPath id={clipId}><rect width={width} height={height}/></clipPath></defs>
      <g clipPath={'url(#' + clipId + ')'}>
        {!props.hidden && props.drawings.map(drawing => draw(moving?.id === drawing.id ? moving : drawing))}
        {mode && previewPoints.length > 0 && draw({id: 'preview', kind: mode, points: previewPoints,
          fib: mode === 'fib' && props.confirmPlacement ? defaultRetracement() : undefined,
          text: tool?.text ? props.confirmPlacement ? 'ข้อความ' : 'Note' : undefined}, true)}
        {mode && aim && !freehand && Number.isFinite(aim.x) && Number.isFinite(aim.y) && <g data-drawing-interaction="aim">
          {canDragAim && <path d={`M 0 ${aim.y} H ${width} M ${aim.x} 0 V ${height}`} stroke={gold} strokeOpacity={.55} strokeDasharray="3 5"/>}
          <circle cx={aim.x} cy={aim.y} r={canDragAim ? 7 : 4} fill="#10151d" stroke="#f0cb83" strokeWidth="2"/>
        </g>}
      </g>
    </svg>
    {mode && canDragAim && aim && aim.x >= 0 && aim.x <= width && aim.y >= 0 && aim.y <= height
      && <div className="live-aim-target" data-drawing-interaction="aim-target" aria-hidden="true" style={{left: aim.x, top: aim.y}}
        onPointerDown={event => {
          if (event.button !== 0 || !event.isPrimary || candidateDrag.current !== null) return;
          const position = coordinates(event);
          if (!position) return;
          event.preventDefault();
          candidateDrag.current = {id:event.pointerId, dx:aim.x-position.x, dy:aim.y-position.y};
          event.currentTarget.setPointerCapture(event.pointerId);
        }} onPointerMove={moveCandidate} onPointerUp={() => { candidateDrag.current = null; }}
        onPointerCancel={() => { candidateDrag.current = null; }} onLostPointerCapture={() => { candidateDrag.current = null; }}/>}
    {freehand && <div className="live-stroke-target" aria-hidden="true" style={{width, height}}
      onPointerDown={startStroke} onPointerMove={moveStroke} onPointerUp={stopStroke}
      onPointerCancel={stopStroke} onLostPointerCapture={stopStroke}/>}
    {controls && (props.controlsHost ? createPortal(controls, props.controlsHost) : controls)}
    {mode && tool && !confirmPlacement && <div className="drawing-instruction" role="status">
      <span>{directError ?? (tool.name + ' · ' + (freehand ? 'ลากเมาส์เพื่อวาด' : (tool.variable ? 'จุด ' + (draft.anchors.length + 1) : tool.points[draft.anchors.length] ?? 'วางจุด') + ' · คลิกกราฟเพื่อวาง') + ' · Esc ยกเลิก')}</span>
      <button type="button" onClick={props.onCancel}>ยกเลิก</button>
    </div>}
  </>;
}
