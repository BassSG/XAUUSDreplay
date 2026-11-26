import {rayEnd, type XY} from './chart-tools.ts';
import {drawingTools, fibDefaults, isLabelBox, isStroke} from './drawing-definitions.ts';
import type {Bar, Drawing, DrawingKind, DrawingPoint, FibLevel} from './engine.ts';
import {forwardStatus, forwardStatusLabel} from './forward-test.ts';

type Style = {color?: string; fill?: number; width?: number; opacity?: number; dash?: string; noStroke?: boolean};
export type DrawingMark = Style & (
  | {kind: 'path'; points: XY[]; closed?: boolean}
  | {kind: 'curve'; d: string}
  | {kind: 'ellipse'; center: XY; rx: number; ry: number}
  | {kind: 'label'; at: XY; value: string; background?: boolean; centered?: boolean; customText?: boolean}
);
export type DrawingView = {
  width: number; height: number; bars: Bar[]; visibleFrom: number; visibleTo: number;
  index: (time: number) => number;
  at: (point: DrawingPoint) => XY;
  atIndex: (index: number, price: number) => XY;
};

function boxCaption(drawing: Drawing, a: XY, b: XY): DrawingMark[] {
  const value = drawing.text?.trim();
  if (!value || drawing.style?.showText === false) return [];
  const fraction = drawing.style?.textAlign === 'start' ? .2 : drawing.style?.textAlign === 'end' ? .8 : .5;
  return [{kind: 'label', at: {x: Math.min(a.x, b.x) + Math.abs(a.x - b.x) * fraction, y: (a.y + b.y) / 2},
    value, centered: true, customText: true, color: drawing.textColor ?? '#e7edf5'}];
}

export function drawingFibLevels(drawing: Drawing): FibLevel[] {
  return drawing.fib?.levels ?? (fibDefaults[drawing.kind] ?? []).map(value => ({value, enabled: true}));
}

function fibCaption(drawing: Drawing, level: FibLevel, price?: number): string {
  const format = drawing.fib?.format ?? (drawing.kind === 'fibTime' ? 'ratio' : 'percent');
  const value = format === 'ratio' ? String(level.value) : format === 'percent'
    ? (Math.round(level.value * 100000) / 1000) + '%' : '';
  const showPrice = drawing.fib?.showPrice ?? (drawing.kind === 'fib' || drawing.kind === 'fibExtension');
  return [value, showPrice && price !== undefined ? money(price) : '', level.text?.trim()].filter(Boolean).join(' · ');
}
const gannRatios = [.125, .25, .33333333, .5, 1, 2, 3, 4, 8];
const success = '#5cdbad';
const loss = '#ee8190';
const dash = {dash: '5 4'};
const twoTimes = new Set<DrawingKind>(['channel', 'fibChannel', 'fibTime', 'fibFan', 'gannFan', 'cycle', 'dateRange']);
const twoPrices = new Set<DrawingKind>(['fib', 'fibExtension', 'fibFan', 'gannFan', 'priceRange']);
const rectangles = new Set<DrawingKind>(['gannBox', 'rect', 'ellipse']);
const patterns = new Set<DrawingKind>(['abcd', 'xabcd', 'headShoulders', 'elliott', 'elliottABC']);

export function positionMetrics(kind: 'long' | 'short', points: DrawingPoint[]) {
  const [entry, target, stop] = points;
  if (!entry || !target || !stop) return null;
  const sign = kind === 'long' ? 1 : -1;
  const reward = sign * (target.price - entry.price);
  const risk = sign * (entry.price - stop.price);
  return reward > 0 && risk > 0 ? {reward, risk, ratio: reward / risk} : null;
}

