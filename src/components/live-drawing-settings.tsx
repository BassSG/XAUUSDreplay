import {useEffect, useRef, useState} from 'react';
import {drawingTools, fibDefaults, isLabelBox, maxFibLevels} from '../lib/drawing-definitions';
import {drawingFibLevels, placementError} from '../lib/drawing-geometry';
import type {Drawing, DrawingStyle, FibLevel} from '../lib/engine';
import {periodList} from '../lib/live-layouts';

type Tab = 'text' | 'style' | 'coordinates' | 'visibility' | 'fib';
const tabs: {id: Tab; label: string}[] = [
  {id:'text', label:'ข้อความ'}, {id:'style', label:'รูปแบบ'}, {id:'fib', label:'ระดับ Fibonacci'},
  {id:'coordinates', label:'พิกัด'}, {id:'visibility', label:'ไทม์เฟรม'},
];
export function drawingInputColor(value: string | undefined, fallback = '#d7b46a') {
  return value && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}
function bangkokLocal(time: number) {
  return new Date((time + 7 * 3600) * 1000).toISOString().slice(0, 19);
}
function percent(value: number) { return Math.round(value * 100); }
function levelInput(value: number, asPercent: boolean) {
  return asPercent ? String(Number((value * 100).toPrecision(15))) : String(value);
}
function parseLevel(value: string, asPercent: boolean) {
  const number = (asPercent ? value.trim().replace(/%$/, '') : value).trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(number)) return NaN;
  return Number(number) / (asPercent ? 100 : 1);
}

function socialLink(value:string) {
  try {
    const url=new URL(value);
    return url.protocol==='https:' && !url.username && !url.password && !url.port &&
      ((['x.com','twitter.com','www.x.com','www.twitter.com'].includes(url.hostname) && /\/status\/\d+/.test(url.pathname)) ||
      ((url.hostname==='tradingview.com' || url.hostname.endsWith('.tradingview.com')) && url.pathname.startsWith('/chart/'))) ? url.href : '';
  } catch { return ''; }
}
async function readDrawingImage(file:File) {
  if (!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size>8_000_000) throw Error('เลือก PNG, JPEG หรือ WebP ไม่เกิน 8 MB');
  const image=await createImageBitmap(file,{resizeWidth:480,resizeQuality:'high'});
  try {
    const canvas=document.createElement('canvas');
    const scale=Math.min(1,480/Math.max(image.width,image.height));
    canvas.width=Math.max(1,Math.round(image.width*scale));
    canvas.height=Math.max(1,Math.round(image.height*scale));
    const context=canvas.getContext('2d');
    if (!context) throw Error('เปิดรูปไม่ได้');
    context.fillStyle='#0b1119';
    context.fillRect(0,0,canvas.width,canvas.height);
    context.drawImage(image,0,0,canvas.width,canvas.height);
    for (const quality of [.84,.68,.50,.32]) {
      const data=canvas.toDataURL('image/jpeg',quality);
      if (data.length<=40000) return data;
    }
    throw Error('รูปมีรายละเอียดมากเกินไป ลองใช้ไฟล์เล็กลง');
  } finally {image.close();}
}

