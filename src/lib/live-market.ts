import type {Bar} from './engine.ts';

export const periods = {'1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400};
export type Period = keyof typeof periods;
export type Quote = {bid: number; ask: number; time: number; status: 'live' | 'closed' | 'stale'};
type Row = Record<string, unknown>;
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;
const epoch = (value: unknown): value is number => positive(value) && Number.isSafeInteger(value);

export function readBars(payload: unknown, seconds: number, now: number): Bar[] {
  if (!Array.isArray(payload) || !payload.length) throw Error('Bridge ไม่มีข้อมูลแท่งราคา');
  const rows = new Map<number, Bar>();
  for (const row of payload) {
    const {time, open, high, low, close, tick_volume, spread} = (row ?? {}) as Row;
    if (!epoch(time) || time % 60 !== 0 || !positive(open) || !positive(high) ||
        !positive(low) || !positive(close) || high < Math.max(open, close) || low > Math.min(open, close)) {
      throw Error('รูปแบบแท่งราคาจาก Bridge ไม่ถูกต้อง');
    }
    if (time + seconds > now) continue;
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
  const live = row.quote_usable === true && row.connection_status === 'connected' &&
    row.market_status === 'open' && row.feed_status === 'fresh' && now - timestamp >= -2 && now - timestamp <= 120;
  return {bid, ask, time: timestamp, status: live ? 'live' : row.market_status === 'closed' ? 'closed' : 'stale'};
}

// The bridge provides closed bars. Sample the next bar only when its boundary
// follows a confirmed broker bar; closed OHLC always replaces our observations.
export function sampleOpenBar(closed: Bar | undefined, previous: Bar | null, quote: Quote, seconds: number): Bar | null {
  if (!closed || quote.status !== 'live') return null;
  const time = closed.time + seconds;
  if (quote.time < time || quote.time >= time + seconds) return null;
  const price = quote.bid;
  if (previous?.time === time) {
    if (previous.close === price) return previous;
    return {...previous, high: Math.max(previous.high, price), low: Math.min(previous.low, price), close: price};
  }
  return {time, open: price, high: price, low: price, close: price, volume: 0};
}
