import {barsQuery, olderBarsEnd, periods, readHistoryPages, readOlderBars, type Period} from './live-market';
import type {Bar} from './engine';
import {maxPineSourceBars, type PineHistoryQuery} from './live-pine';
import {historyCatalog, loadBefore} from './history';
import {spotSnapshot} from './binance-spot';
import {defaultMarketSymbol, isCryptoSymbol, type MarketSymbol} from './market-symbol';

const pagesOrigin = 'https://basssg.github.io';
const pagesBridge = 'https://anything-mrna-work-voted.trycloudflare.com';
const alternateBridge = 'https://theft-volatile-relock.ngrok-free.dev';

export async function requestMarket(route: string, signal: AbortSignal, options: {end?: number; limit?: number} = {}) {
  const publicBridge = import.meta.env.VITE_XAU_LIVE_PUBLIC_ORIGIN ||
    (location.origin === pagesOrigin ? pagesBridge : undefined);
  const suffix = route.startsWith('bars/') ? '?' + barsQuery(options.end, options.limit).toString() : '';
  async function fetchJSON(url: string, useNgrok: boolean) {
    const headers = new Headers({Accept: 'application/json'});
    if (useNgrok) headers.set('ngrok-skip-browser-warning', '1');
    const response = await fetch(url, {cache: 'no-store', credentials: 'omit', redirect: 'error', headers,
      signal: AbortSignal.any([signal, AbortSignal.timeout(6500)])});
    if (!response.ok) throw Error('Bridge ไม่ตอบกลับ');
    return response.json() as Promise<unknown>;
  }
  if (!publicBridge) return fetchJSON('/api/xau-live/' + route + suffix, false);
  const url = new URL('/api/' + route + suffix, publicBridge);
  try {
    return await fetchJSON(url.href, url.hostname.endsWith('.ngrok-free.dev'));
  } catch (error) {
    if (signal.aborted || url.origin !== pagesBridge) throw error;
    return fetchJSON(new URL(url.pathname + url.search, alternateBridge).href, true);
  }
}

export function historyPage(period: Period, before: number, now: number, signal: AbortSignal, symbol: MarketSymbol = defaultMarketSymbol) {
  if (isCryptoSymbol(symbol)) return spotSnapshot(symbol, period, signal, () => now, undefined, before).then(result => result.closed);
  return requestMarket('bars/' + period, signal, {end: olderBarsEnd(before)})
    .then(payload => readOlderBars(payload, before, periods[period], now));
}

export function createPineHistoryLoader(symbol: MarketSymbol = defaultMarketSymbol) {
  const windows = new Map<string, {bars: Bar[]; ended: boolean}>();
  const broker = symbol === 'XAUUSD';
  return async ({period, before, limit}: PineHistoryQuery, asOf: number, signal: AbortSignal, preferArchive = false) => {
    // Only accept read requests for the six known market routes up to this frame.
    if (!Object.hasOwn(periods, period) || !Number.isSafeInteger(before) ||
        before <= 0 || before > asOf || !Number.isSafeInteger(limit) || limit < 1 || limit > maxPineSourceBars) return [];
    const key = period + ':' + before;
    const saved = windows.get(key);
    if (saved && (saved.ended || saved.bars.length >= limit)) return saved.bars.slice(-limit);
    if (broker && preferArchive) {
      const archive=(await historyCatalog().catch(()=>[])).find(d=>d.calendar==='eightcap' && d.timeframe===periods[period]
        && d.start<before && d.end+periods[period]>=before);
      if (archive) {
        const bars=await loadBefore(archive.id,before,limit).catch(()=>[]);
        if (bars.length) {
          windows.set(key,{bars,ended:bars.length<limit});
          if(windows.size>24)windows.delete(windows.keys().next().value!);
          return bars;
        }
      }
    }
    const now = Date.now() / 1000;
    const result = await readHistoryPages(saved?.bars[0]?.time ?? before, limit - (saved?.bars.length ?? 0), signal,
      edge => historyPage(period, edge, now, signal, symbol));
    if (signal.aborted) return [];
    let bars = [...result.bars, ...(saved?.bars ?? [])];
    if (broker && !bars.length) {
      const dataset = (await historyCatalog().catch(() => [])).find(d =>
        d.calendar === 'eightcap' && d.timeframe === periods[period] && d.start < before &&
        d.end + periods[period] >= before);
      if (dataset) bars = await loadBefore(dataset.id, before, limit).catch(() => []);
    }
    if (bars.length || result.ended) {
      windows.set(key, {bars, ended: result.ended});
      if (windows.size > 24) windows.delete(windows.keys().next().value!);
    }
    return bars.slice(-limit);
  };
}
