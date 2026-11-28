import {useState} from 'react';
import type {Drawing} from '../lib/engine';
import {drawingTools} from '../lib/drawing-definitions';
import {DrawingToolIcon} from './drawing-tool-icon';

export default function DrawingObjects({drawings,onChange,onEdit}: {
  drawings: Drawing[]; onChange: (drawings: Drawing[]) => void; onEdit: (id: string) => void;
}) {
  const [selected,setSelected] = useState<string[]>([]);
  const [group,setGroup] = useState('');
  const [query,setQuery] = useState('');
  const selectedRows = drawings.filter(drawing=>selected.includes(drawing.id));
  const editable = selectedRows.filter(drawing=>!drawing.locked);
  const active = new Set(editable.map(drawing=>drawing.id));
  const others = drawings.filter(drawing=>!active.has(drawing.id));
  const matches = drawings.filter(drawing=>[drawingTools[drawing.kind].name,drawing.text,drawing.group]
    .some(value=>value?.toLowerCase().includes(query.trim().toLowerCase())));
  const groups = [...new Set(matches.map(drawing=>drawing.group ?? ''))];
  function update(change: Partial<Drawing>) {
    onChange(drawings.map(drawing=>active.has(drawing.id) ? {...drawing,...change} : drawing));
  }
  function duplicate() {
    const copies=editable.slice(0,500-drawings.length).map(drawing=>({
      ...drawing,id:crypto.randomUUID(),forwardTest:undefined,
    }));
    onChange([...drawings,...copies]);
    setSelected(copies.map(copy=>copy.id));
  }
  return <div className="live-object-manager">
    <input type="search" placeholder="ค้นหาวัตถุ" aria-label="ค้นหาวัตถุ" value={query} onChange={event=>setQuery(event.target.value)}/>
    <div className="object-manager-actions">
      <button type="button" onClick={()=>setSelected(matches.map(drawing=>drawing.id))} disabled={!matches.length}>เลือกทั้งหมด</button>
      <button type="button" onClick={()=>setSelected([])} disabled={!selectedRows.length}>เลิกเลือก</button>
      <button type="button" disabled={!selectedRows.length} onClick={()=>{
        const locked=selectedRows.some(drawing=>!drawing.locked);
        onChange(drawings.map(drawing=>selected.includes(drawing.id)?{...drawing,locked}:drawing));
      }}>{selectedRows.some(drawing=>!drawing.locked)?'ล็อก':'ปลดล็อก'}</button>
      <button type="button" disabled={!editable.length} onClick={()=>update({hidden:editable.some(drawing=>!drawing.hidden)})}>
        {editable.some(drawing=>!drawing.hidden)?'ซ่อน':'แสดง'}</button>
      <button type="button" disabled={!editable.length || drawings.length>=500} onClick={duplicate}>ทำสำเนา</button>
      <button type="button" disabled={!editable.length} onClick={()=>onChange([...others,...editable])}>ไว้ด้านหน้า</button>
      <button type="button" disabled={!editable.length} onClick={()=>onChange([...editable,...others])}>ไว้ด้านหลัง</button>
      <button type="button" disabled={!editable.length} onClick={()=>{onChange(others);setSelected([])}}>ลบที่เลือก</button>
    </div>
    <form className="object-manager-actions" onSubmit={event=>{event.preventDefault();if(group.trim())update({group:group.trim()});setGroup('')}}>
      <input value={group} aria-label="ชื่อกลุ่ม" placeholder="ชื่อกลุ่ม" maxLength={80} onChange={event=>setGroup(event.target.value)}/>
      <button disabled={!editable.length||!group.trim()}>จัดกลุ่ม</button>
      <button type="button" disabled={!editable.some(drawing=>drawing.group)} onClick={()=>update({group:undefined})}>แยกกลุ่ม</button>
    </form>
    {groups.map(name=><section key={name}>
      <h3>{name||'วัตถุทั่วไป'}</h3>
      {matches.filter(drawing=>(drawing.group??'')===name).map(drawing=><div className="object-manager-row" key={drawing.id}>
        <input type="checkbox" aria-label={'เลือก '+(drawing.text||drawingTools[drawing.kind].name)}
          checked={selected.includes(drawing.id)} onChange={event=>setSelected(ids=>event.target.checked?[...ids,drawing.id]:ids.filter(id=>id!==drawing.id))}/>
        <button type="button" onClick={()=>onEdit(drawing.id)}><DrawingToolIcon kind={drawing.kind} size={17}/>
          {drawingTools[drawing.kind].name}{drawing.text&&' · '+drawing.text.slice(0,48)}
        </button>
        <small>{[drawing.locked&&'ล็อก',drawing.hidden&&'ซ่อน'].filter(Boolean).join(' · ')}</small>
      </div>)}
    </section>)}
    {!matches.length && <p className="chart-hint">{drawings.length?'ไม่พบวัตถุที่ตรงกับคำค้น':'ยังไม่มีวัตถุที่วาด'}</p>}
  </div>;
}