export function placementError(kind: DrawingKind, points: DrawingPoint[], bars?: Bar[], index?: DrawingView['index']): string | null {
  const [a, b, c] = points;
  if (!a) return null;
  if (kind === 'vwap' && bars && index) {
    const start = Math.round(index(a.time));
    if (start < 0 || start >= bars.length) return 'เลือกแท่งที่มีอยู่บนกราฟเพื่อเริ่มคำนวณ';
    const {volume} = vwapTotals(bars);
    if (volume[bars.length] === volume[start]) {
      return 'ช่วงนี้ไม่มี Tick Volume สำหรับคำนวณ VWAP';
    }
  }
  if (!b) return null;
  if ((twoTimes.has(kind) || rectangles.has(kind)) && a.time === b.time) return 'เลือกเวลาให้ต่างจากจุดแรก';
  if ((twoPrices.has(kind) || rectangles.has(kind)) && a.price === b.price) return 'เลือกราคาให้ต่างจากจุดแรก';
  if ((kind === 'fibTime' || kind === 'cycle' || kind === 'regression') && index
      && Math.round(index(a.time)) === Math.round(index(b.time))) return 'เลือกคนละแท่งเพื่อคำนวณ';
  if (kind === 'regression' && bars && index) {
    const first = Math.min(index(a.time), index(b.time));
    const last = Math.max(index(a.time), index(b.time));
    if (Math.round(first) < 0 || Math.round(last) >= bars.length) return 'เลือกต้นและท้ายช่วงบนแท่งที่มีข้อมูล';
  }
  if (kind === 'long' || kind === 'short') {
    const sign = kind === 'long' ? 1 : -1;
    if (sign * (b.price - a.price) <= 0) return 'Take Profit ต้องอยู่' + (sign > 0 ? 'เหนือ' : 'ใต้') + 'ราคาเข้า';
    if (c && sign * (a.price - c.price) <= 0) return 'Stop Loss ต้องอยู่' + (sign > 0 ? 'ใต้' : 'เหนือ') + 'ราคาเข้า';
  } else if (!isStroke(kind) && points.slice(1).some((point, i) =>
    point.time === points[i].time && point.price === points[i].price)) return 'ขยับจุดให้ต่างจากจุดก่อนหน้า';
  return null;
}

const point = (x: number, y: number): XY => ({x, y});
const path = (points: XY[], style: Style = {}, closed = false): DrawingMark => ({kind: 'path', points, closed, ...style});
const line = (a: XY, b: XY, style?: Style) => path([a, b], style);
const label = (at: XY, value: string, background = false, style: Style = {}): DrawingMark =>
  ({kind: 'label', at, value, background, ...style});
const shift = (p: XY, x: number, y: number): XY => point(p.x + x, p.y + y);
const box = (a: XY, b: XY, style: Style = {fill: .12}) => path(
  [a, point(b.x, a.y), b, point(a.x, b.y)], style, true);
const isVisible = (x: number, view: DrawingView) => x >= 0 && x <= view.width;
const money = (value: number) => value.toFixed(2);
const signed = (value: number) => (value > 0 ? '+' : '') + money(value);
const finitePoint = ({x, y}: XY) => Number.isFinite(x) && Number.isFinite(y);

function arrow(a: XY, b: XY, main: DrawingMark[]): DrawingMark[] {
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const wing = (side: number) => shift(b, -10 * Math.cos(angle + side * .5), -10 * Math.sin(angle + side * .5));
  return [...main, path([wing(1), b, wing(-1)])];
}

function arcThrough(a: XY, b: XY, c: XY): DrawingMark {
  const u = point(b.x - a.x, b.y - a.y);
  const v = point(c.x - a.x, c.y - a.y);
  const cross = u.x * v.y - u.y * v.x;
  if (Math.abs(cross) < .001) return path([a, c, b]);
  const radius = Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y) * Math.hypot(u.x - v.x, u.y - v.y) / (2 * Math.abs(cross));
  const large = (a.x - c.x) * (b.x - c.x) + (a.y - c.y) * (b.y - c.y) > 0;
  return {kind: 'curve', d: `M ${a.x} ${a.y} A ${radius} ${radius} 0 ${Number(large)} ${Number(cross < 0)} ${b.x} ${b.y}`};
}

