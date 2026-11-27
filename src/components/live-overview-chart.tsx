import {useMemo, useRef, useState, type ReactNode} from 'react';
import {Maximize2, RefreshCw} from 'lucide-react';
import ChartBoundary from './chart-boundary';
import LiveStudyLegend from './live-study-legend';
import ReplayChart, {type LiveChartActions} from './replay-chart';
import type {IndicatorSpec, Trade} from '../lib/engine';
import type {LiveWorkspaceState} from '../lib/live-layouts';
import {periods, type Period} from '../lib/live-market';
import {useLiveBars, useLiveStudies} from '../lib/use-live-chart';
import {useLiveMarket, type LiveFeed} from '../lib/use-live-market';

const noTrades: Trade[] = [];

export function timeframeName(period: Period) {
  return period === '1d' ? '1D' : period;
}

export function LiveChartTile({period, active, onSelect, onExpand, children}: {
  period: Period; active: boolean; onSelect: () => void; onExpand: () => void; children: ReactNode;
}) {
  const label = timeframeName(period);
  return <article className="live-chart-tile" id={'live-tile-' + period} data-active={active} aria-label={'XAUUSD ' + label}>
    <header className="live-tile-header">
      <button type="button" className="live-tile-select" aria-pressed={active} onClick={onSelect}
        aria-label={'เลือกกราฟ ' + label} title={'เลือกกราฟ ' + label + ' สำหรับใช้งานเครื่องมือ'}>
        <strong>{label}</strong><span>XAUUSD</span>
      </button>
      {active && <span className="live-tile-active">กราฟที่เลือก</span>}
      <button type="button" className="live-tile-expand" onClick={onExpand}
        aria-label={'ขยายกราฟ ' + label} title={'ขยายกราฟ ' + label}><Maximize2 size={15}/></button>
    </header>
    <div className="live-tile-plot">{children}</div>
  </article>;
}

export default function LiveOverviewChart({period, feed, retry, onRetry, workspace, scripts, layoutVersion}: {
  period: Period; feed: LiveFeed; retry: number; onRetry: () => void;
  workspace: LiveWorkspaceState; scripts: IndicatorSpec[]; layoutVersion: number;
}) {
  const {studies, lengths, drawings, hiddenDrawings, appearance} = workspace;
  const market = useLiveMarket(period, retry, feed, null, false);
  const {bars, historical, needsBackup, backupFailed} = useLiveBars(period, market, retry);
  const {pine, plots, badges} = useLiveStudies(period, market, historical, studies, lengths, scripts);
  const visibleDrawings = useMemo(() => drawings.filter(d => (d.scope!=='chart'||d.chartPeriod===period) && (!d.visiblePeriods || d.visiblePeriods.includes(period))), [drawings, period]);
  const [follow, setFollow] = useState(true);
  const chart = useRef<LiveChartActions>(null);
  const live = !historical.length && market.quote?.status === 'live' && !market.quoteError;
  const chartKey = period + ':' + layoutVersion;
  const message = historical.length ? 'ข้อมูลสำรอง'
    : market.barError || market.minuteError ? 'แท่งยืนยันอัปเดตล่าช้า' : '';

  if (!bars.length) return <div className="live-chart-empty" role="status">
    {backupFailed ? 'โหลดแท่งราคาไม่ได้' : needsBackup ? 'กำลังโหลดข้อมูลย้อนหลัง' : 'กำลังโหลดแท่งราคา'}
    {backupFailed && <button type="button" onClick={onRetry}><RefreshCw size={14}/>ลองอีกครั้ง</button>}
  </div>;

  return <ChartBoundary resetKey={chartKey}><ReplayChart live compact readOnlyDrawings key={chartKey} liveActions={chart}
    appearance={appearance} seconds={periods[period]} bars={bars} trades={noTrades}
    liveBid={live ? market.quote?.bid : undefined} liveClock={market.serverNow}
    plots={plots} fills={pine.fills} shapes={pine.shapes} pineDrawings={pine.drawings} pineTables={pine.tables}
    calculating={pine.calculating} drawings={visibleDrawings} hiddenDrawings={hiddenDrawings}
    follow={follow} onLeaveLatest={() => setFollow(false)} onHistoryEdge={() => { void market.loadOlder(false); }}
    liveStudyBadges={badges}
    liveLegend={<><LiveStudyLegend badges={badges}/>{(message || !follow || pine.error) && <div className="live-tile-feedback">
      {message && <small title={pine.error || undefined}>{message}</small>}
      {pine.error && <button type="button" onClick={pine.retry}>ลองคำนวณใหม่</button>}
      {!follow && <button type="button" onClick={() => {
        chart.current?.latest();
        setFollow(true);
      }}>ไปแท่งล่าสุด</button>}
    </div>}</>}/></ChartBoundary>;
}
