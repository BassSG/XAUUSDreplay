import type {Bar,IndicatorSpec} from './engine.ts';
import {sourceHash} from './builtin-indicators.ts';

export const focusBarCount=3000;
export const focusIds=['ebw-focus-all-indy','ebw-focus-fibo'] as const;

export function isFocusedIndicator(id?:string): boolean {
  return id===focusIds[0]||id===focusIds[1];
}

export async function installFocusedIndicators(saved:IndicatorSpec[],defaults:readonly IndicatorSpec[],
  previousSources:ReadonlySet<string>):Promise<IndicatorSpec[]> {
  const canonical=new Set(defaults.map(study=>study.id));
  const imported=saved.filter(study=>!canonical.has(study.id)&&!isFocusedIndicator(study.builtinId));
  const kept=await Promise.all(imported.map(async study=>{
    if(!study.enabled||!previousSources.size)return study;
    try {
      const normalized=study.source.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n').trimEnd();
      if(previousSources.has(await sourceHash(normalized)))return {...study,enabled:false};
    } catch { /* Keep custom indicators if hashing is unavailable. */ }
    return study;
  }));
  const managed=defaults.map(base=>{
    const current=saved.find(study=>study.id===base.id||study.builtinId===base.builtinId);
    return current?{...base,enabled:current.enabled,inputs:current.inputs}:base;
  });
  return [...managed,...kept];
}

// Keep a warm chart window per Focus script. Preserve its opening bar on
// incremental updates until the runtime needs to release older history.
export function focusedChartBars(bars:Bar[],previous?:Bar[]):Bar[] {
  if(bars.length<=focusBarCount)return bars;
  if(previous&&previous.length>=focusBarCount) {
    const index=bars.findIndex(bar=>bar.time===previous[0].time);
    if(index>=0&&bars.length-index>=focusBarCount&&bars.length-index<=focusBarCount+240)
      return index===0?bars:bars.slice(index);
  }
  return bars.slice(-focusBarCount);
}
