import {useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode} from 'react';
import {
  ArrowLeft, ChartSpline, ChevronDown, Download, Ellipsis, History, LockKeyhole, LockKeyholeOpen,
  Maximize2, Minimize2, Pencil, Radio, RefreshCw, Save, ScanLine, SkipBack, SkipForward, Trash2, X,
  CalendarDays, Code2, PanelsTopLeft, Settings2,
} from 'lucide-react';
import ChartBoundary from './chart-boundary';
import ReplayChart, {type LiveChartActions} from './replay-chart';
import LiveDrawingToolbar from './live-drawing-toolbar';
import LiveDrawingSettings, {drawingInputColor} from './live-drawing-settings';
import LiveStudyPanel from './live-study-panel';
import LiveAppearance from './live-appearance';
import LiveLayoutPanel, {type ActiveLayout} from './live-layout-panel';
import LivePineEditor, {newScriptDraft, type ScriptDraft} from './live-pine-editor';
import {defaultChartView, loadLiveWorkspace, makeLayoutFile, periodList, readChartView, workspaceKey} from '../lib/live-layouts';
import {saveLiveAutoSave, saveLiveLayout, type SavedLayout} from '../lib/storage';
import {usePine} from '../lib/use-pine';
import type {LiveViewport} from '../lib/chart-tools';
import {drawingTools} from '../lib/drawing-definitions';
import {positionMetrics} from '../lib/drawing-geometry';
import type {Bar, Drawing, DrawingKind, IndicatorSpec, Trade} from '../lib/engine';
import {historyCatalog, loadBefore} from '../lib/history';
import {candleWindow, olderPageSize, periods, type Period} from '../lib/live-market';
import {livePlots, studyDefinitions, studyLabel, type LiveStudy} from '../lib/live-indicators';
import {useLiveMarket} from '../lib/use-live-market';
import {useDialog} from '../lib/use-dialog';
import './live-workspace.css';

