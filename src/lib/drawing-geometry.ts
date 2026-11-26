import {rayEnd, type XY} from './chart-tools.ts';
import {drawingTools, isStroke} from './drawing-definitions.ts';
import type {Bar, Drawing, DrawingKind, DrawingPoint} from './engine.ts';

type Style = {color?: string; fill?: number; width?: number; opacity?: number; dash?: string};
export type DrawingMark = Style & (
  | {kind: 'path'; points: XY[]; closed?: boolean}
  | {kind: 'curve'; d: string}
  | {kind: 'ellipse'; center: XY; rx: number; ry: number}
  | {kind: 'label'; at: XY; value: string; background?: boolean}
);
export type DrawingView = {
  width: number; height: number; bars: Bar[]; visibleFrom: number; visibleTo: number;
  index: (time: number) => number;
  at: (point: DrawingPoint) => XY;
  atIndex: (index: number, price: number) => XY;
};

const retracements = [0, .236, .382, .5, .618, .786, 1];
const extensions = [0, .382, .618, 1, 1.272, 1.618, 2, 2.618];
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

function timeZones(kind: 'fibTime' | 'cycle', first: number, step: number, view: DrawingView) {
  if (step < 1) return [];
  const marks: DrawingMark[] = [];
  const mark = (offset: number, name: string) => {
    const x = view.atIndex(first + offset * step, 1).x;
    if (isVisible(x, view)) marks.push(line(point(x, 0), point(x, view.height), dash), label(point(x + 4, 16), name));
  };
  if (kind === 'cycle') {
    const start = Math.max(0, Math.ceil((view.visibleFrom - first) / step));
    const end = Math.floor((view.visibleTo - first) / step);
    const stride = Math.max(1, Math.ceil((end - start) * 12 / Math.max(1, view.width)));
    for (let i = start; i <= end; i += stride) mark(i, String(i));
  } else {
    let a = 1, b = 2;
    mark(0, '0');
    while (first + a * step <= view.visibleTo) {
      mark(a, String(a));
      [a, b] = [b, a + b];
    }
  }
  return marks;
}

