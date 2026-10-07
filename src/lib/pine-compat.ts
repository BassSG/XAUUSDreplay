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
   const dynamicBodies=new Map<string,{code:string;at:number;match:RegExpMatchArray|null;variants:Map<string,Function>}>();
   for(const method of ['security','security_lower_tf']){const security=ctx.pine.request[method];
   ctx.pine.request[method]=async(...args:any[])=>{
    const unwrap=(v:any)=>{v=Array.isArray(v)&&typeof v[1]==='string'?v[0]:v;return typeof v?.get==='function'?v.get(0):v};
    const symbol=unwrap(args[0])||ctx.tickerId;const tf=String(unwrap(args[1])||ctx.timeframe);
    const expression=Array.isArray(args[2])?args[2][1]:undefined;
    const suffix=typeof expression==='string'?expression.match(/p\d+$/)?.[0]:undefined;
    const key=`${symbol}_${tf}_${expression}${method==='security_lower_tf'?'_lower':''}`;
    // PineTS slices a dynamic request at its FIRST top-level invocation.
    // EBW's first Hero call uses 10m, so its 30m closed-feed request otherwise
    // runs the wrong branch on a 15m chart. Bind that slice's entry call to
    // this request's TF and call scope; keep all function calculations intact.
    const body=suffix&&ctx._ltfTruncatedBodies?.[suffix];
    if(!ctx.isSecondaryContext&&body&&!ctx.cache[key]){
     let entry=dynamicBodies.get(suffix!);if(!entry){const code=body.toString(),at=code.lastIndexOf('$.call(f_heroFetch,');const match=at>=0?code.slice(at).match(/^\$\.call\(f_heroFetch,\s*"[^"]+",\s*(\$\.param\((?:'[^']*'|"[^"]*")|p\d+)/):null;entry={code,at,match,variants:new Map()};dynamicBodies.set(suffix!,entry);}
     const {code,at,match}=entry;
     const callScope=expression.slice(0,-suffix!.length);
     const literal=match?.[1]?.startsWith('$.param(')?match[1]:match?code.slice(0,at).match(new RegExp('\\bconst '+match[1]+'\\s*=\\s*\\$\\.param\\((?:\'[^\']*\'|"[^"]*")'))?.[0]:undefined;
     const initialTF=literal?.match(/'([^']*)'|"([^"]*)"/);const firstMinutes=Number(initialTF?.[1]??initialTF?.[2]);const requestedMinutes=Number(tf)||({D:1440,W:10080,M:43200} as Record<string,number>)[tf];
     // The existing shared slice is sufficient when both calls use the closed
     // branch. Keep it to avoid compiling separate bodies on 1m/5m charts.
     const sameClosedBranch=method==='security'&&firstMinutes>=Number(mainTimeframe)&&requestedMinutes>=Number(mainTimeframe);
     if(match&&callScope&&!sameClosedBranch){const variantKey=tf+'|'+callScope;let fn=entry.variants.get(variantKey);
      if(!fn){let head=code.slice(0,at);const arg=match[1];let boundArg=arg;
       if(arg.startsWith('$.param('))boundArg='$.param('+JSON.stringify(tf);
       else{const declaration=new RegExp('\\bconst '+arg+'\\s*=\\s*\\$\\.param\\((?:\'[^\']*\'|"[^"]*")');if(!declaration.test(head))return security(...args);head=head.replace(declaration,'const '+arg+' = $.param('+JSON.stringify(tf));}
       const replacement=`$.call(f_heroFetch, ${JSON.stringify(callScope)}, ${boundArg}`;fn=optimizePrepared(new Function('return ('+head+replacement+code.slice(at+match[0].length)+')')());entry.variants.set(variantKey,fn!);}
      ctx._ltfTruncatedBodies[suffix!]=fn;
     }
    }
    if(!ctx.cache[key]&&expression){
     const prefix=`${symbol}_${tf}_`;
     const existing=Object.entries(ctx.cache).find(([k,v]:any)=>k.startsWith(prefix)&&k.endsWith('_lower')===(method==='security_lower_tf')&&v.context?.params?.[expression]);
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
