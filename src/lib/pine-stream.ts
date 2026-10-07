import {PineTS} from 'pinets';

// PineTS snapshots scalar series, but keeps array/UDT/drawing references.
// Replay must restore those values before recomputing a forming candle.
function clone(value:any,seen=new Map<any,any>()):any {
 if(!value||typeof value!=='object')return value;
 if(seen.has(value))return seen.get(value);
 if(value instanceof Date)return new Date(value);
 const out:any=value instanceof Map?new Map():value instanceof Set?new Set():Array.isArray(value)?[]:Object.create(Object.getPrototypeOf(value));seen.set(value,out);
 if(value instanceof Map){for(const [k,v] of value)out.set(k,clone(v,seen));return out;}
 if(value instanceof Set){for(const v of value)out.add(clone(v,seen));return out;}
 for(const key of Object.keys(value))out[key]=['context','_udt','_definition'].includes(key)?value[key]:clone(value[key],seen);
 return out;
}
export function installReplaySnapshots(){
 const proto=PineTS.prototype as any;if(proto.__replaySnapshots)return;proto.__replaySnapshots=true;
 const snapshot=proto._snapshotVarState,restore=proto._restoreVarState;
 const execute=proto._executeIterations;
 proto._executeIterations=async function(ctx:any,fn:Function,start:number,end:number){
  const time=this.data[start]?.openTime;
  if(Number.isFinite(time))for(const p of Object.values(ctx.plots) as any[])if(Array.isArray(p.data)&&p.data.at(-1)?.time>=time)p.data=p.data.filter((d:any)=>d.time<time);
  // runPretranspiled skips PineTS' pre-last snapshot. Without one its
  // updateTail fallback removes market data twice. Capture it explicitly.
  if(ctx.isSecondaryContext&&!ctx._varSnapshot&&end>start){
   if(end-start>1)await execute.call(this,ctx,fn,start,end-1);
   ctx._varSnapshot=this._snapshotVarState(ctx);
   return execute.call(this,ctx,fn,end-1,end);
  }
  return execute.call(this,ctx,fn,start,end);
 };
 proto._snapshotVarState=function(ctx:any){
  const state=snapshot.call(this,ctx),seen=new Map<any,any>();seen.set(ctx,ctx);
  for(const helper of ctx._drawingHelpers)seen.set(helper,helper);
  // Clone all last values with one graph map, preserving shared references.
  for(const container of [state.main,...state.lctx])for(const scope of Object.values(container) as any[])for(const v of Object.values(scope) as any[])v.lastVal=clone(v.lastVal,seen);
  state.replayArrays=[ctx,...ctx.lctx.values()].map((container:any)=>Object.fromEntries(['const','var','let','params'].map(scope=>[scope,Object.fromEntries(Object.entries(container[scope]||{}).filter(([,v])=>Array.isArray(v)).map(([key,v]:any)=>[key,{len:v.length,lastVal:clone(v.at(-1),seen)}]))])));
  state.replayScopeKeys=[ctx,...ctx.lctx.values()].map((container:any)=>Object.fromEntries(['const','var','let','params'].map(scope=>[scope,Object.keys(container[scope]||{})])));state.replayLctxKeys=[...ctx.lctx.keys()];
  state.replayHelpers=ctx._drawingHelpers.map((helper:any)=>Object.fromEntries(Object.keys(helper).filter(k=>k!=='context').map(k=>[k,clone(helper[k],seen)])));
  state.replayTA=clone(ctx.taState,seen);return state;
 };
 proto._restoreVarState=function(ctx:any,state:any){
  if(!state?.replayHelpers)return restore.call(this,ctx,state);
  const seen=new Map<any,any>();seen.set(ctx,ctx);for(const helper of ctx._drawingHelpers)seen.set(helper,helper);
  const next=clone(state,seen);for(const key of ctx.lctx.keys())if(!next.replayLctxKeys.includes(key))ctx.lctx.delete(key);
  [ctx,...ctx.lctx.values()].forEach((container:any,i:number)=>{for(const scope of ['const','var','let','params'])for(const key of Object.keys(container[scope]||{}))if(!next.replayScopeKeys[i]?.[scope]?.includes(key))delete container[scope][key];});
  restore.call(this,ctx,next);
  [ctx,...ctx.lctx.values()].forEach((container:any,i:number)=>{for(const [scope,values] of Object.entries(next.replayArrays[i]||{}) as [string,any][])for(const [key,v] of Object.entries(values) as [string,any][]){const array=container[scope]?.[key];if(Array.isArray(array)){array.length=v.len;if(v.len)array[v.len-1]=v.lastVal;}}});
  next.replayHelpers.forEach((values:any,i:number)=>Object.assign(ctx._drawingHelpers[i],values));ctx.taState=next.replayTA;
 };
}
