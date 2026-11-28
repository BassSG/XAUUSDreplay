import {useEffect, useRef, useState} from 'react';
import type {LiveStudy} from './live-indicators';
import type {Period} from './live-market';
import {focusHistoryTarget,isFocusedIndicator} from './focused-indicators';
import {useLiveBars, useLiveStudies} from './use-live-chart';
import {useLiveMarket, type LiveFeed} from './use-live-market';
import {nextBackground, type BackgroundWork} from './live-study-schedule';
import type {ScriptJob} from './pine.worker';

type Settings = {
  period: Period; anchor: number | null; retry: number; feed: LiveFeed; grid: boolean;
  studies: LiveStudy[]; lengths: Partial<Record<LiveStudy, number>>; jobs: ScriptJob[];
  testingScript: boolean; replay?:boolean;
};

function useTimeframe(period: Period, settings: Settings, historyTarget:number, target?: Period) {
  const selected = settings.period === period;
  const run = selected || target === period;
  const anchor = selected ? settings.anchor : null;
  const loaded = useRef(false);
  const fetch = settings.feed.clockReady && (run || settings.grid && loaded.current);
  const market = useLiveMarket(period, settings.retry, settings.feed, anchor, run, fetch, historyTarget);
  const prices = useLiveBars(period, market, settings.retry, anchor !== null, fetch, historyTarget);
  const waitingForNative = period !== '1m' && !market.closed.length && !market.barError;
  const waitingForHistory = market.warmingHistory &&
    (!selected || settings.jobs.some(job => isFocusedIndicator(job.builtinId)));
  const result = useLiveStudies(period, market, prices.historical, settings.studies, settings.lengths,
    settings.jobs, settings.replay || !run || waitingForNative || waitingForHistory);
  const hasData = !waitingForNative && !market.findingWindow && Boolean(market.studyBars.length || prices.historical.length);
  const failed = prices.backupFailed || (anchor !== null && (market.barError || market.windowUnavailable) && !hasData);
  const ready = failed || hasData && !waitingForHistory && (!settings.jobs.length || result.pine.settled ||
    Boolean(result.pine.error && !result.pine.calculating));
  const stale = Boolean(hasData && settings.jobs.length && result.pine.settled &&
    !result.pine.error && result.pine.settledKey !== result.pine.requestedKey);
  useEffect(() => {
    if (hasData && ready) loaded.current = true;
  }, [hasData, ready]);

  return {market, ...prices, ...result, ready, stale, settledKey:result.pine.settledKey};
}

export type LiveTimeframe = ReturnType<typeof useTimeframe>;

export function useLiveTimeframes(settings: Settings) {
  type Plan = {period: Period; retry: number; jobs: ScriptJob[]; work: BackgroundWork};
  const [plan, setPlan] = useState<Plan | null>(null);
  const canPrepare = !settings.replay && !settings.testingScript && (settings.grid || settings.jobs.length > 0 || settings.studies.length > 0);
  const current = canPrepare && plan?.period === settings.period && plan.retry === settings.retry &&
    plan.jobs === settings.jobs ? plan.work : null;
  const background = current?.period;
  const historyTarget = focusHistoryTarget(settings.jobs);

  // Each timeframe owns one Pine session. Changing the selected chart only changes
  // scheduling and rendering, so both chart layouts consume the same cached output.
  const frames = {
    '1m': useTimeframe('1m', settings, historyTarget, background),
    '5m': useTimeframe('5m', settings, historyTarget, background),
    '15m': useTimeframe('15m', settings, historyTarget, background),
    '1h': useTimeframe('1h', settings, historyTarget, background),
    '4h': useTimeframe('4h', settings, historyTarget, background),
    '1d': useTimeframe('1d', settings, historyTarget, background),
  };
  useEffect(() => {
    const work = canPrepare ? nextBackground(settings.period, frames, settings.grid, current) : null;
    if (work === current && (current || !plan)) return;
    setPlan(work ? {period:settings.period,retry:settings.retry,jobs:settings.jobs,work} : null);
  });

  return frames;
}
