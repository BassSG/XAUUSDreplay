import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import type {Bar} from './engine';
import {defaultMarketSymbol, isCryptoSymbol, marketInfoFor, type MarketSymbol} from './market-symbol';
import {spotBookQuote, spotPageSize, spotServerTime, spotSnapshot} from './binance-spot';
import {historyPage, requestMarket as request} from './live-feed';
import {historyCatalog, loadBefore, loadWindow} from './history';
import {focusBarCount} from './focused-indicators';
import {
  candleWindow, candlesFromMinutes, candlesWithBid, mergeClosedBars, minutePollSize, periods, recordBidMinute,
  prependOlderBars, readBars, readHistoryPages, readQuote, recentBarsSize, olderPageSize, type Period, type Quote,
} from './live-market';

type HistoryStatus = 'ready' | 'loading' | 'end' | 'error';
type SavedHistory = {closed: Bar[]; ended: boolean};
type MarketHistory = {
  key: string;
  period: Period;
  closed: Bar[];
  forming: Bar | null;
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
    key, period, closed: findingWindow ? emptyBars : saved?.closed ?? emptyBars, forming: null, archive: false,
    findingWindow, windowUnavailable: false, barError: false,
    historyStatus: !findingWindow && saved?.ended ? 'end' : 'ready',
  };
}

const now = () => Math.floor(Date.now() / 1000);

export function useLiveFeed(retry: number, symbol: MarketSymbol = defaultMarketSymbol) {
  const historyCache = useRef(new Map<Period, SavedHistory>());
  const [quoteState, setQuote] = useState<{quote: Quote | null; quoteError: boolean; sampled: Bar[]}>({quote: null, quoteError: false, sampled: emptyBars});
  const [minuteState, setMinutes] = useState<{rows: Bar[]; minuteError: boolean; minuteForming: Bar | null}>({
    rows: emptyBars, minuteError: false, minuteForming: null,
  });
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
    let clockRequest: Promise<void> | undefined;
    const spot = isCryptoSymbol(symbol);
    const recentLimit = spot ? spotPageSize : recentBarsSize;

    function syncSpotClock() {
      if (clock.current && performance.now() - clock.current.receivedAt < 60000) return Promise.resolve();
      return clockRequest ??= spotServerTime(signal).then(utc => {
        if (!signal.aborted) clock.current = {utc, receivedAt: performance.now()};
      }).catch(error => {
        if (!clock.current || signal.aborted) throw error;
      }).finally(() => { clockRequest = undefined; });
    }

    async function pollQuote() {
      try {
        if (spot) await syncSpotClock();
        const quote = spot ? await spotBookQuote(symbol, signal, serverNow) : readQuote(await request('quote', signal), now());
        if (signal.aborted) return;
        if (quote.time < latestTick.current) {
          setQuote(previous => previous.quoteError ? previous : {...previous, quoteError: true});
          return;
        }
        latestTick.current = quote.time;
        if (!spot) clock.current = {utc: quote.serverTime, receivedAt: performance.now()};
        setQuote(previous => ({quote, quoteError: false, sampled: spot ? emptyBars : recordBidMinute(previous.sampled, quote)}));
      } catch {
        if (!signal.aborted) setQuote(previous => previous.quoteError ? previous : {...previous, quoteError: true});
      } finally {
        if (!signal.aborted) quoteTimer = setTimeout(pollQuote, spot ? 5000 : 2500);
      }
    }

    async function pollMinutes() {
      try {
        const previous = minuteCache.current;
        const last = previous.at(-1);
        if (spot) await syncSpotClock();
        const snapshot = async (limit: number) => spot
          ? spotSnapshot(symbol, '1m', signal, serverNow, limit)
          : {closed: readBars(await request('bars/1m', signal, {limit}), periods['1m'], serverNow()), forming: null};
        let {closed: rows, forming} = await snapshot(last && !refreshMinutes ? minutePollSize : recentLimit);
        if (last && !refreshMinutes && rows[0]?.time > last.time) {
          ({closed: rows, forming} = await snapshot(recentLimit));
        }
        if (signal.aborted) return;
        if (!rows.length) throw Error('ยังไม่มีแท่ง 1 นาทีที่ปิดแล้ว');
        if (last && rows.at(-1)!.time < last.time) throw Error('แท่งหนึ่งนาทีจาก Bridge ถอยหลัง');
        const merged = mergeClosedBars(previous, rows, recentLimit);
        minuteCache.current = merged;
        refreshMinutes = false;
        setMinutes(state => state.rows === merged && !state.minuteError && !forming && !state.minuteForming
          ? state : {rows: merged, minuteError: false, minuteForming: forming});
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
  }, [retry, serverNow, symbol]);
  return {symbol, clockReady: !isCryptoSymbol(symbol) || clock.current !== null,
    ...quoteState, ...minuteState, minuteCache, serverNow, historyCache};
}

export type LiveFeed = ReturnType<typeof useLiveFeed>;

