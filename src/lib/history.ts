import {decodeChunk,type ChunkDescriptor} from './bundled-chunk.ts';
import type {Bar} from './engine';
import type {Dataset} from './types';
type Bundle=Dataset&{chunks:ChunkDescriptor[]};
function baseURL(){return (import.meta as ImportMeta&{env?:{BASE_URL?:string}}).env?.BASE_URL??'/';}
let catalogPromise:Promise<Bundle[]>|undefined;
const chunkCache=new Map<string,Promise<Bar[]>>();
export function historyCatalog():Promise<Bundle[]>{
 if(!catalogPromise)catalogPromise=(async()=>{
  let r=await fetch(baseURL()+'data/catalog-v2.json',{cache:'no-cache'});
  if(r.status===404)r=await fetch(baseURL()+'data/catalog.json',{cache:'no-cache'});
  if(!r.ok)throw Error('โหลดรายการข้อมูลย้อนหลังไม่สำเร็จ');
  const v=await r.json();return (Array.isArray(v)?v:v.datasets) as Bundle[];
 })().catch(e=>{catalogPromise=undefined;throw e});
 return catalogPromise;
}
async function chunkBars(c:ChunkDescriptor):Promise<Bar[]>{
 const key=c.file+':'+(c.contentSha256??c.sha256);
 if(!chunkCache.has(key))chunkCache.set(key,(async()=>{
  const r=await fetch(baseURL()+c.file);if(!r.ok)throw Error('โหลดข้อมูลย้อนหลังไม่สำเร็จ');
  const v=JSON.parse(await decodeChunk(await r.arrayBuffer(),c));const rows:Bar[]=Array.isArray(v)?v:v.bars;
  if(rows.length!==c.count||rows[0]?.time!==c.start||rows.at(-1)?.time!==c.end)throw Error('ข้อมูลย้อนหลังไม่ตรงกับรายการ');
  return rows;
 })().catch(e=>{chunkCache.delete(key);throw e}));
 const result=chunkCache.get(key)!;
 if(chunkCache.size>24)chunkCache.delete(chunkCache.keys().next().value!);
 return result;
}
export function compatibleDatasets(datasets:Dataset[],timeframe:number,at:number){
 return datasets.filter(d=>d.status==='ready'&&d.start<=at&&d.end+d.timeframe>=at&&d.timeframe<=timeframe&&timeframe%d.timeframe===0)
  .sort((a,b)=>b.timeframe-a.timeframe||b.count-a.count);
}
export function bestDataset(datasets:Dataset[],timeframe:number,at:number,current?:string){
 const options=compatibleDatasets(datasets,timeframe,at);return options.find(d=>d.id===current)??options[0];
}
export async function loadBefore(datasetId:string,before:number,limit=2500):Promise<Bar[]>{
 if(limit<=0)return[];
 const ds=(await historyCatalog()).find(d=>d.id===datasetId);if(!ds)return[];
 const eligible=ds.chunks.filter(c=>c.start<before).sort((a,b)=>b.start-a.start);const out:Bar[]=[];
 for(const c of eligible){out.unshift(...(await chunkBars(c)).filter(b=>b.time<before));if(out.length>=limit)break;}
 return out.slice(-limit);
}
export async function loadWindow(datasetId:string,center:number,before=2500,after=12500):Promise<{bars:Bar[];dataset:Dataset;index:number}>{
 const ds=(await historyCatalog()).find(d=>d.id===datasetId);if(!ds)throw Error('ชุดข้อมูลนี้ไม่ใช่ข้อมูลย้อนหลังที่ติดมากับแอป');
 const older=await loadBefore(datasetId,center,before);const upcoming:Bar[]=[];
 for(const c of ds.chunks.filter(c=>c.end>=center)){
  upcoming.push(...(await chunkBars(c)).filter(b=>b.time>=center));if(upcoming.length>=after)break;
 }
 if(!upcoming.length)throw Error('ไม่พบข้อมูลในวันที่เลือก');
 return {bars:[...older,...upcoming.slice(0,after)],dataset:ds,index:older.length};
}
