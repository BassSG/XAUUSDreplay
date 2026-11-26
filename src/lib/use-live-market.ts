import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import type {Bar} from './engine';
import {
  barsQuery, candleWindow, candlesFromMinutes, mergeClosedBars, minutePollSize, olderBarsEnd, periods,
  prependOlderBars, readBars, readOlderBars, readQuote, recentBarsSize, type Period, type Quote,
} from './live-market';

type HistoryStatus = 'ready' | 'loading' | 'end' | 'error';
type SavedHistory = {closed: Bar[]; ended: boolean};
type MarketHistory = {
  key: string;
  period: Period;
  closed: Bar[];
  archive: boolean;
  findingWindow: boolean;
  windowUnavailable: boolean;
  barError: boolean;
  historyStatus: HistoryStatus;
};
type FeedRun = {key: string; signal: AbortSignal; loadingOlder: boolean};
type RequestBars = {end?: number; limit?: number};
const emptyBars: Bar[] = [];

function restoreHistory(
  key: string, period: Period, anchorTime: number | null, saved: SavedHistory | undefined,
): MarketHistory {
  const findingWindow = anchorTime !== null && (!saved?.closed.length || saved.closed[0].time > anchorTime);
  return {
    key, period, closed: findingWindow ? emptyBars : saved?.closed ?? emptyBars, archive: false,
    findingWindow, windowUnavailable: false, barError: false,
    historyStatus: !findingWindow && saved?.ended ? 'end' : 'ready',
  };
}

const now = () => Math.floor(Date.now() / 1000);
const pagesOrigin = 'https://basssg.github.io';
const pagesBridge = 'https://anything-mrna-work-voted.trycloudflare.com';
const alternateBridge = 'https://theft-volatile-relock.ngrok-free.dev';

