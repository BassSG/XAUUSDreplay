import type {Bar} from './engine.ts';
import {periods, type Period, type Quote} from './live-market.ts';

const base = 'https://api.binance.th/api/v1/';
export const spotPageSize = 1000;
let pauseUntil = 0;

async function spotJSON(path: string, signal: AbortSignal) {
  if (Date.now() < pauseUntil) throw Error('Binance TH จำกัดคำขอชั่วคราว');
  const response = await fetch(base + path, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(6500)]),
    credentials: 'omit', cache: 'no-store', redirect: 'error',
  });
  if (response.status === 429 || response.status === 418) {
    const seconds = Number(response.headers.get('retry-after'));
    pauseUntil = Date.now() + 1000 * Math.max(response.status === 418 ? 120 : 30, seconds || 0);
  }
  if (!response.ok) throw Error('Binance TH ตอบ HTTP ' + response.status);
  return response.json() as Promise<unknown>;
}

function price(value: unknown): number {
  if (typeof value !== 'string' && typeof value !== 'number') return NaN;
  if (typeof value === 'string' && !value.trim()) return NaN;
  return Number(value);
}

export function readSpotKlines(payload: unknown, period: Period, nowMs: number) {
  if (!Array.isArray(payload)) throw Error('รูปแบบแท่งราคา Binance TH ไม่ถูกต้อง');
  const duration = periods[period] * 1000;
  const closed: Bar[] = [];
  let forming: Bar | null = null;
  let previousOpen = -1;
  for (const row of payload) {
    if (!Array.isArray(row)) throw Error('รูปแบบแท่งราคา Binance TH ไม่ถูกต้อง');
    const [openMs, rawOpen, rawHigh, rawLow, rawClose, rawVolume, closeMs] = row;
    const [open, high, low, close, volume] = [rawOpen, rawHigh, rawLow, rawClose, rawVolume].map(price);
    const boundary = openMs + duration;
    if (!Number.isSafeInteger(openMs) || openMs <= previousOpen || openMs % duration !== 0 ||
        !Number.isSafeInteger(closeMs) || closeMs < openMs || closeMs >= boundary ||
        ![open, high, low, close, volume].every(Number.isFinite) ||
        Math.min(open, high, low, close) <= 0 || volume < 0 ||
        high < Math.max(open, close) || low > Math.min(open, close)) {
      throw Error('ข้อมูล OHLC หรือเวลาแท่งจาก Binance TH ไม่ถูกต้อง');
    }
    previousOpen = openMs;
    const bar = {time: openMs / 1000, open, high, low, close, volume};
    // Binance can shorten historical bars after a trading interruption.
    if (boundary <= nowMs) closed.push(bar);
    else if (openMs <= nowMs) forming = bar;
  }
  return {closed, forming};
}

export async function spotSnapshot(period: Period, signal: AbortSignal, now: () => number, limit = spotPageSize, before?: number) {
  const params = new URLSearchParams({symbol: 'BTCUSDT', interval: period, limit: String(Math.min(spotPageSize, limit))});
  if (before !== undefined) params.set('endTime', String(before * 1000 - 1));
  const rows = await spotJSON('klines?' + params, signal);
  const snapshot = readSpotKlines(rows, period, now() * 1000);
  if (before !== undefined && (snapshot.closed.at(-1)?.time ?? 0) >= before) throw Error('หน้าแท่งย้อนหลัง Binance TH ไม่ขยับ');
  return snapshot;
}

export async function spotServerTime(signal: AbortSignal) {
  const {serverTime} = await spotJSON('time', signal) as {serverTime?: number};
  if (typeof serverTime !== 'number' || !Number.isSafeInteger(serverTime) || serverTime <= 0) {
    throw Error('เวลาเซิร์ฟเวอร์ Binance TH ไม่ถูกต้อง');
  }
  return serverTime / 1000;
}

export async function spotBookQuote(signal: AbortSignal, now: () => number): Promise<Quote> {
  const row = await spotJSON('ticker/bookTicker?symbol=BTCUSDT', signal) as {symbol?: string; bidPrice?: unknown; askPrice?: unknown};
  const bid = price(row.symbol === 'BTCUSDT' ? row.bidPrice : undefined);
  const ask = price(row.askPrice);
  if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask < bid) {
    throw Error('Bid/Ask จาก Binance TH ไม่ถูกต้อง');
  }
  const time = now();
  return {bid, ask, time, serverTime: time, status: 'live'};
}