function duration(seconds: number) {
  if (seconds < 60) return seconds + ' วิ';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes + ' นาที';
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + ' ชม.' + (minutes % 60 ? ' ' + minutes % 60 + ' นาที' : '');
  return Math.floor(hours / 24) + ' วัน' + (hours % 24 ? ' ' + hours % 24 + ' ชม.' : '');
}

type VwapTotals = {volume: Float64Array; weighted: Float64Array};
const vwapCache = new WeakMap<Bar[], VwapTotals>();
function vwapTotals(bars: Bar[]): VwapTotals {
  const cached = vwapCache.get(bars);
  if (cached) return cached;
  const volume = new Float64Array(bars.length + 1);
  const weighted = new Float64Array(bars.length + 1);
  for (let i = 0; i < bars.length; i += 1) {
    const b = bars[i];
    volume[i + 1] = volume[i] + b.volume;
    weighted[i + 1] = weighted[i] + (b.high + b.low + b.close) / 3 * b.volume;
  }
  const totals = {volume, weighted};
  vwapCache.set(bars, totals);
  return totals;
}

function anchoredVwap(view: DrawingView, time: number) {
  const start = Math.round(view.index(time));
  if (start < 0 || start >= view.bars.length) return [];
  const {volume, weighted} = vwapTotals(view.bars);
  const first = Math.max(start, Math.floor(view.visibleFrom) - 1);
  const last = Math.min(view.bars.length - 1, Math.ceil(view.visibleTo) + 1);
  const stride = Math.max(1, Math.ceil((last - first) / Math.max(100, view.width)));
  const points: XY[] = [];
  for (let i = first; i <= last; i = Math.min(last, i + stride)) {
    const count = volume[i + 1] - volume[start];
    if (count > 0) {
      const price = (weighted[i + 1] - weighted[start]) / count;
      points.push(view.atIndex(i, price));
    }
    if (i === last) break;
  }
  if (!points.length) return [];
  const textPoint = points.find(p => isVisible(p.x, view)) ?? points[0];
  return [path(points, {width: 2}), label(shift(textPoint, 6, -6), 'AVWAP', true)];
}

function regression(view: DrawingView, times: number[]) {
  const first = Math.max(0, Math.round(view.index(Math.min(...times))));
  const last = Math.min(view.bars.length - 1, Math.round(view.index(Math.max(...times))));
  const n = last - first + 1;
  if (n < 2) return [];
  const xMean = (n - 1) / 2;
  let sum = 0, covariance = 0;
  for (let i = first; i <= last; i += 1) {
    sum += view.bars[i].close;
    covariance += (i - first - xMean) * view.bars[i].close;
  }
  const slope = covariance / (n * (n * n - 1) / 12);
  const startPrice = sum / n - xMean * slope;
  let variance = 0;
  for (let i = first; i <= last; i += 1) variance += (view.bars[i].close - startPrice - (i - first) * slope) ** 2 / n;
  const endPrice = startPrice + (n - 1) * slope;
  const band = 2 * Math.sqrt(variance);
  const upper = [view.atIndex(first, startPrice + band), view.atIndex(last, endPrice + band)];
  const lower = [view.atIndex(first, startPrice - band), view.atIndex(last, endPrice - band)];
  return [path([...upper, ...lower.reverse()], {fill: .1}, true),
    line(view.atIndex(first, startPrice), view.atIndex(last, endPrice), dash)];
}

