import {useMemo,useState,useEffect} from 'react';
import type {Bar} from './engine';
import {livePlots,studyLabel,type LiveStudy,type LiveStudyBadge} from './live-indicators';
import {periods,type Period} from './live-market';
import {nextBackground,type BackgroundWork} from './live-study-schedule';
import {usePine} from './use-pine';
import type {InlineReplay} from './use-inline-replay';
import type {ScriptJob} from './pine.worker';

const empty:Bar[]=[];
type Options={replay:InlineReplay;period:Period;grid:boolean;studies:LiveStudy[];
  lengths:Partial<Record<LiveStudy,number>>;jobs:ScriptJob[];testing:boolean};
function useReplayChartFrame(period:Period,options:Options,background?:Period){
  const {replay,studies,lengths,jobs}=options;
  const frame=replay.frames[period];
  const bars=frame?.bars??empty,revealed=frame?.revealed??empty;
  const run=!replay.picking&&(options.period===period||background===period);
  const pine=usePine(undefined,Boolean(replay.id && jobs.length),bars,periods[period],
    replay.id?'inline-replay:'+replay.id+':'+period:undefined,jobs,revealed,periods[replay.base??period],'eightcap',
    false,{asOf:frame?.asOf??0,minutes:replay.base==='1m'?revealed:empty,nativeHistory:true,replay:true},!run);
  const builtIn=useMemo(()=>livePlots(bars,studies,lengths),[bars,studies,lengths]);
  const plots=useMemo(()=>[...builtIn,...pine.plots],[builtIn,pine.plots]);
  const badges:LiveStudyBadge[]=studies.map(study=>({
    id:'live-'+study,label:studyLabel(study,lengths),state:bars.length?'ready':'loading',
  }));
  for(const job of jobs){
    const result=pine.completed.key===pine.requestedKey && pine.completed.studies.find(study=>study.id===job.id);
    badges.push({id:job.id,label:job.name,state:result?result.error?'error':'ready':pine.error?'error':'loading'});
  }
  const supported=!replay.base||periods[period]>=periods[replay.base];
  const ready=!supported||!jobs.length||Boolean(pine.error)||pine.settledKey===pine.requestedKey;
  const stale=supported&&Boolean(frame)&&!ready;
  return {bars,pine,plots,badges,ready,stale,settledKey:pine.settledKey};
}
export function useReplayChartFrames(options:Options){
  const [plan,setPlan]=useState<{id:number;period:Period;work:BackgroundWork}|null>(null);
  const running=options.replay.active&&!options.replay.picking&&options.grid&&!options.testing;
  const current=running&&plan&&plan.id===options.replay.id&&plan.period===options.period?plan.work:null;
  const background=current?.period;
  const frames={
    '1m':useReplayChartFrame('1m',options,background),'5m':useReplayChartFrame('5m',options,background),
    '15m':useReplayChartFrame('15m',options,background),'1h':useReplayChartFrame('1h',options,background),
    '4h':useReplayChartFrame('4h',options,background),'1d':useReplayChartFrame('1d',options,background),
  };
  useEffect(()=>{
    const work=running?nextBackground(options.period,frames,false,current):null;
    if(work===current&&(current||!plan))return;
    setPlan(work&&options.replay.id?{id:options.replay.id,period:options.period,work}:null);
  });
  return frames;
}
export type InlineReplayChartFrame=ReturnType<typeof useReplayChartFrame>;
