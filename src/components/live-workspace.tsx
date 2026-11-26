import {useEffect, useId, useMemo, useRef, useState, type ReactNode} from 'react';
import {
  ArrowLeft, ChartSpline, ChevronDown, Download, Ellipsis, History, LockKeyhole, LockKeyholeOpen,
  Maximize2, Minimize2, Pencil, Radio, RefreshCw, ScanLine, SkipBack, SkipForward, Trash2, X,
} from 'lucide-react';
import ChartBoundary from './chart-boundary';
import ReplayChart, {type LiveChartActions} from './replay-chart';
import LiveDrawingToolbar from './live-drawing-toolbar';
import LiveStudyPanel from './live-study-panel';
import type {LiveViewport} from '../lib/chart-tools';
import {drawingKinds, drawingTools, isStroke, strokeMax, variableDrawingsMax} from '../lib/drawing-definitions';
import {positionMetrics} from '../lib/drawing-geometry';
import type {Bar, Drawing, DrawingKind, Trade} from '../lib/engine';
import {historyCatalog, loadBefore} from '../lib/history';
import {candleWindow, olderPageSize, periods, type Period} from '../lib/live-market';
import {livePlots, studyDefinitions, studyLabel, studyLength, type LiveStudy, type LiveStudyLengths} from '../lib/live-indicators';
import {useLiveMarket} from '../lib/use-live-market';
import {useDialog} from '../lib/use-dialog';
import './live-workspace.css';

