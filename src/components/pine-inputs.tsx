import {useState} from 'react';
import type {StudyStatus} from '../lib/use-pine';
type Values=Record<string,string|number|boolean>;
export default function PineInputs({study,values,onChange}:{study?:StudyStatus;values:Values;onChange:(v:Values)=>void}){
 const [search,setSearch]=useState('');
 if(!study)return <p className="help">กำลังอ่านการตั้งค่าจาก Pine Script · เปิด Indicator แล้วรอผลคำนวณครั้งแรก</p>;
 const groups=new Map<string,any[]>();for(const m of study.inputs){if(search&&!(m.title+' '+m.group).toLowerCase().includes(search.toLowerCase()))continue;const g=m.group||'Inputs';groups.set(g,[...(groups.get(g)||[]),m]);}
 const set=(id:string,value:string|number|boolean)=>onChange({...values,[id]:value});
 return <div className="pine-settings"><div className="pine-settings-heading"><strong>Indicator settings</strong>{study.bridge&&<span className="pill">Zone Bridge · เชื่อม All Indy แล้ว</span>}<button onClick={()=>onChange({})}>Reset inputs</button></div><input aria-label="ค้นหาการตั้งค่า Indicator" placeholder="ค้นหา RSI, TF, Dashboard…" value={search} onChange={e=>setSearch(e.target.value)}/>{[...groups].map(([group,inputs])=><details key={group} open={search?true:undefined}><summary>{group} <small>{inputs.length}</small></summary><div className="pine-input-grid">{inputs.map(m=>{
  const value=values[m.id]??m.defval??'';const bridge=m.type==='source'&&/^ZB \d\d /.test(m.title||'');
  return <label className="field" key={m.id} title={m.tooltip||''}>{m.title||m.name}{bridge&&study.bridge?<span className="source-link">All Indy → {m.title}</span>:m.type==='bool'?<input type="checkbox" checked={!!value} onChange={e=>set(m.id,e.target.checked)}/>:m.options?.length?<select value={String(value)} onChange={e=>set(m.id,m.type==='int'||m.type==='float'?Number(e.target.value):e.target.value)}>{m.options.map((v:any)=><option key={String(v)} value={String(v)}>{String(v)}</option>)}</select>:m.type==='source'?<select value={String(value)} onChange={e=>set(m.id,e.target.value)}>{['close','open','high','low','hl2','hlc3','ohlc4','hlcc4'].map(v=><option key={v}>{v}</option>)}</select>:<input type={['int','float','price','time'].includes(m.type)?'number':m.type==='color'?'color':'text'} value={String(value)} min={m.minval} max={m.maxval} step={m.step??(m.type==='int'||m.type==='time'?1:'any')} onChange={e=>set(m.id,['int','float','price','time'].includes(m.type)?Number(e.target.value):e.target.value)}/>}</label>;
 })}</div></details>)}</div>;
}
