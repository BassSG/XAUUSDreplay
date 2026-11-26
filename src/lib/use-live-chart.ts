import {useEffect, useMemo, useState} from 'react';
import type {Bar} from './engine';
import {historyCatalog, loadBefore} from './history';
import {livePlots, type LiveStudy} from './live-indicators';
import {candleWindow, periods, type Period} from './live-market';
import type {useLiveMarket} from './use-live-market';
import {usePine} from './use-pine';
import type {ScriptJob} from './pine.worker';

const emptyBars: Bar[] = [];
type Market = ReturnType<typeof useLiveMarket>;

export function useLiveBars(period: Period, market: Market, retry: number, anchored = false) {
  const [backup, setBackup] = useState<{period: Period; bars: Bar[]; failed?: boolean}>();
  const needsBackup = !anchored && market.barError && market.closed.length === 0;

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

export function useLiveStudies(period: Period, market: Market, bars: Bar[], historical: Bar[],
  studies: LiveStudy[], lengths: Partial<Record<LiveStudy, number>>, jobs: ScriptJob[]) {
  const builtInPlots = useMemo(() => livePlots(bars, studies, lengths), [bars, studies, lengths]);
  const minuteBased = market.bars.length > market.closed.length;
  const last = minuteBased ? market.minuteTime : market.closed.at(-1)?.time;
  const through = last === undefined ? undefined : candleWindow(last, minuteBased ? 60 : periods[period]).close;
  const pineFrame = {asOf: through ?? (bars.length ? candleWindow(bars.at(-1)!.time, periods[period]).close : 0),
    minutes: market.archive || historical.length ? emptyBars : market.minutes, nativeHistory: true};
  const pineSession = ['live', market.key, market.archive, Boolean(historical.length)].join(':');
  const pine = usePine(undefined, jobs.length > 0, bars, periods[period], pineSession, jobs,
    bars, periods[period], 'eightcap', false, pineFrame);
  const plots = useMemo(() => [...builtInPlots, ...pine.plots], [builtInPlots, pine.plots]);
  return {pine, plots, through, minuteBased};
}