const storageKey = 'xau-live-workspace-v1';
const periodList = Object.keys(periods) as Period[];
const studyList = Object.keys(studyDefinitions) as LiveStudy[];
const emptyBars: Bar[] = [];
const noTrades: Trade[] = [];
const price = new Intl.NumberFormat('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
const clock = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Bangkok', day: '2-digit', month: 'short',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
});
const historyDate = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Bangkok', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
});
const counts = new Intl.NumberFormat('en-US');
const shortClock = new Intl.DateTimeFormat('en-GB', {timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'});

function LiveCandleClock({seconds, serverNow, through}: {seconds: number; serverNow: () => number; through?: number}) {
  const [stamp, setStamp] = useState(serverNow);
  useEffect(() => {
    const update = () => setStamp(previous => Math.max(previous, serverNow()));
    update();
    const interval = setInterval(update, 250);
    return () => clearInterval(interval);
  }, [serverNow]);
  let window;
  try {
    window = candleWindow(stamp, seconds);
  } catch {
    return null;
  }
  const left = Math.max(0, window.close - stamp);
  const minutes = Math.floor(left / 60);
  const two = (value: number) => String(value).padStart(2, '0');
  const duration = (minutes >= 60 ? Math.floor(minutes / 60) + ':' : '') + two(minutes % 60) + ':' + two(left % 60);
  const asOf = through === undefined ? '' : 'OHLC ถึง ' + shortClock.format(through * 1000);
  return <div className="live-candle-clock" data-open={window.open} data-close={window.close} data-through={through}
    title={'เวลาเปิด–ปิดแท่งตาม MT5 · ปิด ' + shortClock.format(window.close * 1000) + ' กรุงเทพฯ'}>
    <span>ปิดใน <strong>{duration}</strong></span>
    {asOf && <span>{asOf}</span>}
  </div>;
}

function LivePanel({title, onClose, children}: {title: string; onClose: () => void; children: ReactNode}) {
  const id = useId();
  useDialog(true, onClose);
  return <div className="modal-shade" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="modal live-panel" role="dialog" aria-modal="true" aria-labelledby={id}>
      <header className="modal-head">
        <h2 id={id}>{title}</h2>
        <button type="button" className="live-icon" aria-label="ปิดหน้าต่าง" onClick={onClose}><X size={19}/></button>
      </header>
      {children}
    </section>
  </div>;
}

type Workspace = {
  period: Period; drawings: Drawing[]; studies: LiveStudy[];
  lengths: LiveStudyLengths; magnet: boolean; hiddenDrawings: boolean;
};

function loadWorkspace(): Workspace {
  const defaults: Workspace = {period: '1m', drawings: [], studies: ['ema20'], lengths: {}, magnet: false, hiddenDrawings: false};
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
    if (!stored) return defaults;
    const lengths: LiveStudyLengths = {};
    for (const study of studyList) {
      const value = studyLength(study, stored.lengths?.[study]);
      if (value !== null) lengths[study] = value;
    }
    return {
      period: periodList.includes(stored.period) ? stored.period : defaults.period,
      studies: Array.isArray(stored.studies) ? studyList.filter(s => stored.studies.includes(s)) : defaults.studies,
      lengths,
      magnet: stored.magnet === true,
      hiddenDrawings: stored.hiddenDrawings === true,
      drawings: Array.isArray(stored.drawings) ? stored.drawings.filter((d: Drawing | null) => {
        if (!d || !drawingKinds.includes(d.kind) || typeof d.id !== 'string' || !Array.isArray(d.points)) return false;
        const tool = drawingTools[d.kind];
        const variable = tool.variable || isStroke(d.kind);
        const max = isStroke(d.kind) ? strokeMax : tool.variable ? variableDrawingsMax : tool.points.length;
        return d.points.length >= (variable ? 2 : max) && d.points.length <= max
          && (d.text === undefined || typeof d.text === 'string') && (d.color === undefined || typeof d.color === 'string')
          && d.points.every(p => p && Number.isSafeInteger(p.time) && p.time > 0 && p.time < 8640000000000
            && Number.isFinite(p.price) && p.price > 0);
      }).slice(0, 500) : [],
    };
  } catch {
    return defaults;
  }
}

export default function LiveWorkspace({onReplay}: {onReplay: () => void}) {
  const [workspace, setWorkspace] = useState(loadWorkspace);
  const {period, studies, lengths, drawings, magnet, hiddenDrawings} = workspace;
  const [mode, setMode] = useState<DrawingKind | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);
  const [viewport, setViewport] = useState<LiveViewport | null>(null);
  const [retry, setRetry] = useState(0);
  const [backup, setBackup] = useState<{period: Period; bars: Bar[]; failed?: boolean}>();
  const [storageFailed, setStorageFailed] = useState(false);
  const [panel, setPanel] = useState<'quotes' | 'view' | 'history' | 'drawing' | 'studies' | null>(null);
  const [focusMode, setFocusMode] = useState(false);
  const chart = useRef<LiveChartActions>(null);
  const undo = useRef<Drawing[][]>([]);
  const redo = useRef<Drawing[][]>([]);
  const market = useLiveMarket(period, retry, viewport?.time ?? null);
  const needsBackup = !viewport && market.barError && market.closed.length === 0;

  useEffect(() => {
    if (!focusMode || mode || selected || panel) return;
    function exitFocus(event: KeyboardEvent) {
      if (event.key === 'Escape' && !document.querySelector('[aria-modal="true"]')) setFocusMode(false);
    }
    window.addEventListener('keydown', exitFocus);
    return () => window.removeEventListener('keydown', exitFocus);
  }, [focusMode, mode, selected, panel]);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(workspace));
      setStorageFailed(false);
    } catch {
      setStorageFailed(true);
    }
  }, [workspace]);

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
  const plots = useMemo(() => livePlots(bars, studies, lengths), [bars, studies, lengths]);
  const activeDrawing = drawings.find(d => d.id === selected);
  const activeMetrics = activeDrawing?.kind === 'long' || activeDrawing?.kind === 'short'
    ? positionMetrics(activeDrawing.kind, activeDrawing.points) : null;
  const quote = market.quote;
  const status = market.quoteError ? 'การเชื่อมต่อขัดข้อง' : quote?.status === 'live' ? 'ราคาสด'
    : quote?.status === 'closed' ? 'ตลาดปิด' : quote ? 'ราคาล่าช้า' : 'กำลังเชื่อมต่อ';
  const shortStatus = market.quoteError ? 'ขัดข้อง' : quote?.status === 'live' ? 'สด'
    : quote?.status === 'closed' ? 'ปิด' : quote ? 'ล่าช้า' : 'เชื่อมต่อ';
  const historyLabel = market.historyStatus === 'loading' ? 'กำลังโหลดแท่งเก่า'
    : market.historyStatus === 'error' ? 'โหลดแท่งเก่าไม่สำเร็จ'
    : market.historyStatus === 'end' ? 'ถึงข้อมูลเก่าสุดที่ Eightcap ส่งมาแล้ว' : '';
  const liveNow = follow && !market.archive && !historical.length && quote?.status === 'live' && !market.quoteError;
  const minuteBased = market.bars.length > market.closed.length;
  const last = minuteBased ? market.minuteTime : market.closed.at(-1)?.time;
  const through = last === undefined ? undefined : candleWindow(last, minuteBased ? 60 : periods[period]).close;
  const viewportKey = period + (market.archive ? '-archive' : '-current');

  function cancelDrawing() {
    setMode(null);
    setSelected(null);
  }
  function saveDrawings(next: Drawing[]) {
    undo.current = [...undo.current.slice(-99), drawings];
    redo.current = [];
    setWorkspace(value => ({...value, drawings: next}));
  }
  function changeDrawing(drawing: Drawing) {
    saveDrawings(drawings.map(d => d.id === drawing.id ? drawing : d));
  }
  function deleteDrawing() {
    if (activeDrawing?.locked || !activeDrawing) return;
    saveDrawings(drawings.filter(d => d.id !== selected));
    setSelected(null);
  }
  function restoreDrawing(source: Drawing[][], destination: Drawing[][]) {
    const next = source.pop();
    if (!next) return;
    destination.push(drawings);
    setWorkspace(value => ({...value, drawings: next}));
  }
  function selectPeriod(value: Period) {
    if (value === period) return;
    setViewport(follow ? null : chart.current?.viewport() ?? viewport);
    setWorkspace(current => ({...current, period: value}));
    cancelDrawing();
  }
  function toggleStudy(study: LiveStudy) {
    setWorkspace(value => ({...value, studies: value.studies.includes(study)
      ? value.studies.filter(s => s !== study) : [...value.studies, study]}));
  }
  function loadAtChartEdge() {
    if (!market.closed.length) return;
    setFollow(false);
    void market.loadOlder(false);
  }

  function closePanel() { setPanel(null); }
  function reconnect() { setRetry(value => value + 1); }
  function goLatest() {
    if (!market.archive && !market.findingWindow) chart.current?.latest();
    setViewport(null);
    setFollow(true);
  }
  function toggleFollow() {
    if (follow) setFollow(false);
    else goLatest();
  }

  const drawingStrip = activeDrawing && <section className="live-object-strip" aria-label="แก้ไขวัตถุที่เลือก">
    <button type="button" className="live-object-name" title="ตั้งค่าวัตถุที่เลือก" aria-haspopup="dialog"
      onClick={() => setPanel('drawing')}><Pencil size={15}/><span>{drawingTools[activeDrawing.kind].name}</span></button>
    {activeMetrics && <span className="live-object-ratio">R/R {activeMetrics.ratio.toFixed(2)}</span>}
    <div className="live-object-actions">
      <button type="button" className="live-icon" aria-label={activeDrawing.locked ? 'ปลดล็อกวัตถุ' : 'ล็อกวัตถุ'}
        title={activeDrawing.locked ? 'ปลดล็อกวัตถุ' : 'ล็อกวัตถุ'} aria-pressed={Boolean(activeDrawing.locked)}
        onClick={() => changeDrawing({...activeDrawing, locked: !activeDrawing.locked})}>
        {activeDrawing.locked ? <LockKeyhole size={16}/> : <LockKeyholeOpen size={16}/>}
      </button>
      <button type="button" className="live-icon" aria-label="ลบวัตถุจากกราฟ" title="ลบวัตถุจากกราฟ"
        disabled={activeDrawing.locked} onClick={deleteDrawing}><Trash2 size={16}/></button>
      <button type="button" className="live-icon" aria-label="ปิดแถบแก้ไขวัตถุ" title="ปิดแถบแก้ไขวัตถุ"
        onClick={() => setSelected(null)}><X size={16}/></button>
    </div>
  </section>;

  return <main className="live-workspace" data-focus={focusMode}>
    <header className="live-header">
      <h1>
        <button className="live-symbol" type="button" aria-label="ข้อมูลราคา XAUUSD" aria-haspopup="dialog"
          title="ข้อมูลราคา XAUUSD" onClick={() => setPanel('quotes')}>
          <img src={import.meta.env.BASE_URL + 'icons/icon-192.png'} alt="" width={26} height={26}/>
          <span>XAUUSD</span><ChevronDown size={13}/>
        </button>
      </h1>
      <div className="live-market-readout">
        <strong aria-label="ราคา Bid">{quote ? price.format(quote.bid) : '—'}</strong>
        <span className="live-feed" data-live={quote?.status === 'live' && !market.quoteError} title={status}>
          <i aria-hidden="true"/><span role="status" aria-label={status}>{shortStatus}</span>
        </span>
      </div>
      <button className="live-replay" type="button" aria-label="เปิด Replay" title="เปิด Replay" onClick={onReplay}>
        <ArrowLeft size={16}/><span>Replay</span>
      </button>
    </header>

    <div className="live-controls" aria-label="มุมมองราคา XAUUSD">
      <div className="live-periods" role="group" aria-label="ช่วงเวลาแท่งราคา">
        {periodList.map(tf => <button key={tf} type="button" aria-pressed={period === tf}
          onClick={() => selectPeriod(tf)}>{tf === '1d' ? '1D' : tf}</button>)}
      </div>
      <button className="live-studies-button" type="button" aria-haspopup="dialog" aria-label="อินดิเคเตอร์"
        title="อินดิเคเตอร์" onClick={() => setPanel('studies')}>
        <ChartSpline size={19}/><span className="live-wide-label">อินดิเคเตอร์</span>
        {studies.length > 0 && <span className="live-study-count" aria-label={studies.length + ' ตัวที่เปิดอยู่'}>{studies.length}</span>}
      </button>
      <div className="live-view-actions">
        <button className="live-wide-action" type="button" aria-pressed={follow} title="ติดตามแท่งล่าสุด"
          aria-label="ติดตามแท่งล่าสุด" onClick={toggleFollow}><Radio size={17}/></button>
        <button className="live-wide-action" type="button" aria-haspopup="dialog" title="แท่งย้อนหลัง"
          aria-label="แท่งย้อนหลัง" onClick={() => setPanel('history')}><History size={17}/><span>ย้อนหลัง</span></button>
        <button className="live-wide-action" type="button" aria-label="ไปแท่งล่าสุด" title="ไปแท่งล่าสุด"
          disabled={!bars.length && !viewport} onClick={goLatest}><SkipForward size={17}/></button>
        <button type="button" aria-label={focusMode ? 'ออกจากโหมดโฟกัส' : 'มุมมองกราฟ'}
          title={focusMode ? 'ออกจากโหมดโฟกัส' : 'มุมมองกราฟ'} aria-haspopup={focusMode ? undefined : 'dialog'}
          onClick={() => focusMode ? setFocusMode(false) : setPanel('view')}>
          {focusMode ? <Minimize2 size={19}/> : <Ellipsis size={21}/>}
        </button>
      </div>
    </div>

    <section className="live-chart-layout" aria-label="กราฟ XAUUSD">
      <LiveDrawingToolbar mode={mode} enabled={!hiddenDrawings && bars.length > 0 && drawings.length < 500}
        magnet={magnet} hidden={hiddenDrawings} canUndo={undo.current.length > 0} canRedo={redo.current.length > 0}
        canDelete={Boolean(activeDrawing && !activeDrawing.locked)}
        onPick={kind => { setMode(kind); setSelected(null); setFollow(false); }} onSelect={cancelDrawing}
        onMagnet={() => setWorkspace(value => ({...value, magnet: !value.magnet}))}
        onHide={() => {
          cancelDrawing();
          setWorkspace(value => ({...value, hiddenDrawings: !value.hiddenDrawings}));
        }}
        onUndo={() => { cancelDrawing(); restoreDrawing(undo.current, redo.current); }}
        onRedo={() => { cancelDrawing(); restoreDrawing(redo.current, undo.current); }} onDelete={deleteDrawing}
        navigation={<>
          <button className="live-dock-action" type="button" aria-label="แท่งย้อนหลัง" aria-haspopup="dialog"
            onClick={() => setPanel('history')}><History size={19}/><span>ย้อนหลัง</span></button>
          <button className="live-dock-action" type="button" aria-label="ไปแท่งล่าสุด" title="ไปแท่งล่าสุด"
            data-following={follow} disabled={!bars.length && !viewport} onClick={goLatest}><SkipForward size={19}/><span>ล่าสุด</span></button>
        </>}/>
      <div className="live-chart">
        {bars.length ? <ChartBoundary resetKey={viewportKey}><ReplayChart live key={viewportKey} liveActions={chart}
          liveViewport={viewport} liveBid={liveNow ? quote.bid : undefined}
          bars={bars} trades={noTrades} plots={plots} follow={follow} seconds={periods[period]}
          drawings={drawings} drawingMode={mode} magnet={magnet} hiddenDrawings={hiddenDrawings}
          selectedDrawing={selected} onDrawingSelect={setSelected} onDrawingCancel={cancelDrawing}
          liveSelection={drawingStrip} liveLegend={<div className="live-chart-extras">
            {studies.length > 0 && <div className="live-study-legend" aria-label="อินดิเคเตอร์ที่ใช้งาน">
              <button type="button" onClick={() => setPanel('studies')} aria-label="จัดการอินดิเคเตอร์ที่ใช้งาน">
              <i style={{backgroundColor: studyDefinitions[studies[0]].color}} aria-hidden="true"/>
              {studyLabel(studies[0], lengths)}
              {studies.length > 1 && <span>+{studies.length - 1}</span>}
              </button>
            </div>}
            {liveNow && <LiveCandleClock seconds={periods[period]} serverNow={market.serverNow} through={through}/>}
          </div>}
          onDrawing={drawing => { saveDrawings([...drawings, drawing]); setSelected(drawing.id); setMode(null); }}
          onDrawingChange={changeDrawing} onDrawingDelete={deleteDrawing} onDragStart={() => setFollow(false)}
          onDrawingUndo={() => restoreDrawing(undo.current, redo.current)} onDrawingRedo={() => restoreDrawing(redo.current, undo.current)}
          onHistoryEdge={loadAtChartEdge} onLeaveLatest={() => setFollow(false)}/></ChartBoundary>
          : <div className="live-chart-empty" role="status"><span>{market.findingWindow ? 'กำลังโหลดช่วงเวลาเดิม'
            : market.barError && (viewport || backup?.failed) ? 'โหลดแท่งราคาไม่ได้'
              : needsBackup ? 'กำลังโหลดข้อมูลย้อนหลัง' : 'กำลังโหลดแท่งราคาจาก Eightcap'}</span>
            {market.barError && (viewport || backup?.failed) && <button type="button" onClick={reconnect}><RefreshCw size={16}/>เชื่อมต่อใหม่</button>}
          </div>}
      </div>
    </section>

    <footer className="live-foot">
      <span>Eightcap MT5 <span aria-hidden="true">·</span> Bid</span>
      <span className="live-foot-status" role="status">{storageFailed ? 'บันทึกลงเครื่องไม่ได้' : historyLabel ||
        (market.windowUnavailable ? 'ไม่พบช่วงเวลาเดิมในไทม์เฟรมนี้' : market.archive ? 'มุมมองย้อนหลัง'
          : historical.length ? 'ข้อมูลสำรอง' : market.barError || market.minuteError ? 'แสดงแท่งที่โหลดไว้'
            : minuteBased ? 'OHLC จาก 1m ที่ปิดแล้ว' : '')}</span>
      <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">TradingView Lightweight Charts™</a>
    </footer>

    {panel === 'quotes' && <LivePanel title="ราคา XAUUSD" onClose={closePanel}>
      <div className="live-details-head">
        <span>Eightcap MT5 · Gold CFD</span>
        <strong className="live-feed" data-live={quote?.status === 'live' && !market.quoteError}><i aria-hidden="true"/>{status}</strong>
      </div>
      <dl className="live-quotes">
        <div><dt>Bid</dt><dd>{quote ? price.format(quote.bid) : '—'}</dd></div>
        <div><dt>Ask</dt><dd>{quote ? price.format(quote.ask) : '—'}</dd></div>
        <div><dt>Spread (USD)</dt><dd>{quote ? price.format(quote.ask - quote.bid) : '—'}</dd></div>
      </dl>
      <div className="live-panel-end">
        <span>{quote ? clock.format(quote.time * 1000) + ' กรุงเทพฯ' : status}</span>
        <button type="button" onClick={reconnect}><RefreshCw size={16}/>เชื่อมต่อใหม่</button>
      </div>
    </LivePanel>}

    {panel === 'view' && <LivePanel title="มุมมองกราฟ" onClose={closePanel}>
      <div className="live-panel-options">
        <button type="button" aria-pressed={follow} onClick={() => { toggleFollow(); closePanel(); }}>
          <Radio size={18}/><span>ติดตามแท่งล่าสุด</span>
        </button>
        <button type="button" disabled={!bars.length} onClick={() => { setFollow(false); chart.current?.fit(); closePanel(); }}>
          <ScanLine size={18}/><span>พอดีช่วงที่โหลด</span>
        </button>
        <button type="button" onClick={() => { setFocusMode(true); closePanel(); }}>
          <Maximize2 size={18}/><span>โหมดโฟกัสกราฟ</span>
        </button>
        <button type="button" disabled={!bars.length} onClick={() => { void chart.current?.exportPng(); closePanel(); }}>
          <Download size={18}/><span>บันทึกภาพ PNG</span>
        </button>
      </div>
    </LivePanel>}

    {panel === 'history' && <LivePanel title="แท่งย้อนหลัง" onClose={closePanel}>
      <div className="live-history" aria-label="แท่งเทียนย้อนหลัง">
        <div className="live-history-detail">
          <strong>{bars.length ? 'ย้อนหลังถึง ' + historyDate.format(bars[0].time * 1000) : 'กำลังโหลดแท่งราคา'}</strong>
          <span>{counts.format(market.closed.length || historical.length)} แท่งปิด · {period === '1d' ? '1D' : period}</span>
          <span role="status">{historyLabel}</span>
        </div>
        <div className="live-panel-options">
          <button type="button" disabled={!market.closed.length || market.historyStatus === 'loading' || market.historyStatus === 'end'}
            title={'โหลดครั้งละสูงสุด ' + counts.format(olderPageSize) + ' แท่ง'}
            onClick={() => void market.loadOlder(true)}>
            <History size={18}/><span>{market.historyStatus === 'error' ? 'ลองโหลดอีกครั้ง' : 'โหลดแท่งเก่า'}</span>
          </button>
          <button type="button" disabled={!bars.length} onClick={() => { setFollow(false); chart.current?.first(); closePanel(); }}>
            <SkipBack size={18}/><span>ไปแท่งแรกที่โหลด</span>
          </button>
        </div>
      </div>
    </LivePanel>}

    {panel === 'drawing' && activeDrawing && <LivePanel title={drawingTools[activeDrawing.kind].name} onClose={closePanel}>
      <div className="live-object">
        {activeMetrics && <span>Reward/Risk {activeMetrics.ratio.toFixed(2)} · ระยะ TP {price.format(activeMetrics.reward)} USD · ระยะ SL {price.format(activeMetrics.risk)} USD</span>}
        <label className="live-object-color">สี <input aria-label="สีของวัตถุ" type="color" disabled={activeDrawing.locked}
          defaultValue={/^#[0-9a-f]{6}$/i.test(activeDrawing.color ?? '') ? activeDrawing.color : '#d7b46a'}
          key={activeDrawing.id + (activeDrawing.color ?? '')}
          onBlur={e => {
            if (e.target.value !== (activeDrawing.color ?? '#d7b46a')) changeDrawing({...activeDrawing, color: e.target.value});
          }}/></label>
        {drawingTools[activeDrawing.kind].text && <label>ข้อความบนกราฟ
          <input aria-label="ข้อความบนกราฟ" defaultValue={activeDrawing.text} disabled={activeDrawing.locked}
            key={activeDrawing.id + (activeDrawing.text ?? '')} maxLength={100}
            onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
            onBlur={e => { if (e.target.value !== activeDrawing.text) changeDrawing({...activeDrawing, text: e.target.value}); }}/>
        </label>}
      </div>
    </LivePanel>}

    {panel === 'studies' && <LiveStudyPanel selected={studies} lengths={lengths} onToggle={toggleStudy}
      onLength={(study, length) => setWorkspace(value => ({...value, lengths: {...value.lengths, [study]: length}}))}
      onClose={closePanel}/>}
  </main>;
}
