import {useMemo, useRef, useState, type ReactNode} from 'react';
import {Maximize2, RefreshCw} from 'lucide-react';
import ChartBoundary from './chart-boundary';
import LiveStudyLegend from './live-study-legend';
import ReplayChart, {type LiveChartActions} from './replay-chart';
import type {Trade} from '../lib/engine';
import type {LiveWorkspaceState} from '../lib/live-layouts';
import {periods, type Period} from '../lib/live-market';
import type {InlineReplayChartFrame} from '../lib/use-inline-replay-studies';
import type {LiveTimeframe} from '../lib/use-live-timeframes';
import {marketInfo, type MarketSymbol} from '../lib/market-symbol';

const noTrades: Trade[] = [];

export function timeframeName(period: Period) {
  return period === '1d' ? '1D' : period;
}

export function LiveChartTile({symbol, period, active, onSelect, onExpand, children, available=true}: {
  symbol: MarketSymbol; period: Period; active: boolean; available?:boolean; onSelect: () => void; onExpand: () => void; children: ReactNode;
}) {
  const label = timeframeName(period);
  return <article className="live-chart-tile" id={'live-tile-' + period} data-active={active} aria-label={marketInfo[symbol].label + ' ' + label}>
    <header className="live-tile-header">
      <button type="button" className="live-tile-select" aria-pressed={active} disabled={!available} onClick={onSelect}
        aria-label={'เลือกกราฟ ' + label} title={'เลือกกราฟ ' + label + ' สำหรับใช้งานเครื่องมือ'}>
        <strong>{label}</strong><span>{marketInfo[symbol].label}</span>
      </button>
      {active && <span className="live-tile-active">กราฟที่เลือก</span>}
      <button type="button" className="live-tile-expand" disabled={!available} onClick={onExpand}
        aria-label={'ขยายกราฟ ' + label} title={'ขยายกราฟ ' + label}><Maximize2 size={15}/></button>
    </header>
    <div className="live-tile-plot">{children}</div>
  </article>;
}

export default function LiveOverviewChart({period, frame, onRetry, workspace, layoutVersion, replay, replayPicker, onOpenStudies, onToggleStudy}: {
  period: Period; frame: LiveTimeframe; onRetry: () => void;
  workspace: LiveWorkspaceState; layoutVersion: number;
  replay?:{frame:InlineReplayChartFrame;asOf:number;session:number};
  replayPicker?:{time:number|null;onPick:(time:number)=>void};
  onOpenStudies: () => void;
  onToggleStudy: (id: string) => void;
}) {
  const {drawings, hiddenDrawings, appearance} = workspace;
  const {market,historical,needsBackup,backupFailed}=frame;
  const {bars,pine,plots,badges}=replay?.frame??frame;
  const visibleDrawings = useMemo(() => drawings.filter(d => (!replay||d.points.every(p=>p.screen||p.time<replay.asOf)) && (d.scope!=='chart'||d.chartPeriod===period) && (!d.visiblePeriods || d.visiblePeriods.includes(period))).map(d=>replay&&d.forwardTest?{...d,forwardTest:undefined}:d), [drawings,period,replay?.asOf]);
  const [follow, setFollow] = useState(true);
  const chart = useRef<LiveChartActions>(null);
  const live = !replay && !historical.length && market.quote?.status === 'live' && !market.quoteError;
  const chartKey = period + ':' + layoutVersion + ':' + (replay?.session??'live');
  const message = replay ? '' : historical.length ? 'ข้อมูลสำรอง'
    : market.barError || market.minuteError ? 'แท่งยืนยันอัปเดตล่าช้า' : '';

  if (!bars.length) return <div className="live-chart-empty" role="status">
    {replay ? 'ไม่มีข้อมูลละเอียดสำหรับไทม์เฟรมนี้' : backupFailed ? 'โหลดแท่งราคาไม่ได้' : needsBackup ? 'กำลังโหลดข้อมูลย้อนหลัง' : 'กำลังโหลดแท่งราคา'}
    {!replay && backupFailed && <button type="button" onClick={onRetry}><RefreshCw size={14}/>ลองอีกครั้ง</button>}
  </div>;

  return <ChartBoundary resetKey={chartKey}><ReplayChart live symbol={market.symbol} compact readOnlyDrawings key={chartKey} liveActions={chart}
    appearance={appearance} replayPicker={replayPicker} seconds={periods[period]} bars={bars} trades={noTrades}
    liveBid={live && (market.symbol === 'XAUUSD' || !market.barError) ? market.livePrice : undefined} liveClock={market.serverNow}
    plots={plots} fills={pine.fills} shapes={pine.shapes} pineDrawings={pine.drawings} pineTables={pine.tables}
    calculating={pine.calculating} drawings={visibleDrawings} hiddenDrawings={hiddenDrawings}
    follow={follow} onLeaveLatest={() => setFollow(false)} onHistoryEdge={() => { if(!replay)void market.loadOlder(false); }}
    liveStudyBadges={badges} hiddenStudies={workspace.hiddenStudies} onToggleStudy={onToggleStudy}
    liveLegend={<><LiveStudyLegend badges={badges} showTitles={appearance.studyTitles} hiddenStudies={workspace.hiddenStudies}
      onOpen={onOpenStudies} onToggleStudy={onToggleStudy}/>{(message || !follow || pine.error) && <div className="live-tile-feedback">
      {message && <small title={pine.error || undefined}>{message}</small>}
      {pine.error && <button type="button" onClick={pine.retry}>ลองคำนวณใหม่</button>}
      {!follow && <button type="button" onClick={() => {
        chart.current?.latest();
        setFollow(true);
      }}>ไปแท่งล่าสุด</button>}
    </div>}</>}/></ChartBoundary>;
}