async function request(route: string, signal: AbortSignal, options: RequestBars = {}) {
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

function useLiveFeed(retry: number) {
  const [quoteState, setQuote] = useState<{quote: Quote | null; quoteError: boolean}>({quote: null, quoteError: false});
  const [minuteState, setMinutes] = useState({rows: emptyBars, minuteError: false});
  const minuteCache = useRef(emptyBars);
  const clock = useRef<{utc: number; receivedAt: number} | null>(null);
  const latestTick = useRef(0);
  const serverNow = useCallback(() => {
    const sample = clock.current;
    return sample ? Math.floor(sample.utc + (performance.now() - sample.receivedAt) / 1000) : now();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const {signal} = controller;
    let quoteTimer: ReturnType<typeof setTimeout>;
    let minuteTimer: ReturnType<typeof setTimeout>;
    let refreshMinutes = true;

    async function pollQuote() {
      try {
        const quote = readQuote(await request('quote', signal), now());
        if (signal.aborted) return;
        if (quote.time < latestTick.current) {
          setQuote(previous => previous.quoteError ? previous : {...previous, quoteError: true});
          return;
        }
        latestTick.current = quote.time;
        clock.current = {utc: quote.serverTime, receivedAt: performance.now()};
        setQuote({quote, quoteError: false});
      } catch {
        if (!signal.aborted) setQuote(previous => previous.quoteError ? previous : {...previous, quoteError: true});
      } finally {
        if (!signal.aborted) quoteTimer = setTimeout(pollQuote, 2500);
      }
    }

    async function pollMinutes() {
      try {
        const previous = minuteCache.current;
        const last = previous.at(-1);
        let rows = readBars(await request('bars/1m', signal, {limit: last && !refreshMinutes ? minutePollSize : recentBarsSize}),
          periods['1m'], serverNow());
        if (last && !refreshMinutes && rows[0].time > last.time) {
          rows = readBars(await request('bars/1m', signal), periods['1m'], serverNow());
        }
        if (signal.aborted) return;
        if (last && rows.at(-1)!.time < last.time) throw Error('แท่งหนึ่งนาทีจาก Bridge ถอยหลัง');
        const merged = mergeClosedBars(previous, rows, recentBarsSize);
        minuteCache.current = merged;
        refreshMinutes = false;
        setMinutes(state => state.rows === merged && !state.minuteError ? state : {rows: merged, minuteError: false});
      } catch {
        if (!signal.aborted) setMinutes(state => state.minuteError ? state : {...state, minuteError: true});
      } finally {
        if (!signal.aborted) minuteTimer = setTimeout(pollMinutes, 3000);
      }
    }

    void pollQuote();
    void pollMinutes();
    return () => {
      controller.abort();
      clearTimeout(quoteTimer);
      clearTimeout(minuteTimer);
    };
  }, [retry, serverNow]);
  return {...quoteState, ...minuteState, minuteCache, serverNow};
}

export function useLiveMarket(period: Period, retry: number, anchorTime: number | null = null) {
  const key = period + ':' + (anchorTime ?? 'latest');
  const seconds = periods[period];
  const {quote, quoteError, rows: minutes, minuteError, minuteCache, serverNow} = useLiveFeed(retry);
  const [data, setData] = useState(() => restoreHistory(key, period, anchorTime, undefined));
  const currentData = useRef(data);
  currentData.current = data;
  const active = useRef<FeedRun | null>(null);
  const cache = useRef(new Map<Period, SavedHistory>());

  useEffect(() => {
    if (!data.archive && data.closed.length) {
      const previous = cache.current.get(data.period);
      cache.current.set(data.period, {closed: data.closed, ended: data.historyStatus === 'end' || Boolean(previous?.ended)});
    }
  }, [data.period, data.closed, data.historyStatus, data.archive]);

  useEffect(() => {
    const controller = new AbortController();
    const {signal} = controller;
    const run = {key, signal, loadingOlder: false};
    active.current = run;
    let timer: ReturnType<typeof setTimeout>;
    const initial = restoreHistory(key, period, anchorTime, cache.current.get(period));
    let checkWindow = initial.findingWindow;
    let archive = currentData.current.key === key && currentData.current.archive;
    const apply = (change: (state: MarketHistory) => MarketHistory) => {
      if (!signal.aborted) setData(state => signal.aborted || state.key !== key ? state : change(state));
    };
    setData(current => current.key !== key ? initial
      : current.historyStatus === 'loading' ? {...current, historyStatus: 'ready'} : current);

    async function pollBars() {
      try {
        const cachedMinutes = minuteCache.current;
        const rows = period === '1m' && cachedMinutes.length ? cachedMinutes
          : readBars(await request('bars/' + period, signal), seconds, serverNow());
        if (checkWindow && anchorTime !== null && rows[0].time > anchorTime) {
          try {
            const end = olderBarsEnd(Math.min(serverNow(), anchorTime + seconds * 128));
            const past = readBars(await request('bars/' + period, signal, {end}), seconds, serverNow());
            if (past[0].time > anchorTime || candleWindow(past.at(-1)!.time, seconds).close < anchorTime) {
              throw Error('ช่วงนี้ไม่มีแท่งราคาที่ขอ');
            }
            archive = true;
            checkWindow = false;
            apply(state => ({...state, closed: past, archive: true, findingWindow: false,
              historyStatus: 'ready', windowUnavailable: false, barError: false}));
            return;
          } catch {
            if (signal.aborted) return;
            apply(state => ({...state, windowUnavailable: true}));
          }
        }
        checkWindow = false;
        apply(state => rows.at(-1)!.time < (state.closed.at(-1)?.time ?? 0)
          ? {...state, barError: true, findingWindow: false}
          : {...state, closed: mergeClosedBars(state.closed, rows, Infinity), barError: false, findingWindow: false});
      } catch {
        apply(state => ({...state, barError: true, findingWindow: false}));
      } finally {
        if (!signal.aborted && !archive && (period !== '1m' || checkWindow)) timer = setTimeout(pollBars, 15000);
      }
    }

    if (!archive && (period !== '1m' || checkWindow)) void pollBars();
    return () => {
      controller.abort();
      if (active.current === run) active.current = null;
      clearTimeout(timer);
    };
  }, [key, period, seconds, retry, anchorTime, minuteCache, serverNow]);

  useEffect(() => {
    if (period !== '1m') return;
    setData(state => {
      if (state.key !== key || state.archive || state.findingWindow) return state;
      const closed = mergeClosedBars(state.closed, minutes, Infinity);
      return closed === state.closed && minuteError === state.barError
        ? state : {...state, closed, barError: minuteError};
    });
  }, [key, period, minutes, minuteError, data.findingWindow]);

  const view = data.key === key ? data : restoreHistory(key, period, anchorTime, cache.current.get(period));
  const bars = useMemo(() => view.archive ? view.closed : candlesFromMinutes(view.closed, minutes, seconds),
    [view.archive, view.closed, minutes, seconds]);

  const loadOlder = useCallback(async (byUser: boolean) => {
    const run = active.current;
    const first = view.closed[0];
    if (!run || run.key !== key || !first || run.loadingOlder ||
        view.historyStatus === 'loading' || view.historyStatus === 'end' ||
        (view.historyStatus === 'error' && !byUser)) return;
    run.loadingOlder = true;
    const apply = (update: (current: MarketHistory) => MarketHistory) => {
      if (!run.signal.aborted) setData(current => current.key === key && !run.signal.aborted ? update(current) : current);
    };
    apply(current => ({...current, historyStatus: 'loading'}));
    try {
      const rows = readOlderBars(await request('bars/' + period, run.signal, {end: olderBarsEnd(first.time)}),
        first.time, seconds, serverNow());
      apply(current => ({
        ...current, closed: prependOlderBars(current.closed, rows), historyStatus: rows.length ? 'ready' : 'end',
      }));
    } catch {
      apply(current => ({...current, historyStatus: 'error'}));
    } finally {
      run.loadingOlder = false;
    }
  }, [key, period, seconds, view.closed, view.historyStatus, serverNow]);

  return {...view, bars, quote, quoteError, minuteError, minuteTime: minutes.at(-1)?.time, serverNow, loadOlder};
}
