import type {Bar} from './engine';
import type {PinePlot} from '../components/replay-chart';

export const studyDefinitions = {
  ema20: {name: 'EMA', length: 20, color: '#e2bb70'},
  ema50: {name: 'EMA', length: 50, color: '#73a9ea'},
  sma: {name: 'SMA', length: 20, color: '#eb8cbb'},
  bollinger: {name: 'Bollinger Bands', length: 20, color: '#78b7c8'},
  rsi14: {name: 'RSI', length: 14, color: '#adacf3'},
  macd: {name: 'MACD', length: null, color: '#73a9ea'},
  atr: {name: 'ATR', length: 14, color: '#f0b28f'},
  volume: {name: 'Tick Volume', length: null, color: '#79a69a'},
};
export type LiveStudy = keyof typeof studyDefinitions;
export type LiveStudyLengths = Partial<Record<LiveStudy, number>>;

const blue = '#73a9ea';
const muted = '#9aa7ba';
const up = '#35c4a0';
const down = '#ef6b79';

export function studyLength(study: LiveStudy, value: unknown): number | null {
  const length = studyDefinitions[study].length;
  if (length === null) return null;
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 500 ? value : length;
}

export function studyLabel(study: LiveStudy, lengths: LiveStudyLengths) {
  const name = studyDefinitions[study].name;
  const length = studyLength(study, lengths[study]);
  return length === null ? name : name + ' ' + length;
}

function exponential(values: number[], alpha: number) {
  let average = values[0];
  return values.map(value => average += (value - average) * alpha);
}

function wilder(values: number[], length: number): (number | null)[] {
  let average = 0;
  return values.map((value, i) => {
    if (i < length) average += value / length;
    else average += (value - average) / length;
    return i < length - 1 ? null : average;
  });
}

function rolling(values: number[], length: number) {
  let sum = 0;
  let squares = 0;
  return values.map((value, i) => {
    sum += value;
    squares += value ** 2;
    if (i >= length) {
      sum -= values[i - length];
      squares -= values[i - length] ** 2;
    }
    if (i < length - 1) return null;
    const mean = sum / length;
    return {mean, deviation: Math.sqrt(Math.max(0, squares / length - mean ** 2))};
  });
}

export function livePlots(bars: Bar[], studies: LiveStudy[], lengths: LiveStudyLengths = {}): PinePlot[] {
  if (!bars.length || !studies.length) return [];
  const closes = bars.map(bar => bar.close);
  return studies.flatMap(study => {
    const {color} = studyDefinitions[study];
    const length = studyLength(study, lengths[study]) ?? 1;
    const name = studyLabel(study, lengths);
    function plot(label: string, values: (number | null)[], options: Partial<PinePlot> = {}, colors?: string[]): PinePlot {
      return {
        name: label, indicatorId: 'live-' + study, indicatorName: name, style: 'line',
        overlay: true, color, width: 1, ...options,
        data: bars.map((bar, i) => ({time: bar.time, value: values[i] ?? null,
          ...(colors ? {color: colors[i]} : {})})),
      };
    }
    switch (study) {
      case 'ema20':
      case 'ema50':
        return [plot(name, exponential(closes, 2 / (length + 1)), {width: 2})];
      case 'sma':
        return [plot(name, rolling(closes, length).map(value => value?.mean ?? null), {width: 2})];
      case 'bollinger': {
        const channel = rolling(closes, length);
        return [
          plot('BB Upper', channel.map(v => v ? v.mean + 2 * v.deviation : null)),
          plot('BB Basis', channel.map(v => v?.mean ?? null), {color: muted}),
          plot('BB Lower', channel.map(v => v ? v.mean - 2 * v.deviation : null)),
        ];
      }
      case 'rsi14': {
        const deltas = closes.slice(1).map((value, i) => value - closes[i]);
        const gain = wilder(deltas.map(value => Math.max(0, value)), length);
        const loss = wilder(deltas.map(value => Math.max(0, -value)), length);
        const values = gain.map((upValue, i) => {
          const downValue = loss[i];
          if (upValue === null || downValue === null) return null;
          return downValue ? 100 * upValue / (upValue + downValue) : upValue ? 100 : 50;
        });
        return [
          plot(name, [null, ...values], {overlay: false, width: 2}),
          plot('RSI 70', closes.map(() => 70), {overlay: false, color: muted}),
          plot('RSI 30', closes.map(() => 30), {overlay: false, color: muted}),
        ];
      }
      case 'macd': {
        const fast = exponential(closes, 2 / 13);
        const slow = exponential(closes, 2 / 27);
        const macd = fast.map((value, i) => value - slow[i]);
        const signal = exponential(macd, 2 / 10);
        const histogram = macd.map((value, i) => value - signal[i]);
        return [
          plot('Histogram', histogram, {overlay: false, style: 'style_histogram'}, histogram.map(v => v >= 0 ? up : down)),
          plot('MACD', macd, {overlay: false, color: blue, width: 2}),
          plot('Signal', signal, {overlay: false, color: '#e2bb70'}),
        ];
      }
      case 'atr': {
        const ranges = bars.map((bar, i) => i ? Math.max(bar.high - bar.low,
          Math.abs(bar.high - closes[i - 1]), Math.abs(bar.low - closes[i - 1])) : bar.high - bar.low);
        return [plot(name, wilder(ranges, length), {overlay: false, width: 2})];
      }
      case 'volume':
        return [plot(name, bars.map(b => b.volume), {overlay: false, style: 'style_histogram'},
          bars.map(b => b.close >= b.open ? up : down))];
    }
  });
}
