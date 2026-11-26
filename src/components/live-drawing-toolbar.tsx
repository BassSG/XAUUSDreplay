import {useState} from 'react';
import {
  ArrowDown, ArrowRight, ArrowUp, ArrowUpRight, Brush, CalendarRange, ChartCandlestick,
  ChartColumnIncreasing, ChartLine, ChartNoAxesCombined, Circle, CornerUpRight, Crosshair,
  Diamond, Ellipsis, Eye, EyeOff, Fan, Flag, GitFork, Grid2X2, Highlighter, Info,
  ListTree, Magnet, MessageSquare, Minus, MousePointer2, MoveHorizontal, MoveUpRight,
  MoveVertical, PanelsLeftBottom, Redo2, Route, Ruler, Search, Shapes, Slash, Spline, Square,
  StickyNote, Tag, Trash2, TrendingDown, TrendingUp, Triangle, TriangleRight, Type,
  Undo2, Waypoints, Workflow, X, type LucideIcon,
} from 'lucide-react';
import {drawingGroups, drawingKinds, drawingTools, type DrawingKind} from '../lib/drawing-definitions';
import {useDialog} from '../lib/use-dialog';

type ToolGroup = keyof typeof drawingGroups;
const groups = Object.keys(drawingGroups) as ToolGroup[];
const groupIcons: Record<ToolGroup, LucideIcon> = {
  lines: TrendingUp, channels: PanelsLeftBottom, levels: ListTree, shapes: Shapes,
  patterns: Waypoints, measure: Ruler, annotations: Type,
};
const icons: Record<DrawingKind, LucideIcon> = {
  trend: MoveUpRight, ray: CornerUpRight, extended: Slash, arrow: ArrowUpRight, info: Info,
  hline: Minus, hray: ArrowRight, vline: MoveVertical, cross: Crosshair, channel: PanelsLeftBottom,
  regression: ChartNoAxesCombined, pitchfork: GitFork, fib: ListTree, fibExtension: ChartColumnIncreasing,
  fibChannel: Workflow, fibTime: CalendarRange, fibFan: Fan, gannBox: Grid2X2, gannFan: TriangleRight,
  rect: Square, rotated: Diamond, circle: Circle, ellipse: Ellipsis, triangle: Triangle,
  polyline: Route, brush: Brush, highlighter: Highlighter, curve: Spline, doubleCurve: Workflow, arc: Fan,
  abcd: Waypoints, xabcd: Workflow, headShoulders: ChartNoAxesCombined, elliott: ChartLine, elliottABC: Route,
  cycle: CalendarRange, ruler: Ruler, priceRange: MoveVertical, dateRange: MoveHorizontal,
  position: ChartCandlestick, long: TrendingUp, short: TrendingDown, vwap: ChartLine,
  text: Type, note: StickyNote, priceLabel: Tag, callout: MessageSquare, flag: Flag, markUp: ArrowUp, markDown: ArrowDown,
};
const keywords: Partial<Record<DrawingKind, string>> = {
  hline: 'horizontal line support resistance แนวรับ แนวต้าน',
  vline: 'vertical line',
  hray: 'horizontal ray',
  trend: 'trendline trend line',
  fib: 'fibo retracement',
  fibExtension: 'fibo projection',
  rect: 'rectangle zone',
  ruler: 'price date range measure ไม้บรรทัด',
  long: 'risk reward rr buy',
  short: 'risk reward rr sell',
};

function DrawingPicker({group, onClose, onPick}: {
  group: ToolGroup | 'all'; onClose: () => void; onPick: (kind: DrawingKind) => void;
}) {
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState(group);
  useDialog(true, onClose);
  const filter = query.trim().toLocaleLowerCase();
  const matches = drawingKinds.filter(kind => {
    const {name, help} = drawingTools[kind];
    return [name, help, kind, keywords[kind] ?? ''].some(text => text.toLocaleLowerCase().includes(filter));
  });
  const visibleGroups = scope === 'all' || filter ? groups : [scope];

  return <div className="modal-shade" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="modal live-picker" role="dialog" aria-modal="true" aria-labelledby="drawing-picker-title">
      <header className="modal-head">
        <h2 id="drawing-picker-title">{scope === 'all' ? 'เครื่องมือวาด' : drawingGroups[scope].name}</h2>
        <button className="live-icon" type="button" aria-label="ปิดเครื่องมือวาด" onClick={onClose}><X size={18}/></button>
      </header>
      <div className="live-picker-search">
        <label><Search size={16}/><input type="search" aria-label="ค้นหาเครื่องมือวาด"
          placeholder="ค้นหาชื่อเครื่องมือ" value={query} onChange={event => setQuery(event.target.value)}/></label>
        {scope !== 'all' && <button type="button" onClick={() => setScope('all')}>ดูทุกหมวด</button>}
      </div>
      <div className="live-picker-list">
        {!matches.length && <p role="status">ไม่พบเครื่องมือที่ตรงกับคำค้น</p>}
        {visibleGroups.map(group => {
          const tools = drawingGroups[group].tools.filter(kind => matches.includes(kind));
          if (!tools.length) return null;
          return <section key={group} aria-label={drawingGroups[group].name}>
            {(scope === 'all' || filter) && <h3>{drawingGroups[group].name}</h3>}
            <div className="live-picker-options">
              {tools.map(kind => {
                const Icon = icons[kind];
                const tool = drawingTools[kind];
                return <button key={kind} className="live-picker-option" type="button" title={tool.help}
                  aria-label={tool.name} aria-describedby={'drawing-help-' + kind} onClick={() => onPick(kind)}>
                  <Icon size={19} aria-hidden="true"/>
                  <span><strong>{tool.name}</strong><small id={'drawing-help-' + kind}>{tool.help}</small></span>
                </button>;
              })}
            </div>
          </section>;
        })}
      </div>
    </section>
  </div>;
}

