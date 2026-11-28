import type {Bar} from './engine.ts';
import type {Period} from './live-market.ts';
import {isForexSymbol} from './market-symbol.ts';

// This preview endpoint is public and contains no credentials. The reported
// timestamps are raw MT5 values; their timezone has not been verified.
const forexOrigin = 'https://mixed-locally-hobbies-responded.trycloudflare.com';
const cached = new Map<string, {at: number; frames: Record<string, Bar[]>}>();
const pending = new Map<string, Promise<Record<string, Bar[]>>>();

async function fetchForex(url: string, signal: AbortSignal): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    const response = await fetch(url, {cache: 'no-store', credentials: 'omit', redirect: 'error', signal});
    if (response.status !== 429 || attempt >= 2) return response;
    const retryAfter = response.headers?.get('Retry-After');
    const seconds = retryAfter === null || retryAfter === undefined ? NaN : Number(retryAfter);
    const dateDelay = retryAfter && !Number.isFinite(seconds) ? Date.parse(retryAfter) - Date.now() : NaN;
    const delay = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000
      : Number.isFinite(dateDelay) ? Math.max(0, dateDelay) : 1000 * (attempt + 1);
    if (delay > 15000) return response;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, delay);
      function abort() { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(signal.reason); }
      signal.addEventListener('abort', abort, {once: true});
      if (signal.aborted) abort();
    });
  }
}

export async function forexHistoryPage(symbol: string, period: Period, before: number,
  signal: AbortSignal, limit = 1000): Promise<{bars: Bar[]; hasMore: boolean}> {
  if (!isForexSymbol(symbol) || !['1m','5m','15m','1h','4h','1d'].includes(period) ||
      !Number.isSafeInteger(before) || before <= 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 3000)
    throw Error('คำขอประวัติ Forex ไม่ถูกต้อง');
  const endpoint = import.meta.env?.DEV ? '/api/forex-history' : forexOrigin + '/api/bars';
  const query = new URLSearchParams({symbol, timeframe: period, limit: String(limit), before: String(before)});
  const response = await fetchForex(endpoint + '?' + query, AbortSignal.any([signal, AbortSignal.timeout(20000)]));
  if (!response.ok) throw Error('โหลดประวัติ Forex ไม่สำเร็จ');
  const payload = await response.json();
  if (payload.symbol !== symbol || payload.timeframe !== period) throw Error('Forex API ส่งข้อมูลผิดคู่หรือไทม์เฟรม');
  if (!Array.isArray(payload.bars) || typeof payload.has_more !== 'boolean' || payload.bars.length > limit)
    throw Error('Forex API ส่งหน้าประวัติไม่ถูกต้อง');
  let previous = 0;
  const bars: Bar[] = payload.bars.map((row: Record<string, unknown>) => {
    const {time, open, high, low, close, tick_volume, spread} = row;
    if (typeof time !== 'number' || !Number.isSafeInteger(time) || time <= previous || time >= before)
      throw Error('Forex API ส่งแท่งนอกช่วงย้อนหลังหรือเรียงเวลาไม่ถูกต้อง');
    if (![open, high, low, close].every(x => typeof x === 'number' && Number.isFinite(x) && x > 0) ||
        (high as number) < Math.max(open as number, close as number) ||
        (low as number) > Math.min(open as number, close as number)) throw Error('Forex API ส่งแท่งไม่ถูกต้อง');
    previous = time;
    return {time, open: open as number, high: high as number, low: low as number, close: close as number,
      volume: typeof tick_volume === 'number' && tick_volume >= 0 ? tick_volume : 0,
      ...(typeof spread === 'number' && spread >= 0 ? {spread} : {})};
  });
  if (!bars.length && payload.has_more) throw Error('Forex API แจ้งว่ามีแท่งต่อแต่ส่งหน้าว่าง');
  return {bars, hasMore: payload.has_more};
}

export async function forexSnapshot(symbol: string, period: Period, signal: AbortSignal): Promise<Bar[]> {
  if (!isForexSymbol(symbol)) throw Error('คู่ Forex ไม่ถูกต้อง');
  let item = cached.get(symbol);
  if (!item || Date.now() - item.at > 15000) {
    let task = pending.get(symbol);
    if (!task) {
      const endpoint = import.meta.env?.DEV ? '/api/forex-preview' : forexOrigin + '/api/bars/all';
      task = fetchForex(endpoint + '?' + new URLSearchParams({symbol, limit: '3000'}),
        AbortSignal.timeout(20000))
        .then(async response => {
          if (!response.ok) throw Error('Forex API ไม่ตอบกลับ');
          const payload = await response.json();
          if (payload.symbol !== symbol || !payload.timeframes || typeof payload.timeframes !== 'object')
            throw Error('Forex API ส่งข้อมูลผิดคู่');
          const frames: Record<string, Bar[]> = {};
          for (const tf of ['1m', '5m', '15m', '1h', '4h', '1d']) {
            const source = payload.timeframes[tf];
            if (!Array.isArray(source)) throw Error('Forex API ไม่มีข้อมูล ' + tf);
            const times = new Set<number>();
            frames[tf] = source.map((row: Record<string, unknown>) => {
              const {time, open, high, low, close, tick_volume, spread} = row;
              if (!Number.isSafeInteger(time) || typeof time !== 'number' || time <= 0 ||
                  ![open, high, low, close].every(x => typeof x === 'number' && Number.isFinite(x) && x > 0) ||
                  (high as number) < Math.max(open as number, close as number) ||
                  (low as number) > Math.min(open as number, close as number) || times.has(time))
                throw Error('Forex API ส่งแท่งไม่ถูกต้อง');
              times.add(time);
              return {time, open: open as number, high: high as number, low: low as number, close: close as number,
                volume: typeof tick_volume === 'number' && tick_volume >= 0 ? tick_volume : 0,
                ...(typeof spread === 'number' && spread >= 0 ? {spread} : {})};
            }).sort((a: Bar, b: Bar) => a.time - b.time);
          }
          cached.set(symbol, {at: Date.now(), frames});
          return frames;
        }).finally(() => pending.delete(symbol));
      pending.set(symbol, task);
    }
    const frames = await task;
    signal.throwIfAborted();
    item = {at: Date.now(), frames};
  }
  signal.throwIfAborted();
  return item.frames[period];
}
