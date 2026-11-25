import type {Bar} from './engine';
import type {PinePlot} from '../components/replay-chart';

export const studyNames = {ema20: 'EMA 20', ema50: 'EMA 50', rsi14: 'RSI 14'};
export type LiveStudy = keyof typeof studyNames;

function ema(bars: Bar[], length: number, color: string): PinePlot {
  const alpha = 2 / (length + 1);
  let value = bars[0]?.close ?? 0;
  return {name: 'EMA ' + length, style: 'line', overlay: true, color, width: 2,
    data: bars.map(bar => {
      value += (bar.close - value) * alpha;
      return {time: bar.time, value};
    })};
}

function rsi(bars: Bar[]): PinePlot {
  const length = 14;
  let gain = 0;
  let loss = 0;
  return {name: 'RSI 14', indicatorId: 'live-rsi14', style: 'line', overlay: false, color: '#adacf3', width: 2,
    data: bars.map((bar, index) => {
      if (!index) return {time: bar.time, value: null};
      const delta = bar.close - bars[index - 1].close;
      const up = Math.max(delta, 0);
      const down = Math.max(-delta, 0);
      if (index <= length) {
        gain += up / length;
        loss += down / length;
      } else {
        gain = (gain * (length - 1) + up) / length;
        loss = (loss * (length - 1) + down) / length;
      }
      return {time: bar.time, value: index < length ? null : loss ? 100 * gain / (gain + loss) : gain ? 100 : 50};
    })};
}

export function livePlots(bars: Bar[], studies: LiveStudy[]) {
  return studies.map(study => {
    if (study === 'ema20') return ema(bars, 20, '#e2bb70');
    if (study === 'ema50') return ema(bars, 50, '#73a9ea');
    return rsi(bars);
  });
}