type Props = {
  mode: DrawingKind | null; enabled: boolean; magnet: boolean; hidden: boolean;
  canUndo: boolean; canRedo: boolean; canDelete: boolean;
  onPick: (kind: DrawingKind) => void; onSelect: () => void; onMagnet: () => void;
  onHide: () => void; onUndo: () => void; onRedo: () => void; onDelete: () => void;
};

export default function LiveDrawingToolbar(props: Props) {
  const [picker, setPicker] = useState<ToolGroup | 'all' | null>(null);
  const [recent, setRecent] = useState<DrawingKind>('hline');
  const current = props.mode ?? recent;
  const CurrentIcon = icons[current];
  const currentTool = drawingTools[current];

  function pick(kind: DrawingKind) {
    setPicker(null);
    setRecent(kind);
    props.onPick(kind);
  }

  return <>
    <aside className="live-tools" aria-label="เครื่องมือวาดบนกราฟ">
      <button type="button" aria-label="เคอร์เซอร์เลือกวัตถุ" title="เคอร์เซอร์เลือกวัตถุ · แตะเส้นเพื่อเลือกหรือลากแก้ไข"
        aria-pressed={!props.mode} onClick={props.onSelect}><MousePointer2 size={19}/></button>
      <button type="button" aria-label="เครื่องมือวาดทั้งหมด" title="เครื่องมือวาดทั้งหมด · ค้นหาตามชื่อหรือเปิดทุกหมวด"
        aria-haspopup="dialog" disabled={!props.enabled} onClick={() => setPicker('all')}><Search size={19}/></button>
      <button type="button" aria-label={currentTool.name} title={currentTool.name + ' · ' + currentTool.help}
        aria-pressed={props.mode === current} disabled={!props.enabled}
        onClick={() => props.mode === current ? props.onSelect() : pick(current)}><CurrentIcon size={19}/></button>
      <div className="live-tool-groups" role="group" aria-label="หมวดเครื่องมือ">
        {groups.map(group => {
          const Icon = groupIcons[group];
          const {name} = drawingGroups[group];
          return <button key={group} type="button" aria-label={name} title={name}
            aria-haspopup="dialog" disabled={!props.enabled} onClick={() => setPicker(group)}><Icon size={18}/></button>;
        })}
      </div>
      <div className="live-drawing-actions" role="group" aria-label="จัดการเส้นวาด">
        <button type="button" aria-label="ดูดจุดเข้าหาราคาแท่ง" title="แม่เหล็ก · ดูดจุดเข้า Open, High, Low หรือ Close"
          aria-pressed={props.magnet} onClick={props.onMagnet}><Magnet size={17}/></button>
        <button type="button" aria-label={props.hidden ? 'แสดงเส้นวาด' : 'ซ่อนเส้นวาด'}
          title={props.hidden ? 'แสดงเส้นวาด' : 'ซ่อนเส้นวาด'} aria-pressed={props.hidden}
          onClick={props.onHide}>{props.hidden ? <EyeOff size={17}/> : <Eye size={17}/>}</button>
        <button type="button" aria-label="ย้อนการวาด" title="ย้อนการวาด · Ctrl+Z"
          disabled={!props.canUndo} onClick={props.onUndo}><Undo2 size={17}/></button>
        <button type="button" aria-label="ทำการวาดซ้ำ" title="ทำการวาดซ้ำ · Ctrl+Shift+Z"
          disabled={!props.canRedo} onClick={props.onRedo}><Redo2 size={17}/></button>
        <button type="button" aria-label="ลบวัตถุที่เลือก" title="ลบวัตถุที่เลือก · Delete"
          disabled={!props.canDelete} onClick={props.onDelete}><Trash2 size={17}/></button>
      </div>
    </aside>
    {picker && props.enabled && <DrawingPicker group={picker} onClose={() => setPicker(null)} onPick={pick}/>}
  </>;
}
