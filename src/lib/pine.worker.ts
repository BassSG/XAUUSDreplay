import {PineTS,Indicator} from 'pinets';
import type {Bar,CandleCalendar} from './engine.ts';
import {brokerTimeToUtc,utcToBrokerTime} from './engine.ts';

const context=self as unknown as Worker;
type ScriptJob={id:string;name:string;source:string};
type Payload={id:number;source?:string;bars:Bar[];baseBars?:Bar[];seconds:number;baseSeconds?:number;calendar?:CandleCalendar;scripts?:ScriptJob[]};

function timeframeSeconds(tf:string){
 const v=String(tf||'').trim().toUpperCase();
 if(/^\d+$/.test(v))return Number(v)*60;
 let m=v.match(/^(\d+)S$/);if(m)return Number(m[1]);
 m=v.match(/^(\d*)D$/);if(m)return Number(m[1]||1)*86400;
 m=v.match(/^(\d*)W$/);if(m)return Number(m[1]||1)*604800;
 m=v.match(/^(\d*)M$/);if(m)return Number(m[1]||1)*2592000;
 return 0;
}
function bucketStart(time:number,tf:string,calendar:CandleCalendar){
 const raw=calendar==='eightcap'?utcToBrokerTime(time):time;
 const upper=tf.toUpperCase();
 let bucket=raw;
 if(/M$/.test(upper)&&!/^\d+$/.test(upper)){
  const mult=Number(upper.slice(0,-1)||1);const d=new Date(raw*1000);
  const month=Math.floor(d.getUTCMonth()/mult)*mult;bucket=Date.UTC(d.getUTCFullYear(),month,1)/1000;
 }else if(/W$/.test(upper)){
  const mult=Number(upper.slice(0,-1)||1);const d=new Date(raw*1000);const monday=(d.getUTCDay()+6)%7;
  const mondayTime=Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()-monday)/1000;
  const anchor=Date.UTC(1970,0,5)/1000;bucket=anchor+Math.floor((mondayTime-anchor)/(mult*604800))*mult*604800;
 }else{
  const sec=timeframeSeconds(tf);if(sec>0)bucket=Math.floor(raw/sec)*sec;
 }
 return calendar==='eightcap'?brokerTimeToUtc(bucket):bucket;
}
function aggregateBars(bars:Bar[],tf:string,calendar:CandleCalendar){
 const out:Bar[]=[];for(const b of bars){const time=bucketStart(b.time,tf,calendar);const p=out.at(-1);
  if(p&&p.time===time){p.high=Math.max(p.high,b.high);p.low=Math.min(p.low,b.low);p.close=b.close;p.volume+=b.volume;}
  else out.push({...b,time});
 }return out;
}
function toKlines(bars:Bar[],tf:string){
 const sec=Math.max(1,timeframeSeconds(tf));
 return bars.map((b,i)=>({openTime:b.time*1000,closeTime:((bars[i+1]?.time??b.time+sec)*1000)-1,open:b.open,high:b.high,low:b.low,close:b.close,volume:b.volume,quoteAssetVolume:0,numberOfTrades:0,takerBuyBaseAssetVolume:0,takerBuyQuoteAssetVolume:0,ignore:0}));
}
function provider(baseBars:Bar[],baseSeconds:number,calendar:CandleCalendar){
 return {
  configure(){},
  async getMarketData(_ticker:string,tf:string,limit?:number,sDate?:number,eDate?:number){
   const sec=timeframeSeconds(tf);if(!sec||sec<baseSeconds)return[];
   let rows=sec===baseSeconds?baseBars:aggregateBars(baseBars,tf,calendar);
   if(Number.isFinite(sDate))rows=rows.filter(b=>b.time*1000>=(sDate as number));
   if(Number.isFinite(eDate))rows=rows.filter(b=>b.time*1000<=(eDate as number));
   if(limit&&limit>0&&rows.length>limit)rows=rows.slice(-limit);
   return toKlines(rows,tf);
  },
  async getSymbolInfo(){
   return {current_contract:'',description:'Gold / US Dollar',isin:'',main_tickerid:'XAUUSD',prefix:'XAU',root:'XAU',ticker:'XAUUSD',tickerid:'XAUUSD',type:'commodity',basecurrency:'XAU',country:'',currency:'USD',timezone:'Etc/UTC',employees:0,industry:'',sector:'',shareholders:0,shares_outstanding_float:0,shares_outstanding_total:0,expiration_date:0,session:'24x7',volumetype:'tick',mincontract:.01,minmove:1,mintick:.01,pointvalue:100,pricescale:100,recommendations_buy:0,recommendations_buy_strong:0,recommendations_date:0,recommendations_hold:0,recommendations_sell:0,recommendations_sell_strong:0,recommendations_total:0,target_price_average:0,target_price_date:0,target_price_estimates:0,target_price_high:0,target_price_low:0,target_price_median:0};
  }
 };
}
function latestObjects(raw:any,key:string){const data=raw.plots?.[key]?.data;return Array.isArray(data)&&data.length?(data.at(-1)?.value??[]):[];}
function color(v:any,fallback='#d7b46a'){return typeof v==='string'&&v&&v!=='na'?v:fallback;}

