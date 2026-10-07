import {gunzipSync} from 'fflate';
import type {Bar} from './engine';
import type {Dataset} from './types';

type Chunk={file:string;start:number;end:number;count:number;sha256?:string};
type Bundle=Dataset&{chunks:Chunk[]};

function baseURL(){return (import.meta as ImportMeta&{env?:{BASE_URL?:string}}).env?.BASE_URL??'/';}
let catalogPromise:Promise<Bundle[]>|undefined;

async function catalog(){
 if(!catalogPromise)catalogPromise=fetch(baseURL()+'data/catalog.json',{cache:'no-cache'}).then(async r=>{
  if(!r.ok)throw Error('โหลดรายการข้อมูลย้อนหลังไม่สำเร็จ');
  const v=await r.json();return (Array.isArray(v)?v:v.datasets) as Bundle[];
 }).finally(()=>{catalogPromise=undefined});
 return catalogPromise;
}
async function chunkBars(c:Chunk):Promise<Bar[]>{
 const r=await fetch(baseURL()+c.file);if(!r.ok)throw Error('โหลดข้อมูลย้อนหลังไม่สำเร็จ');
 const bytes=await r.arrayBuffer();
 if(c.sha256){
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
  if(hash!==c.sha256.toLowerCase())throw Error('ไฟล์ข้อมูลย้อนหลังไม่สมบูรณ์');
 }
 const text=c.file.endsWith('.gz')?(typeof DecompressionStream==='undefined'
  ?new TextDecoder().decode(gunzipSync(new Uint8Array(bytes)))
  :await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text())
  :new TextDecoder().decode(bytes);
 const v=JSON.parse(text);return (Array.isArray(v)?v:v.bars) as Bar[];
}
export function compatibleDatasets(datasets:Dataset[],timeframe:number,at:number){
 return datasets.filter(d=>d.status==='ready'&&d.start<=at&&d.end>=at&&d.timeframe<=timeframe&&timeframe%d.timeframe===0)
  .sort((a,b)=>b.timeframe-a.timeframe||b.count-a.count);
}
export function bestDataset(datasets:Dataset[],timeframe:number,at:number,current?:string){
 const options=compatibleDatasets(datasets,timeframe,at);return options.find(d=>d.id===current)??options[0];
}
export async function loadWindow(datasetId:string,center:number,before=2500,after=12500):Promise<{bars:Bar[];dataset:Dataset;index:number}>{
 const all=await catalog();const ds=all.find(d=>d.id===datasetId);if(!ds)throw Error('ชุดข้อมูลนี้ไม่ใช่ข้อมูลย้อนหลังที่ติดมากับแอป');
 const selected=ds.chunks.filter(c=>c.end>=center-before*ds.timeframe&&c.start<=center+after*ds.timeframe);
 if(!selected.length)throw Error('ไม่พบข้อมูลในวันที่เลือก');
 const bars=(await Promise.all(selected.map(chunkBars))).flat().filter(b=>b.time>=center-before*ds.timeframe&&b.time<=center+after*ds.timeframe);
 bars.sort((a,b)=>a.time-b.time);
 let index=bars.findIndex(b=>b.time>=center);if(index<0)index=bars.length-1;
 return {bars,dataset:ds,index};
}
export async function loadBefore(datasetId:string,before:number,limit=10000):Promise<Bar[]>{
 const all=await catalog();const ds=all.find(d=>d.id===datasetId);if(!ds)return[];
 const eligible=ds.chunks.filter(c=>c.start<before).sort((a,b)=>b.start-a.start);const out:Bar[]=[];
 for(const c of eligible){const rows=await chunkBars(c);out.unshift(...rows.filter(b=>b.time<before));if(out.length>=limit)break;}
 return out.slice(-limit);
}
