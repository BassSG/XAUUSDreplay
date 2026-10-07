// Keep the shipped Pine sources complete and unchanged. These narrowly scoped
// guards protect missing packets during the first bars of a secondary context.
// They do not replace any calculations or disable indicator features.
const patched=new WeakSet<object>();
let mainTimeframe='1';
export function setPineMainTimeframe(tf:string){mainTimeframe=tf;}
export function optimizePrepared(fn:Function):Function {
 // The 0.11 transpiler revisits default param indexes in large scripts,
 // emitting dozens of get(get(undefined,0),0) calls per argument. Each
 // evaluates to undefined. Preserve quoted text; fold only emitted code.
 let code=fn.toString(),previous='';
 while(code!==previous){previous=code;code=code.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\$\.get\(undefined,\s*0\)/g,m=>m.startsWith('$.get(')?'undefined':m);}
 return code===fn.toString()?fn:new Function('return ('+code+')')();
}
export function wrapPineContext(fn:Function,owner?:any):Function {
 return async (ctx:any)=>{
  if(owner)ctx.pineTSCode=owner;
  if(!patched.has(ctx)){
   patched.add(ctx);
   // main_period stays the chart's timeframe inside request contexts. PineTS
   // 0.11 aliases it to period, which changes dynamic request branches.
   Object.defineProperty(ctx.pine.timeframe,'main_period',{get:()=>mainTimeframe});
   Object.defineProperties(ctx.pine.barstate,{
    isrealtime:{get:()=>ctx.idx===ctx.length-1&&ctx.marketData[ctx.idx]?.closeTime>Date.now()},
    ishistory:{get:()=>ctx.marketData[ctx.idx]?.closeTime<=Date.now()},
   });
   const arrayNew=ctx.pine.array.new;
   ctx.pine.array.new=(size:number,value:any)=>arrayNew(size,
    typeof value==='number'&&Number.isNaN(value)||value&&'__value' in Object(value)&&Number.isNaN(value.__value)?undefined:value);
   const type=ctx.pine.Type;
   ctx.pine.Type=(...args:any[])=>{
    const factory=type(...args);const make=factory.new;
    factory.new=(...values:any[])=>{
     const obj=make.apply(factory,values);const proto=Object.getPrototypeOf(obj);
     if(!patched.has(proto)){
      patched.add(proto);
      proto.copy=function(){return new this.constructor(Object.fromEntries([...new Set([...Object.keys(this.__def__),...Object.keys(this).filter(k=>!['_definition','context','_udt'].includes(k))])].map(k=>[k,this[k]])),this.context,this._udt)};
     }
     return obj;
    };return factory;
   };
   const security=ctx.pine.request.security;
   ctx.pine.request.security=async(...args:any[])=>{
    const unwrap=(v:any)=>{v=Array.isArray(v)&&typeof v[1]==='string'?v[0]:v;return typeof v?.get==='function'?v.get(0):v};
    const symbol=unwrap(args[0])||ctx.tickerId;const tf=String(unwrap(args[1])||ctx.timeframe);
    const expression=Array.isArray(args[2])?args[2][1]:undefined;
    const key=`${symbol}_${tf}_${expression}`;
    if(!ctx.cache[key]&&expression){
     const prefix=`${symbol}_${tf}_`;
     const existing=Object.entries(ctx.cache).find(([k,v]:any)=>k.startsWith(prefix)&&v.context?.params?.[expression]);
     if(existing)ctx.cache[key]=existing[1];
    }
    try{return await security(...args)}catch(e){
     // A dynamic call has a different scope prefix in a truncated secondary
     // body. Reconcile only an unambiguous expression call-site, never its TF.
     if(!(e instanceof TypeError)||!e.message.includes('undefined'))throw e;
     const suffix=typeof expression==='string'?expression.match(/p\d+$/)?.[0]:undefined;
     let repaired=false;
     for(const [cacheKey,cached] of Object.entries(ctx.cache) as [string,any][]){
      if(cacheKey!==key)continue;
      const params=cached?.context?.params;if(!params||!expression||params[expression])continue;
      const keys=Object.keys(params).filter(k=>k.match(/p\d+$/)?.[0]===suffix);
      if(keys.length===1){params[expression]=params[keys[0]];repaired=true;}
     }
     if(repaired)return security(...args);
     throw e;
    }
   };
  }
  return fn(ctx);
 };
}
export function adaptPineSource(source:string):string {
 if(source.includes('indicator("All Indy (EBW) V10.4.4')) {
  source=source.replace('string key = p.id + ":" + p.status','string key = na(p) ? "" : p.id + ":" + p.status')
   .replace('string message = key != previous and p.id != "" ?','string message = not na(p) and key != previous and p.id != "" ?')
   .replace('if sample.closedAt <= time_close','if not na(sample) and sample.closedAt <= time_close');
 }
 if(source.includes('indicator("EBW-Fibo 1.9')) {
  source=source.replace('if not na(packet.asof) and packet.asof <= timenow','if not na(packet) and not na(packet.asof) and packet.asof <= timenow')
   .replace('if timeframe.in_seconds(tf) < timeframe.in_seconds()','if timeframe.in_seconds(tf) < timeframe.in_seconds(timeframe.main_period)');
 }
 return source;
}
