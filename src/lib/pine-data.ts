import {brokerTimeToUtc,utcToBrokerTime,type Bar,type CandleCalendar} from './engine.ts';
import {historyCatalog,loadBefore} from './history.ts';
export function timeframeSeconds(tf:string){
 const v=String(tf||'').trim().toUpperCase();if(/^\d+$/.test(v))return Number(v)*60;
 const m=v.match(/^(\d*)(S|D|W|M)$/);return m?Number(m[1]||1)*({S:1,D:86400,W:604800,M:2592000}[m[2] as 'S'|'D'|'W'|'M']):0;
}
export function bucketStart(time:number,tf:string,calendar:CandleCalendar){
 const raw=calendar==='eightcap'?utcToBrokerTime(time):time;const upper=tf.toUpperCase();let bucket=raw;
 if(/M$/.test(upper)){
  const mult=Number(upper.slice(0,-1)||1),d=new Date(raw*1000);const total=d.getUTCFullYear()*12+d.getUTCMonth();const month=Math.floor(total/mult)*mult;bucket=Date.UTC(Math.floor(month/12),month%12,1)/1000;
 }else if(/W$/.test(upper)){
  const mult=Number(upper.slice(0,-1)||1),d=new Date(raw*1000);const monday=(d.getUTCDay()+6)%7;const anchor=Date.UTC(1970,0,5)/1000;const mondayTime=Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()-monday)/1000;bucket=anchor+Math.floor((mondayTime-anchor)/(mult*604800))*mult*604800;
 }else{const sec=timeframeSeconds(tf);if(sec)bucket=Math.floor(raw/sec)*sec;}
 return calendar==='eightcap'?brokerTimeToUtc(bucket):bucket;
}
export function periodEnd(time:number,tf:string,calendar:CandleCalendar){
 const raw=calendar==='eightcap'?utcToBrokerTime(time):time;let end=raw+timeframeSeconds(tf);
 if(/M$/.test(tf.toUpperCase())){const d=new Date(raw*1000);end=Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+Number(tf.slice(0,-1)||1),1)/1000;}
 return calendar==='eightcap'?brokerTimeToUtc(end):end;
}
export function aggregatePineBars(bars:Bar[],tf:string,calendar:CandleCalendar){
 const out:Bar[]=[];for(const b of bars){const time=bucketStart(b.time,tf,calendar);const p=out.at(-1);
  if(p&&p.time===time){p.high=Math.max(p.high,b.high);p.low=Math.min(p.low,b.low);p.close=b.close;p.volume+=b.volume;}else out.push({...b,time});
 }return out;
}
export function toKlines(bars:Bar[],tf:string,calendar:CandleCalendar){
 return bars.map(b=>({openTime:b.time*1000,closeTime:periodEnd(b.time,tf,calendar)*1000-1,open:b.open,high:b.high,low:b.low,close:b.close,volume:b.volume,quoteAssetVolume:0,numberOfTrades:0,takerBuyBaseAssetVolume:0,takerBuyQuoteAssetVolume:0,ignore:0}));
}
export function replayProvider(baseBars:Bar[],baseSeconds:number,calendar:CandleCalendar,asOf:number,bundled:boolean,warnings:string[],injected?:Record<string,Bar[]>,primary?:{tf:string;bars:Bar[]}){
 const cache=new Map<string,Promise<Bar[]>>();const baseTF=String(baseSeconds/60);const known=baseBars.filter(b=>periodEnd(b.time,baseTF,calendar)<=asOf);
 const getRows=(tf:string,limit=2000)=>{
  const key=tf+':'+limit;if(!cache.has(key))cache.set(key,(async()=>{
   const seconds=timeframeSeconds(tf);let rows:Bar[]=[];let sourceSeconds=baseSeconds;
   if(seconds===baseSeconds)rows=known;
   else if(injected?.[tf]){rows=injected[tf];sourceSeconds=seconds;}
   else if(bundled){
    const candidates=(await historyCatalog()).filter(d=>d.calendar===calendar&&d.start<asOf&&d.timeframe<=seconds&&seconds%d.timeframe===0).sort((a,b)=>b.timeframe-a.timeframe);
    const ds=candidates[0];if(ds){sourceSeconds=ds.timeframe;rows=await loadBefore(ds.id,asOf+1,Math.min(100000,Math.ceil(limit*seconds/sourceSeconds)+5));}
   }else if(seconds>=baseSeconds)rows=known;
   if(!rows.length){warnings.push('ไม่มีข้อมูล '+tf+' ณ จุด Replay นี้');return [];}
   rows=rows.filter(b=>periodEnd(b.time,String(sourceSeconds/60),calendar)<=asOf);
   if(sourceSeconds!==seconds)rows=aggregatePineBars(rows,tf,calendar);
   if(seconds>baseSeconds){
    rows=rows.filter(b=>periodEnd(b.time,tf,calendar)<=asOf);
    const start=bucketStart(asOf-1,tf,calendar);let partial=known.filter(b=>b.time>=start);
    // A short minute window may begin in the middle of the week/month.
    // Reconstruct its earlier portion from CLOSED coarse candles, then
    // append only the revealed fine candles at the edge.
    if(bundled&&partial[0]?.time!==start){
     const ds=(await historyCatalog()).filter(d=>d.calendar===calendar&&d.start<=start&&d.timeframe<seconds&&seconds%d.timeframe===0).sort((a,b)=>b.timeframe-a.timeframe)[0];
     if(ds){const head=(await loadBefore(ds.id,asOf+1,Math.min(100000,Math.ceil((asOf-start)/ds.timeframe)+5))).filter(b=>b.time>=start&&periodEnd(b.time,String(ds.timeframe/60),calendar)<=asOf);const edge=head.length?periodEnd(head.at(-1)!.time,String(ds.timeframe/60),calendar):start;partial=[...head,...known.filter(b=>b.time>=edge)];}
    }
    if(partial.length&&partial[0].time===start){const forming=aggregatePineBars(partial,tf,calendar).at(-1)!;if(!rows.some(b=>b.time===forming.time))rows.push(forming);}
   }
   return rows.filter(b=>b.time<asOf).sort((a,b)=>a.time-b.time).slice(-limit);
  })());return cache.get(key)!;
 };
 return {
  configure(){},
  async getMarketData(ticker:string,tf:string,limit?:number,sDate?:number,eDate?:number){
   if(ticker.split(':').at(-1)!=='XAUUSD')throw Error('ชุดข้อมูลนี้รองรับ XAUUSD เท่านั้น');
   if(!timeframeSeconds(tf))throw Error('Timeframe ไม่รองรับ: '+tf);
   let rows=primary&&timeframeSeconds(tf)===timeframeSeconds(primary.tf)?primary.bars:await getRows(tf,limit||Math.max(2000,known.length));
   if(Number.isFinite(sDate))rows=rows.filter(b=>b.time*1000>=sDate!);
   if(Number.isFinite(eDate))rows=rows.filter(b=>b.time*1000<=Math.min(eDate!,asOf*1000));
   return toKlines(rows,tf,calendar);
  },
  async getSymbolInfo(){return {ticker:'XAUUSD',tickerid:'XAUUSD',main_tickerid:'XAUUSD',description:'Gold / US Dollar',type:'commodity',basecurrency:'XAU',currency:'USD',timezone:'Etc/UTC',session:'24x5',mintick:.01,minmove:1,pricescale:100,pointvalue:100,mincontract:.01,volumetype:'tick'};}
 };
}
