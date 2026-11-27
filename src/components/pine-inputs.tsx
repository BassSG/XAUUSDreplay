import {useRef,useState} from 'react';
import type {IPineInput} from 'pinets';
import type {StudyStatus} from '../lib/use-pine';
import type {IndicatorInputs} from '../lib/focused-indicators';

const empty:IndicatorInputs={};
const priceSources=['close','open','high','low','hl2','hlc3','ohlc4','hlcc4'];
const numeric=new Set(['int','float','price','time']);
function optionText(field:IPineInput, value:unknown) {
  if (field.type!=='timeframe') return String(value);
  const text=String(value);
  if (!text) return 'อัตโนมัติ';
  if (/^\d+$/.test(text)) return Number(text)%60===0 ? Number(text)/60+'H' : text+'m';
  return /^\d/.test(text) ? text : '1'+text;
}

function numberValue(field:IPineInput, value:string|number|boolean):number|undefined {
  if (String(value).trim()==='') return undefined;
  const parsed=Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  const n=field.type==='int'||field.type==='time'?Math.round(parsed):parsed;
  return Math.min(field.maxval??Infinity,Math.max(field.minval??-Infinity,n));
}

export default function PineInputs({study,values=empty,managed=false,onChange}:{
  study?:StudyStatus;values?:IndicatorInputs;managed?:boolean;onChange:(v:IndicatorInputs)=>void;
}){
  const lastStudy=useRef(study);
  if(study) lastStudy.current=study;
  const schema=study??lastStudy.current;
  const [search,setSearch]=useState('');
  const [edits,setEdits]=useState<IndicatorInputs>(empty);
  const [reset,setReset]=useState(false);
  const [saved,setSaved]=useState(false);
  if(!schema) return <p className="help">กำลังอ่าน Input จาก Pine Script</p>;
  if(!schema.inputs.length) return <p className="help">สคริปต์นี้ไม่มี Input ให้ปรับ</p>;
  const base=reset?empty:values;
  const query=search.trim().toLocaleLowerCase();
  const groups=new Map<string,IPineInput[]>();
  for(const field of schema.inputs){
    const group=field.group||'Inputs';
    if(query && ![field.title,field.varId,group].join(' ').toLocaleLowerCase().includes(query)) continue;
    const fields=groups.get(group);
    if(fields)fields.push(field);
    else groups.set(group,[field]);
  }
  const ordered=[...groups].sort(([a],[b])=>a.localeCompare(b,'th',{numeric:true}));
  const dirty=reset||Object.keys(edits).length>0;
  function commit(baseValues:IndicatorInputs,changes:IndicatorInputs){
    const next={...baseValues};
    for(const [id,raw] of Object.entries(changes)){
      const field=schema?.inputs.find(input=>input.id===id);
      if(!field)continue;
      const value=numeric.has(field.type)?numberValue(field,raw):raw;
      if(value===undefined||value===field.defval) delete next[id];
      else next[id]=value;
    }
    onChange(next);
  }
  function set(id:string,value:string|number|boolean){
    if(!managed){commit(values,{[id]:value});return;}
    setSaved(false);setEdits(previous=>({...previous,[id]:value}));
  }
  function apply(){
    commit(base,edits);setEdits(empty);setReset(false);setSaved(true);
  }
  return <div className="pine-settings">
    <div className="pine-settings-heading">
      <strong>ตั้งค่าอินดิเคเตอร์</strong>
      {schema.bridge&&<span className="pill">เชื่อม All Indy แล้ว</span>}
      <button type="button" onClick={()=>{if(!managed){onChange(empty);return;}setSaved(false);setEdits(empty);setReset(true);}}>คืนค่าเริ่มต้น</button>
    </div>
    <input type="search" aria-label="ค้นหา Input" placeholder="ค้นหา กล่อง, TF, RSI, เป้า…" value={search}
      onChange={event=>setSearch(event.currentTarget.value)}/>
    {!ordered.length&&<p className="help" role="status">ไม่พบ Input ที่ตรงกับคำค้น</p>}
    {ordered.map(([group,fields],index)=><details key={group} open={query?true:index<(managed?3:1)?true:undefined}>
      <summary>{group.replace(/^\d+ · /,'')} <small>{fields.length}</small></summary>
      <div className="pine-input-grid">
        {fields.map(field=>{
          const value=edits[field.id]??base[field.id]??field.defval??'';
          const bridge=field.type==='source'&&/^ZB \d\d /.test(field.title||'')&&schema.bridge;
          const options=field.options?.length?field.options:field.type==='source'?priceSources:undefined;
          const tfOption=field.type==='timeframe'&&options?.find(option=>optionText(field,option)===optionText(field,value));
          const name=field.title||field.name;
          const label=field.type==='bool'?'field pine-input-toggle':'field';
          return <label className={label} key={field.id} title={field.tooltip}>
            <span>{name}</span>
            {bridge?<span className="source-link">All Indy → {name}</span>:field.type==='bool'
              ?<input type="checkbox" checked={value===true} disabled={field.active===false}
                onChange={event=>set(field.id,event.currentTarget.checked)}/>
              :options?<select value={String(tfOption||value)} disabled={field.active===false}
                onChange={event=>set(field.id,event.currentTarget.value)}>
                {options.map(v=><option key={String(v)} value={String(v)}>{optionText(field,v)}</option>)}
              </select>
              :field.type==='text_area'?<textarea value={String(value)} disabled={field.active===false} onChange={event=>set(field.id,event.currentTarget.value)}/>
              :<input type={numeric.has(field.type)?'number':field.type==='color'?'color':'text'}
                inputMode={field.type==='int'?'numeric':field.type==='float'?'decimal':undefined}
                value={field.type==='color'?(/^#[0-9a-f]{6}/i.exec(String(value))?.[0]??'#ffffff'):String(value)}
                min={field.minval} max={field.maxval} step={field.step??(field.type==='int'||field.type==='time'?1:'any')}
                disabled={field.active===false} onChange={event=>set(field.id,event.currentTarget.value)}/>}
            {field.tooltip && <small className="pine-input-note">{field.tooltip}</small>}
          </label>;
        })}
      </div>
    </details>)}
    {managed&&<div className="pine-input-actions">
      <small role="status">{dirty?'มีค่าที่ยังไม่ได้ใช้':saved?'ใช้การตั้งค่าแล้ว':''}</small>
      <button type="button" className="primary" disabled={!dirty} onClick={apply}>ใช้การตั้งค่า</button>
    </div>}
  </div>;
}