context.onmessage=async(event:MessageEvent)=>{
 const {id,source,bars,baseBars=bars,seconds,baseSeconds=seconds,calendar='utc',scripts}=event.data as Payload;
 const jobs=scripts?.length?scripts:[{id:'legacy',name:'Pine',source:source||''}];
 const allPlots:any[]=[];const shapes:any[]=[];const drawings:any[]=[];const tables:any[]=[];const warnings:string[]=[];const errors:string[]=[];
 for(const job of jobs){
  try{
   const src=job.source;if(src.length>250000)throw Error('Pine Script ยาวเกิน 250,000 ตัวอักษร');
   if(/\bimport\b/.test(src.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\/[^\n]*|\/\*[\s\S]*?\*\//g,m=>' '.repeat(m.length))))throw Error('ยังไม่รองรับ Pine library import');
   const dataSource=provider(baseBars,baseSeconds,calendar);
   const pine=new PineTS(dataSource as any,'XAUUSD',String(seconds/60),undefined,baseBars[0]?.time*1000,baseBars.at(-1)?.time*1000);
   pine.setMaxLoops(100000);
   const indicator=new Indicator(src);
   const raw=await pine.run(indicator) as any;
   for(const [key,value] of Object.entries(raw.plots??{})){
    if(key.startsWith('__'))continue;const p=value as any;if(!Array.isArray(p?.data))continue;
    const style=p.options?.style??'style_line';const overlay=p.options?.overlay??raw.indicator?.overlay??false;
    if(style==='shape'||style==='char'){
     for(const d of p.data){if(!d?.options||!d.value)continue;shapes.push({indicatorId:job.id,indicatorName:job.name,time:Math.floor(d.time/1000),shape:d.options.shape||style,location:d.options.location||'abovebar',color:color(d.options.color),text:d.options.text||d.options.char||'',textcolor:color(d.options.textcolor,'#ffffff'),size:d.options.size||'small'});}
     continue;
    }
    if(['background','barcolor','bar','candle'].includes(style)){warnings.push(job.name+': '+style+' ยังไม่แสดงผลใน chart host');continue;}
    if(!['style_line','style_linebr','line','hline','style_histogram','style_columns','style_area'].includes(style))continue;
    allPlots.push({indicatorId:job.id,indicatorName:job.name,name:p.title||key,style,overlay,color:color(p.options?.color),width:Math.max(1,Math.min(4,p.options?.linewidth||1)),data:p.data.map((d:any)=>({time:Math.floor(d.time/1000),value:Number.isFinite(d.value)?d.value:null,color:typeof d.options?.color==='string'?d.options.color:undefined}))});
   }
   const groups=[
    ['line',latestObjects(raw,'__lines__'),false],['line',latestObjects(raw,'__lines_overlay__'),true],
    ['box',latestObjects(raw,'__boxes__'),false],['box',latestObjects(raw,'__boxes_overlay__'),true],
    ['label',latestObjects(raw,'__labels__'),false],['label',latestObjects(raw,'__labels_overlay__'),true],
    ['linefill',latestObjects(raw,'__linefills__'),false],['linefill',latestObjects(raw,'__linefills_overlay__'),true]
   ] as const;
   for(const [kind,items,overlay] of groups)for(const item of items??[])if(item&&!item._deleted)drawings.push({...item,kind,overlay:overlay||item.force_overlay,indicatorId:job.id,indicatorName:job.name});
   for(const item of latestObjects(raw,'__tables__')??[])if(item&&!item._deleted)tables.push({...item,indicatorId:job.id,indicatorName:job.name});
   warnings.push(...(raw.warnings??[]).map((w:any)=>job.name+': '+String(w?.message??w)).slice(0,3));
  }catch(e){errors.push(job.name+': '+(e instanceof Error?(e.stack||e.message):String(e)));}
 }
 context.postMessage({id,plots:allPlots,shapes,drawings,tables,warnings:warnings.slice(0,12),errors});
};
