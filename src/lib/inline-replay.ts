import {aggregate,type Bar} from './engine.ts';
import {candleWindow,periods,type Period} from './live-market.ts';

export type ReplayTape = {bars:Bar[];period:Period;dataset?:string;end:number};

export function replayFrame(tape: Pick<ReplayTape,'bars'|'period'>, cursor: number, period: Period, history: Bar[]) {
  const seconds=periods[period], base=periods[tape.period];
  if (seconds<base || !tape.bars[cursor]) return null;
  const revealed=tape.bars.slice(0,cursor+1);
  const asOf=candleWindow(revealed.at(-1)!.time,base).close;
  if (seconds===base) return {bars:history.length?[...history.filter(bar=>bar.time<revealed[0].time),...revealed]:revealed,revealed,asOf};
  const first=candleWindow(revealed[0].time,seconds);
  const firstCovered=revealed[0].time===first.open?first.open:first.close;
  const earlier=history.filter(bar=>bar.time<firstCovered&&candleWindow(bar.time,seconds).close<=asOf);
  const aggregateBars=aggregate(revealed,seconds,'eightcap').filter(bar=>bar.time>=firstCovered);
  return {bars:[...earlier,...aggregateBars],revealed,asOf};
}
