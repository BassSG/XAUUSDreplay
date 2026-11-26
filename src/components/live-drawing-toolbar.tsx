import {useRef, useState, type ReactNode} from 'react';
import {
  ArrowDown, ArrowRight, ArrowUp, ArrowUpRight, Brush, CalendarRange, ChartCandlestick,
  ChartColumnIncreasing, ChartLine, ChartNoAxesCombined, Circle, CornerUpRight, Crosshair,
  Diamond, Ellipsis, Eye, EyeOff, Fan, Flag, GitFork, Grid2X2, Highlighter, Info,
  ListTree, Magnet, MessageSquare, Minus, MousePointer2, MoveHorizontal, MoveUpRight,
  MoveVertical, PanelsLeftBottom, PencilRuler, Redo2, Route, Ruler, Search, Shapes, Slash, Spline, Square,
  StickyNote, Tag, Trash2, TrendingDown, TrendingUp, Triangle, TriangleRight, Type,
  GripVertical, Repeat, Star, Undo2, Waypoints, Workflow, X, type LucideIcon,
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

function DrawingPicker({group, enabled, actions, onClose, onPick, favorites, toggleFavorite}: {
  group: ToolGroup | 'all'; enabled: boolean; actions: ReactNode;
  onClose: () => void; onPick: (kind: DrawingKind) => void;
  favorites: DrawingKind[]; toggleFavorite: (kind: DrawingKind) => void;
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
                return <div className="live-picker-item" key={kind}>
                <button className="live-picker-option" type="button" title={tool.help} disabled={!enabled}
                  aria-label={tool.name} aria-describedby={'drawing-help-' + kind} onClick={() => onPick(kind)}>
                  <Icon size={19} aria-hidden="true"/>
                  <span><strong>{tool.name}</strong><small id={'drawing-help-' + kind}>{tool.help}</small></span>
                </button>
                <button type="button" className="live-favorite-star" aria-label={'รายการโปรด: ' + tool.name}
                  title={'ปักหมุด ' + tool.name} aria-pressed={favorites.includes(kind)}
                  onClick={() => toggleFavorite(kind)}><Star size={17} fill={favorites.includes(kind) ? 'currentColor' : 'none'}/></button>
                </div>;
              })}
            </div>
          </section>;
        })}
      </div>
      {actions}
    </section>
  </div>;
}

type Props = {
  mode: DrawingKind | null; enabled: boolean; magnet: boolean; hidden: boolean; stayInDrawingMode: boolean;
  canUndo: boolean; canRedo: boolean; canDelete: boolean;
  navigation: ReactNode;
  favorites: DrawingKind[]; favoritePosition: {x: number; y: number};
  onFavorite: (kind: DrawingKind) => void; onMoveFavorites: (position: Props['favoritePosition']) => void;
  onPick: (kind: DrawingKind) => void; onSelect: () => void; onMagnet: () => void;
  onStayInDrawingMode: () => void;
  onHide: () => void; onUndo: () => void; onRedo: () => void; onDelete: () => void;
};

function FavoriteBar({props, pick}: {props: Props; pick: (kind: DrawingKind) => void}) {
  const bounds = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const drag = useRef<{id: number; x: number; y: number; start: Props['favoritePosition']; next: Props['favoritePosition']} | null>(null);
  const [preview, setPreview] = useState<Props['favoritePosition'] | null>(null);
  const position = preview ?? props.favoritePosition;
  const clamp = (n: number) => Math.min(1, Math.max(0, n));
  return <div className="live-favorite-area" ref={bounds}>
    <div className="live-favorite-bar" ref={bar} role="toolbar" aria-label="เครื่องมือโปรด"
      style={{left: position.x * 100 + '%', top: position.y * 100 + '%',
        transform: `translate(${-position.x * 100}%, ${-position.y * 100}%)`}}>
      <button type="button" className="live-favorite-grip" title="ลากเพื่อย้ายแถบเครื่องมือโปรด" aria-label="ย้ายแถบเครื่องมือโปรด"
        onPointerDown={e => {
          if (e.button !== 0 || drag.current) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = {id: e.pointerId, x: e.clientX, y: e.clientY, start: position, next: position};
        }}
        onPointerMove={e => {
          const start = drag.current;
          if (start?.id !== e.pointerId || !bounds.current || !bar.current) return;
          const w = bounds.current.clientWidth - bar.current.offsetWidth;
          const h = bounds.current.clientHeight - bar.current.offsetHeight;
          start.next = {x: w > 0 ? clamp(start.start.x + (e.clientX - start.x) / w) : start.start.x,
            y: h > 0 ? clamp(start.start.y + (e.clientY - start.y) / h) : start.start.y};
          setPreview(start.next);
        }}
        onPointerUp={e => {
          if (drag.current?.id !== e.pointerId) return;
          props.onMoveFavorites(drag.current.next);
          drag.current = null; setPreview(null);
        }}
        onLostPointerCapture={() => { drag.current = null; setPreview(null); }}
        onKeyDown={e => {
          const shifts: Record<string, [number, number]> = {ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1]};
          const shift = shifts[e.key];
          if (!shift) return;
          e.preventDefault(); e.stopPropagation();
          props.onMoveFavorites({x: clamp(position.x + shift[0] * .05), y: clamp(position.y + shift[1] * .05)});
        }}><GripVertical size={17}/></button>
      <div className="live-favorite-list">
        {props.favorites.map(kind => {
          const Icon = icons[kind];
          const tool = drawingTools[kind];
          return <button type="button" key={kind} title={tool.name + ' · ' + tool.help} aria-label={tool.name}
            aria-pressed={props.mode === kind} disabled={!props.enabled} onClick={() => pick(kind)}><Icon size={17}/></button>;
        })}
      </div>
    </div>
  </div>;
}

