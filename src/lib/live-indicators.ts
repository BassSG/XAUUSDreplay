import type {Bar} from './engine';
import type {PinePlot} from '../components/replay-chart';

export const studyDefinitions = {
  ema20: {name: 'EMA', length: 20, color: '#e2bb70', help: 'ค่าเฉลี่ยราคาแบบเอ็กซ์โพเนนเชียล ให้น้ำหนักแท่งล่าสุดมากขึ้น'},
  ema50: {name: 'EMA', length: 50, color: '#73a9ea', help: 'EMA อีกเส้นสำหรับเทียบกับค่าเฉลี่ยคาบสั้น'},
  sma: {name: 'SMA', length: 20, color: '#eb8cbb', help: 'ค่าเฉลี่ยราคาปิดโดยให้ทุกแท่งในคาบมีน้ำหนักเท่ากัน'},
  wma: {name: 'WMA', length: 20, color: '#e4a9dc', help: 'ค่าเฉลี่ยที่ให้น้ำหนักราคาเพิ่มขึ้นตามลำดับจากแท่งเก่าไปแท่งใหม่'},
  vwma: {name: 'VWMA (Tick Volume)', length: 20, color: '#90d4b8', help: 'ค่าเฉลี่ยราคาปิดที่ถ่วงน้ำหนักด้วยจำนวน Tick ในแต่ละแท่ง'},
  bollinger: {name: 'Bollinger Bands', length: 20, color: '#78b7c8', help: 'กรอบรอบ SMA ที่ระยะ ±2 ส่วนเบี่ยงเบนมาตรฐานของราคา'},
  donchian: {name: 'Donchian Channels', length: 20, color: '#97a9ec', help: 'กรอบราคาสูงสุด–ต่ำสุดของแท่งในคาบที่เลือก'},
  keltner: {name: 'Keltner Channels', length: 20, color: '#bdacdf', help: 'กรอบรอบ EMA ที่ระยะ ±2 เท่าของ EMA ของ True Range'},
  supertrend: {name: 'Supertrend', length: 10, color: '#65d5b4', help: 'แสดงแนวโน้มด้วยกรอบที่ใช้ ATR คูณสาม โดยปรับคาบ ATR ได้'},
  rsi14: {name: 'RSI', length: 14, color: '#adacf3', help: 'เทียบแรงขึ้นและลงในช่วง 0–100 พร้อมเส้นอ้างอิง 30 และ 70'},
  stochastic: {name: 'Stochastic', length: 14, color: '#b9abed', help: 'เทียบราคาปิดกับช่วงสูง–ต่ำ ใช้ค่าเฉลี่ย 3 แท่งสำหรับ %K และ %D'},
  roc: {name: 'ROC', length: 9, color: '#82bddd', help: 'แสดงเปอร์เซ็นต์การเปลี่ยนแปลงจากราคาปิดย้อนหลังตามคาบ'},
  macd: {name: 'MACD', length: null, color: '#73a9ea', help: 'ผลต่าง EMA 12 กับ 26 พร้อมเส้น Signal 9 และฮิสโตแกรม'},
  atr: {name: 'ATR', length: 14, color: '#f0b28f', help: 'วัดความผันผวนเฉลี่ยจากช่วงราคาและช่องว่างระหว่างแท่ง'},
  volume: {name: 'Tick Volume', length: null, color: '#79a69a', help: 'แสดงจำนวน Tick ที่แหล่งข้อมูลบันทึกไว้ในแต่ละแท่ง'},
  obv: {name: 'OBV (Tick Volume)', length: null, color: '#7cc6c3', help: 'สะสมจำนวน Tick โดยบวกเมื่อราคาปิดขึ้นและลบเมื่อราคาปิดลง'},
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

function weightedAverage(values: number[], length: number) {
  let sum = 0;
  let weighted = 0;
  const divisor = length * (length + 1) / 2;
  return values.map((value, i) => {
    weighted = i < length ? weighted + (i + 1) * value : weighted - sum + length * value;
    sum += value - (i < length ? 0 : values[i - length]);
    return i < length - 1 ? null : weighted / divisor;
  });
}

function tickWeightedAverage(bars: Bar[], length: number) {
  let weighted = 0, volume = 0;
  return bars.map((bar, i) => {
    weighted += bar.close * bar.volume;
    volume += bar.volume;
    if (i >= length) {
      const expired = bars[i - length];
      weighted -= expired.close * expired.volume;
      volume -= expired.volume;
    }
    return i >= length - 1 && volume > 0 ? weighted / volume : null;
  });
}

function rollingBounds(bars: Bar[], length: number) {
  const highs: number[] = [], lows: number[] = [];
  return bars.map((bar, i) => {
    if (highs[0] <= i - length) highs.shift();
    if (lows[0] <= i - length) lows.shift();
    while (highs.length && bars[highs[highs.length - 1]].high <= bar.high) highs.pop();
    while (lows.length && bars[lows[lows.length - 1]].low >= bar.low) lows.pop();
    highs.push(i);
    lows.push(i);
    return i >= length - 1 ? {high: bars[highs[0]].high, low: bars[lows[0]].low} : null;
  });
}

function threeBarAverage(values: (number | null)[]) {
  return values.map((value, i) => {
    const first = values[i - 2], second = values[i - 1];
    return i >= 2 && value !== null && first !== null && second !== null ? (first + second + value) / 3 : null;
  });
}

function trueRanges(bars: Bar[]) {
  return bars.map((bar, i) => i ? Math.max(bar.high - bar.low,
    Math.abs(bar.high - bars[i - 1].close), Math.abs(bar.low - bars[i - 1].close)) : bar.high - bar.low);
}

function supertrend(bars: Bar[], length: number) {
  const atr = wilder(trueRanges(bars), length);
  let upper: number | undefined, lower: number | undefined;
  let rising = false;
  return bars.map((bar, i) => {
    const distance = atr[i];
    if (distance === null) return null;
    const center = (bar.high + bar.low) / 2;
    const basicUpper = center + 3 * distance;
    const basicLower = center - 3 * distance;
    const previousUpper = upper;
    upper = upper === undefined || basicUpper < upper || bars[i - 1].close > upper ? basicUpper : upper;
    lower = lower === undefined || basicLower > lower || bars[i - 1].close < lower ? basicLower : lower;
    if (previousUpper !== undefined) rising = rising ? bar.close >= lower : bar.close > upper;
    return {value: rising ? lower : upper, rising};
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
      case 'wma':
        return [plot(name, weightedAverage(closes, length), {width: 2})];
      case 'vwma':
        return [plot(name, tickWeightedAverage(bars, length), {width: 2})];
      case 'bollinger': {
        const channel = rolling(closes, length);
        return [
          plot('BB Upper', channel.map(v => v ? v.mean + 2 * v.deviation : null)),
          plot('BB Basis', channel.map(v => v?.mean ?? null), {color: muted}),
          plot('BB Lower', channel.map(v => v ? v.mean - 2 * v.deviation : null)),
        ];
      }
      case 'donchian': {
        const channel = rollingBounds(bars, length);
        return [
          plot('Donchian High', channel.map(row => row?.high ?? null)),
          plot('Donchian Mid', channel.map(row => row ? (row.high + row.low) / 2 : null), {color: muted}),
          plot('Donchian Low', channel.map(row => row?.low ?? null)),
        ];
      }
      case 'keltner': {
        const basis = exponential(closes, 2 / (length + 1));
        const range = exponential(trueRanges(bars), 2 / (length + 1));
        return [
          plot('Keltner Upper', basis.map((value, i) => value + 2 * range[i])),
          plot('Keltner Basis', basis, {color: muted}),
          plot('Keltner Lower', basis.map((value, i) => value - 2 * range[i])),
        ];
      }
      case 'supertrend': {
        const trend = supertrend(bars, length);
        return [
          plot('Supertrend ↑', trend.map(row => row?.rising ? row.value : null), {color: up, width: 2}),
          plot('Supertrend ↓', trend.map(row => row && !row.rising ? row.value : null), {color: down, width: 2}),
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
      case 'stochastic': {
        const bounds = rollingBounds(bars, length);
        const k = threeBarAverage(bounds.map((row, i) =>
          row && row.high > row.low ? 100 * (bars[i].close - row.low) / (row.high - row.low) : null));
        return [
          plot('%K', k, {overlay: false, width: 2}),
          plot('%D', threeBarAverage(k), {overlay: false, color: '#e2bb70'}),
          plot('Stochastic 80', closes.map(() => 80), {overlay: false, color: muted}),
          plot('Stochastic 20', closes.map(() => 20), {overlay: false, color: muted}),
        ];
      }
      case 'roc':
        return [plot(name, closes.map((value, i) => i < length ? null : 100 * (value - closes[i - length]) / closes[i - length]),
          {overlay: false, width: 2}), plot('ROC Zero', closes.map(() => 0), {overlay: false, color: muted})];
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
      case 'atr':
        return [plot(name, wilder(trueRanges(bars), length), {overlay: false, width: 2})];
      case 'volume':
        return [plot(name, bars.map(b => b.volume), {overlay: false, style: 'style_histogram'},
          bars.map(b => b.close >= b.open ? up : down))];
      case 'obv': {
        let running = 0;
        return [plot(name, bars.map((bar, i) => i ? running += Math.sign(bar.close - closes[i - 1]) * bar.volume : running),
          {overlay: false, width: 2})];
      }
    }
  });
}