function timeZones(drawing: Drawing, first: number, step: number, view: DrawingView) {
  if (step < 1) return [];
  const marks: DrawingMark[] = [];
  const mark = (offset: number, name: string, color?: string, opacity?: number) => {
    const x = view.atIndex(first + offset * step, 1).x;
    if (!isVisible(x, view)) return;
    marks.push(line(point(x, 0), point(x, view.height), {...dash, color, opacity}));
    if (name) marks.push(label(point(x + 4, 16), name, false, {color}));
  };
  if (drawing.kind === 'cycle') {
    const start = Math.max(0, Math.ceil((view.visibleFrom - first) / step));
    const end = Math.floor((view.visibleTo - first) / step);
    const stride = Math.max(1, Math.ceil((end - start) * 12 / Math.max(1, view.width)));
    for (let i = start; i <= end; i += stride) mark(i, String(i));
  } else {
    for (const level of drawingFibLevels(drawing)) if (level.enabled) {
      mark(level.value * (drawing.fib?.reverse ? -1 : 1), fibCaption(drawing, level), level.color, level.opacity);
    }
  }
  return marks;
}

function toolGeometry(drawing: Drawing, view: DrawingView): DrawingMark[] {
  const {kind, points} = drawing;
  const projected = points.map(view.at);
  const [a, b, c, d] = projected;
  if (!a || !projected.every(finitePoint)) return [];
  const {width, height} = view;
  const text = drawing.text ?? 'Note';
  const annotation = (at: XY, background = false): DrawingMark[] => drawing.style?.showText !== false && text
    ? [{kind:'label', at, value:text, background, customText:true}] : [];
  const fibLevels = drawingFibLevels(drawing).filter(level => level.enabled);
  const direction = drawing.fib?.reverse ? -1 : 1;
  const fibTrend = (anchors: XY[]) => drawing.fib?.showTrend ? [path(anchors, dash)] : [];
  const levels = (left: number, right: number, start: number, delta: number, time: number) => {
    const from = drawing.style?.extendLeft ? Math.min(0, left) : left;
    const end = drawing.style?.extendRight ? Math.max(width, right) : right;
    const projectedLevels = fibLevels.flatMap(level => {
      const price = start + delta * level.value;
      if (price <= 0) return [];
      const {y} = view.at({time, price});
      return Number.isFinite(y) ? [{level, y, price}] : [];
    });
    const sorted = [...projectedLevels].sort((a,b) => a.y - b.y);
    const fill = drawing.fib?.backgroundOpacity ?? 0;
    const bands = fill > 0 ? sorted.slice(0, -1).map(({level, y}, index) =>
      box(point(from, y), point(end, sorted[index+1].y), {color:level.color, fill, noStroke:true})) : [];
    const visibleLeft = Math.max(3, from);
    const visibleRight = Math.min(width - 3, end);
    const x = drawing.fib?.labelPosition === 'left' ? visibleLeft + 3
      : drawing.fib?.labelPosition === 'center' ? (visibleLeft + visibleRight) / 2
      : Math.max(3, Math.min(width - 140, end + 5));
    return [...bands, ...projectedLevels.flatMap(({level, y, price}) => {
      const marks = [line(point(from, y), point(end, y), {...dash, color:level.color, opacity:level.opacity})];
      const tag = fibCaption(drawing, level, price);
      if (tag && visibleLeft < visibleRight) marks.push(label(point(x, Math.max(11, y - 3)), tag, true, {color:level.color}));
      return marks;
    })];
  };
  const xLabel = (x: number, length: number) => Math.max(4, Math.min(width - length, x));

  switch (kind) {
    case 'hline': return [line(point(0, a.y), point(width, a.y))];
    case 'hray': return [line(a, point(width, a.y)), label(point(Math.max(a.x + 5, width - 75), a.y - 5), money(points[0].price), true)];
    case 'vline': return [line(point(a.x, 0), point(a.x, height))];
    case 'cross': return [line(point(a.x, 0), point(a.x, height)), line(point(0, a.y), point(width, a.y))];
    case 'text': return annotation(shift(a, 6, -8));
    case 'note': return annotation(shift(a, 6, -8), true);
    case 'priceLabel': return [line(a, shift(a, 12, 0)), label(point(xLabel(a.x + 14, 65), a.y + 4), money(points[0].price), true)];
    case 'flag': return [line(a, shift(a, 0, -24)), path([shift(a, 0, -24), shift(a, 18, -20), shift(a, 0, -14)], {fill: .4}, true)];
    case 'markUp': return arrow(shift(a, 0, 19), a, [line(shift(a, 0, 19), a)]);
    case 'markDown': return arrow(shift(a, 0, -19), a, [line(shift(a, 0, -19), a)]);
    case 'vwap': return anchoredVwap(view, points[0].time);
    case 'brush': return [path(projected, {width: 2.5})];
    case 'highlighter': return [path(projected, {width: 14, opacity: .32})];
  }
  if (!b) return [];
  const [first, second, third] = points;
  const dx = b.x - a.x, dy = b.y - a.y;
  const left = Math.min(a.x, b.x), right = Math.max(a.x, b.x);
  const top = Math.min(a.y, b.y), bottom = Math.max(a.y, b.y);
  const change = second.price - first.price;
  const priceDelta = signed(change) + ' USD · ' + signed(change / first.price * 100) + '%';
  const barDelta = Math.round(Math.abs(view.index(second.time) - view.index(first.time)));
  const timeDelta = () => duration(Math.abs(second.time - first.time)) + ' · ' + barDelta + ' แท่ง';

  if (patterns.has(kind)) {
    const marks = projected.map((p, i) => label(shift(p, 7, -8), drawingTools[kind].points[i] ?? '', true));
    if (kind === 'headShoulders' && d) marks.push(line(b, d, dash));
    return [path(projected, {}, kind === 'xabcd' && projected.length === 5), ...marks];
  }
  switch (kind) {
    case 'trend': {
      const from = drawing.style?.extendLeft ? rayEnd(b, a, width, height) : a;
      const to = drawing.style?.extendRight ? rayEnd(a, b, width, height) : b;
      return [line(from, to)];
    }
    case 'polyline': return [path(projected)];
    case 'ray': return [line(a, rayEnd(a, b, width, height))];
    case 'extended': return [line(rayEnd(b, a, width, height), rayEnd(a, b, width, height))];
    case 'arrow': return arrow(a, b, [line(a, b)]);
    case 'info': return [line(a, b), label(point(xLabel(b.x + 6, 162), b.y - 6), priceDelta, true),
      label(point(xLabel(b.x + 6, 162), b.y + 12), timeDelta(), true)];
    case 'rect': {
      const x1 = drawing.style?.extendLeft ? Math.min(0, left) : left;
      const x2 = drawing.style?.extendRight ? Math.max(width, right) : right;
      const marks = [box(point(x1, top), point(x2, bottom)), ...boxCaption(drawing, a, b)];
      if (drawing.style?.middle) marks.push(line(point(x1, (top + bottom) / 2), point(x2, (top + bottom) / 2), dash));
      return marks;
    }
    case 'circle': return [{kind: 'ellipse', center: a, rx: Math.hypot(dx, dy), ry: Math.hypot(dx, dy), fill: .08}];
    case 'ellipse': return [{kind: 'ellipse', center: shift(a, dx / 2, dy / 2), rx: Math.abs(dx) / 2, ry: Math.abs(dy) / 2, fill: .08}];
    case 'triangle': return [path(projected, {fill: .12}, Boolean(c))];
    case 'curve': return c ? [{kind: 'curve', d: `M ${a.x} ${a.y} Q ${c.x} ${c.y} ${b.x} ${b.y}`}] : [line(a, b, dash)];
    case 'doubleCurve': return c && d ? [{kind: 'curve', d: `M ${a.x} ${a.y} C ${c.x} ${c.y} ${d.x} ${d.y} ${b.x} ${b.y}`}] : [path([a, ...(c ? [c] : []), b], dash)];
    case 'arc': return [c ? arcThrough(a, b, c) : line(a, b, dash)];
    case 'callout': return [...arrow(b, a, [line(b, a)]), ...annotation(shift(b, 6, -7), true)];
    case 'fib': return [...fibTrend([a, b]), ...levels(left, Math.max(right, left + 38),
      direction === 1 ? first.price : second.price, change * direction, first.time)];
    case 'fibExtension': return c
      ? [...(drawing.fib?.showTrend !== false ? [path([a, b, c], dash)] : []),
        ...levels(c.x, Math.max(c.x + 50, width - 105), third.price, change * direction, third.time)]
      : [line(a, b, dash)];
    case 'fibTime': case 'cycle': {
      const start = Math.round(view.index(first.time));
      return [...fibTrend([a, b]), ...timeZones(drawing, start, Math.abs(Math.round(view.index(second.time)) - start), view)];
    }
    case 'fibFan': case 'gannFan': {
      const rows: FibLevel[] = kind === 'fibFan' ? fibLevels : gannRatios.map(value => ({value, enabled:true}));
      return [...fibTrend([a, b]), ...rows.flatMap(level => {
        const ratio = level.value;
        const price = first.price + change * ratio * direction;
        if (price <= 0) return [];
        const p = view.at({time: second.time, price});
        if (!finitePoint(p)) return [];
        const name = kind === 'fibFan' ? fibCaption(drawing, level, price) : ratio >= 1 ? Math.round(ratio) + '×1' : '1×' + Math.round(1 / ratio);
        return [line(a, rayEnd(a, p, width, height), {...(ratio === 1 ? {} : dash), color:level.color, opacity:level.opacity}),
          ...(name ? [label(shift(p, 4, -3), name, false, {color:level.color})] : [])];
      })];
    }
    case 'gannBox': {
      const marks = [box(a, b), line(a, b, dash), line(point(a.x, b.y), point(b.x, a.y), dash)];
      for (let i = 1; i < 8; i += 1) {
        const ratio = i / 8;
        const x = a.x + dx * ratio;
        const y = view.at({time: first.time, price: first.price + ratio * change}).y;
        marks.push(line(point(x, top), point(x, bottom), dash), line(point(left, y), point(right, y), dash));
      }
      return [...marks, ...boxCaption(drawing, a, b)];
    }
    case 'channel': case 'fibChannel': case 'rotated': {
      if (!c || Math.hypot(dx, dy) < .001) return [line(a, b)];
      const offset = ((c.x - a.x) * -dy + (c.y - a.y) * dx) / (dx * dx + dy * dy);
      const x = -dy * offset, y = dx * offset;
      const marks = [path([a, b, shift(b, x, y), shift(a, x, y)], {fill: .11}, true)];
      if (kind === 'rotated') return [...marks, ...boxCaption(drawing, a, shift(b, x, y))];
      if (kind === 'channel') marks.push(line(shift(a, x / 2, y / 2), shift(b, x / 2, y / 2), dash));
      if (kind === 'fibChannel') return [...fibTrend([a,b,c]), ...fibLevels.flatMap(level => {
        const ratio = level.value * direction;
        const end = shift(b, x * ratio, y * ratio);
        const name = fibCaption(drawing, level);
        return [line(shift(a, x * ratio, y * ratio), end, {...dash, color:level.color, opacity:level.opacity}),
          ...(name ? [label(shift(end, 4, -3), name, false, {color:level.color})] : [])];
      })];
      return marks;
    }
    case 'pitchfork': {
      if (!c) return [line(a, b, dash)];
      const center = point((b.x + c.x) / 2, (b.y + c.y) / 2);
      const x = center.x - a.x, y = center.y - a.y;
      return [line(b, c, dash), line(a, rayEnd(a, center, width, height)),
        line(b, rayEnd(b, shift(b, x, y), width, height)), line(c, rayEnd(c, shift(c, x, y), width, height))];
    }
    case 'regression': return regression(view, [first.time, second.time]);
    case 'position': case 'ruler':
      return [box(a, b, {color: change >= 0 ? success : loss, fill: .12}),
        label(point(xLabel(left + 5, 162), top + 16), priceDelta, true),
        label(point(xLabel(left + 5, 162), top + 34), timeDelta(), true),
        ...(kind === 'position' ? boxCaption(drawing, a, b) : [])];
    case 'priceRange': {
      const x = Math.max(10, Math.min(width - 10, b.x));
      return [line(point(x - 6, a.y), point(x + 6, a.y)), line(point(x - 6, b.y), point(x + 6, b.y)),
        line(point(x, a.y), point(x, b.y)), label(point(xLabel(x + 8, 162), (a.y + b.y) / 2), priceDelta, true)];
    }
    case 'dateRange': {
      const y = Math.min(height - 10, Math.max(a.y, b.y));
      return [line(point(a.x, y - 6), point(a.x, y + 6)), line(point(b.x, y - 6), point(b.x, y + 6)),
        line(point(a.x, y), point(b.x, y)), label(point(xLabel(left + 5, 142), y - 10), timeDelta(), true)];
    }
    case 'long': case 'short': {
      if (placementError(kind, points)) return [path(projected, dash)];
      const left = Math.min(a.x, b.x, c?.x ?? a.x);
      const right = Math.max(left + 35, a.x, b.x, c?.x ?? a.x);
      const ratio = positionMetrics(kind, points);
      const state = drawing.forwardTest ? forwardStatus(drawing) : null;
      const textX = xLabel(left + 6, state ? 222 : 145);
      return [
        box(point(left, a.y), point(right, b.y), {color: success, fill: .19}),
        label(point(textX, b.y + (b.y < a.y ? -6 : 15)), 'TP ' + money(second.price), true, {color: success}),
        ...(c ? [
          box(point(left, a.y), point(right, c.y), {color: loss, fill: .19}),
          label(point(textX, c.y + (c.y < a.y ? -6 : 15)), 'SL ' + money(third.price), true, {color: loss}),
        ] : []),
        label(point(textX, a.y - 5), 'Entry ' + money(first.price) + (ratio ? ' · R/R ' + money(ratio.ratio) : '') +
          (state ? ' · ' + forwardStatusLabel[state] : ''), true,
          state === 'tp' || state === 'open' ? {color: success} : state === 'sl' ? {color: loss} : undefined),
      ];
    }
    default: return [];
  }
}

