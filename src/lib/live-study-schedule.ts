import {periods, type Period} from './live-market.ts';

const order = Object.keys(periods) as Period[];
export type TimeframeWork = {ready: boolean; stale: boolean; settledKey?: string};
export type BackgroundWork = {period: Period; previousKey?: string};

export function nextBackground(active: Period, frames: Record<Period, TimeframeWork>,
  refresh: boolean, current: BackgroundWork | null): BackgroundWork | null {
  if (!frames[active].ready) return null;
  if (current && current.period !== active) {
    const frame = frames[current.period];
    if ((!frame.ready || refresh && frame.stale) && frame.settledKey === current.previousKey) return current;
  }
  const start = current ? order.indexOf(current.period) + 1 : 0;
  const candidates = [...order.slice(start), ...order.slice(0, start)].filter(period => period !== active);
  const period = candidates.find(period => !frames[period].ready)
    ?? (refresh ? candidates.find(period => frames[period].stale) : undefined);
  return period ? {period, previousKey: frames[period].settledKey} : null;
}
