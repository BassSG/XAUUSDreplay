import {PineTS} from 'pinets';
import type {Bar} from './engine';
const context=self as unknown as Worker;
context.onmessage=async(event:MessageEvent)=>{
 const {id,source,bars,seconds,scripts}=event.data as {id:number;source?:string;bars:Bar[];seconds:number;scripts?:{id:string;name:string;source:string}[]};
 try{
  const jobs=scripts?.length?scripts:[{id:'legacy',name:'Pine',source:source||''}];
  const allPlots:any[]=[];const warnings:string[]=[];
  for(const job of jobs){const source=job.source;
  if(source.length>30000)throw Error(job.name+': Pine Script ยาวเกิน 30,000 ตัวอักษร');
  const masked=source.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\/[^\n]*|\/\*[\s\S]*?\*\//g,m=>' '.repeat(m.length));
  if(/\b(request\s*\.|import\b|strategy\s*\(|timenow\b)/.test(masked))throw Error('รุ่นนี้รองรับ indicator ใน timeframe ปัจจุบัน ยังไม่รองรับ request.*, import, strategy หรือ timenow');
  if(/\b(timeframe\s*=|offset\s*=|plotshape\s*\(|plotchar\s*\(|fill\s*\(|bgcolor\s*\(|barcolor\s*\(|(?:line|label|box|table|polyline)\s*\.)/.test(masked))throw Error('ตัววาด Pine รุ่นนี้รองรับ plot และ hline ยังไม่รองรับ drawing, shape, fill, offset หรือ timeframe override');
  const pine=new PineTS(bars.map(b=>({openTime:b.time*1000,closeTime:(b.time+seconds)*1000-1,open:b.open,high:b.high,low:b.low,close:b.close,volume:b.volume})),'XAUUSD',String(seconds/60));
  pine.setMaxLoops(10000);
  const result=await pine.run(source);const raw=result as any;const plots:any[]=[];
  for(const [key,value] of Object.entries(raw.plots??{})){
   const p=value as any;if(key.startsWith('__')||!Array.isArray(p?.data))continue;
   if(plots.length>=16)throw Error('รองรับไม่เกิน 16 plots ต่อสคริปต์');
   const style=p.options?.style??'style_line';
   if(!['style_line','style_linebr','line','hline','style_histogram','style_columns','style_area'].includes(style))throw Error('ยังไม่รองรับ plot style: '+style);
   plots.push({name:p.title||key,style,overlay:p.options?.overlay??raw.indicator?.overlay??false,color:p.options?.color||'#d7b46a',width:Math.max(1,Math.min(4,p.options?.linewidth||1)),data:p.data.map((d:any)=>({time:Math.floor(d.time/1000),value:Number.isFinite(d.value)?d.value:null,color:typeof d.options?.color==='string'?d.options.color:undefined}))});
  }
  allPlots.push(...plots.map(p=>({...p,indicatorId:job.id,indicatorName:job.name})));warnings.push(...(raw.warnings??[]).map((w:any)=>job.name+': '+String(w?.message??w)).slice(0,2));}
  context.postMessage({id,plots:allPlots,warnings:warnings.slice(0,6)});
 }catch(e){context.postMessage({id,error:e instanceof Error?e.message:'ไม่สามารถรัน Pine Script นี้ได้'});}
};
