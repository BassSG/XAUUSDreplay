import {useEffect, useRef, useState, type HTMLAttributes, type PointerEvent, type ReactNode} from 'react';
import {
  ChevronLeft, Eye, EyeOff, GripVertical, Magnet, MousePointer2, PencilRuler,
  Redo2, Repeat, Search, Star, Trash2, Undo2, X,
} from 'lucide-react';
import {DrawingToolIcon} from './drawing-tool-icon';
import {drawingGroups, drawingKinds, drawingTools, type DrawingKind} from '../lib/drawing-definitions';
import {useDialog} from '../lib/use-dialog';
import type {LiveWorkspaceState} from '../lib/live-layouts';

type ToolGroup = keyof typeof drawingGroups;
const groups = Object.keys(drawingGroups) as ToolGroup[];
const groupIcons: Record<ToolGroup, DrawingKind> = {
  lines: 'trend', channels: 'channel', levels: 'fib', shapes: 'rect',
  patterns: 'xabcd', measure: 'ruler', annotations: 'text',
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

export function DrawingPicker({group, enabled, actions, onClose, onPick, favorites = [], toggleFavorite}: {
  group: ToolGroup | 'all'; enabled: boolean; actions?: ReactNode;
  onClose: () => void; onPick: (kind: DrawingKind) => void;
  favorites?: DrawingKind[]; toggleFavorite?: (kind: DrawingKind) => void;
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
                const tool = drawingTools[kind];
                return <div className="live-picker-item" key={kind}>
                <button className="live-picker-option" type="button" title={tool.help} disabled={!enabled}
                  aria-label={tool.name} aria-describedby={'drawing-help-' + kind} onClick={() => onPick(kind)}>
                  <DrawingToolIcon kind={kind} size={24}/>
                  <span><strong>{tool.name}</strong><small id={'drawing-help-' + kind}>{tool.help}</small></span>
                </button>
                {toggleFavorite && <button type="button" className="live-favorite-star" aria-label={'รายการโปรด: ' + tool.name}
                  title={'ปักหมุด ' + tool.name} aria-pressed={favorites.includes(kind)}
                  onClick={() => toggleFavorite(kind)}><Star size={17} fill={favorites.includes(kind) ? 'currentColor' : 'none'}/></button>}
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
  mode: DrawingKind | null; enabled: boolean; magnet: boolean; strongMagnet?:boolean; hidden: boolean; stayInDrawingMode: boolean;
  canUndo: boolean; canRedo: boolean; canDelete: boolean;
  desktopAction: ReactNode; mobileStart: ReactNode; mobileEnd: ReactNode;
  favorites: DrawingKind[]; favoritePosition: {x: number; y: number};
  favoriteCollapsed: boolean; onToggleFavorites: () => void;
  favoriteSize: LiveWorkspaceState['favoriteSize']; onResizeFavorites: (size: Props['favoriteSize']) => void;
  onFavorite: (kind: DrawingKind) => void; onMoveFavorites: (position: Props['favoritePosition']) => void;
  onReorderFavorite: (kind: DrawingKind, target: DrawingKind) => void;
  onPick: (kind: DrawingKind) => void; onSelect: () => void; onMagnet: () => void;
  onStayInDrawingMode: () => void;
  onHide: () => void; onUndo: () => void; onRedo: () => void; onDelete: () => void;
};

type FavoritePress = {
  id: number; kind: DrawingKind; x: number; y: number; scrollTop: number;
  phase: 'pressed' | 'reordering' | 'swiping'; timer?: ReturnType<typeof setTimeout>;
};

function FavoriteBar({props, pick}: {props: Props; pick: (kind: DrawingKind) => void}) {
  const bounds = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const drag = useRef<{id: number; x: number; y: number; start: Props['favoritePosition']; next: Props['favoritePosition']} | null>(null);
  const [preview, setPreview] = useState<Props['favoritePosition'] | null>(null);
  const press = useRef<FavoritePress | null>(null);
  const handledPress = useRef(false);
  const [reordering, setReordering] = useState<{
    kind: DrawingKind; target: DrawingKind | null; x: number; y: number;
  } | null>(null);
  useEffect(() => () => clearTimeout(press.current?.timer), []);

  const position = preview ?? props.favoritePosition;
  const sizeNames = {small: 'เล็ก', medium: 'กลาง', large: 'ใหญ่'};
  const nextSize = ({small: 'medium', medium: 'large', large: 'small'} as const)[props.favoriteSize];
  const clamp = (n: number) => Math.min(1, Math.max(0, n));
  const dragged = useRef(false);
  const touchToggle = useRef(-Infinity);
  const positionHandle: Pick<HTMLAttributes<HTMLButtonElement>,
    'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onPointerCancel' | 'onLostPointerCapture' | 'onKeyDown'> = {
    onPointerDown: event => {
      if (!event.isPrimary || event.button !== 0 || drag.current || press.current) return;
      dragged.current = false;
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = {id: event.pointerId, x: event.clientX, y: event.clientY, start: position, next: position};
    },
    onPointerMove: event => {
      const start = drag.current;
      if (start?.id !== event.pointerId || !bounds.current || !bar.current) return;
      const dx = event.clientX - start.x, dy = event.clientY - start.y;
      if (!dragged.current && Math.hypot(dx, dy) < 6) return;
      dragged.current = true;
      const w = bounds.current.clientWidth - bar.current.offsetWidth;
      const h = bounds.current.clientHeight - bar.current.offsetHeight;
      start.next = {x: w > 0 ? clamp(start.start.x + dx / w) : start.start.x,
        y: h > 0 ? clamp(start.start.y + dy / h) : start.start.y};
      setPreview(start.next);
    },
    onPointerUp: event => {
      if (drag.current?.id !== event.pointerId) return;
      if (dragged.current) props.onMoveFavorites(drag.current.next);
      drag.current = null;
      setPreview(null);
    },
    onPointerCancel: () => { drag.current = null; setPreview(null); },
    onLostPointerCapture: () => { if (drag.current) { drag.current = null; setPreview(null); } },
    onKeyDown: event => {
      const shifts: Record<string, [number, number]> = {ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1]};
      const shift = shifts[event.key];
      if (!shift) return;
      event.preventDefault();
      event.stopPropagation();
      props.onMoveFavorites({x: clamp(position.x + shift[0] * .05), y: clamp(position.y + shift[1] * .05)});
    },
  };

  function favoriteTarget(x: number, y: number) {
    const hit = document.elementFromPoint(x, y)?.closest<HTMLButtonElement>('button[data-favorite-kind]');
    return hit && list.current?.contains(hit) ? hit.dataset.favoriteKind as DrawingKind : null;
  }

  function showFavoriteDrag(kind: DrawingKind, x: number, y: number) {
    const frame = bar.current?.getBoundingClientRect();
    if (frame) setReordering({kind, target: favoriteTarget(x, y), x: x - frame.left, y: y - frame.top});
  }

  function beginFavoritePress(event: PointerEvent<HTMLButtonElement>, kind: DrawingKind) {
    if (!event.isPrimary || event.button !== 0 || press.current || drag.current) return;
    const current: FavoritePress = {
      id: event.pointerId, kind, x: event.clientX, y: event.clientY,
      scrollTop: list.current?.scrollTop ?? 0, phase: 'pressed',
    };
    handledPress.current = false;
    press.current = current;
    event.currentTarget.setPointerCapture(event.pointerId);
    if (event.pointerType !== 'mouse' && props.favorites.length > 1) {
      current.timer = setTimeout(() => {
        if (press.current !== current || current.phase !== 'pressed') return;
        current.phase = 'reordering';
        showFavoriteDrag(kind, current.x, current.y);
      }, 300);
    }
  }

  function moveFavoritePress(event: PointerEvent<HTMLButtonElement>) {
    const current = press.current;
    if (current?.id !== event.pointerId) return;
    if (current.phase === 'pressed') {
      if (Math.hypot(event.clientX - current.x, event.clientY - current.y) < 7) return;
      clearTimeout(current.timer);
      current.phase = event.pointerType === 'mouse' && props.favorites.length > 1 ? 'reordering' : 'swiping';
    }
    if (current.phase === 'reordering') {
      showFavoriteDrag(current.kind, event.clientX, event.clientY);
    } else if (list.current && event.pointerType !== 'mouse') {
      // Keep vertical scrolling available when a long favorites list overflows.
      list.current.scrollTop = current.scrollTop + current.y - event.clientY;
    }
  }

  function finishFavoritePress(event: PointerEvent<HTMLButtonElement>, commit: boolean) {
    const current = press.current;
    if (current?.id !== event.pointerId) return;
    clearTimeout(current.timer);
    press.current = null;
    handledPress.current = true;
    setReordering(null);
    if (!commit || !props.enabled) return;
    const target = favoriteTarget(event.clientX, event.clientY);
    if (current.phase === 'reordering' && target && target !== current.kind) {
      props.onReorderFavorite(current.kind, target);
    } else if (current.phase === 'pressed' && target === current.kind) {
      pick(current.kind);
    }
  }

  const sourceIndex = reordering ? props.favorites.indexOf(reordering.kind) : -1;
  return <div className="live-favorite-area" ref={bounds}>
    <div className="live-favorite-bar" ref={bar} role="toolbar" aria-label="เครื่องมือโปรด" data-collapsed={props.favoriteCollapsed} data-size={props.favoriteSize}
      style={{left: position.x * 100 + '%', top: position.y * 100 + '%',
        transform: `translate(${-position.x * 100}%, ${-position.y * 100}%)`}}>
      <button type="button" className="live-favorite-toggle" aria-expanded={!props.favoriteCollapsed}
        aria-label={props.favoriteCollapsed ? 'ขยายแถบเครื่องมือโปรด' : 'พับแถบเครื่องมือโปรด'}
        title={props.favoriteCollapsed ? 'ขยายแถบเครื่องมือโปรด' : 'พับแถบเครื่องมือโปรด'}
        {...positionHandle}
        onPointerUp={event => {
          const tapped = event.pointerType === 'touch' && drag.current?.id === event.pointerId && !dragged.current;
          positionHandle.onPointerUp?.(event);
          if (tapped) {
            touchToggle.current = performance.now();
            props.onToggleFavorites();
          }
        }}
        onClick={event => {
          if (event.detail !== 0 && performance.now() - touchToggle.current < 500) return;
          if (event.detail !== 0 && dragged.current) { dragged.current = false; return; }
          props.onToggleFavorites();
        }}>{props.favoriteCollapsed ? <Star size={17}/> : <ChevronLeft size={17}/>}</button>
      {!props.favoriteCollapsed && <><button type="button" className="live-favorite-grip" title="ลากเพื่อย้ายแถบเครื่องมือโปรด"
        aria-label="ย้ายแถบเครื่องมือโปรด" {...positionHandle}><GripVertical size={17}/></button>
      <button type="button" className="live-favorite-size"
        aria-label={'ขนาดแถบเครื่องมือโปรด ' + sizeNames[props.favoriteSize] + ' · เปลี่ยนเป็น' + sizeNames[nextSize]}
        title={'เปลี่ยนเป็นขนาด' + sizeNames[nextSize]}
        onClick={() => props.onResizeFavorites(nextSize)}>{sizeNames[props.favoriteSize]}</button>
      <div className="live-favorite-list" ref={list}>
        {props.favorites.map((kind, index) => {
          const tool = drawingTools[kind];
          return <button type="button" key={kind} title={tool.name + ' · ' + tool.help + ' · กดค้างแล้วลากเพื่อจัดลำดับ'}
            aria-label={tool.name} aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"
            data-favorite-kind={kind} data-dragging={reordering?.kind === kind}
            data-drop-side={reordering?.target === kind && sourceIndex !== index
              ? sourceIndex < index ? 'after' : 'before' : undefined}
            aria-pressed={props.mode === kind} disabled={!props.enabled}
            onPointerDown={event => beginFavoritePress(event, kind)} onPointerMove={moveFavoritePress}
            onPointerUp={event => finishFavoritePress(event, true)}
            onPointerCancel={event => finishFavoritePress(event, false)}
            onLostPointerCapture={event => finishFavoritePress(event, false)}
            onContextMenu={event => event.preventDefault()}
            onClick={event => {
              if (!event.detail || !handledPress.current) pick(kind);
              handledPress.current = false;
            }}
            onKeyDown={event => {
              if (!event.altKey || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
              event.preventDefault();
              event.stopPropagation();
              const target = props.favorites[index + (event.key === 'ArrowLeft' ? -1 : 1)];
              if (target) props.onReorderFavorite(kind, target);
            }}>
            <DrawingToolIcon kind={kind} size={17}/>
          </button>;
        })}
      </div></>}
      {reordering && <span className="live-favorite-drag-preview" aria-hidden="true"
        style={{left: reordering.x, top: reordering.y}}><DrawingToolIcon kind={reordering.kind} size={18}/></span>}
    </div>
  </div>;
}

function DrawingActions({props, inPicker = false}: {props: Props; inPicker?: boolean}) {
  return <div className={'live-drawing-actions' + (inPicker ? ' live-picker-actions' : '')}
    role="group" aria-label="จัดการเส้นวาด">
    <button type="button" aria-label="ดูดจุดเข้าหาราคาแท่ง" title={(props.magnet ? props.strongMagnet ? "แม่เหล็กแรง" : "แม่เหล็กอ่อน" : "ปิดแม่เหล็ก") + " · กดเพื่อเปลี่ยนโหมด หรือกด Ctrl ค้างเพื่อใช้ชั่วคราว"}
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
  const currentTool = drawingTools[current];

  function pick(kind: DrawingKind) {
    setPicker(null);
    setRecent(kind);
    props.onPick(kind);
  }

  return <>
    <aside className="live-tools" aria-label="แถบเครื่องมือกราฟ">
      {props.mobileStart}
      <button className="live-desktop-tool" type="button" aria-label="เคอร์เซอร์เลือกวัตถุ" title="เคอร์เซอร์เลือกวัตถุ · แตะเส้นเพื่อเลือกหรือลากแก้ไข"
        aria-pressed={!props.mode} onClick={props.onSelect}><MousePointer2 size={19}/><span>เลือก</span></button>
      <button className="live-open-drawings" data-drawing={Boolean(props.mode)} type="button" aria-label="เครื่องมือวาดทั้งหมด" title="เครื่องมือวาดทั้งหมด · ค้นหาตามชื่อหรือเปิดทุกหมวด"
        aria-haspopup="dialog" onClick={() => setPicker('all')}><PencilRuler size={19}/><span>วาด</span></button>
      <button className="live-desktop-tool" type="button" aria-label={currentTool.name} title={currentTool.name + ' · ' + currentTool.help}
        aria-pressed={props.mode === current} disabled={!props.enabled}
        onClick={() => props.mode === current ? props.onSelect() : pick(current)}><DrawingToolIcon kind={current}/><span>ด่วน</span></button>
      {props.desktopAction}
      {props.mobileEnd}
      <div className="live-tool-groups" role="group" aria-label="หมวดเครื่องมือ">
        {groups.map(group => {
          const {name} = drawingGroups[group];
          return <button key={group} type="button" aria-label={name} title={name}
            aria-haspopup="dialog" disabled={!props.enabled} onClick={() => setPicker(group)}>
            <DrawingToolIcon kind={groupIcons[group]} size={18}/>
          </button>;
        })}
      </div>
      <DrawingActions props={props}/>
    </aside>
    {props.favorites.length > 0 && <FavoriteBar props={props} pick={pick}/>}
    {picker && <DrawingPicker group={picker} enabled={props.enabled} actions={<>
        <div className="live-picker-shortcuts" role="group" aria-label="ทางลัดเครื่องมือ">
          <button type="button" onClick={() => { setPicker(null); props.onSelect(); }}>
            <MousePointer2 size={16}/>เลือกวัตถุ
          </button>
          <button type="button" disabled={!props.enabled} onClick={() => pick(current)}>
            <DrawingToolIcon kind={current} size={16}/>ใช้ล่าสุด · {currentTool.name}
          </button>
        </div>
        <DrawingActions props={props} inPicker/>
      </>}
      favorites={props.favorites} toggleFavorite={props.onFavorite}
      onClose={() => setPicker(null)} onPick={pick}/>}
  </>;
}
