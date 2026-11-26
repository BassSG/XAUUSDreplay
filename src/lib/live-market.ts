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
  const last = closed.at(-1);
  if (seconds === periods['1m'] || !last || !minutes.length) return closed;
  const nextOpen = candleWindow(last.time, seconds).close;
  if (minutes[0].time > nextOpen || minutes.at(-1)!.time < nextOpen) return closed;
  const tail = aggregate(minutes.slice(minutes.findIndex(bar => bar.time >= nextOpen)), seconds, 'eightcap');
  return [...closed, ...tail];
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
