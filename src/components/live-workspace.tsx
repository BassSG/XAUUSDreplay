import DrawingObjects from './drawing-objects';
import {useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode} from 'react';
import {
  ArrowLeft, Bell, ChartSpline, ChevronDown, Download, Ellipsis, History, LayoutGrid, LockKeyhole, LockKeyholeOpen,
  Maximize2, Minimize2, Pencil, Radio, RefreshCw, Save, ScanLine, SkipBack, SkipForward, Trash2, X,
  CalendarDays, Code2, Copy, PanelsTopLeft, Settings2, Target,
} from 'lucide-react';
import ChartBoundary from './chart-boundary';
import ReplayChart, {type LiveChartActions} from './replay-chart';
import LiveOverviewChart, {LiveChartTile, timeframeName} from './live-overview-chart';
import LiveDrawingToolbar from './live-drawing-toolbar';
import LiveDrawingSettings, {drawingInputColor} from './live-drawing-settings';
import LiveStudyPanel from './live-study-panel';
import LiveStudyLegend from './live-study-legend';
import LiveAppearance from './live-appearance';
import LiveAlertPanel from './live-alert-panel';
import LiveForwardPanel from './live-forward-panel';
import LiveLayoutPanel, {type ActiveLayout} from './live-layout-panel';
import LivePineEditor, {newScriptDraft, type ScriptDraft} from './live-pine-editor';
import {defaultChartView, loadLiveWorkspace, makeLayoutFile, periodList, readChartView, workspaceKey} from '../lib/live-layouts';
import {saveLiveAutoSave, saveLiveLayout, type SavedLayout} from '../lib/storage';
import {useLiveTimeframes} from '../lib/use-live-timeframes';
import type {LiveViewport} from '../lib/chart-tools';
import {drawingTools} from '../lib/drawing-definitions';
import {positionMetrics} from '../lib/drawing-geometry';
import {forwardPlan, forwardQuoteMaxAge, isFreshForwardQuote, matchesForwardPlan, startForwardTest, updateForwardTest} from '../lib/forward-test';
import type {Drawing, DrawingKind, IndicatorSpec, Trade} from '../lib/engine';
import {olderPageSize, periods, type Period} from '../lib/live-market';
import type {LiveStudy} from '../lib/live-indicators';
import {useLiveFeed} from '../lib/use-live-market';
import {useDialog} from '../lib/use-dialog';
import {alertText, usePriceAlerts} from '../lib/use-price-alerts';
import './live-workspace.css';
import './live-alerts.css';

