import {useEffect, useMemo, useRef, useState} from 'react';
import {ArrowLeft, Crosshair, Eye, EyeOff, Magnet, Radio, Redo2, RefreshCw, SlidersHorizontal, Trash2, Undo2} from 'lucide-react';
import ChartBoundary from './chart-boundary';
import ReplayChart from './replay-chart';
import LiveStudyPanel from './live-study-panel';
import {drawingNames} from '../lib/chart-tools';
import type {Bar, Drawing, DrawingKind, Trade} from '../lib/engine';
import {historyCatalog, loadBefore} from '../lib/history';
import {periods, type Period} from '../lib/live-market';
import {livePlots, studyDefinitions, studyLabel, studyLength, type LiveStudy, type LiveStudyLengths} from '../lib/live-indicators';
import {useLiveMarket} from '../lib/use-live-market';
import './live-workspace.css';

const storageKey = 'xau-live-workspace-v1';
const periodList = Object.keys(periods) as Period[];
const studyList = Object.keys(studyDefinitions) as LiveStudy[];
const drawingList = Object.keys(drawingNames) as DrawingKind[];
const emptyBars: Bar[] = [];
const noTrades: Trade[] = [];
const price = new Intl.NumberFormat('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
const clock = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Bangkok', day: '2-digit', month: 'short',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
});

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
      drawings: Array.isArray(stored.drawings) ? stored.drawings.filter((d: Drawing | null) =>
        d && drawingList.includes(d.kind) && typeof d.id === 'string' &&
        Array.isArray(d.points) && d.points.length > 0 &&
        d.points.every(p => p && Number.isFinite(p.time) && p.time > 0 && Number.isFinite(p.price) && p.price > 0)
      ).slice(0, 500) : [],
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
  const [retry, setRetry] = useState(0);
  const [backup, setBackup] = useState<{period: Period; bars: Bar[]; failed?: boolean}>();
  const [storageFailed, setStorageFailed] = useState(false);
  const [showStudies, setShowStudies] = useState(false);
  const undo = useRef<Drawing[][]>([]);
  const redo = useRef<Drawing[][]>([]);
  const market = useLiveMarket(period, retry);
  const needsBackup = market.barError && market.closed.length === 0;

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
  const bars = useMemo(() => market.closed.length
    ? market.open ? [...market.closed, market.open] : market.closed
    : historical, [market.closed, market.open, historical]);
  const plots = useMemo(() => livePlots(bars, studies, lengths), [bars, studies, lengths]);
  const activeDrawing = drawings.find(d => d.id === selected);
  const quote = market.quote;
  const status = market.quoteError ? 'การเชื่อมต่อขัดข้อง' : quote?.status === 'live' ? 'ราคาสด'
    : quote?.status === 'closed' ? 'ตลาดปิด' : quote ? 'ราคาล่าช้า' : 'กำลังเชื่อมต่อ';

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
    setWorkspace(current => ({...current, period: value}));
    cancelDrawing();
    setFollow(true);
  }
  function toggleStudy(study: LiveStudy) {
    setWorkspace(value => ({...value, studies: value.studies.includes(study)
      ? value.studies.filter(s => s !== study) : [...value.studies, study]}));
  }

  return <main className="live-workspace">
    <header className="live-header">
      <div className="live-identity">
        <img src={import.meta.env.BASE_URL + 'icons/icon-192.png'} alt="" width={42} height={42}/>
        <div><h1>XAUUSD Live</h1><p>Eightcap MT5 <span> / </span> Gold CFD</p></div>
      </div>
      <button type="button" onClick={onReplay}><ArrowLeft size={16}/>Replay</button>
    </header>
    <section className="live-tape" aria-label="ราคาและสถานะข้อมูล">
      <div className="live-feed" data-live={quote?.status === 'live' && !market.quoteError}>
        <strong role="status">{status}</strong>
        <span>{quote ? clock.format(quote.time * 1000) + ' กรุงเทพฯ' : 'Eightcap MT5'}</span>
      </div>
      <dl className="live-quotes">
        <div><dt>Bid</dt><dd>{quote ? price.format(quote.bid) : '—'}</dd></div>
        <div><dt>Ask</dt><dd>{quote ? price.format(quote.ask) : '—'}</dd></div>
        <div><dt>Spread (USD)</dt><dd>{quote ? price.format(quote.ask - quote.bid) : '—'}</dd></div>
      </dl>
      <button className="live-icon" type="button" aria-label="เชื่อมต่อราคาใหม่" title="เชื่อมต่อราคาใหม่"
        onClick={() => setRetry(value => value + 1)}><RefreshCw size={17}/></button>
    </section>
    <section className="live-desk" aria-label="พื้นที่วิเคราะห์ XAUUSD">
      <div className="live-controls">
        <div className="live-periods" role="group" aria-label="ช่วงเวลาแท่งราคา">
          {periodList.map(tf => <button key={tf} type="button" aria-pressed={period === tf} onClick={() => selectPeriod(tf)}>{tf}</button>)}
        </div>
        <button className="live-studies-button" type="button" aria-haspopup="dialog" onClick={() => setShowStudies(true)}>
          <SlidersHorizontal size={15}/>อินดิเคเตอร์{studies.length ? ' (' + studies.length + ')' : ''}
        </button>
        <button type="button" aria-pressed={follow} onClick={() => setFollow(value => !value)}><Radio size={15}/>ติดตามกราฟ</button>
      </div>
      {!!studies.length && <div className="live-study-legend" aria-label="อินดิเคเตอร์ที่ใช้งาน">
        {studies.map(study => <button key={study} type="button" onClick={() => setShowStudies(true)}>{studyLabel(study, lengths)}</button>)}
      </div>}
      <div className="live-chart-layout">
        <aside className="live-tools" aria-label="เครื่องมือวาด">
          <button type="button" aria-pressed={!mode} onClick={cancelDrawing}><Crosshair size={15}/>เลือก</button>
          {drawingList.map(kind => <button key={kind} type="button" disabled={hiddenDrawings || !bars.length || drawings.length >= 500}
            aria-pressed={mode === kind} onClick={() => { setMode(kind); setSelected(null); }}>{drawingNames[kind]}</button>)}
          <div className="live-drawing-actions">
            <button className="live-icon" type="button" aria-label="ดูดจุดเข้าหาราคาแท่ง" title="ดูดจุดเข้าหาราคาแท่ง" aria-pressed={magnet}
              onClick={() => setWorkspace(value => ({...value, magnet: !value.magnet}))}><Magnet size={16}/></button>
            <button className="live-icon" type="button" aria-label="ซ่อนเส้นวาด" title="ซ่อนเส้นวาด" aria-pressed={hiddenDrawings} onClick={() => {
              cancelDrawing();
              setWorkspace(value => ({...value, hiddenDrawings: !value.hiddenDrawings}));
            }}>{hiddenDrawings ? <EyeOff size={16}/> : <Eye size={16}/>}</button>
            <button className="live-icon" type="button" aria-label="ย้อนการวาด" title="ย้อนการวาด" disabled={!undo.current.length}
              onClick={() => restoreDrawing(undo.current, redo.current)}><Undo2 size={16}/></button>
            <button className="live-icon" type="button" aria-label="ทำการวาดซ้ำ" title="ทำการวาดซ้ำ" disabled={!redo.current.length}
              onClick={() => restoreDrawing(redo.current, undo.current)}><Redo2 size={16}/></button>
            <button className="live-icon" type="button" aria-label="ลบวัตถุที่เลือก" title="ลบวัตถุที่เลือก"
              disabled={!activeDrawing || activeDrawing.locked} onClick={deleteDrawing}><Trash2 size={16}/></button>
          </div>
        </aside>
        <div className="live-chart">
          {bars.length ? <ChartBoundary resetKey={period}><ReplayChart live key={period} bars={bars} trades={noTrades} plots={plots}
            follow={follow} seconds={periods[period]} drawings={drawings} drawingMode={mode} magnet={magnet} hiddenDrawings={hiddenDrawings}
            selectedDrawing={selected} onDrawingSelect={setSelected} onDrawingCancel={cancelDrawing}
            onDrawing={drawing => { saveDrawings([...drawings, drawing]); setSelected(drawing.id); setMode(null); }}
            onDrawingChange={changeDrawing} onDrawingDelete={deleteDrawing} onDragStart={() => setFollow(false)}
            onDrawingUndo={() => restoreDrawing(undo.current, redo.current)}
            onDrawingRedo={() => restoreDrawing(redo.current, undo.current)}/></ChartBoundary>
            : <div className="live-chart-empty" role="status">{needsBackup && backup?.failed
              ? 'โหลดแท่งราคาไม่ได้ ลองเชื่อมต่อใหม่' : needsBackup ? 'กำลังโหลดข้อมูลย้อนหลังที่บันทึกไว้' : 'กำลังโหลดแท่งราคาจาก Eightcap'}</div>}
        </div>
      </div>
      <div className="live-foot">
        <span>{historical.length ? 'กราฟย้อนหลังถึง ' + clock.format(historical.at(-1)!.time * 1000)
          : market.barError && market.closed.length ? 'แสดงแท่งล่าสุดที่โหลดไว้' : market.open ? 'แท่งปัจจุบันใช้ Bid ที่แอปรับมา'
          : market.closed.length ? 'แสดงแท่งที่ปิดแล้ว' : 'กราฟราคา Bid'}</span>
        <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">TradingView Lightweight Charts™</a>
      </div>
    </section>
    {activeDrawing && <section className="live-object" aria-label="แก้ไขวัตถุที่เลือก">
      <strong>{drawingNames[activeDrawing.kind]}</strong>
      {activeDrawing.kind === 'text' && <input aria-label="ข้อความบนกราฟ" defaultValue={activeDrawing.text} key={activeDrawing.id}
        maxLength={100} onBlur={e => { if (e.target.value !== activeDrawing.text) changeDrawing({...activeDrawing, text: e.target.value}); }}/>}
      <button type="button" aria-pressed={Boolean(activeDrawing.locked)}
        onClick={() => changeDrawing({...activeDrawing, locked: !activeDrawing.locked})}>{activeDrawing.locked ? 'ปลดล็อก' : 'ล็อกวัตถุ'}</button>
    </section>}
    {storageFailed && <p role="alert">เบราว์เซอร์บันทึกการตั้งค่ากราฟลงเครื่องไม่ได้</p>}
    {showStudies && <LiveStudyPanel selected={studies} lengths={lengths} onToggle={toggleStudy}
      onLength={(study, length) => setWorkspace(value => ({...value, lengths: {...value.lengths, [study]: length}}))}
      onClose={() => setShowStudies(false)}/>}
  </main>;
}
