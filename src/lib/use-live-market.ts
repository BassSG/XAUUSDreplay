import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import type {Bar} from './engine';
import {historyPage, requestMarket as request} from './live-feed';
import {historyCatalog, loadBefore, loadWindow} from './history';
import {
  candleWindow, candlesFromMinutes, mergeClosedBars, minutePollSize, periods,
  prependOlderBars, readBars, readHistoryPages, readQuote, recentBarsSize, olderPageSize, type Period, type Quote,
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
type FeedRun = {key: string; signal: AbortSignal; backfill: AbortController | null};
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

export function useLiveFeed(retry: number) {
  const historyCache = useRef(new Map<Period, SavedHistory>());
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
  return {...quoteState, ...minuteState, minuteCache, serverNow, historyCache};
}

export type LiveFeed = ReturnType<typeof useLiveFeed>;

export function useLiveMarket(period: Period, retry: number, feed: LiveFeed, anchorTime: number | null = null, warm = true) {
  const key = period + ':' + (anchorTime ?? 'latest');
  const seconds = periods[period];
  const {quote, quoteError, rows: minutes, minuteError, minuteCache, serverNow, historyCache: cache} = feed;
  const [data, setData] = useState(() => restoreHistory(key, period, anchorTime, cache.current.get(period)));
  const [progress, setProgress] = useState<{key: string; loaded: number} | null>(null);
  const currentData = useRef(data);
  currentData.current = data;
  const active = useRef<FeedRun | null>(null);

  useEffect(() => {
    if (!data.archive && data.closed.length) {
      const previous = cache.current.get(data.period);
      cache.current.set(data.period, {closed: data.closed, ended: data.historyStatus === 'end' || Boolean(previous?.ended)});
    }
  }, [data.period, data.closed, data.historyStatus, data.archive]);

  useEffect(() => {
    const controller = new AbortController();
    const {signal} = controller;
    const run: FeedRun = {key, signal, backfill: null};
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
            const before = Math.min(serverNow(), anchorTime + seconds * 128);
            const past = await historyPage(period, before, serverNow(), signal);
            if (!past.length || past[0].time > anchorTime) {
              throw Error('ช่วงนี้ไม่มีแท่งราคาที่ขอ');
            }
            archive = true;
            checkWindow = false;
            apply(state => ({...state, closed: past, archive: true, findingWindow: false,
              historyStatus: 'ready', windowUnavailable: false, barError: false}));
            return;
          } catch {
            if (signal.aborted) return;
            try {
              const source = (await historyCatalog()).find(d => d.calendar === 'eightcap'
                && d.timeframe === seconds && d.start <= anchorTime && d.end >= anchorTime);
              if (source) {
                const {bars} = await loadWindow(source.id, anchorTime, olderPageSize, 128);
                archive = true;
                checkWindow = false;
                apply(state => ({...state, closed: bars, archive: true, findingWindow: false, barError: false}));
                return;
              }
            } catch { /* Continue to latest when the archive is unavailable. */ }
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

  const loadOlder = useCallback(async (byUser: boolean, limit = olderPageSize) => {
    const run = active.current;
    const first = view.closed[0];
    if (!run || run.key !== key || !first || run.backfill ||
        view.historyStatus === 'end' || (view.historyStatus === 'error' && !byUser)) return false;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, run.signal]);
    const all = limit === Infinity;
    run.backfill = controller;
    if (all) setProgress({key, loaded: 0});
    const apply = (update: (current: MarketHistory) => MarketHistory) => {
      if (!run.signal.aborted) setData(current => current.key === key && !run.signal.aborted ? update(current) : current);
    };
    apply(current => ({...current, historyStatus: 'loading'}));
    try {
      const dataset = all ? await historyCatalog().then(datasets => datasets.find(d => d.calendar === 'eightcap'
        && d.timeframe === seconds)).catch(() => undefined) : undefined;
      const read = async (before: number) => {
        if (dataset && dataset.start < before && dataset.end >= before) {
          try {
            // Join the bundled export only at a matching Eightcap candle.
            const [overlap, broker] = await Promise.all([
              loadBefore(dataset.id, before + 1, 1),
              before === first.time ? [first] : historyPage(period, before + 1, serverNow(), signal),
            ]);
            const local = overlap.at(-1), remote = broker.at(-1);
            if (local && remote && local.time === before && remote.time === before &&
                local.open === remote.open && local.high === remote.high &&
                local.low === remote.low && local.close === remote.close) {
              return await loadBefore(dataset.id, before, dataset.count);
            }
          } catch { /* Continue with broker pages if the export is unavailable. */ }
        }
        return historyPage(period, before, serverNow(), signal);
      };
      const result = await readHistoryPages(first.time, limit, signal, read,
        all ? loaded => { if (!signal.aborted) setProgress({key, loaded}); } : undefined);
      apply(current => ({
        ...current, closed: prependOlderBars(current.closed, result.bars),
        historyStatus: result.failed ? 'error' : result.ended ? 'end' : 'ready',
      }));
      return !signal.aborted && !result.failed;
    } finally {
      run.backfill = null;
      if (all && !run.signal.aborted) setProgress(null);
    }
  }, [key, period, seconds, view.closed, view.historyStatus, serverNow]);

  const warmed = useRef(new Set<Period>());
  useEffect(() => {
    if (!warm || anchorTime !== null || view.archive || view.closed.length < recentBarsSize ||
        view.historyStatus !== 'ready' || warmed.current.has(period)) return;
    warmed.current.add(period);
    if (view.closed.length < recentBarsSize + 2 * olderPageSize) void loadOlder(false, 2 * olderPageSize);
  }, [warm, anchorTime, period, view.archive, view.closed.length, view.historyStatus, loadOlder]);

  return {...view, bars, minutes, quote, quoteError, minuteError, minuteTime: minutes.at(-1)?.time,
    serverNow, loadOlder, progress: progress?.key === key ? progress : null,
    stopHistory: () => active.current?.backfill?.abort()};
}