function DrawingActions({props, inPicker = false}: {props: Props; inPicker?: boolean}) {
  return <div className={'live-drawing-actions' + (inPicker ? ' live-picker-actions' : '')}
    role="group" aria-label="จัดการเส้นวาด">
    <button type="button" aria-label="ดูดจุดเข้าหาราคาแท่ง" title="แม่เหล็ก · กด Ctrl ค้างเพื่อใช้ชั่วคราว"
      aria-pressed={props.magnet} onClick={props.onMagnet}><Magnet size={17}/></button>
    <button type="button" aria-label={props.stayInDrawingMode ? 'ปิดวาดต่อเนื่อง' : 'วาดต่อเนื่อง'}
      title={props.stayInDrawingMode ? 'ปิดวาดต่อเนื่อง · หลังวาดเสร็จกลับไปเลือกวัตถุ' : 'วาดต่อเนื่อง · วาดวัตถุชิ้นถัดไปด้วยเครื่องมือเดิม'}
      aria-pressed={props.stayInDrawingMode} onClick={props.onStayInDrawingMode}><Repeat size={17}/></button>
    <button type="button" aria-label={props.hidden ? 'แสดงเส้นวาด' : 'ซ่อนเส้นวาด'}
      title={props.hidden ? 'แสดงเส้นวาด' : 'ซ่อนเส้นวาด'} aria-pressed={props.hidden}
      onClick={props.onHide}>{props.hidden ? <EyeOff size={17}/> : <Eye size={17}/>}</button>
    <button type="button" aria-label="ย้อนการวาด" title="ย้อนการวาด · Ctrl+Z"
      disabled={!props.canUndo} onClick={props.onUndo}><Undo2 size={17}/></button>
    <button type="button" aria-label="ทำการวาดซ้ำ" title="ทำการวาดซ้ำ · Ctrl+Shift+Z"
      disabled={!props.canRedo} onClick={props.onRedo}><Redo2 size={17}/></button>
    <button type="button" aria-label="ลบวัตถุที่เลือก" title="ลบวัตถุที่เลือก · Delete"
      disabled={!props.canDelete} onClick={props.onDelete}><Trash2 size={17}/></button>
  </div>;
}

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
        aria-pressed={!props.mode} onClick={props.onSelect}><MousePointer2 size={19}/><span>เลือก</span></button>
      <button type="button" aria-label="เครื่องมือวาดทั้งหมด" title="เครื่องมือวาดทั้งหมด · ค้นหาตามชื่อหรือเปิดทุกหมวด"
        aria-haspopup="dialog" onClick={() => setPicker('all')}><PencilRuler size={19}/><span>เครื่องมือ</span></button>
      <button type="button" aria-label={currentTool.name} title={currentTool.name + ' · ' + currentTool.help}
        aria-pressed={props.mode === current} disabled={!props.enabled}
        onClick={() => props.mode === current ? props.onSelect() : pick(current)}><CurrentIcon size={19}/><span>ด่วน</span></button>
      {props.navigation}
      <div className="live-tool-groups" role="group" aria-label="หมวดเครื่องมือ">
        {groups.map(group => {
          const Icon = groupIcons[group];
          const {name} = drawingGroups[group];
          return <button key={group} type="button" aria-label={name} title={name}
            aria-haspopup="dialog" disabled={!props.enabled} onClick={() => setPicker(group)}><Icon size={18}/></button>;
        })}
      </div>
      <DrawingActions props={props}/>
    </aside>
    {props.favorites.length > 0 && <FavoriteBar props={props} pick={pick}/>}
    {picker && <DrawingPicker group={picker} enabled={props.enabled} actions={<DrawingActions props={props} inPicker/>}
      favorites={props.favorites} toggleFavorite={props.onFavorite}
      onClose={() => setPicker(null)} onPick={pick}/>}
  </>;
}