export function drawingGeometry(drawing: Drawing, view: DrawingView): DrawingMark[] {
  const {kind, points} = drawing;
  const projected = points.map(view.at);
  const [a, b, c, d] = projected;
  if (!a || !projected.every(finitePoint)) return [];
  const {width, height} = view;
  const text = drawing.text || 'Note';
  const levels = (left: number, right: number, start: number, delta: number, ratios: number[], time: number) =>
    ratios.flatMap(ratio => {
      const price = start + delta * ratio;
      const {y} = view.at({time, price});
      if (!Number.isFinite(y)) return [];
      const tag = Math.round(ratio * 1000) / 10 + '% · ' + money(price);
      return [line(point(left, y), point(right, y), dash), label(point(Math.max(3, Math.min(width - 97, right + 5)), y - 3), tag, true)];
    });
  const xLabel = (x: number, length: number) => Math.max(4, Math.min(width - length, x));

  switch (kind) {
    case 'hline': return [line(point(0, a.y), point(width, a.y))];
    case 'hray': return [line(a, point(width, a.y)), label(point(Math.max(a.x + 5, width - 75), a.y - 5), money(points[0].price), true)];
    case 'vline': return [line(point(a.x, 0), point(a.x, height))];
    case 'cross': return [line(point(a.x, 0), point(a.x, height)), line(point(0, a.y), point(width, a.y))];
    case 'text': return [label(shift(a, 6, -8), text)];
    case 'note': return [label(shift(a, 6, -8), text, true)];
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
    case 'trend': case 'polyline': return [path(projected)];
    case 'ray': return [line(a, rayEnd(a, b, width, height))];
    case 'extended': return [line(rayEnd(b, a, width, height), rayEnd(a, b, width, height))];
    case 'arrow': return arrow(a, b, [line(a, b)]);
    case 'info': return [line(a, b), label(point(xLabel(b.x + 6, 162), b.y - 6), priceDelta, true),
      label(point(xLabel(b.x + 6, 162), b.y + 12), timeDelta(), true)];
    case 'rect': return [box(a, b)];
    case 'circle': return [{kind: 'ellipse', center: a, rx: Math.hypot(dx, dy), ry: Math.hypot(dx, dy), fill: .08}];
    case 'ellipse': return [{kind: 'ellipse', center: shift(a, dx / 2, dy / 2), rx: Math.abs(dx) / 2, ry: Math.abs(dy) / 2, fill: .08}];
    case 'triangle': return [path(projected, {fill: .12}, Boolean(c))];
    case 'curve': return c ? [{kind: 'curve', d: `M ${a.x} ${a.y} Q ${c.x} ${c.y} ${b.x} ${b.y}`}] : [line(a, b, dash)];
    case 'doubleCurve': return c && d ? [{kind: 'curve', d: `M ${a.x} ${a.y} C ${c.x} ${c.y} ${d.x} ${d.y} ${b.x} ${b.y}`}] : [path([a, ...(c ? [c] : []), b], dash)];
    case 'arc': return [c ? arcThrough(a, b, c) : line(a, b, dash)];
    case 'callout': return [...arrow(b, a, [line(b, a)]), label(shift(b, 6, -7), text, true)];
    case 'fib': return levels(left, Math.max(right, left + 38), first.price, change, retracements, first.time);
    case 'fibExtension': return c
      ? [path([a, b, c], dash), ...levels(c.x, Math.max(c.x + 50, width - 105), third.price, change, extensions, third.time)]
      : [line(a, b, dash)];
    case 'fibTime': case 'cycle': {
      const start = Math.round(view.index(first.time));
      return timeZones(kind, start, Math.abs(Math.round(view.index(second.time)) - start), view);
    }
    case 'fibFan': case 'gannFan': {
      const ratios = kind === 'fibFan' ? retracements.slice(1) : gannRatios;
      return ratios.flatMap(ratio => {
        const p = view.at({time: second.time, price: first.price + change * ratio});
        if (!finitePoint(p)) return [];
        const name = kind === 'fibFan' ? (ratio * 100).toFixed(1) + '%' : ratio >= 1 ? Math.round(ratio) + '×1' : '1×' + Math.round(1 / ratio);
        return [line(a, rayEnd(a, p, width, height), ratio === 1 ? {} : dash), label(shift(p, 4, -3), name)];
      });
    }
    case 'gannBox': {
      const marks = [box(a, b), line(a, b, dash), line(point(a.x, b.y), point(b.x, a.y), dash)];
      for (let i = 1; i < 8; i += 1) {
        const ratio = i / 8;
        const x = a.x + dx * ratio;
        const y = view.at({time: first.time, price: first.price + ratio * change}).y;
        marks.push(line(point(x, top), point(x, bottom), dash), line(point(left, y), point(right, y), dash));
      }
      return marks;
    }
    case 'channel': case 'fibChannel': case 'rotated': {
      if (!c || Math.hypot(dx, dy) < .001) return [line(a, b)];
      const offset = ((c.x - a.x) * -dy + (c.y - a.y) * dx) / (dx * dx + dy * dy);
      const x = -dy * offset, y = dx * offset;
      const marks = [path([a, b, shift(b, x, y), shift(a, x, y)], {fill: .11}, true)];
      if (kind === 'channel') marks.push(line(shift(a, x / 2, y / 2), shift(b, x / 2, y / 2), dash));
      if (kind === 'fibChannel') for (const ratio of [...retracements.slice(1), 1.618, 2.618]) {
        const end = shift(b, x * ratio, y * ratio);
        marks.push(line(shift(a, x * ratio, y * ratio), end, dash), label(shift(end, 4, -3), Math.round(ratio * 1000) / 10 + '%'));
      }
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
        label(point(xLabel(left + 5, 162), top + 34), timeDelta(), true)];
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
      const textX = xLabel(left + 6, 145);
      return [
        box(point(left, a.y), point(right, b.y), {color: success, fill: .19}),
        label(point(textX, b.y + (b.y < a.y ? -6 : 15)), 'TP ' + money(second.price), true, {color: success}),
        ...(c ? [
          box(point(left, a.y), point(right, c.y), {color: loss, fill: .19}),
          label(point(textX, c.y + (c.y < a.y ? -6 : 15)), 'SL ' + money(third.price), true, {color: loss}),
        ] : []),
        label(point(textX, a.y - 5), 'Entry ' + money(first.price) + (ratio ? ' · R/R ' + money(ratio.ratio) : ''), true),
      ];
    }
    default: return [];
  }
}