const cameraKey = workspaceKey + '-camera';
// Discard the too-wide saved viewport once after changing the live framing.
const cameraVersion = 2;
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
const bangkokDate = new Intl.DateTimeFormat('sv-SE', {timeZone: 'Asia/Bangkok'});
const shortClock = new Intl.DateTimeFormat('en-GB', {timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'});

function mergeScripts(older: IndicatorSpec[], newer: IndicatorSpec[]) {
  return [...new Map([...older, ...newer].map(script => [script.id, script])).values()];
}

function LivePanel({title, onClose, children, wide, previewChart}: {title: string; onClose: () => void; children: ReactNode; wide?: boolean; previewChart?: boolean}) {
  const id = useId();
  useDialog(true, onClose);
  return <div className="modal-shade" data-chart-preview={previewChart} onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className={'modal live-panel' + (wide ? ' live-panel-wide' : '')} role="dialog" aria-modal="true" aria-labelledby={id}>
      <header className="modal-head">
        <h2 id={id}>{title}</h2>
        <button type="button" className="live-icon" aria-label="ปิดหน้าต่าง" onClick={onClose}><X size={19}/></button>
      </header>
      {children}
    </section>
  </div>;
}

function readWorkingChart() {
  let raw, camera;
  try {
    raw = JSON.parse(localStorage.getItem(workspaceKey) ?? 'null');
    camera = JSON.parse(localStorage.getItem(cameraKey) ?? 'null');
  } catch { /* A fresh or private browser can still open the chart. */ }
  const workspace = loadLiveWorkspace(raw);
  const library = mergeScripts(workspace.scripts, loadLiveWorkspace({scripts: raw?.library}).scripts);
  const link = raw?.activeLayout;
  const active: ActiveLayout | null = link && typeof link.id === 'string' && typeof link.name === 'string'
    && Number.isInteger(link.revision) ? {id: link.id, name: link.name, revision: link.revision} : null;
  const view = camera?.version === cameraVersion && camera?.period === workspace.period
    && camera.active === (active?.id ?? null) ? readChartView(camera.view) : null;
  // Start on the live edge. A saved layout can still open its historical view.
  return {workspace, active, view: view?.follow ? view : null, library};
}

export default function LiveWorkspace({onReplay}: {onReplay: () => void}) {
  const [initial] = useState(readWorkingChart);
  const [workspace, setWorkspace] = useState(initial.workspace);
  const [library, setLibrary] = useState(initial.library);
  const {period, chartLayout, studies, lengths, drawings, magnet, strongMagnet, hiddenDrawings, stayInDrawingMode, appearance, scripts} = workspace;
  const [activeLayout, setActiveLayout] = useState(initial.active);
  const [saveState, setSaveState] = useState<'ready' | 'saving' | 'saved' | 'error'>('ready');
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [saveError, setSaveError] = useState('');
  const [snapshot, setSnapshot] = useState<{busy: boolean; message: string; error?: boolean}>({busy:false,message:''});
  const [initialView, setInitialView] = useState(initial.view);
  const [layoutVersion, setLayoutVersion] = useState(0);
  const [draft, setDraft] = useState<ScriptDraft>(newScriptDraft);
  const [trial, setTrial] = useState<IndicatorSpec | null>(null);
  const [editorError, setEditorError] = useState('');
  const [editorMessage, setEditorMessage] = useState('');
  const [mode, setMode] = useState<DrawingKind | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [follow, setFollow] = useState(initial.view?.follow ?? true);
  const [viewport, setViewport] = useState<LiveViewport | null>(initial.view?.follow ? null : initial.view?.viewport ?? null);
  const [retry, setRetry] = useState(0);
  const [storageFailed, setStorageFailed] = useState(false);
  const [panel, setPanel] = useState<'quotes' | 'view' | 'history' | 'drawing' | 'objects' | 'studies' | 'appearance' | 'layouts' | 'pine' | 'alerts' | 'forward' | null>(() =>
    new URLSearchParams(location.search).get('panel') === 'alerts' ? 'alerts' : null);
  const [editingDrawing, setEditingDrawing] = useState<string | null>(null);
  const [focusMode, setFocusMode] = useState(false);
  const [historyDay, setHistoryDay] = useState('');
  const [fitHistory, setFitHistory] = useState(false);
  const chart = useRef<LiveChartActions>(null);
  const saveWorkingCopy = useRef<() => Promise<void>>(async () => {});
  const saveInProgress = useRef(false);
  const undo = useRef<Drawing[][]>([]);
  const redo = useRef<Drawing[][]>([]);
  const sixCharts = chartLayout === 'six';
  const feed = useLiveFeed(retry);
  const liveQuote = feed.quoteError ? null : feed.quote;
  const [alertDrawing,setAlertDrawing] = useState<Drawing>();
  const alerts = usePriceAlerts(liveQuote);
  const previousForwardQuote = useRef<number | null>(null);
  const armedAlerts = alerts.state.rules.filter(rule => rule.status === 'armed');

  useEffect(() => {
    function openAlerts(event: MessageEvent) {
      if (event.data === 'EBW_OPEN_ALERTS') setPanel('alerts');
    }
    navigator.serviceWorker?.addEventListener('message', openAlerts);
    return () => navigator.serviceWorker?.removeEventListener('message', openAlerts);
  }, []);
  useEffect(() => {
    if (!isFreshForwardQuote(liveQuote)) {
      previousForwardQuote.current = null;
      return;
    }
    const previous = previousForwardQuote.current;
    if (previous !== null && liveQuote.time <= previous) return;
    previousForwardQuote.current = liveQuote.time;
    const rebaseline = previous === null || liveQuote.time - previous > forwardQuoteMaxAge;
    setWorkspace(current => {
      let changed = false;
      const next = current.drawings.map(drawing => {
        const run = drawing.forwardTest;
        if (!run || run.exit || !matchesForwardPlan(run, forwardPlan(drawing))) return drawing;
        const result = updateForwardTest(run, liveQuote, rebaseline);
        if (result === run) return drawing;
        changed = true;
        return {...drawing, forwardTest: result};
      });
      return changed ? {...current, drawings: next} : current;
    });
  }, [liveQuote]);

  const proposedScripts = useMemo(() => !trial ? scripts : scripts.some(s => s.id === trial.id)
    ? scripts.map(s => s.id === trial.id ? trial : s) : [...scripts, trial], [scripts, trial]);
  const jobs = useMemo(() => proposedScripts.filter(s => s.enabled), [proposedScripts]);
  const timeframes = useLiveTimeframes({period, anchor:viewport?.time ?? null, retry, feed, grid:sixCharts,
    studies,lengths,jobs,testingScript:Boolean(trial)});
  const {market,bars,historical,needsBackup,backupFailed,pine,plots,through,minuteBased,badges} = timeframes[period];

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
      const extraScripts = library.filter(script => !workspace.scripts.some(active =>
        active.id === script.id && active.name === script.name && active.source === script.source));
      localStorage.setItem(workspaceKey, JSON.stringify({...workspace, activeLayout, library: extraScripts}));
      setStorageFailed(false);
    } catch {
      setStorageFailed(true);
    }
  }, [workspace, activeLayout, library]);

  function currentView() {
    return chart.current?.captureView(follow) ?? {...(initialView ?? defaultChartView), follow, viewport: viewport ?? initialView?.viewport ?? null};
  }
  const saveCamera = useRef(() => {});
  saveCamera.current = () => {
    try { localStorage.setItem(cameraKey, JSON.stringify({version: cameraVersion, period, active: activeLayout?.id ?? null, view: currentView(), savedAt: Date.now()})); }
    catch { /* Named layouts are stored independently in IndexedDB. */ }
  };
  useEffect(() => {
    const save = () => saveCamera.current();
    const onHidden = () => { if (document.hidden) save(); };
    window.addEventListener('pagehide', save);
    document.addEventListener('visibilitychange', onHidden);
    return () => { window.removeEventListener('pagehide', save); document.removeEventListener('visibilitychange', onHidden); };
  }, []);

  saveWorkingCopy.current = async () => {
    if (saveInProgress.current) return;
    saveInProgress.current = true;
    setSaveState('saving');
    saveCamera.current();
    try {
      const file = makeLayoutFile(activeLayout?.name ?? 'กราฟปัจจุบัน', workspace, currentView(), library);
      await saveLiveAutoSave(file);
      if (activeLayout) {
        try { rememberLayout(await saveLiveLayout(file, activeLayout)); }
        catch (error) {
          setSavedAt(Date.now());
          setSaveError('สำรองฉบับล่าสุดแล้ว แต่เลย์เอาต์เดิมอัปเดตไม่ได้: ' + (error instanceof Error ? error.message : 'ไม่ทราบสาเหตุ'));
          setSaveState('saved');
          return;
        }
      }
      setSavedAt(Date.now());
      setSaveError('');
      setSaveState('saved');
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'ไม่ทราบสาเหตุ');
      setSaveState('error');
    } finally {
      saveInProgress.current = false;
    }
  };
  useEffect(() => {
    const timer = window.setInterval(() => { void saveWorkingCopy.current(); }, 5 * 60 * 1000);
    const onHidden = () => { if (document.hidden) void saveWorkingCopy.current(); };
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onHidden);
    };
  }, []);

  const visibleDrawings = useMemo(() => drawings.filter(d => (d.scope!=='chart'||d.chartPeriod===period) && (!d.visiblePeriods || d.visiblePeriods.includes(period))), [drawings, period]);
  const activeDrawing = visibleDrawings.find(d => d.id === selected);
  const drawingToEdit = editingDrawing ? drawings.find(d => d.id === editingDrawing) : undefined;
  const activeMetrics = activeDrawing?.kind === 'long' || activeDrawing?.kind === 'short'
    ? positionMetrics(activeDrawing.kind, activeDrawing.points) : null;
  const quote = market.quote;
  const status = market.quoteError ? 'การเชื่อมต่อขัดข้อง' : quote?.status === 'live' ? 'ราคาสด'
    : quote?.status === 'closed' ? 'ตลาดปิด' : quote ? 'ราคาล่าช้า' : 'กำลังเชื่อมต่อ';
  const shortStatus = market.quoteError ? 'ขัดข้อง' : quote?.status === 'live' ? 'สด'
    : quote?.status === 'closed' ? 'ปิด' : quote ? 'ล่าช้า' : 'เชื่อมต่อ';
  const historyLabel = market.progress ? 'โหลดเพิ่มแล้ว ' + counts.format(market.progress.loaded) + ' แท่ง'
    : market.historyStatus === 'loading' ? 'กำลังโหลดแท่งเก่า'
    : market.historyStatus === 'error' ? 'โหลดแท่งเก่าไม่สำเร็จ'
    : market.historyStatus === 'end' ? 'ถึงข้อมูลเก่าสุดที่ Eightcap ส่งมาแล้ว' : '';
  const liveNow = follow && !market.archive && !historical.length && quote?.status === 'live' && !market.quoteError;
  const enabledScripts = useMemo(() => scripts.filter(s => s.enabled), [scripts]);
  const totalStudies = studies.length + enabledScripts.length;
  useEffect(() => {
    if (!trial) return;
    const finished = pine.completed.studies.find(s => s.id === trial.id);
    if (!finished && (!pine.error || pine.calculating)) return;
    if (!finished || finished.error) {
      setEditorError(finished?.error || pine.error);
      setPanel(current => current === 'studies' ? 'pine' : current);
    } else {
      setWorkspace(previous => ({...previous, scripts: proposedScripts}));
      setLibrary(saved => mergeScripts(saved, [trial]));
      setDraft({id: trial.id, name: trial.name, source: trial.source});
      setEditorMessage((scripts.some(s => s.id === trial.id) ? 'อัปเดต ' : 'เพิ่ม ') + trial.name + ' ในอินดิเคเตอร์ของฉันแล้ว');
    }
    setTrial(null);
  }, [trial, pine.completed, pine.error, pine.calculating, proposedScripts, scripts]);
  const chartStatus = storageFailed ? 'บันทึกลงเครื่องไม่ได้' : historyLabel ||
    (market.windowUnavailable ? 'ไม่พบช่วงเวลาเดิมในไทม์เฟรมนี้' : market.archive ? 'มุมมองย้อนหลัง'
      : historical.length ? 'ข้อมูลสำรอง' : liveNow && market.provisional ? 'OHLC กำลังก่อตัวจาก Bid สด'
        : market.barError || market.minuteError ? 'แสดงแท่งที่โหลดไว้'
          : liveNow && through !== undefined ? 'OHLC ถึง ' + shortClock.format(through * 1000)
          : minuteBased ? 'OHLC จาก 1m ที่ปิดแล้ว' : '');
  const viewportKey = period + (market.archive ? '-archive' : '-current') + '-' + layoutVersion;

  useEffect(() => {
    if (!fitHistory || !bars.length) return;
    chart.current?.fit();
    setFitHistory(false);
  }, [fitHistory, bars]);

  function rememberLayout(row: SavedLayout | null) {
    setActiveLayout(row ? {id: row.id, name: row.file.name, revision: row.revision} : null);
  }
  function openLayout(row: SavedLayout) {
    const next=row.file.workspace;
    const globals=new Map(next.drawings.filter(d=>d.scope==='global').map(d=>[d.id,d]));
    for (const d of drawings) if(d.scope==='global') globals.set(d.id,d);
    const removedGlobal=[...new Set([...workspace.removedGlobal,...next.removedGlobal])].slice(-2000);
    for (const id of removedGlobal) globals.delete(id);
    const combined=[...next.drawings.filter(d=>d.scope!=='global'&&!globals.has(d.id)),...globals.values()];
    if (combined.length>500) {
      setSaveError('เลย์เอาต์รวมกับวัตถุที่แชร์แล้วเกิน 500 ชิ้น กรุณาลดวัตถุก่อนเปิด');return;
    }
    previousForwardQuote.current = null;
    setWorkspace({...next,removedGlobal,drawings:combined});
    setLibrary(saved => mergeScripts(saved, row.file.library ?? row.file.workspace.scripts));
    setFollow(row.file.view.follow);
    setViewport(row.file.view.follow ? null : row.file.view.viewport);
    setInitialView(row.file.view);
    setLayoutVersion(v => v + 1);
    rememberLayout(row.isAutoSave ? null : row);
    undo.current = []; redo.current = [];
    cancelDrawing(); setDraft(newScriptDraft); setTrial(null); setEditorError(''); setEditorMessage('');
    closePanel();
  }

  function cancelDrawing() {
    setMode(null);
    setSelected(null);
  }
  function storeDrawings(next: Drawing[]) {
    setWorkspace(value => {
      const tracked = new Map(value.drawings.filter(drawing => drawing.forwardTest).map(drawing => [drawing.id, drawing.forwardTest]));
      const globalIds = new Set(next.filter(d=>d.scope==='global').map(d=>d.id));
      const removedGlobal = [...new Set([...value.removedGlobal,
        ...value.drawings.filter(d=>d.scope==='global'&&!globalIds.has(d.id)).map(d=>d.id)])]
        .filter(id=>!globalIds.has(id)).slice(-2000);
      return {...value, removedGlobal, drawings: next.map(drawing => {
        const run = tracked.get(drawing.id);
        return run && run !== drawing.forwardTest ? {...drawing, forwardTest: run} : drawing;
      })};
    });
  }
  function saveDrawings(next: Drawing[]) {
    undo.current = [...undo.current.slice(-99), drawings];
    redo.current = [];
    storeDrawings(next);
  }
  function changeDrawing(drawing: Drawing) {
    undo.current = [...undo.current.slice(-99), drawings];
    redo.current = [];
    setWorkspace(current => ({...current,
      removedGlobal:drawing.scope==='global' ? current.removedGlobal.filter(id=>id!==drawing.id)
        : current.drawings.some(d=>d.id===drawing.id&&d.scope==='global')
          ? [...new Set([...current.removedGlobal,drawing.id])].slice(-2000) : current.removedGlobal,
      drawings: current.drawings.map(previous => {
      if (previous.id !== drawing.id) return previous;
      const run = previous.forwardTest;
      const plan = forwardPlan(drawing);
      const restartPending = run && !run.entry && plan && !matchesForwardPlan(run, plan);
      return {...drawing, forwardTest: restartPending ? startForwardTest(plan, liveQuote) : run};
    })}));
  }
  function trackPosition(id: string) {
    setWorkspace(current => ({...current, drawings: current.drawings.map(drawing => {
      if (drawing.id !== id) return drawing;
      const plan = forwardPlan(drawing);
      return plan ? {...drawing, forwardTest: startForwardTest(plan, liveQuote)} : drawing;
    })}));
  }
  function pickDrawing(kind: DrawingKind) {
    setMode(kind);
    setSelected(null);
    setFollow(false);
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
    storeDrawings(next);
  }
  function selectPeriod(value: Period) {
    if (value === period) return;
    setInitialView(null);
    setViewport(follow ? null : chart.current?.viewport() ?? viewport);
    setWorkspace(current => ({...current, period: value}));
    cancelDrawing();
  }
  function changeChartLayout(value: 'single' | 'six', timeframe = period) {
    if (timeframe !== period) selectPeriod(timeframe);
    else setInitialView(follow ? null : currentView());
    setWorkspace(current => ({...current, chartLayout: value}));
  }
  function toggleStudy(study: LiveStudy) {
    setWorkspace(value => ({...value, studies: value.studies.includes(study)
      ? value.studies.filter(s => s !== study) : [...value.studies, study]}));
  }
  function loadAtChartEdge() {
    if (!market.closed.length) return;
    void market.loadOlder(false);
  }
  function jumpToDate(day: string) {
    const time = Date.parse(day + 'T00:00:00+07:00') / 1000;
    if (!Number.isFinite(time) || time <= 0 || time > market.serverNow()) return;
    const view = chart.current?.viewport();
    setInitialView(null);
    setFollow(false);
    setViewport({time, span: Math.min(160, view?.span ?? 100)});
    setLayoutVersion(number => number + 1);
    closePanel();
  }
  async function showAllHistory() {
    if (market.historyStatus !== 'end' && !await market.loadOlder(true, Infinity)) return;
    setFollow(false);
    setFitHistory(true);
    setPanel(current => current === 'history' ? null : current);
  }

  function closePanel() { setAlertDrawing(undefined); setPanel(null); setEditingDrawing(null); setEditorMessage(''); }
  function toggleMagnet() {
    setWorkspace(value => ({...value, magnet: !value.magnet || !value.strongMagnet, strongMagnet:value.magnet && !value.strongMagnet}));
  }
  async function captureImage(action: 'copy' | 'download') {
    const current = chart.current;
    if (!current || snapshot.busy) return;
    setSnapshot({busy:true, message:'กำลังสร้างภาพกราฟ…'});
    try {
      await (action === 'copy' ? current.copyPng() : current.exportPng());
      setSnapshot({busy:false, message:action === 'copy' ? 'คัดลอกรูปกราฟแล้ว นำไปวางในแชตได้' : 'เริ่มดาวน์โหลด PNG แล้ว'});
    } catch (error) {
      setSnapshot({busy:false, error:true, message:error instanceof Error ? error.message : 'สร้างภาพกราฟไม่สำเร็จ'});
    }
  }
  function editDrawing(id: string) {
    setMode(null);
    setSelected(id);
    setEditingDrawing(id);
    setPanel('drawing');
  }
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

  const drawingToolsOverlay = activeDrawing && <section className="live-object-tools" aria-label="แก้ไขวัตถุที่เลือก">
    <button type="button" className="live-object-name" title={drawingTools[activeDrawing.kind].name + ' · ตั้งค่าวัตถุ'}
      aria-label="ตั้งค่าวัตถุที่เลือก" aria-haspopup="dialog"
      onClick={() => editDrawing(activeDrawing.id)}><Pencil size={15}/><span>{drawingTools[activeDrawing.kind].name}</span>
      <i className="live-object-swatch" style={{background: drawingInputColor(activeDrawing.color)}} aria-hidden="true"/></button>
    {activeMetrics && <span className="live-object-ratio">R/R {activeMetrics.ratio.toFixed(2)}</span>}
    <div className="live-object-actions">
      {!activeDrawing.pane && ['trend','rect'].includes(activeDrawing.kind) && activeDrawing.points[0]?.time !== activeDrawing.points[1]?.time &&
        <button type="button" className="live-icon" aria-label="แจ้งเตือนจากวัตถุ" title="แจ้งเตือนจากวัตถุ"
          onClick={()=>{setAlertDrawing(activeDrawing);setPanel('alerts')}}><Bell size={16}/></button>}
      {activeMetrics && <button type="button" className="live-icon" aria-label="เปิด Forward Test" title="Forward Test"
        aria-haspopup="dialog" onClick={() => setPanel('forward')}><Target size={16}/></button>}
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

  const primaryChart = bars.length
    ? <ChartBoundary resetKey={viewportKey}>
      <ReplayChart live compact={sixCharts} key={viewportKey} liveActions={chart}
        alertLevels={[...new Set(armedAlerts.filter(rule=>!rule.drawing).map(rule => rule.level))]}
        liveViewport={viewport} initialView={initialView} appearance={appearance} liveBid={liveNow ? quote.bid : undefined} liveClock={market.serverNow}
        fills={pine.fills} shapes={pine.shapes} pineDrawings={pine.drawings} pineTables={pine.tables} calculating={pine.calculating}
        bars={bars} trades={noTrades} plots={plots} follow={follow} seconds={periods[period]}
        drawings={visibleDrawings} drawingMode={mode} magnet={magnet} strongMagnet={strongMagnet} onToggleMagnet={toggleMagnet} hiddenDrawings={hiddenDrawings}
        selectedDrawing={selected} onDrawingSelect={setSelected} onDrawingEdit={editDrawing} onDrawingRemove={id=>saveDrawings(drawings.filter(d=>d.id!==id))} onDrawingCancel={cancelDrawing}
        liveSelection={drawingToolsOverlay} liveStudyBadges={badges}
        liveLegend={<LiveStudyLegend badges={badges} onOpen={() => setPanel('studies')}
          details={pine.error || pine.warnings.join(' · ')} onDetails={() => setPanel('pine')}/>}
        onDrawing={drawing => {
          const plan = forwardPlan(drawing);
          const placed = plan ? {...drawing, forwardTest: startForwardTest(plan, liveQuote)} : drawing;
          saveDrawings([...drawings, placed]);
          if (stayInDrawingMode) setSelected(null);
          else { setSelected(drawing.id); setMode(null); }
        }}
        onDrawingChange={changeDrawing} onDrawingDelete={deleteDrawing} onDragStart={() => setFollow(false)}
        onDrawingUndo={() => restoreDrawing(undo.current, redo.current)} onDrawingRedo={() => restoreDrawing(redo.current, undo.current)}
        onHistoryEdge={loadAtChartEdge} onLeaveLatest={() => setFollow(false)}/>
    </ChartBoundary>
    : <div className="live-chart-empty" role="status"><span>{market.findingWindow ? 'กำลังโหลดช่วงเวลาเดิม'
          : market.barError && (viewport || backupFailed) ? 'โหลดแท่งราคาไม่ได้'
            : needsBackup ? 'กำลังโหลดข้อมูลย้อนหลัง' : 'กำลังโหลดแท่งราคาจาก Eightcap'}</span>
          {market.barError && (viewport || backupFailed) && <button type="button" onClick={reconnect}><RefreshCw size={16}/>เชื่อมต่อใหม่</button>}
        </div>;

  const layoutAction = sixCharts ? 'สลับเป็นกราฟเดียว' : 'เปิดกราฟ 6 ไทม์เฟรม';
  return <main className="live-workspace" data-focus={focusMode}>
    <header className="live-header">
      <h1>
        <button className="live-symbol" type="button" aria-label="EBW · ข้อมูลราคา XAUUSD" aria-haspopup="dialog"
          title="ข้อมูลราคา XAUUSD" onClick={() => setPanel('quotes')}>
          <img src={import.meta.env.BASE_URL + 'icons/ebw-mark.png'} alt="" width={42} height={12}/>
          <span>XAUUSD</span><ChevronDown size={13}/>
        </button>
      </h1>
      <div className="live-market-readout">
        <strong aria-label="ราคา Bid">{quote ? price.format(quote.bid) : '—'}</strong>
        <span className="live-feed" data-live={quote?.status === 'live' && !market.quoteError} title={status}>
          <i aria-hidden="true"/><span role="status" aria-label={status}>{shortStatus}</span>
        </span>
      </div>
      <div className="live-chart-settings">
        <button className="header-save" type="button" aria-label="บันทึกกราฟตอนนี้" title={saveError || (saveState === 'error' ? 'บันทึกไม่สำเร็จ' : saveState === 'saved' && savedAt ? 'บันทึกล่าสุด ' + new Date(savedAt).toLocaleTimeString('th-TH', {hour: '2-digit', minute: '2-digit'}) + ' · เก็บในเครื่องนี้' : 'บันทึกกราฟตอนนี้ · เก็บในเครื่องนี้')} disabled={saveState === 'saving'} onClick={() => void saveWorkingCopy.current()}>
          <Save size={17}/><span>บันทึก</span>
        </button>
        <span className="live-save-status" data-state={saveState} role="status" aria-live="polite">
          {saveState === 'saving' ? 'กำลังบันทึก…' : saveState === 'error' ? 'บันทึกไม่สำเร็จ' : savedAt ? 'บันทึก ' + new Date(savedAt).toLocaleTimeString('th-TH', {hour: '2-digit', minute: '2-digit'}) : 'อัตโนมัติ 5 นาที'}
        </span>
        <button className="header-layout" type="button" aria-label="เลย์เอาต์" title="บันทึกและเปิดเลย์เอาต์"
          aria-haspopup="dialog" onClick={() => setPanel('layouts')}><PanelsTopLeft size={18}/><span>{activeLayout?.name ?? 'เลย์เอาต์'}</span></button>
        <button className="header-appearance" type="button" aria-label="ตั้งค่ารูปลักษณ์กราฟ" title="ตั้งค่ารูปลักษณ์กราฟ"
          aria-haspopup="dialog" onClick={() => setPanel('appearance')}><Settings2 size={18}/></button>
      </div>
      <button className="live-replay" type="button" aria-label="เปิด Replay" title="เปิด Replay" onClick={() => { saveCamera.current(); onReplay(); }}>
        <ArrowLeft size={16}/><span>Replay</span>
      </button>
    </header>

    <div className="live-controls" aria-label="มุมมองราคา XAUUSD">
      <div className="live-periods" role="group" aria-label="ช่วงเวลาแท่งราคา">
        {periodList.map(tf => <button key={tf} type="button" aria-pressed={period === tf}
          onClick={() => {
            selectPeriod(tf);
            if (sixCharts) document.getElementById('live-tile-' + tf)?.scrollIntoView({block: 'nearest'});
          }}>{timeframeName(tf)}</button>)}
      </div>
      <button className="live-studies-button" type="button" aria-haspopup="dialog" aria-label="อินดิเคเตอร์"
        title="อินดิเคเตอร์" onClick={() => setPanel('studies')}>
        <ChartSpline size={19}/><span className="live-wide-label">อินดิเคเตอร์</span>
        {totalStudies > 0 && <span className="live-study-count" aria-label={totalStudies + ' ตัวที่เปิดอยู่'}>{totalStudies}</span>}
      </button>
      <div className="live-view-actions">
        <button className="live-alert-button" type="button" aria-label="แจ้งเตือนราคา" aria-haspopup="dialog" title="แจ้งเตือนราคา"
          data-armed={armedAlerts.length > 0} onClick={() => setPanel('alerts')}>
          <Bell size={17}/><span className="live-wide-label">แจ้งเตือน</span>
          {armedAlerts.length > 0 && <small className="live-study-count">{armedAlerts.length}</small>}
        </button>
        <button type="button" className="live-grid-toggle" aria-pressed={sixCharts} aria-label={layoutAction} title={layoutAction}
          onClick={() => changeChartLayout(sixCharts ? 'single' : 'six')}>
          <LayoutGrid size={17}/><span className="live-wide-label">6 ไทม์เฟรม</span>
        </button>
        <button className="live-wide-action" type="button" aria-pressed={follow} title="ติดตามแท่งล่าสุด"
          aria-label="ติดตามแท่งล่าสุด" onClick={toggleFollow}><Radio size={17}/></button>
        <button className="live-wide-action" type="button" aria-haspopup="dialog" title="แท่งย้อนหลัง"
          aria-label="แท่งย้อนหลัง" onClick={() => setPanel('history')}><History size={17}/><span>ย้อนหลัง</span></button>
        <button className="live-wide-action" type="button" aria-label="ไปแท่งล่าสุด" title="ไปแท่งล่าสุด"
          disabled={!bars.length && !viewport} onClick={goLatest}><SkipForward size={17}/></button>
        <button type="button" aria-label={focusMode ? 'ออกจากโหมดโฟกัส' : 'มุมมองกราฟ'}
          title={focusMode ? 'ออกจากโหมดโฟกัส' : 'มุมมองกราฟ'} aria-haspopup={focusMode ? undefined : 'dialog'}
          onClick={() => {
            if (focusMode) setFocusMode(false);
            else {
              setSnapshot(previous => previous.busy ? previous : {busy:false,message:''});
              setPanel('view');
            }
          }}>
          {focusMode ? <Minimize2 size={19}/> : <Ellipsis size={21}/>}
        </button>
      </div>
    </div>

    <section className="live-chart-layout" aria-label="กราฟ XAUUSD">
      <LiveDrawingToolbar mode={mode} enabled={!hiddenDrawings && bars.length > 0 && drawings.length < 500}
        favorites={workspace.favoriteTools} favoritePosition={workspace.favoritePosition}
        onFavorite={kind => setWorkspace(value => ({...value, favoriteTools: value.favoriteTools.includes(kind)
          ? value.favoriteTools.filter(tool => tool !== kind) : [...value.favoriteTools, kind]}))}
        onMoveFavorites={position => setWorkspace(value => ({...value, favoritePosition: position}))}
        magnet={magnet} strongMagnet={strongMagnet} hidden={hiddenDrawings} stayInDrawingMode={stayInDrawingMode}
        canUndo={undo.current.length > 0} canRedo={redo.current.length > 0}
        canDelete={Boolean(activeDrawing && !activeDrawing.locked)}
        onPick={pickDrawing} onSelect={cancelDrawing}
        onMagnet={toggleMagnet}
        onStayInDrawingMode={() => setWorkspace(value => ({...value, stayInDrawingMode: !value.stayInDrawingMode}))}
        onHide={() => {
          cancelDrawing();
          setWorkspace(value => ({...value, hiddenDrawings: !value.hiddenDrawings}));
        }}
        onUndo={() => { cancelDrawing(); restoreDrawing(undo.current, redo.current); }}
        onRedo={() => { cancelDrawing(); restoreDrawing(redo.current, undo.current); }} onDelete={deleteDrawing}
        navigation={<>
          <button className="live-forward-dock" type="button" aria-label="Forward Test" title="Forward Test · Long / Short" aria-haspopup="dialog"
            onClick={() => setPanel('forward')}><Target size={19}/><span>จำลอง</span></button>
          <button className="live-dock-action" type="button" aria-label="แท่งย้อนหลัง" aria-haspopup="dialog"
            onClick={() => setPanel('history')}><History size={19}/><span>ย้อนหลัง</span></button>
          <button className="live-dock-action" type="button" aria-label="ไปแท่งล่าสุด" title="ไปแท่งล่าสุด"
            data-following={follow} disabled={!bars.length && !viewport} onClick={goLatest}><SkipForward size={19}/><span>ล่าสุด</span></button>
        </>}/>
      <div className="live-chart" data-light={appearance.background.toLowerCase() === "#ffffff"} style={{'--chart-bg': appearance.background, '--chart-ink': appearance.text,
        '--chart-up': appearance.upColor, '--chart-down': appearance.downColor} as CSSProperties}>
        {sixCharts ? <div className="live-chart-grid" aria-label="XAUUSD 6 ไทม์เฟรม">
          {periodList.map(tf => <LiveChartTile key={tf} period={tf} active={tf === period}
            onSelect={() => selectPeriod(tf)} onExpand={() => changeChartLayout('single', tf)}>
            {tf === period ? primaryChart : <LiveOverviewChart period={tf} frame={timeframes[tf]} onRetry={reconnect}
              workspace={workspace} layoutVersion={layoutVersion}/>}
          </LiveChartTile>)}
        </div> : primaryChart}
      </div>
    </section>

    <footer className="live-foot">
      <span>Eightcap MT5 <span aria-hidden="true">·</span> Bid</span>
      <span className="live-foot-status" role="status" title={chartStatus}>{chartStatus}</span>
      <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">TradingView Lightweight Charts™</a>
    </footer>

    {alerts.notice && <aside className="alerts-toast" role="status" aria-label="ถึงราคาแจ้งเตือน">
      <Bell size={18} aria-hidden="true"/>
      <button type="button" onClick={() => {setPanel('alerts'); alerts.setNotice(null);}}>
        <strong>{alerts.notice.label || 'EBW · XAUUSD'}</strong><small>{alertText(alerts.notice)}</small>
      </button>
      <button type="button" className="live-icon" aria-label="ปิดข้อความแจ้งเตือน" onClick={() => alerts.setNotice(null)}><X size={16}/></button>
    </aside>}

    {panel === 'forward' && <LivePanel title="Forward Test" onClose={closePanel}>
      <LiveForwardPanel drawings={drawings} enabled={!hiddenDrawings && bars.length > 0 && drawings.length < 500}
        live={isFreshForwardQuote(liveQuote)} selected={selected} onEdit={editDrawing} onTrack={trackPosition}
        onPick={kind => {closePanel(); pickDrawing(kind);}}/>
    </LivePanel>}

    {panel === 'alerts' && <LivePanel title="แจ้งเตือนราคา XAUUSD" onClose={closePanel}>
      <LiveAlertPanel alerts={alerts} drawing={alertDrawing} bid={quote?.status === 'live' && !market.quoteError ? quote.bid : undefined}/>
    </LivePanel>}

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
        <button type="button" onClick={() => setPanel('appearance')}><Settings2 size={18}/><span>ตั้งค่ารูปลักษณ์กราฟ</span></button>
        <button type="button" onClick={() => setPanel('layouts')}><PanelsTopLeft size={18}/><span>เลย์เอาต์</span></button>
        <button type="button" onClick={() => setPanel('objects')}><Pencil size={18}/><span>วัตถุบนกราฟ</span></button>
        <button type="button" onClick={() => setPanel('pine')}><Code2 size={18}/><span>Pine Editor</span></button>
        <button type="button" aria-pressed={follow} onClick={() => { toggleFollow(); closePanel(); }}>
          <Radio size={18}/><span>ติดตามแท่งล่าสุด</span>
        </button>
        <button type="button" disabled={!bars.length} onClick={() => {
          setInitialView(null); setFollow(true); setViewport(null); chart.current?.resetView(); closePanel();
        }}><ScanLine size={18}/><span>รีเซ็ตมุมมองกราฟ</span></button>
        <label className="chart-field">เคอร์เซอร์และซูม
          <select defaultValue="" onChange={event=>{
            const tool=event.target.value as Parameters<LiveChartActions['utility']>[0];
            if(tool){chart.current?.utility(tool);closePanel()}
          }}>
            <option value="" disabled>เลือกโหมด</option><option value="cross">กากบาท</option><option value="dot">จุด</option>
            <option value="arrow">ลูกศร</option><option value="demo">นำเสนอ</option><option value="magic">เส้นเน้นสีม่วง</option>
            <option value="erase">ยางลบ</option><option value="zoom">ลากกรอบซูม</option>
          </select>
        </label>
        <button type="button" disabled={!bars.length} onClick={() => { setFollow(false); chart.current?.fit(); closePanel(); }}>
          <ScanLine size={18}/><span>พอดีช่วงที่โหลด</span>
        </button>
        <button type="button" onClick={() => { setFocusMode(true); closePanel(); }}>
          <Maximize2 size={18}/><span>โหมดโฟกัสกราฟ</span>
        </button>
        <button type="button" disabled={!bars.length || snapshot.busy} onClick={() => { void captureImage('copy'); }}>
          <Copy size={18}/><span>คัดลอกรูปกราฟ</span>
        </button>
        <button type="button" disabled={!bars.length || snapshot.busy} onClick={() => { void captureImage('download'); }}>
          <Download size={18}/><span>ดาวน์โหลด PNG</span>
        </button>
      </div>
      {snapshot.message && <p role="status" className={(snapshot.error ? 'chart-error' : 'chart-feedback') + ' live-snapshot-status'}>{snapshot.message}</p>}
    </LivePanel>}

    {panel === 'history' && <LivePanel title="แท่งย้อนหลัง" onClose={closePanel}>
      <div className="live-history" aria-label="แท่งเทียนย้อนหลัง">
        <div className="live-history-detail">
          <strong>{bars.length ? 'ย้อนหลังถึง ' + historyDate.format(bars[0].time * 1000) : 'กำลังโหลดแท่งราคา'}</strong>
          <span>{counts.format(market.closed.length || historical.length)} แท่งปิด · {period === '1d' ? '1D' : period}</span>
          <span role="status">{historyLabel}</span>
        </div>
        <form className="live-history-date" onSubmit={event => { event.preventDefault(); jumpToDate(historyDay); }}>
          <label>ไปวันที่ (กรุงเทพฯ)
            <input type="date" min="1970-01-02" max={bangkokDate.format(market.serverNow() * 1000)}
              value={historyDay} required onChange={event => setHistoryDay(event.target.value)}/>
          </label>
          <button type="submit" disabled={!historyDay || Boolean(market.progress)}><CalendarDays size={17}/>ไปที่กราฟ</button>
        </form>
        <div className="live-panel-options">
          {market.progress
            ? <button type="button" onClick={market.stopHistory}><X size={17}/><span>หยุดโหลด</span></button>
            : <button type="button" disabled={!market.closed.length || market.historyStatus === 'loading'}
              onClick={() => void showAllHistory()}><ScanLine size={18}/><span>ดูประวัติทั้งหมด</span></button>}
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

    {panel === 'objects' && <LivePanel title="วัตถุบนกราฟ" onClose={closePanel}>
      <DrawingObjects drawings={drawings} onChange={saveDrawings} onEdit={editDrawing}/>
    </LivePanel>}

    {panel === 'drawing' && drawingToEdit && <LivePanel title={drawingTools[drawingToEdit.kind].name} onClose={closePanel} wide>
      <LiveDrawingSettings key={drawingToEdit.id} drawing={drawingToEdit} period={period} onSave={changeDrawing} onClose={closePanel}/>
    </LivePanel>}

    {panel === 'appearance' && <LivePanel title="รูปลักษณ์กราฟ" onClose={closePanel} previewChart>
      <LiveAppearance value={appearance} onChange={next => setWorkspace(v => ({...v, appearance: next}))}/>
    </LivePanel>}
    {panel === 'layouts' && <LivePanel title="เลย์เอาต์" onClose={closePanel}>
      <LiveLayoutPanel active={activeLayout} capture={name => makeLayoutFile(name, workspace, currentView(), library)}
        onSave={rememberLayout} onOpen={openLayout}/>
    </LivePanel>}
    {panel === 'pine' && <LivePanel title="Pine Editor" onClose={closePanel} wide>
      <LivePineEditor scripts={scripts} studies={pine.studies} draft={draft} setDraft={v => {
        setDraft(v); setEditorError(''); setEditorMessage('');
      }} pending={Boolean(trial)} hasBars={bars.length > 0} status={trial ? 'กำลังทดสอบกับแท่ง ' + period :
        pine.warnings.length ? pine.warnings.join(' · ') : pine.status}
        error={editorError || pine.error} onApply={candidate => {
          setEditorError(''); setEditorMessage(''); setTrial(candidate); setPanel('studies');
        }}
        onChange={next => { setEditorError(''); setEditorMessage(''); setWorkspace(v => ({...v, scripts: next})); }}
        onRetry={pine.retry} onShowChart={closePanel}/>
    </LivePanel>}
    {panel === 'studies' && <LiveStudyPanel selected={studies} lengths={lengths} onToggle={toggleStudy}
      message={editorMessage || (editorError ? 'Pine · ' + editorError : '')}
      scripts={mergeScripts(library.map(script => ({...script, enabled: false})), proposedScripts)} evaluations={pine.studies}
      pendingId={trial?.id} pendingStatus={pine.status} onCancelApply={() => { setTrial(null); setPanel('pine'); }}
      onPine={() => { setDraft(newScriptDraft); setEditorError(''); setPanel('pine'); }}
      onEdit={script => { setDraft({id: script.id, name: script.name, source: script.source}); setEditorError(''); setPanel('pine'); }}
      onScriptChange={next => {
        setEditorMessage('');
        setWorkspace(v => ({...v, scripts: mergeScripts(v.scripts, [next])}));
      }}
      onLength={(study, length) => setWorkspace(value => ({...value, lengths: {...value.lengths, [study]: length}}))}
      onClose={closePanel}/>}
  </main>;
}