export function useLiveMarket(period: Period, retry: number, feed: LiveFeed, anchorTime: number | null = null, warm = true, enabled = true, historyTarget = focusBarCount) {
  const {symbol} = feed;
  const spot = isCryptoSymbol(symbol);
  const pollDelay = spot ? 10000 : 15000;
  const key = symbol + ':' + period + ':' + (anchorTime ?? 'latest');
  const seconds = periods[period];
  const {quote, quoteError, sampled: liveSampled, rows: liveMinutes, minuteError, minuteCache, serverNow, historyCache: cache} = feed;
  const retained = useRef({minutes:liveMinutes, sampled:liveSampled});
  if (enabled && (retained.current.minutes !== liveMinutes || retained.current.sampled !== liveSampled)) {
    retained.current = {minutes:liveMinutes,sampled:liveSampled};
  }
  const {minutes, sampled} = retained.current;
  const [data, setData] = useState(() => restoreHistory(key, period, anchorTime, cache.current.get(period)));
  const [progress, setProgress] = useState<{key: string; loaded: number} | null>(null);
  const currentData = useRef(data);
  currentData.current = data;
  const active = useRef<FeedRun | null>(null);
  const lastPoll = useRef<{key:string;retry:number;at:number} | undefined>(undefined);

  useEffect(() => {
    if (!data.archive && data.closed.length) {
      const previous = cache.current.get(data.period);
      cache.current.set(data.period, {closed: data.closed, ended: data.historyStatus === 'end' || Boolean(previous?.ended)});
    }
  }, [data.period, data.closed, data.historyStatus, data.archive]);

  useEffect(() => {
    if (!enabled) return;
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
        const snapshot = period === '1m' && cachedMinutes.length ? {closed: cachedMinutes, forming: null}
          : spot ? await spotSnapshot(symbol, period, signal, serverNow)
          : {closed: readBars(await request('bars/' + period, signal), seconds, serverNow()), forming: null};
        const rows = snapshot.closed;
        if (!rows.length) throw Error('ยังไม่มีแท่งราคาที่ปิดแล้ว');
        if (checkWindow && anchorTime !== null && rows[0].time > anchorTime) {
          try {
            const before = Math.min(serverNow(), anchorTime + seconds * 128);
            const {bars: past} = await readHistoryPages(before, historyTarget + 128, signal,
              edge => historyPage(period, edge, serverNow(), signal, symbol));
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
              const source = spot ? undefined : (await historyCatalog()).find(d => d.calendar === 'eightcap'
                && d.timeframe === seconds && d.start <= anchorTime && d.end >= anchorTime);
              if (source) {
                const {bars} = await loadWindow(source.id, anchorTime, historyTarget, 128);
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
          : {...state, closed: mergeClosedBars(state.closed, rows, Infinity), forming: snapshot.forming, barError: false, findingWindow: false});
      } catch {
        apply(state => ({...state, barError: true, findingWindow: false}));
      } finally {
        if (!signal.aborted) lastPoll.current = {key,retry,at:performance.now()};
        if (!signal.aborted && !archive && (period !== '1m' || checkWindow)) timer = setTimeout(pollBars, pollDelay);
      }
    }

    if (!archive && (period !== '1m' || checkWindow)) {
      const previous = lastPoll.current;
      const delay = !checkWindow && previous?.key === key && previous.retry === retry
        ? pollDelay - (performance.now() - previous.at) : 0;
      if (delay > 0) timer = setTimeout(pollBars,delay);
      else void pollBars();
    }
    return () => {
      controller.abort();
      if (active.current === run) active.current = null;
      clearTimeout(timer);
    };
  }, [key, period, seconds, retry, anchorTime, minuteCache, serverNow, enabled, historyTarget, spot, pollDelay, symbol]);

  useEffect(() => {
    if (!enabled || period !== '1m') return;
    setData(state => {
      if (state.key !== key || state.archive || state.findingWindow) return state;
      const closed = mergeClosedBars(state.closed, minutes, Infinity);
      return closed === state.closed && minuteError === state.barError
        ? state : {...state, closed, barError: minuteError};
    });
  }, [key, period, minutes, minuteError, data.findingWindow, enabled]);

  const view = data.key === key ? data : restoreHistory(key, period, anchorTime, cache.current.get(period));
  const useArchiveBars = view.archive || view.findingWindow;
  const studyBars = useMemo(() => useArchiveBars || spot ? view.closed : candlesFromMinutes(view.closed, minutes, seconds),
    [useArchiveBars, spot, view.closed, minutes, seconds]);
  const minuteTime = minutes.at(-1)?.time;
  const lastClosed = view.closed.at(-1);
  const forming = period === '1m' ? feed.minuteForming : view.forming;
  const bars = useMemo(() => {
    if (useArchiveBars) return studyBars;
    if (spot) return forming && forming.time > (lastClosed?.time ?? 0) ? [...studyBars, forming] : studyBars;
    return candlesWithBid(studyBars, lastClosed, minuteTime, sampled, seconds);
  }, [useArchiveBars, spot, forming, studyBars, lastClosed, minuteTime, sampled, seconds]);

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
      const dataset = !spot && (all || view.archive) ? await historyCatalog().then(datasets => datasets.find(d => d.calendar === 'eightcap'
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
              return await loadBefore(dataset.id, before, all ? dataset.count : limit);
            }
          } catch { /* Continue with broker pages if the export is unavailable. */ }
        }
        return historyPage(period, before, serverNow(), signal, symbol);
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
  }, [key, period, seconds, view.closed, view.historyStatus, view.archive, serverNow, spot, symbol]);

  const canWarm = enabled && warm && !view.findingWindow &&
    view.closed.length > 0 && view.closed.length < historyTarget;
  const shouldWarm = canWarm && view.historyStatus === 'ready';
  const warmingHistory = shouldWarm || canWarm && view.historyStatus === 'loading';
  useEffect(() => {
    if (!shouldWarm) return;
    void loadOlder(false, historyTarget - view.closed.length);
  }, [shouldWarm, loadOlder, historyTarget, view.closed.length]);

  const livePrice = spot ? bars.at(-1)?.close : quote?.bid;
  return {...view, symbol, calendar: marketInfoFor(symbol).calendar, livePrice, bars, studyBars, warmingHistory, provisional: bars !== studyBars, minutes, quote, quoteError, minuteError, minuteTime,
    serverNow, loadOlder, progress: progress?.key === key ? progress : null,
    stopHistory: () => active.current?.backfill?.abort()};
}