const cameraKey = workspaceKey + '-camera';
// Discard the too-wide saved viewport once after changing the live framing.
const cameraVersion = 2;
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
  const {period, studies, lengths, drawings, magnet, hiddenDrawings, stayInDrawingMode, appearance, scripts} = workspace;
  const [activeLayout, setActiveLayout] = useState(initial.active);
  const [saveState, setSaveState] = useState<'ready' | 'saving' | 'saved' | 'error'>('ready');
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [saveError, setSaveError] = useState('');
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
  const [backup, setBackup] = useState<{period: Period; bars: Bar[]; failed?: boolean}>();
  const [storageFailed, setStorageFailed] = useState(false);
  const [panel, setPanel] = useState<'quotes' | 'view' | 'history' | 'drawing' | 'objects' | 'studies' | 'appearance' | 'layouts' | 'pine' | null>(null);
  const [editingDrawing, setEditingDrawing] = useState<string | null>(null);
  const [focusMode, setFocusMode] = useState(false);
  const [historyDay, setHistoryDay] = useState('');
  const [fitHistory, setFitHistory] = useState(false);
  const chart = useRef<LiveChartActions>(null);
  const saveWorkingCopy = useRef<() => Promise<void>>(async () => {});
  const saveInProgress = useRef(false);
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
  const builtInPlots = useMemo(() => livePlots(bars, studies, lengths), [bars, studies, lengths]);
  const proposedScripts = useMemo(() => !trial ? scripts : scripts.some(s => s.id === trial.id)
    ? scripts.map(s => s.id === trial.id ? trial : s) : [...scripts, trial], [scripts, trial]);
  const jobs = useMemo(() => proposedScripts.filter(s => s.enabled), [proposedScripts]);
  const visibleDrawings = useMemo(() => drawings.filter(d => !d.visiblePeriods || d.visiblePeriods.includes(period)), [drawings, period]);
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
  const minuteBased = market.bars.length > market.closed.length;
  const last = minuteBased ? market.minuteTime : market.closed.at(-1)?.time;
  const through = last === undefined ? undefined : candleWindow(last, minuteBased ? 60 : periods[period]).close;
  const pineFrame = {asOf: through ?? (bars.length ? candleWindow(bars.at(-1)!.time, periods[period]).close : 0),
    minutes: market.archive || historical.length ? emptyBars : market.minutes, nativeHistory: true};
  const pineSession = ['live', market.key, market.archive, Boolean(historical.length)].join(':');
  const pine = usePine(undefined, jobs.length > 0, bars, periods[period], pineSession, jobs,
    bars, periods[period], 'eightcap', false, pineFrame);
  const plots = useMemo(() => [...builtInPlots, ...pine.plots], [builtInPlots, pine.plots]);
  const enabledScripts = scripts.filter(s => s.enabled);
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
      : historical.length ? 'ข้อมูลสำรอง' : market.barError || market.minuteError ? 'แสดงแท่งที่โหลดไว้'
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
    setWorkspace(row.file.workspace);
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
    setInitialView(null);
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

  function closePanel() { setPanel(null); setEditingDrawing(null); setEditorMessage(''); }
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

  const drawingStrip = activeDrawing && <section className="live-object-strip" aria-label="แก้ไขวัตถุที่เลือก">
    <button type="button" className="live-object-name" title="แก้สีและข้อความของวัตถุ" aria-haspopup="dialog"
      onClick={() => editDrawing(activeDrawing.id)}><Pencil size={15}/><span>{drawingTools[activeDrawing.kind].name}</span>
      <i className="live-object-swatch" style={{background: drawingInputColor(activeDrawing.color)}} aria-hidden="true"/></button>
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
          onClick={() => selectPeriod(tf)}>{tf === '1d' ? '1D' : tf}</button>)}
      </div>
      <button className="live-studies-button" type="button" aria-haspopup="dialog" aria-label="อินดิเคเตอร์"
        title="อินดิเคเตอร์" onClick={() => setPanel('studies')}>
        <ChartSpline size={19}/><span className="live-wide-label">อินดิเคเตอร์</span>
        {totalStudies > 0 && <span className="live-study-count" aria-label={totalStudies + ' ตัวที่เปิดอยู่'}>{totalStudies}</span>}
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
        favorites={workspace.favoriteTools} favoritePosition={workspace.favoritePosition}
        onFavorite={kind => setWorkspace(value => ({...value, favoriteTools: value.favoriteTools.includes(kind)
          ? value.favoriteTools.filter(tool => tool !== kind) : [...value.favoriteTools, kind]}))}
        onMoveFavorites={position => setWorkspace(value => ({...value, favoritePosition: position}))}
        magnet={magnet} hidden={hiddenDrawings} stayInDrawingMode={stayInDrawingMode}
        canUndo={undo.current.length > 0} canRedo={redo.current.length > 0}
        canDelete={Boolean(activeDrawing && !activeDrawing.locked)}
        onPick={kind => { setMode(kind); setSelected(null); setFollow(false); }} onSelect={cancelDrawing}
        onMagnet={() => setWorkspace(value => ({...value, magnet: !value.magnet}))}
        onStayInDrawingMode={() => setWorkspace(value => ({...value, stayInDrawingMode: !value.stayInDrawingMode}))}
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
      <div className="live-chart" style={{'--chart-bg': appearance.background, '--chart-ink': appearance.text,
        '--chart-up': appearance.upColor, '--chart-down': appearance.downColor} as CSSProperties}>
        {bars.length ? <ChartBoundary resetKey={viewportKey}><ReplayChart live key={viewportKey} liveActions={chart}
          liveViewport={viewport} initialView={initialView} appearance={appearance} liveBid={liveNow ? quote.bid : undefined} liveClock={market.serverNow}
          fills={pine.fills} shapes={pine.shapes} pineDrawings={pine.drawings} pineTables={pine.tables} calculating={pine.calculating}
          bars={bars} trades={noTrades} plots={plots} follow={follow} seconds={periods[period]}
          drawings={visibleDrawings} drawingMode={mode} magnet={magnet} hiddenDrawings={hiddenDrawings}
          selectedDrawing={selected} onDrawingSelect={setSelected} onDrawingEdit={editDrawing} onDrawingCancel={cancelDrawing}
          liveSelection={drawingStrip} liveLegend={totalStudies > 0 && <div className="live-study-legend" aria-label="อินดิเคเตอร์ที่ใช้งาน">
            <button type="button" onClick={() => setPanel('studies')} aria-label="จัดการอินดิเคเตอร์ที่ใช้งาน">
              <i style={{backgroundColor: studies.length ? studyDefinitions[studies[0]].color : pine.plots[0]?.color ?? '#e2bc73'}} aria-hidden="true"/>
              {studies.length ? studyLabel(studies[0], lengths) : enabledScripts[0]?.name}
              {totalStudies > 1 && <span>+{totalStudies - 1}</span>}
            </button>
            {(pine.error || pine.warnings.length > 0) && <button type="button" onClick={() => setPanel('pine')} title={pine.error || pine.warnings.join(' · ')}>ดูข้อความ Pine</button>}
          </div>}
          onDrawing={drawing => {
            saveDrawings([...drawings, drawing]);
            if (stayInDrawingMode) setSelected(null);
            else { setSelected(drawing.id); setMode(null); }
          }}
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
      <span className="live-foot-status" role="status" title={chartStatus}>{chartStatus}</span>
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
      <div className="live-drawing-list">
        {drawings.length === 0 && <p className="chart-hint">ยังไม่มีวัตถุที่วาด</p>}
        {drawings.map(drawing => <button type="button" key={drawing.id} onClick={() => editDrawing(drawing.id)}>
          {drawing.locked ? <LockKeyhole size={14}/> : <Pencil size={14}/>}
          <span>{drawingTools[drawing.kind].name}{drawing.text?.trim() ? ' · ' + drawing.text.trim().slice(0, 90) : ''}
            {drawing.visiblePeriods && !drawing.visiblePeriods.includes(period) ? ' · ซ่อนใน ' + period : ''}</span>
        </button>)}
      </div>
    </LivePanel>}

    {panel === 'drawing' && drawingToEdit && <LivePanel title={drawingTools[drawingToEdit.kind].name} onClose={closePanel} wide>
      <LiveDrawingSettings key={drawingToEdit.id} drawing={drawingToEdit} onSave={changeDrawing} onClose={closePanel}/>
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
