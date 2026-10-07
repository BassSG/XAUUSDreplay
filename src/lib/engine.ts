export type Bar={time:number;open:number;high:number;low:number;close:number;volume:number;spread?:number};
export type CandleCalendar='utc'|'eightcap';
export type Side='long'|'short';
export type OrderType='market'|'limit'|'stop';
export type IndicatorSpec={id:string;name:string;source:string;enabled:boolean};
export type DrawingKind='hline'|'trend'|'rect'|'fib';
export type DrawingPoint={time:number;price:number};
export type Drawing={id:string;kind:DrawingKind;points:DrawingPoint[];locked?:boolean};
export type Command={
 id:string;at:number;type:'open'|'close'|'stop'|'protect'|'cancel'|'modify';
 side?:Side;lots?:number;sl?:number;tp?:number;tradeId?:string;orderId?:string;fraction?:number;
 orderType?:OrderType;entry?:number;
};
export type Settings={balance:number;contractSize:number;spread:number;commission:number;slippage:number};
export type Fill={time:number;price:number;lots:number;pnl:number;reason:string;ambiguous:boolean};
export type Trade={id:string;side:Side;entry:number;time:number;lots:number;remaining:number;initialSL:number;sl:number;tp:number;risk:number;pnl:number;exits:Fill[];orderId?:string};
export type PendingOrder={id:string;side:Side;orderType:'limit'|'stop';entry:number;lots:number;sl:number;tp:number;requestedAt:number;activeFrom:number};
export type Session={
 id:string;name:string;dataset:string;from:number;cursor:number;furthest:number;commands:Command[];settings:Settings;parent?:string;
 notes:Record<string,string>;pine:string;indicatorEnabled:boolean;timeframe:number;revision:number;engineVersion:1;
 windowStart?:number;indicators?:IndicatorSpec[];drawings?:Drawing[];
};
export type EngineResult={
 trades:Trade[];orders:PendingOrder[];pending:Command[];rejected:{id:string;reason:string}[];pnl:number;floating:number;
 equity:number;balance:number;totalR:number;closed:Trade[];winRate:number;drawdown:number;curve:{time:number;value:number}[];
};
export const defaultSettings:Settings={balance:10000,contractSize:100,spread:0.16,commission:0,slippage:0};
const round=(n:number)=>Math.round(n*1e8)/1e8;
function finitePositive(...values:(number|undefined)[]){return values.every(v=>Number.isFinite(v)&&v!>0);}
export function simulate(bars:Bar[],cursor:number,commands:Command[],settings:Settings):EngineResult {
 if(!Object.values(settings).every(Number.isFinite)||settings.balance<=0||settings.contractSize<=0||settings.spread<0||settings.commission<0||settings.slippage<0)throw new Error('Invalid simulation settings');
 const trades:Trade[]=[];const rejected:{id:string;reason:string}[]=[];const curve:{time:number;value:number}[]=[];
 const active:Trade[]=[];const orders:PendingOrder[]=[];
 const ordered=[...commands].sort((a,b)=>a.at-b.at);let commandIndex=0;let peak=settings.balance;let maxDD=0;let realized=0;
 const offset=settings.spread/2+settings.slippage;
 function exit(t:Trade,bar:Bar,mid:number,amount:number,reason:string,ambiguous=false){
  const lots=Math.min(t.remaining,amount);if(lots<=0)return;
  const price=mid+(t.side==='long'?-offset:offset);
  const pnl=round((price-t.entry)*(t.side==='long'?1:-1)*lots*settings.contractSize-settings.commission*lots);
  t.pnl=round(t.pnl+pnl);realized=round(realized+pnl);t.remaining=round(t.remaining-lots);
  t.exits.push({time:bar.time,price,lots,pnl,reason,ambiguous});
 }
 function gap(t:Trade,b:Bar){
  const quote=b.open+(t.side==='long'?-settings.spread/2:settings.spread/2);
  if(t.side==='long'?quote<=t.sl:quote>=t.sl)exit(t,b,b.open,t.remaining,'SL · gap');
  else if(t.side==='long'?quote>=t.tp:quote<=t.tp)exit(t,b,b.open,t.remaining,'TP · gap');
 }
 function createTrade(id:string,orderId:string|undefined,side:Side,entry:number,lots:number,sl:number,tp:number,b:Bar){
  const fee=settings.commission*lots;
  const t:Trade={id,orderId,side,entry,time:b.time,lots,remaining:lots,initialSL:sl,sl,tp,risk:Math.abs(entry-sl)*lots*settings.contractSize,pnl:-fee,exits:[]};
  realized=round(realized-fee);trades.push(t);active.push(t);return t;
 }
 function validProtective(side:Side,entry:number,sl:number,tp:number){return side==='long'?sl<entry&&tp>entry:sl>entry&&tp<entry;}
 function pendingFill(o:PendingOrder,b:Bar):number|null{
  const openQuote=b.open+(o.side==='long'?settings.spread/2:-settings.spread/2);
  const lowQuote=b.low+(o.side==='long'?settings.spread/2:-settings.spread/2);
  const highQuote=b.high+(o.side==='long'?settings.spread/2:-settings.spread/2);
  if(o.side==='long'&&o.orderType==='limit'){
   if(openQuote<=o.entry)return Math.min(o.entry,openQuote+settings.slippage);
   if(lowQuote<=o.entry)return o.entry;
  }
  if(o.side==='short'&&o.orderType==='limit'){
   if(openQuote>=o.entry)return Math.max(o.entry,openQuote-settings.slippage);
   if(highQuote>=o.entry)return o.entry;
  }
  if(o.side==='long'&&o.orderType==='stop'){
   if(openQuote>=o.entry)return Math.max(o.entry,openQuote+settings.slippage);
   if(highQuote>=o.entry)return o.entry+settings.slippage;
  }
  if(o.side==='short'&&o.orderType==='stop'){
   if(openQuote<=o.entry)return Math.min(o.entry,openQuote-settings.slippage);
   if(lowQuote<=o.entry)return o.entry-settings.slippage;
  }
  return null;
 }
 const last=Math.min(cursor,bars.length-1);
 for(let i=0;i<=last;i++){
  const b=bars[i];const previous=bars[i-1];
  const due:Command[]=[];while(commandIndex<ordered.length&&ordered[commandIndex].at<b.time)due.push(ordered[commandIndex++]);

  for(const c of due.filter(c=>c.type==='cancel'||c.type==='modify'||c.type==='stop'||c.type==='protect')){
   if(c.type==='cancel'){
    const index=orders.findIndex(o=>o.id===c.orderId);
    if(index<0){rejected.push({id:c.id,reason:'Pending order ถูก Fill/Cancel ไปแล้ว'});continue;}
    orders.splice(index,1);continue;
   }
   if(c.type==='modify'){
    const o=orders.find(o=>o.id===c.orderId);
    if(!o){rejected.push({id:c.id,reason:'ไม่พบ Pending order ที่ต้องการแก้ไข'});continue;}
    const next={...o,entry:c.entry??o.entry,sl:c.sl??o.sl,tp:c.tp??o.tp,lots:c.lots??o.lots};
    if(!finitePositive(next.entry,next.sl,next.tp,next.lots)||!validProtective(next.side,next.entry,next.sl,next.tp)){rejected.push({id:c.id,reason:'Entry / SL / TP ของ Pending order ไม่ถูกต้อง'});continue;}
    Object.assign(o,next);continue;
   }
   const t=trades.find(t=>t.id===c.tradeId&&t.remaining>0);
   const quote=previous&&t?previous.close+(t.side==='long'?-settings.spread/2:settings.spread/2):NaN;
   if(!t||!Number.isFinite(quote)){rejected.push({id:c.id,reason:'Position ปิดไปแล้ว'});continue;}
   const nextSL=c.sl??t.sl,nextTP=c.tp??t.tp;
   if(!finitePositive(nextSL,nextTP)||(t.side==='long'?(nextSL>=quote||nextTP<=quote):(nextSL<=quote||nextTP>=quote))){
    rejected.push({id:c.id,reason:'SL / TP ต้องอยู่ฝั่งป้องกันและเป้าหมายของราคาขณะสั่ง'});continue;
   }
   t.sl=nextSL;t.tp=nextTP;
  }

  for(const t of active)if(t.remaining>0)gap(t,b);

  for(const c of due.filter(c=>c.type==='open'||c.type==='close')){
   if(c.type==='open'){
    const side=c.side;const lots=c.lots;const sl=c.sl;const tp=c.tp;const orderType=c.orderType??'market';
    if(!side||!['long','short'].includes(side)||!finitePositive(lots,sl,tp)){rejected.push({id:c.id,reason:'ออเดอร์ไม่สมบูรณ์'});continue;}
    if(orderType==='market'){
     const entry=b.open+(side==='long'?offset:-offset);
     if(!validProtective(side,entry,sl!,tp!)){rejected.push({id:c.id,reason:'ราคาเปิดข้าม SL/TP หรือขนาดออเดอร์ไม่ถูกต้อง'});continue;}
     const t=createTrade(c.id,undefined,side,entry,lots!,sl!,tp!,b);gap(t,b);
    }else{
     const entry=c.entry;
     if(!finitePositive(entry)||!validProtective(side,entry!,sl!,tp!)){rejected.push({id:c.id,reason:'Pending order ต้องมี Entry / SL / TP ที่ถูกฝั่ง'});continue;}
     orders.push({id:c.id,side,orderType,entry:entry!,lots:lots!,sl:sl!,tp:tp!,requestedAt:c.at,activeFrom:b.time});
    }
   }else{
    const t=trades.find(t=>t.id===c.tradeId&&t.remaining>0);
    if(!t){rejected.push({id:c.id,reason:'Position ปิดไปแล้ว'});continue;}
    const fraction=c.fraction??1;
    if(!Number.isFinite(fraction)||fraction<=0||fraction>1){rejected.push({id:c.id,reason:'สัดส่วนการปิดต้องมากกว่า 0 และไม่เกิน 1'});continue;}
    exit(t,b,b.open,t.remaining*fraction,'Manual');
   }
  }

  for(let oi=orders.length-1;oi>=0;oi--){
   const o=orders[oi];if(o.activeFrom>b.time)continue;
   const fill=pendingFill(o,b);if(fill===null)continue;
   orders.splice(oi,1);
   const t=createTrade(o.id,o.id,o.side,fill,o.lots,o.sl,o.tp,b);
   const quoteOffset=t.side==='long'?-settings.spread/2:settings.spread/2;
   const hitSL=t.side==='long'?b.low+quoteOffset<=t.sl:b.high+quoteOffset>=t.sl;
   const hitTP=t.side==='long'?b.high+quoteOffset>=t.tp:b.low+quoteOffset<=t.tp;
   if(hitSL||hitTP){const level=hitSL?t.sl:t.tp;exit(t,b,level-quoteOffset,t.remaining,hitSL?'SL':'TP',true);}
  }

  for(const t of active){
   if(t.remaining<=0||t.time===b.time&&t.exits.length)continue;
   const quoteOffset=t.side==='long'?-settings.spread/2:settings.spread/2;
   const hitSL=t.side==='long'?b.low+quoteOffset<=t.sl:b.high+quoteOffset>=t.sl;
   const hitTP=t.side==='long'?b.high+quoteOffset>=t.tp:b.low+quoteOffset<=t.tp;
   if(hitSL||hitTP){const level=hitSL?t.sl:t.tp;exit(t,b,level-quoteOffset,t.remaining,hitSL?'SL':'TP',hitSL&&hitTP);}
  }
  let floating=0;for(const t of active)if(t.remaining>0)floating+=(b.close+(t.side==='long'?-settings.spread/2:settings.spread/2)-t.entry)*(t.side==='long'?1:-1)*t.remaining*settings.contractSize;
  const equity=settings.balance+realized+floating;peak=Math.max(peak,equity);maxDD=Math.max(maxDD,peak-equity);curve.push({time:b.time,value:equity});
 }
 const closed=trades.filter(t=>t.remaining<=0);const equity=curve.at(-1)?.value??settings.balance;
 return {trades,orders,pending:ordered.slice(commandIndex).filter(c=>c.at<=(bars[last]?.time??0)),rejected,pnl:round(realized),floating:round(equity-settings.balance-realized),equity,balance:settings.balance+realized,totalR:trades.reduce((v,t)=>v+(t.risk?t.pnl/t.risk:0),0),closed,winRate:closed.length?closed.filter(t=>t.pnl>0).length/closed.length*100:0,drawdown:maxDD,curve};
}
export function brokerOffsetSeconds(raw:number):number{
 const year=new Date(raw*1000).getUTCFullYear();
 const sunday=(month:number,n:number)=>Date.UTC(year,month,1+(7-new Date(Date.UTC(year,month,1)).getUTCDay())%7+(n-1)*7)/1000;
 return raw>=sunday(2,2)&&raw<sunday(10,1)?10800:7200;
}
export function brokerTimeToUtc(raw:number):number{return raw-brokerOffsetSeconds(raw);}
export function utcToBrokerTime(utc:number):number{
 const summer=utc+10800;if(brokerTimeToUtc(summer)===utc)return summer;
 const winter=utc+7200;if(brokerTimeToUtc(winter)===utc)return winter;
 throw new Error('เวลาอยู่ในช่วงเปลี่ยนนาฬิกาโบรกเกอร์ที่ไม่มีแท่งราคา');
}
export function aggregate(bars:Bar[],seconds:number,calendar:CandleCalendar='utc'):Bar[]{
 const result:Bar[]=[];for(const b of bars){const raw=calendar==='eightcap'?utcToBrokerTime(b.time):b.time;const bucket=Math.floor(raw/seconds)*seconds;const time=calendar==='eightcap'?brokerTimeToUtc(bucket):bucket;const prev=result.at(-1);if(prev&&prev.time===time){prev.high=Math.max(prev.high,b.high);prev.low=Math.min(prev.low,b.low);prev.close=b.close;prev.volume+=b.volume;}else result.push({...b,time});}return result;
}
export function normalizeImportBars(rows:unknown[],clock:CandleCalendar='utc'):Bar[]{
 const bars=normalizeBars(rows);return clock==='eightcap'?bars.map(b=>({...b,time:brokerTimeToUtc(b.time)})):bars;
}
export function normalizeBars(rows:unknown[]):Bar[]{
 const map=new Map<number,Bar>();
 for(const row of rows){
  if(!row||typeof row!=='object')throw new Error('พบแถวข้อมูลที่ไม่ใช่แท่งราคา');
  const r=row as Record<string,unknown>;let time=Number(r.time??r.timestamp??r.openTime);
  if(!Number.isFinite(time)){const date=String(r.datetime_utc??r.datetime??r.date??r.time??r.timestamp??r.openTime??'');time=Date.parse(date.endsWith('Z')||/[+-]\d\d:\d\d$/.test(date)?date:date.replace(' ','T')+'Z')/1000;}
  if(time>1e12)time/=1000;time=Math.floor(time);
  const b:Bar={time,open:Number(r.open),high:Number(r.high),low:Number(r.low),close:Number(r.close),volume:Number(r.volume??r.tick_volume??0)};
  if(![b.time,b.open,b.high,b.low,b.close,b.volume].every(Number.isFinite)||b.time<1e9||b.open<=0||b.low<=0||b.high<Math.max(b.open,b.close)||b.low>Math.min(b.open,b.close)||b.high<b.low||b.volume<0)throw new Error('แท่งราคาไม่ถูกต้อง: ต้องมีเวลา UTC และ OHLC ที่สมบูรณ์');
  map.set(time,b);
 }return [...map.values()].sort((a,b)=>a.time-b.time);
}