export function drawingGeometry(drawing: Drawing, view: DrawingView): DrawingMark[] {
  const marks = toolGeometry(drawing, view);
  const text = drawing.text?.trim();
  if (!text || drawing.style?.showText === false || drawingTools[drawing.kind].text || isLabelBox(drawing.kind)) return marks;
  const first = drawing.points[0];
  if (!first) return marks;
  const a = view.at(first);
  const b = drawing.points[1] ? view.at(drawing.points[1]) : a;
  if (!finitePoint(a) || !finitePoint(b)) return marks;
  const fraction = drawing.style?.textAlign === 'start' ? .15 : drawing.style?.textAlign === 'end' ? .85 : .5;
  const [left, right] = a.x <= b.x ? [a, b] : [b, a];
  let x = left.x + (right.x - left.x) * fraction;
  let y = left.y + (right.y - left.y) * fraction - 12;
  if (drawing.kind === 'hline' || drawing.kind === 'hray') {
    x = (drawing.kind === 'hray' ? Math.max(0, a.x) : 0) * (1 - fraction) + view.width * fraction;
  }
  if (drawing.kind === 'vline' || drawing.kind === 'cross') {
    x = a.x + 8;
    y = view.height * fraction;
  }
  const isHorizontal = drawing.kind === 'hline' || drawing.kind === 'hray';
  if (!isHorizontal && (right.x < 0 || left.x > view.width)) return marks;
  if (y < -12 || y > view.height) return marks;
  return [...marks, {kind:'label', at:point(Math.max(4, Math.min(view.width - 80, x)), Math.max(14, y)),
    value:text, background:true, customText:true}];
}
