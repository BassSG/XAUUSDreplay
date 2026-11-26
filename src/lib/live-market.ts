import {aggregate, brokerTimeToUtc, utcToBrokerTime, type Bar} from './engine.ts';

export const periods = {'1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400};
export type Period = keyof typeof periods;
export type Quote = {bid: number; ask: number; time: number; serverTime: number; status: 'live' | 'closed' | 'stale'};
export const olderPageSize = 1000;
export const recentBarsSize = 1500;
export const minutePollSize = 12;
type Row = Record<string, unknown>;
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;
const epoch = (value: unknown): value is number => positive(value) && Number.isSafeInteger(value);

export function sameMarketBar(a: Bar, b: Bar) {
  return a === b || (a.time === b.time && a.open === b.open && a.high === b.high &&
    a.low === b.low && a.close === b.close && a.volume === b.volume && a.spread === b.spread);
}

export function mergeClosedBars(previous: Bar[], snapshot: Bar[], capacity = 2500) {
  if (!previous.length) return snapshot.length <= capacity ? snapshot : snapshot.slice(-capacity);
  if (!snapshot.length || snapshot.at(-1)!.time < previous.at(-1)!.time) return previous;
  const overlap = previous.findIndex(bar => bar.time >= snapshot[0].time);
  const keep = overlap < 0 ? previous.length : overlap;
  const length = keep + snapshot.length;
  if (length === previous.length && length <= capacity &&
      snapshot.every((bar, i) => sameMarketBar(bar, previous[keep + i]))) return previous;
  const bars = [...previous.slice(0, keep), ...snapshot];
  return length <= capacity ? bars : bars.slice(-capacity);
}

export function barsQuery(rawEnd?: number, limit = rawEnd === undefined ? recentBarsSize : olderPageSize) {
  const query = new URLSearchParams({limit: String(limit), order: 'desc'});
  if (rawEnd !== undefined) query.set('end', String(rawEnd));
  return query;
}

// GET /api/bars filters on the broker's clock, while chart bars are UTC.
export function olderBarsEnd(before: number) {
  return utcToBrokerTime(before) - 1;
}

export function candleWindow(time: number, seconds: number) {
  const open = Math.floor(utcToBrokerTime(time) / seconds) * seconds;
  return {open: brokerTimeToUtc(open), close: brokerTimeToUtc(open + seconds)};
}

// The bridge publishes settled candles. Derive the remaining higher-timeframe
// candles from the same settled M1 stream, starting only where it covers the open.
export function candlesFromMinutes(closed: Bar[], minutes: Bar[], seconds: number): Bar[] {
  if (seconds === periods['1m'] || !minutes.length) return closed;
  const last = closed.at(-1);
  const firstMinute = minutes[0].time;
  const firstWindow = candleWindow(firstMinute, seconds);
  const firstCovered = firstMinute === firstWindow.open ? firstWindow.open : firstWindow.close;
  const nextOpen = last ? candleWindow(last.time, seconds).close : 0;
  const first = minutes.findIndex(bar => bar.time >= Math.max(firstCovered, nextOpen));
  if (first < 0) return closed;
  const tail = aggregate(minutes.slice(first), seconds, 'eightcap');
  return [...closed, ...tail];
}


const sampledMinuteLimit = 120;

export function recordBidMinute(sampled: Bar[], quote: Pick<Quote, 'time' | 'bid' | 'status'>): Bar[] {
  if (quote.status !== 'live') return sampled;
  const time = Math.floor(quote.time / 60) * 60;
  const bid = quote.bid;
  const last = sampled.at(-1);
  if (last && time < last.time) return sampled;
  if (last?.time === time) {
    if (last.close === bid) return sampled;
    return [...sampled.slice(0, -1), {...last, high: Math.max(last.high, bid), low: Math.min(last.low, bid), close: bid}];
  }
  return [...sampled.slice(-(sampledMinuteLimit - 1)), {time, open: bid, high: bid, low: bid, close: bid, volume: 0}];
}

// Settled broker rows take precedence. Quotes only extend the portion that the
// broker has yet to publish, and add no estimated tick volume.
export function candlesWithBid(base: Bar[], lastClosed: Bar | undefined, lastMinute: number | undefined,
  sampled: Bar[], seconds: number): Bar[] {
  const last = base.at(-1);
  if (!sampled.length) return base;
  const confirmedThrough = Math.max(
    lastClosed ? candleWindow(lastClosed.time, seconds).close : 0,
    lastMinute === undefined ? 0 : lastMinute + 60,
  );
  const tail = aggregate(sampled.filter(bar => bar.time >= confirmedThrough), seconds, 'eightcap')
    .filter(bar => !last || bar.time >= last.time);
  if (!tail.length) return base;
  const first = tail[0];
  if (!last || first.time > last.time) return [...base, ...tail];
  const merged = {...last, high: Math.max(last.high, first.high), low: Math.min(last.low, first.low), close: first.close};
  return [...base.slice(0, -1), merged, ...tail.slice(1)];
}

export function readOlderBars(payload: unknown, before: number, seconds: number, now: number) {
  if (Array.isArray(payload) && !payload.length) return [];
  const bars = readBars(payload, seconds, now);
  if (bars.at(-1)!.time >= before) throw Error('Bridge ส่งแท่งที่อยู่นอกช่วงย้อนหลัง');
  return bars;
}

export function prependOlderBars(current: Bar[], older: Bar[]) {
  if (!current.length || !older.length) return current;
  const rows = older.filter(bar => bar.time < current[0].time);
  return rows.length ? [...rows, ...current] : current;
}

export function liveTailUpdate(previous: Bar[], next: Bar[]) {
  if (next === previous) return true;
  if (!previous.length || next.length < previous.length || next.length > previous.length + 1) return false;
  const append = next.length > previous.length;
  const prefix = append ? previous.length : previous.length - 1;
  const expectedTime = append ? next.at(-1)!.time > previous.at(-1)!.time : next.at(-1)!.time === previous.at(-1)!.time;
  if (!expectedTime) return false;
  for (let index = 0; index < prefix; index++) {
    if (!sameMarketBar(previous[index], next[index])) return false;
  }
  return true;
}

// An empty page, rather than a short page, marks the end of the source.
export async function readHistoryPages(
  before: number, limit: number, signal: AbortSignal,
  page: (before: number) => Promise<Bar[]>, progress?: (loaded: number) => void,
) {
  const pages: Bar[][] = [];
  let loaded = 0;
  let ended = false;
  let failed = false;
  try {
    while (loaded < limit && !signal.aborted) {
      const rows = await page(before);
      if (signal.aborted) break;
      if (!rows.length) { ended = true; break; }
      if (rows.at(-1)!.time >= before) throw Error('หน้าแท่งย้อนหลังไม่ขยับ');
      pages.push(rows);
      loaded += rows.length;
      before = rows[0].time;
      progress?.(loaded);
    }
  } catch {
    failed = !signal.aborted;
  }
  return {bars: pages.reverse().flat(), ended, failed};
}

export function readBars(payload: unknown, seconds: number, now: number): Bar[] {
  if (!Array.isArray(payload) || !payload.length) throw Error('Bridge ไม่มีข้อมูลแท่งราคา');
  const rows = new Map<number, Bar>();
  for (const row of payload) {
    const {time, open, high, low, close, tick_volume, spread} = (row ?? {}) as Row;
    if (!epoch(time) || time % 60 !== 0 || !positive(open) || !positive(high) ||
        !positive(low) || !positive(close) || high < Math.max(open, close) || low > Math.min(open, close)) {
      throw Error('รูปแบบแท่งราคาจาก Bridge ไม่ถูกต้อง');
    }
    if (candleWindow(time, seconds).close > now) continue;
    if (rows.has(time)) throw Error('Bridge ส่งแท่งราคาซ้ำ');
    const volume = typeof tick_volume === 'number' && Number.isSafeInteger(tick_volume) && tick_volume >= 0 ? tick_volume : 0;
    rows.set(time, {time, open, high, low, close, volume,
      ...(typeof spread === 'number' && Number.isSafeInteger(spread) && spread >= 0 ? {spread} : {})});
  }
  if (!rows.size) throw Error('Bridge ยังไม่มีแท่งที่ปิดแล้ว');
  return [...rows.values()].sort((a, b) => a.time - b.time);
}

export function readQuote(payload: unknown, now: number): Quote {
  const row = (payload ?? {}) as Row;
  const {bid, ask, timestamp} = row;
  if (row.symbol !== 'XAUUSD' || row.source_id !== 'Eightcap-MT5-Live' || row.price_basis !== 'Bid' ||
      !positive(bid) || !positive(ask) || ask < bid || !epoch(timestamp)) {
    throw Error('รูปแบบ Quote จาก Bridge ไม่ถูกต้อง');
  }
  const age = typeof row.tick_age_seconds === 'number' && Number.isFinite(row.tick_age_seconds) && row.tick_age_seconds >= 0
    ? row.tick_age_seconds : now - timestamp;
  const live = row.quote_usable === true && row.connection_status === 'connected' &&
    row.market_status === 'open' && row.feed_status === 'fresh' && age >= -2 && age <= 120;
  return {bid, ask, time: timestamp, serverTime: timestamp + age,
    status: live ? 'live' : row.market_status === 'closed' ? 'closed' : 'stale'};
}