export default function LiveDrawingSettings({drawing, onSave, onClose, period}: {
  drawing: Drawing; period?:typeof periodList[number]; onSave: (drawing: Drawing) => void; onClose: () => void;
}) {
  const isFib = Boolean(fibDefaults[drawing.kind]);
  const asPercent = drawing.kind !== 'fibTime';
  const isBox = isLabelBox(drawing.kind);
  const [tab, setTab] = useState<Tab>('text');
  const [draft, setDraft] = useState(drawing);
  const [defaultStyle,setDefaultStyle]=useState(false);
  const [anchors, setAnchors] = useState(() => drawing.points.map(p => ({time:bangkokLocal(p.time), price:String(p.price)})));
  const [levels, setLevels] = useState(() => drawingFibLevels(drawing).map((level, id) => ({
    ...level, id, original: level.value, value:levelInput(level.value, asPercent),
  })));
  const nextLevelId = useRef(levels.length);
  const [focusLevel, setFocusLevel] = useState<number | null>(null);
  const activeLevelInput = useRef<HTMLInputElement>(null);
  const [size,setSize]=useState(()=>({lots:String(drawing.size?.lots ?? ''),contract:String(drawing.size?.contract ?? 100)}));
  const position = drawing.kind==='long' || drawing.kind==='short';
  const [error, setError] = useState('');
  const style = draft.style ?? {};
  const fib = draft.fib;
  const horizontalFib = drawing.kind === 'fib' || drawing.kind === 'fibExtension';
  const extend = horizontalFib || drawing.kind === 'rect' || drawing.kind === 'trend';
  const hasFill = isBox || ['ellipse','triangle','circle','channel','regression','ruler','long','short','flag','polyline','sector','gannSquare','gannFixed','flatChannel','disjoint'].includes(drawing.kind);
  const screenAnchored = drawing.points.some(point=>point.screen);
  const hasOutline = drawing.kind !== 'text' && drawing.kind !== 'note';
  const textDefaultColor = drawingTools[drawing.kind].text ? drawingInputColor(draft.color) : '#e7edf5';
  useEffect(() => {
    if (focusLevel === null || tab !== 'fib') return;
    activeLevelInput.current?.focus();
    activeLevelInput.current?.scrollIntoView({block:'nearest', inline:'nearest'});
    setFocusLevel(null);
  }, [focusLevel, tab]);

  function addLevel() {
    if (levels.length >= maxFibLevels) return;
    const id = nextLevelId.current++;
    setLevels(current => [...current, {id, value:'', original:NaN, enabled:true}]);
    setFocusLevel(id);
    setError('');
  }

  function resetLevels() {
    const standard = fibDefaults[drawing.kind] ?? [];
    setLevels(standard.map(value => ({
      id: nextLevelId.current++, original:value, value:levelInput(value, asPercent), enabled:true,
    })));
    fibOption('reverse', true);
    setError('');
  }
  function property<K extends keyof Drawing>(key: K, value: Drawing[K]) {
    setDraft(current => ({...current, [key]:value}));
  }
  function appearance<K extends keyof DrawingStyle>(key: K, value: DrawingStyle[K]) {
    setDraft(current => ({...current, style:{...current.style, [key]:value}}));
  }
  function fibOption<K extends keyof Omit<NonNullable<Drawing['fib']>, 'levels'>>(key: K, value: NonNullable<Drawing['fib']>[K]) {
    setDraft(current => ({...current, fib:{levels:drawingFibLevels(current), ...current.fib, [key]:value}}));
  }
  function save() {
    if (drawing.locked) return;
    setError('');
    const points = anchors.map(({time,price},i) => ({...drawing.points[i],time:Date.parse(time + '+07:00') / 1000, price:Number(price)}));
    const moved = points.some((point,i) => point.time !== drawing.points[i].time || point.price !== drawing.points[i].price);
    if (moved) {
      const issue = points.some(p => !Number.isSafeInteger(p.time) || p.time <= 0 || p.time > 253402275599 ||
        !Number.isFinite(p.price) || !drawing.pane && p.price < .01)
        ? 'ตรวจวัน เวลา และราคาของแต่ละจุด' : placementError(drawing.kind, points);
      if (issue) { setTab('coordinates'); setError(issue); return; }
    }
    const parsedLevels: FibLevel[] = levels.map(({id, original, value, ...level}) => ({
      ...level, value:value === levelInput(original, asPercent) ? original : parseLevel(value, asPercent),
    }));
    const invalidLevel = parsedLevels.findIndex(level => !Number.isFinite(level.value) || Math.abs(level.value) > 1000000);
    if (isFib && invalidLevel !== -1) {
      setTab('fib');
      setFocusLevel(levels[invalidLevel].id);
      setError('ตรวจตัวเลขของระดับที่ ' + (invalidLevel + 1) + (asPercent ? ' เช่น 161.8%' : ' เช่น 21'));
      return;
    }
    const next = {...draft, points};
    if (drawing.kind==='social' && draft.link && !socialLink(draft.link)) {
      setTab('text');setError('ใส่ลิงก์โพสต์จาก X หรือไอเดีย TradingView');return;
    }
    if (draft.link) next.link=socialLink(draft.link);
    if (position) {
      const lots=Number(size.lots),contract=Number(size.contract);
      if (size.lots && (!(lots>0 && lots<=1000) || !(contract>0 && contract<=100000))) {
        setTab('style');setError('ตรวจจำนวนล็อตและขนาดสัญญา');return;
      }
      next.size=size.lots?{lots,contract}:undefined;
    }
    if (isFib && (fib || JSON.stringify(parsedLevels) !== JSON.stringify(drawingFibLevels(drawing)))) {
      next.fib = {...fib, levels:parsedLevels};
    }
    if (defaultStyle) {
      const {color,fillColor,textColor,style,fib,text}=next;
      try { localStorage.setItem('ebw-drawing-style:'+drawing.kind,JSON.stringify({color,fillColor,textColor,style,fib,text})); }
      catch { setError('พื้นที่จัดเก็บเต็ม กรุณาลองอีกครั้ง');return; }
    }
    if (JSON.stringify(next) !== JSON.stringify(drawing)) onSave(next);
    onClose();
  }
  return <form className="live-object live-drawing-settings" noValidate onSubmit={event => {event.preventDefault(); save();}}>
    <nav className="drawing-settings-tabs" aria-label="หมวดตั้งค่าเครื่องมือ">
      {tabs.filter(item => (item.id !== 'coordinates' || !screenAnchored) && (item.id !== 'fib' || isFib) && (item.id !== 'style' || hasOutline)).map(item =>
        <button type="button" key={item.id} aria-pressed={tab === item.id}
          onClick={() => {setError(''); setTab(item.id);}}>{item.label}</button>)}
    </nav>
    <fieldset disabled={drawing.locked}>
      {tab === 'text' && <>
        {drawing.kind==='image' && <label>แนบรูปบนกราฟ
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={async event=>{
            const file=event.target.files?.[0];
            if(!file)return;
            setError('');
            try {property('image',await readDrawingImage(file));}
            catch(error){setError(error instanceof Error?error.message:'เปิดรูปไม่ได้');}
          }}/>
          {draft.image && <img className="drawing-image-preview" src={draft.image} alt="ตัวอย่างรูปบนกราฟ"/>}
        </label>}
        {drawing.kind==='social' && <label>ลิงก์โพสต์หรือไอเดีย
          <input type="url" maxLength={1000} value={draft.link??''} onChange={e=>property('link',e.target.value)}/>
          {draft.link && socialLink(draft.link) && <a href={socialLink(draft.link)} target="_blank" rel="noopener noreferrer">เปิดต้นทาง</a>}
        </label>}
        <label className="live-object-text">{isBox ? 'ข้อความในกล่อง' : 'ข้อความบนกราฟ'}
          <textarea name="text" data-dialog-autofocus rows={3} maxLength={1000}
            placeholder={isBox ? 'เช่น โซนรอราคา' : 'เช่น แนวต้านรายวัน'}
            value={draft.text ?? ''} onChange={event => property('text', event.target.value)}/>
        </label>
        <div className="drawing-settings-fields">
          <label>สีข้อความ <input type="color" value={drawingInputColor(draft.textColor, textDefaultColor)}
            onChange={event => property('textColor',event.target.value)}/></label>
          <label>ขนาด <select value={style.textSize ?? 12} onChange={event => appearance('textSize',Number(event.target.value))}>
            {[8,10,12,14,16,18,20,24,30].map(size => <option key={size}>{size}</option>)}</select></label>
          {!drawingTools[drawing.kind].text && <label>ตำแหน่ง <select value={style.textAlign ?? 'center'}
            onChange={event => appearance('textAlign',event.target.value as DrawingStyle['textAlign'])}>
            <option value="start">ต้น</option><option value="center">กลาง</option><option value="end">ปลาย</option>
          </select></label>}
        </div>
        <div className="drawing-settings-fields">
          <label><input type="checkbox" checked={style.showText !== false} onChange={e=>appearance('showText',e.target.checked)}/>แสดงข้อความ</label>
          <label><input type="checkbox" checked={style.bold ?? false} onChange={e=>appearance('bold',e.target.checked)}/>ตัวหนา</label>
          <label><input type="checkbox" checked={style.italic ?? false} onChange={e=>appearance('italic',e.target.checked)}/>ตัวเอียง</label>
        </div>
      </>}
      {tab === 'style' && <>
        {position && <div className="drawing-settings-fields">
          <label>จำนวนล็อตจำลอง <input type="number" step="any" min="0" value={size.lots} onChange={e=>setSize({...size,lots:e.target.value})}/></label>
          <label>ขนาดสัญญาต่อล็อต <input type="number" step="any" min="0" value={size.contract} onChange={e=>setSize({...size,contract:e.target.value})}/></label>
        </div>}
        <div className="drawing-settings-fields">
          <label>สีเส้น <input type="color" value={drawingInputColor(draft.color)} onChange={e=>property('color',e.target.value)}/></label>
          <label>ความหนา <select value={style.width ?? ''} onChange={e=>appearance('width',e.target.value ? Number(e.target.value) : undefined)}>
            <option value="">เดิม</option>{[1,2,3,4,5,6,7,8].map(n=><option key={n}>{n}</option>)}</select></label>
          <label>ชนิดเส้น <select value={style.line ?? ''} onChange={e=>appearance('line',(e.target.value || undefined) as DrawingStyle['line'])}>
            <option value="">เดิม</option><option value="solid">ทึบ</option><option value="dashed">ประ</option><option value="dotted">จุด</option>
          </select></label>
          {hasFill && <label>สีพื้น <input type="color" value={drawingInputColor(draft.fillColor,drawingInputColor(draft.color))}
            onChange={e=>property('fillColor',e.target.value)}/></label>}
        </div>
        <label>ความทึบเส้น <input type="range" min={0} max={100} value={percent(style.opacity ?? 1)}
          onChange={e=>appearance('opacity',Number(e.target.value)/100)}/><output>{percent(style.opacity ?? 1)}%</output></label>
        {hasFill && <label>ความทึบพื้น <input type="range" min={0} max={100} value={percent(style.fillOpacity ?? .12)}
          onChange={e=>appearance('fillOpacity',Number(e.target.value)/100)}/><output>{percent(style.fillOpacity ?? .12)}%</output></label>}
        {extend && <div className="drawing-settings-fields">
          <label><input type="checkbox" checked={style.extendLeft ?? false} onChange={e=>appearance('extendLeft',e.target.checked)}/>ต่อเส้นซ้าย</label>
          <label><input type="checkbox" checked={style.extendRight ?? false} onChange={e=>appearance('extendRight',e.target.checked)}/>ต่อเส้นขวา</label>
        </div>}
        {drawing.kind === 'polyline' && <label><input type="checkbox" checked={style.closed ?? false}
          onChange={e=>appearance('closed',e.target.checked)}/>ปิดรูปและเติมสีพื้น</label>}
        {drawing.kind === 'rect' && <label><input type="checkbox" checked={style.middle ?? false} onChange={e=>appearance('middle',e.target.checked)}/>เส้นกึ่งกลาง</label>}
      </>}
      {tab === 'fib' && <>
        <div className="drawing-settings-fields">
          <label><input type="checkbox" checked={fib?.reverse ?? false} onChange={e=>fibOption('reverse',e.target.checked)}/>กลับทิศ</label>
          <label><input type="checkbox" checked={fib?.showTrend ?? (drawing.kind === 'fibExtension')}
            onChange={e=>fibOption('showTrend',e.target.checked)}/>เส้นจุดยึด</label>
          {['fib','fibExtension','fibFan'].includes(drawing.kind) && <label><input type="checkbox"
            checked={fib?.showPrice ?? (drawing.kind !== 'fibFan')} onChange={e=>fibOption('showPrice',e.target.checked)}/>แสดงราคา</label>}
          <label>ป้ายระดับ <select value={fib?.format ?? (drawing.kind === 'fibTime' || drawing.kind === 'fibTrendTime' ? 'ratio' : 'percent')}
            onChange={e=>fibOption('format',e.target.value as 'ratio'|'percent'|'none')}>
            <option value="ratio">ตัวเลข</option><option value="percent">เปอร์เซ็นต์</option><option value="none">ซ่อนตัวเลข</option>
          </select></label>
        </div>
        {horizontalFib && <div className="drawing-settings-fields">
          <label>ตำแหน่งป้าย <select value={fib?.labelPosition ?? 'right'}
            onChange={e=>fibOption('labelPosition',e.target.value as 'left'|'center'|'right')}>
            <option value="left">ซ้าย</option><option value="center">กลาง</option><option value="right">ขวา</option>
          </select></label>
          <label>พื้นระหว่างระดับ <input type="range" min={0} max={100} value={percent(fib?.backgroundOpacity ?? 0)}
            onChange={e=>fibOption('backgroundOpacity',Number(e.target.value)/100)}/><output>{percent(fib?.backgroundOpacity ?? 0)}%</output></label>
        </div>}
        <div className="drawing-fib-actions">
          <button type="button" disabled={levels.length >= maxFibLevels} onClick={addLevel}>+ เพิ่มระดับ</button>
          {drawing.kind === 'fib' && <button type="button" onClick={resetLevels}>ใช้ชุดมาตรฐาน EBW</button>}
          <small>{levels.length}/{maxFibLevels}</small>
        </div>
        <p className="chart-hint">{asPercent ? 'ใส่ค่าเป็นเปอร์เซ็นต์ เช่น 161.8 แล้วกดบันทึก' : 'ใส่ตัวเลขจำนวนช่วง เช่น 21 แล้วกดบันทึก'}</p>
        <div className="drawing-fib-list">
          {levels.map((level,i) => {
            const update = (change: Partial<typeof level>) => setLevels(rows => rows.map((row,j) => i===j ? {...row,...change} : row));
            return <div key={level.id} className="drawing-fib-row">
              <input aria-label={'แสดงระดับ ' + (i+1)} type="checkbox" checked={level.enabled} onChange={e=>update({enabled:e.target.checked})}/>
              <label className="drawing-level-value">
                <input aria-label={'ตัวเลขระดับ ' + (i+1) + (asPercent ? ' (%)' : '')} type="text" inputMode="decimal"
                  ref={focusLevel === level.id ? activeLevelInput : undefined} value={level.value}
                  placeholder={asPercent ? '161.8' : '21'} onChange={e=>update({value:e.target.value})}/>
                {asPercent && <span>%</span>}
              </label>
              <input aria-label={'สีระดับ ' + (i+1)} type="color" value={drawingInputColor(level.color,drawingInputColor(draft.color))}
                onChange={e=>update({color:e.target.value})}/>
              <label className="drawing-level-opacity" title="ความทึบของเส้นระดับ">
                <input aria-label={'ความทึบระดับ ' + (i+1)} type="number" min={0} max={100} step={1}
                  value={percent(level.opacity ?? 1)}
                  onChange={e=>update({opacity:Math.max(0,Math.min(100,Number(e.target.value)))/100})}/><span>%</span>
              </label>
              <input aria-label={'ข้อความระดับ ' + (i+1)} placeholder="ข้อความ" maxLength={120} value={level.text ?? ''}
                onChange={e=>update({text:e.target.value})}/>
              <button type="button" aria-label={'ลบระดับ ' + (i+1)} onClick={()=>setLevels(rows=>rows.filter((_,j)=>i!==j))}>×</button>
            </div>;
          })}
        </div>
      </>}
      {tab === 'coordinates' && <div className="drawing-anchor-list">
        {anchors.map((anchor,i) => {
          const update = (change: Partial<typeof anchor>) => setAnchors(all=>all.map((point,j)=>i===j ? {...point,...change} : point));
          return <div className="drawing-anchor-row" key={i}>
            <strong>{drawingTools[drawing.kind].points[i] ?? 'จุด ' + (i+1)}</strong>
            <label>เวลา กรุงเทพฯ <input type="datetime-local" step="1" value={anchor.time} onChange={e=>update({time:e.target.value})}/></label>
            <label>ราคา <input type="number" min={drawing.pane?undefined:.01} step="any" value={anchor.price} onChange={e=>update({price:e.target.value})}/></label>
          </div>;
        })}
      </div>}
      {tab === 'visibility' && <div className="drawing-settings-fields">
        {period && <label>แชร์วัตถุ <select value={draft.scope??'layout'} onChange={e=>{
          const scope=e.target.value as Drawing['scope'];
          setDraft(current=>({...current,scope,chartPeriod:scope==='chart'?period:undefined}));
        }}>
          <option value="chart">เฉพาะกราฟ {period}</option><option value="layout">ในเลย์เอาต์นี้</option>
          <option value="global">ทุกเลย์เอาต์</option>
        </select></label>}
        {periodList.map(period => <label key={period}><input type="checkbox"
          checked={draft.visiblePeriods?.includes(period) ?? true}
          onChange={e=>property('visiblePeriods',periodList.filter(p=>p===period ? e.target.checked : draft.visiblePeriods?.includes(p) ?? true))}/>{period}</label>)}
      </div>}
    </fieldset>
    {drawing.locked && <p className="chart-hint">ปลดล็อกวัตถุจากแถบแก้ไขเพื่อเปลี่ยนค่า</p>}
    {error && <p className="chart-error" role="alert">{error}</p>}
    <div className="layout-actions">
      <label><input type="checkbox" disabled={drawing.locked} checked={defaultStyle}
        onChange={event=>setDefaultStyle(event.target.checked)}/>ใช้เป็นค่าเริ่มต้นของเครื่องมือนี้</label>
      <button type="submit" className="primary" disabled={drawing.locked}>บันทึก</button>
      <button type="button" onClick={onClose}>ยกเลิก</button>
    </div>
  </form>;
}
