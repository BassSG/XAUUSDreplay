import {PineTS,Indicator} from 'pinets';
import type {Bar,CandleCalendar} from './engine.ts';
import {adaptPineSource,wrapPineContext,optimizePrepared,setPineMainTimeframe} from './pine-compat.ts';
import {periodEnd,replayProvider} from './pine-data.ts';
import {installReplaySnapshots} from './pine-stream.ts';
installReplaySnapshots();
const secondaryRun=PineTS.prototype.runPretranspiled;
const preparedSlices=new WeakMap<Function,Function>();
PineTS.prototype.runPretranspiled=function(fn:Function,inputs?:Record<string,any>,periods?:number){let prepared=preparedSlices.get(fn);if(!prepared){prepared=wrapPineContext(optimizePrepared(fn));preparedSlices.set(fn,prepared);}return secondaryRun.call(this,prepared,inputs,periods)};
const context=self as unknown as Worker;
export type ScriptJob={id:string;name:string;source:string;inputs?:Record<string,string|number|boolean>;builtinId?:string};
type Payload={id:number;key?:string;source?:string;bars:Bar[];baseBars?:Bar[];seconds:number;baseSeconds?:number;calendar?:CandleCalendar;scripts?:ScriptJob[];bundled?:boolean;history?:Record<string,Bar[]>};
type Compiled={source:string;indicator:Indicator;meta:any[];bridge:Map<string,Map<number,number>>;runtime?:{pine:any;raw:any;provider:{current:any};bars:Bar[];baseBars:Bar[];settings:string}};
const compiled=new Map<string,Compiled>();
const results=new Map<string,any>();
function latestObjects(raw:any,key:string){const data=raw.plots?.[key]?.data;return Array.isArray(data)&&data.length?(data.at(-1)?.value??[]):[];}
function color(v:any,fallback='#d7b46a'){return typeof v==='string'&&v&&v!=='na'?v:fallback;}
function plain(value:any){return JSON.parse(JSON.stringify(value,(k,v)=>['context','_udt','_definition'].includes(k)||typeof v==='function'?undefined:v));}
export const visibleDisplay=(v:unknown)=>v===undefined||v==='all'||typeof v==='string'&&v.includes('pane');
context.onmessage=async(event:MessageEvent)=>{
 const {id,key,source,bars,baseBars=bars,seconds,baseSeconds=seconds,calendar='utc',scripts,bundled=false,history}=event.data as Payload;
 if(key&&results.has(key)){context.postMessage({...results.get(key),id});return;}
 const jobs=(scripts?.length?scripts:[{id:'legacy',name:'Pine',source:source||''}]).slice().sort((a,b)=>Number(b.source.includes('indicator("All Indy (EBW) V10.4.4'))-Number(a.source.includes('indicator("All Indy (EBW) V10.4.4')));
 const plots:any[]=[],shapes:any[]=[],drawings:any[]=[],tables:any[]=[],warnings:string[]=[],errors:string[]=[],studies:any[]=[];
 let bridge=new Map<string,Map<number,number>>();
 const asOf=baseBars.length?periodEnd(baseBars.at(-1)!.time,String(baseSeconds/60),calendar):0;
 const realNow=Date.now;Date.now=()=>asOf*1000;
 try{for(const job of jobs){
  setPineMainTimeframe(String(seconds/60));
  const study={id:job.id,name:job.name,inputs:[] as any[],error:'',bridge:false,ms:0,mode:'initial'};const started=performance.now();
  context.postMessage({id,progress:job.name});
  try{
   const src=job.source;const executable=src.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\/[^\n]*|\/\*[\s\S]*?\*\//g,m=>' '.repeat(m.length));if(/\bstrategy\s*\(/.test(executable))throw Error('หน้านี้ใช้ indicator() · strategy() ยังไม่เชื่อมกับสมุดออเดอร์จำลอง');if(src.length>250000)throw Error('Pine Script ยาวเกิน 250,000 ตัวอักษร');
   if(/\bimport\b/.test(src.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\/[^\n]*|\/\*[\s\S]*?\*\//g,m=>' '.repeat(m.length))))throw Error('ยังไม่รองรับ Pine library import');
   let item=compiled.get(job.id);
   if(!item||item.source!==src){
    const indicator=new Indicator(adaptPineSource(src)),prepared=indicator.prepare();
    item={source:src,indicator,meta:indicator.getInputsMeta(),bridge:new Map()};const entry=item,fn=optimizePrepared(prepared.fn);
    prepared.fn=wrapPineContext(async(ctx:any)=>{
     const t=Math.floor(ctx.marketData[ctx.idx]?.openTime/1000);
     for(const m of entry.meta.filter(m=>m.type==='source'&&/^ZB \d\d /.test(m.title||''))){
      if(entry.bridge.size)ctx.inputs[m.id]=entry.bridge.get(m.title)?.get(t)??NaN;
     }
     return fn(ctx);
    },indicator);
    compiled.set(job.id,item);
   }
   item.indicator.inputs={...job.inputs};item.bridge=bridge;study.inputs=item.meta;
   study.bridge=src.includes('indicator("EBW-Fibo 1.9')&&bridge.size===17;
   context.postMessage({id,progress:job.name,metadata:study});
   const dataSource=replayProvider(baseBars,baseSeconds,calendar,asOf,bundled,warnings,history,{tf:String(seconds/60),bars});
   const settings=JSON.stringify([seconds,baseSeconds,calendar,bundled,job.inputs]);const prior=item.runtime;
   const prefix=(previous:Bar[],next:Bar[])=>next.length>=previous.length&&previous.length>1&&previous.slice(0,-1).every((b,i)=>JSON.stringify(b)===JSON.stringify(next[i]));
   let raw:any;
   if(prior&&prior.settings===settings&&prefix(prior.bars,bars)&&prefix(prior.baseBars,baseBars)){
    study.mode='incremental';
    prior.provider.current=dataSource;prior.pine.eDate=asOf*1000;prior.raw.eDate=asOf*1000;
    await prior.pine.updateTail(prior.raw);raw=prior.raw;prior.bars=bars;prior.baseBars=baseBars;
   }else{
    const provider={current:dataSource};const liveProvider={configure(){},getMarketData:(...args:any[])=>(provider.current.getMarketData as any)(...args),getSymbolInfo:()=>provider.current.getSymbolInfo()};
    const pine=new PineTS(liveProvider as any,'XAUUSD',String(seconds/60),undefined,bars[0]?.time*1000,asOf*1000);
    pine.setMaxLoops(100000);pine.setTimezone('Asia/Bangkok');raw=await pine.run(item.indicator) as any;
    item.runtime={pine,raw,provider,bars,baseBars,settings};
   }
   if(src.includes('indicator("All Indy (EBW) V10.4.4')){
    bridge=new Map(Object.entries(raw.plots??{}).filter(([key,p]:any)=>/^ZB \d\d /.test(p.title||key)).map(([key,p]:any)=>[p.title||key,new Map<number,number>(p.data.map((d:any)=>[Math.floor(d.time/1000),Number(d.value)]))]));
   }
   for(const [key,value] of Object.entries(raw.plots??{})){
    if(key.startsWith('__'))continue;const p=value as any;if(!Array.isArray(p?.data)||!visibleDisplay(p.options?.display))continue;
    const style=p.options?.style??'style_line',overlay=!!(p.options?.force_overlay||p.options?.overlay||raw.indicator?.overlay);
    if(style==='shape'||style==='char'){
     for(const d of p.data){if(!d?.options||!d.value)continue;shapes.push({indicatorId:job.id,indicatorName:job.name,time:Math.floor(d.time/1000),shape:d.options.shape||style,location:d.options.location||'abovebar',color:color(d.options.color),text:d.options.text||d.options.char||'',textcolor:color(d.options.textcolor,'#ffffff'),size:d.options.size||'small'});}continue;
    }
    if(['background','barcolor','bar','candle'].includes(style)){warnings.push(job.name+': '+style+' ยังไม่แสดงในกราฟ');continue;}
    if(!['style_line','style_linebr','style_stepline','line','hline','style_histogram','style_columns','style_area'].includes(style))continue;
    plots.push({indicatorId:job.id,indicatorName:job.name,name:p.title||key,style,overlay,color:color(p.options?.color),width:Math.max(1,Math.min(4,p.options?.linewidth||1)),data:p.data.map((d:any)=>({time:Math.floor(d.time/1000),value:Number.isFinite(d.value)?d.value:null,color:typeof d.options?.color==='string'?d.options.color:undefined}))});
   }
   for(const [kind,key,overlay] of [['line','__lines__',false],['line','__lines_overlay__',true],['box','__boxes__',false],['box','__boxes_overlay__',true],['label','__labels__',false],['label','__labels_overlay__',true],['linefill','__linefills__',false],['linefill','__linefills_overlay__',true]] as const){
    for(const d of latestObjects(raw,key)??[])if(d&&!d._deleted)drawings.push(plain({...d,kind,overlay:overlay||d.force_overlay||raw.indicator?.overlay,indicatorId:job.id,indicatorName:job.name}));
   }
   for(const t of latestObjects(raw,'__tables__')??[])if(t&&!t._deleted)tables.push(plain({...t,indicatorId:job.id,indicatorName:job.name}));
   warnings.push(...(raw.warnings??[]).slice(0,3).map((w:any)=>job.name+': '+String(w?.message??w)));
  }catch(e){const item=compiled.get(job.id);if(item)item.runtime=undefined;study.error=e instanceof Error?e.message:String(e);errors.push(job.name+': '+study.error);}
  study.ms=Math.round(performance.now()-started);studies.push(study);
 }}finally{Date.now=realNow;}
 for(const key of compiled.keys())if(!jobs.some(j=>j.id===key))compiled.delete(key);
 const result={id,plots,shapes,drawings,tables,warnings:[...new Set(warnings)].slice(0,12),errors,studies};
 if(key&&!errors.length){results.set(key,result);while(results.size>8||[...results.values()].reduce((n,r)=>n+r.plots.reduce((v:number,p:any)=>v+p.data.length,0),0)>400000)results.delete(results.keys().next().value!);}
 context.postMessage(result);
};
