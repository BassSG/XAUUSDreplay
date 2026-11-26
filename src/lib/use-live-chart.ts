import {useEffect, useMemo, useState} from 'react';
import type {Bar} from './engine';
import {historyCatalog, loadBefore} from './history';
import {livePlots, studyLabel, type LiveStudy, type LiveStudyBadge} from './live-indicators';
import {candleWindow, periods, type Period} from './live-market';
import type {useLiveMarket} from './use-live-market';
import {usePine} from './use-pine';
import type {ScriptJob} from './pine.worker';

const emptyBars: Bar[] = [];
type Market = ReturnType<typeof useLiveMarket>;

export function useLiveBars(period: Period, market: Market, retry: number, anchored = false) {
  const [backup, setBackup] = useState<{period: Period; bars: Bar[]; failed?: boolean}>();
  const needsBackup = !anchored && market.barError && market.bars.length === 0;

  useEffect(() => {
    if (!needsBackup) return;
    let active = true;
    async function loadBackup() {
      try {
        const datasets = await historyCatalog();
        const dataset = datasets.filter(d => d.timeframe === periods[period] && d.id.startsWith('eightcap-'))
          .sort((a, b) => b.end - a.end)[0];
        const bars = dataset ? await loadBefore(dataset.id, dataset.end + 1, 1500) : [];
        if (active) setBackup({period, bars, failed: !bars.length});
      } catch {
        if (active) setBackup({period, bars: [], failed: true});
      }
    }
    void loadBackup();
    return () => { active = false; };
  }, [period, needsBackup, retry]);

  const historical = needsBackup && backup?.period === period ? backup.bars : emptyBars;
  const bars = market.bars.length ? market.bars : historical;
  return {bars, historical, needsBackup, backupFailed: backup?.period === period && backup.failed};
}

export function useLiveStudies(period: Period, market: Market, historical: Bar[],
  studies: LiveStudy[], lengths: Partial<Record<LiveStudy, number>>, jobs: ScriptJob[]) {
  const sourceBars = historical.length ? historical : market.studyBars;
  const builtInPlots = useMemo(() => livePlots(sourceBars, studies, lengths), [sourceBars, studies, lengths]);
  const minuteBased = market.studyBars.length > market.closed.length;
  const last = minuteBased ? market.minuteTime : market.closed.at(-1)?.time;
  const through = last === undefined ? undefined : candleWindow(last, minuteBased ? 60 : periods[period]).close;
  const pineFrame = {asOf: through ?? (sourceBars.length ? candleWindow(sourceBars.at(-1)!.time, periods[period]).close : 0),
    minutes: market.archive || historical.length ? emptyBars : market.minutes, nativeHistory: true};
  const pineSession = ['live', market.key, market.archive, Boolean(historical.length)].join(':');
  const pine = usePine(undefined, jobs.length > 0, sourceBars, periods[period], pineSession, jobs,
    sourceBars, periods[period], 'eightcap', false, pineFrame);
  const plots = useMemo(() => [...builtInPlots, ...pine.plots], [builtInPlots, pine.plots]);
  const completed = pine.completed.key === pine.requestedKey ? pine.completed.studies : [];
  const badges: LiveStudyBadge[] = studies.map(study => ({
    id: 'live-' + study, label: studyLabel(study, lengths), state: sourceBars.length ? 'ready' : 'loading',
  }));
  for (const job of jobs) {
    const result = completed.find(study => study.id === job.id);
    const state = result ? (result.error ? 'error' : 'ready') : pine.error && !pine.calculating ? 'error' : 'loading';
    badges.push({id: job.id, label: job.name, state});
  }
  return {pine, plots, through, minuteBased, badges};
}
