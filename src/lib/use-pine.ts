import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {createLivePineWorker} from './live-pine-worker';
import {createPineHistoryLoader} from './live-feed';
import type {LivePineFrame,PineHistoryQuery} from './live-pine';
import type {Bar,CandleCalendar} from './engine';
import type {ScriptJob} from './pine.worker';
import type {IPineInput} from 'pinets';
import type {PineBand} from './pine-bands';
import type {PinePlot,PineShape,PineDrawing,PineTable} from '../components/replay-chart';
export type StudyStatus={id:string;name:string;inputs:IPineInput[];error:string;bridge:boolean;ms:number;mode?:'initial'|'incremental'};
type Job={id:number;key:string;source:string;bars:Bar[];baseBars:Bar[];seconds:number;baseSeconds:number;calendar:CandleCalendar;scripts?:ScriptJob[];bundled:boolean;plotLimit:number;live?:LivePineFrame};
type Snapshot={key:string;plots:PinePlot[];fills:PineBand[];shapes:PineShape[];drawings:PineDrawing[];tables:PineTable[];studies:StudyStatus[];errors:string[];warnings:string[]};
const empty:Snapshot={key:'',plots:[],fills:[],shapes:[],drawings:[],tables:[],studies:[],errors:[],warnings:[]};
function mergePartial(previous:Snapshot, current:Snapshot):Snapshot {
 const updated=new Set(current.studies.map(study=>study.id));
 function merge<T extends {indicatorId?:string}>(old:T[],fresh:T[]){
  return [...fresh,...old.filter(item=>!updated.has(item.indicatorId??'legacy'))];
 }
 return {...current,plots:merge(previous.plots,current.plots),fills:merge(previous.fills,current.fills),shapes:merge(previous.shapes,current.shapes),
  drawings:merge(previous.drawings,current.drawings),tables:merge(previous.tables,current.tables)};
}
function hash(s:string){let h=2166136261;for(let i=0;i<s.length;i++)h=Math.imul(h^s.charCodeAt(i),16777619);return (h>>>0).toString(36)+':'+s.length;}
function frameKey(scope:string,bars:Bar[],baseBars:Bar[],live?:LivePineFrame,revision=0){return [scope,bars.length,baseBars.length,JSON.stringify(bars.at(-1)),JSON.stringify(baseBars.at(-1)),live?.asOf,revision].join('|');}
export function usePine(source:string|undefined,enabled:boolean|undefined,bars:Bar[],seconds:number,sessionId:string|undefined,scripts?:ScriptJob[],baseBars:Bar[]=bars,baseSeconds=seconds,calendar:CandleCalendar='utc',bundled=false,live?:LivePineFrame, paused=false){
 const [,refresh]=useState(0),[error,setError]=useState(''),[run,setRun]=useState(0),[progress,setProgress]=useState({key:'',text:''});
 const [metadata,setMetadata]=useState<StudyStatus[]>([]);
 const frames=useRef(new Map<string,Snapshot>()),counter=useRef(0);
 const liveData=useRef<{bars:Bar[];minutes:Bar[];revision:number}|null>(null);
 const lastFinal=useRef<{scope:string;key:string}|null>(null);
 const pauseWork=useRef<(()=>void)|null>(null);
 const lastLive=useRef<{scope:string;through:number;frame:Snapshot}|null>(null);
 const completedLive=useRef<{scope:string;frame:Snapshot}|null>(null);
 const loadHistory=useMemo(createPineHistoryLoader,[]);
 // The broker can revise earlier OHLC without changing the length or last candle.
 if(live && (liveData.current?.bars!==bars || liveData.current.minutes!==live.minutes)){
  liveData.current={bars,minutes:live.minutes,revision:(liveData.current?.revision??0)+1};
 }
 const revision=live?liveData.current!.revision:0;
 const request=useRef<((job:Job)=>Promise<boolean>)|null>(null);
 const scriptKey=useMemo(()=>hash(JSON.stringify(scripts?.length?scripts:source)??''),[scripts,source]);
 // A Live history prepend queues a new snapshot without cancelling work on
 // the already loaded bars. Replay still keys caches by the revealed start.
 const replayStart=live?'':[bars[0]?.time,baseBars[0]?.time].join(':');
 const scope=[sessionId,seconds,baseSeconds,calendar,bundled,!!live,replayStart,scriptKey,run].join('|');
 const key=frameKey(scope,bars,baseBars,live,revision),expected=useRef(key);expected.current=key;
 const needed=!!enabled&&!!(source||scripts?.length);
 const params=useRef({scope,source:source||'',seconds,baseSeconds,calendar,scripts,bundled,needed,live,revision,paused});params.current={scope,source:source||'',seconds,baseSeconds,calendar,scripts,bundled,needed,live,revision,paused};
 useEffect(()=>{
  frames.current.clear();lastFinal.current=null;lastLive.current=null;completedLive.current=null;refresh(v=>v+1);setError('');setProgress({key:'',text:''});setMetadata([]);if(!needed)return;
  let worker: ReturnType<typeof createLivePineWorker> | Worker | undefined;
  let historyAbort=new AbortController();
  type Task={job:Job;resolve:((ready:boolean)=>void)[]};
  const queue:Task[]=[];let active:Task|null=null,dead=false,deadline:ReturnType<typeof setTimeout>|undefined;
  function fail(message:string){dead=true;clearTimeout(deadline);historyAbort.abort();worker?.terminate();setError(message);active?.resolve.forEach(resolve=>resolve(false));for(const task of queue)task.resolve.forEach(resolve=>resolve(false));active=null;queue.length=0;}
  const arm=()=>{clearTimeout(deadline);deadline=setTimeout(()=>fail('ตัวประมวลผล Pine ไม่ตอบสนอง 180 วินาที กด Retry เพื่อลองใหม่'),180000)};
  function send(){
   if(dead||active||!queue.length||params.current.paused)return;
   if(!worker){
    worker=params.current.live?createLivePineWorker():new Worker(new URL('./pine.worker.ts',import.meta.url),{type:'module'});
    worker.onmessage=onMessage;
    worker.onerror=onError;
   }
   active=queue.shift()!;arm();worker.postMessage(active.job);
  }
  pauseWork.current=()=>{
   for(const task of queue.splice(0))task.resolve.forEach(resolve=>resolve(false));
   if(!active)return;
   active.resolve.forEach(resolve=>resolve(false));
   active=null;
   clearTimeout(deadline);
   historyAbort.abort();historyAbort=new AbortController();
   worker?.terminate();worker=undefined;
  };
  request.current=job=>{
   if(dead||params.current.paused)return Promise.resolve(false);
   const cached=frames.current.get(job.key);if(cached)return Promise.resolve(!cached.errors.length);
   if(job.key===expected.current)for(let i=queue.length-1;i>=0;i--)if(queue[i].job.key!==job.key){queue[i].resolve.forEach(resolve=>resolve(false));queue.splice(i,1);}
   return new Promise(resolve=>{const pending=active?.job.key===job.key?active:queue.find(t=>t.job.key===job.key);if(pending)pending.resolve.push(resolve);else queue.push({job,resolve:[resolve]});send();});
  };
  function onMessage(e:MessageEvent){
   if(dead||!active||active.job.id!==e.data.id)return;const result=e.data;
   if(result.historyRequest&&active.job.live?.nativeHistory){
    const {number,query}=result.historyRequest as {number:number;query:PineHistoryQuery};
    if(!Number.isSafeInteger(number)||!query||typeof query!=='object')return;
    const job=active.job;
    arm();
    void loadHistory(query,active.job.live.asOf,historyAbort.signal,active.job.live.replay).catch(()=>[]).then(bars=>{
     if(!dead&&active?.job===job)worker?.postMessage({historyResponse:{number,bars}});
    });
    return;
   }
   if(result.progress){arm();if(result.metadata)setMetadata(old=>[...old.filter(m=>m.id!==result.metadata.id),result.metadata]);
    if(active.job.live||active.job.key===expected.current)setProgress({key:active.job.key,text:'กำลังคำนวณ '+result.progress});return;}
   const finished=active;
   const frame:Snapshot={key:finished.job.key,plots:result.plots||[],fills:result.fills||[],shapes:result.shapes||[],drawings:result.drawings||[],tables:result.tables||[],studies:result.studies||[],errors:result.errors||[],warnings:result.warnings||[]};
   if(result.partial){
    if(!finished.job.live)return;
    arm();
    const previous=lastLive.current;
    const through=finished.job.live.asOf;
    const visible=previous?.scope===scope&&previous.through<=through?mergePartial(previous.frame,frame):frame;
    lastLive.current={scope,through,frame:visible};
    completedLive.current={scope,frame};
    refresh(v=>v+1);
    return;
   }
   clearTimeout(deadline);active=null;
   // Prepared frames stay private until the replay cursor selects their exact key.
   frames.current.set(frame.key,frame);
   if(finished.job.live){lastFinal.current={scope,key:frame.key};completedLive.current={scope,frame};lastLive.current={scope,through:finished.job.live.asOf,frame};}
   const points=()=>[...frames.current.values()].reduce((n,f)=>n+f.plots.reduce((sum,p)=>sum+p.data.length,0),0);
   while(frames.current.size>(finished.job.live?2:6)||frames.current.size>2&&points()>400000){const oldest=[...frames.current.keys()].find(k=>k!==expected.current&&k!==frame.key);if(!oldest)break;frames.current.delete(oldest);}
   if(finished.job.live||frame.key===expected.current)refresh(v=>v+1);finished.resolve.forEach(resolve=>resolve(!frame.errors.length));send();
  };
  const onError=(e:{message:string})=>fail(e.message||'Pine runtime ไม่พร้อม');
  return()=>{dead=true;request.current=null;pauseWork.current=null;clearTimeout(deadline);historyAbort.abort();worker?.terminate();active?.resolve.forEach(resolve=>resolve(false));for(const task of queue)task.resolve.forEach(resolve=>resolve(false));};
 },[needed,scope,loadHistory]);
 const prepare=useCallback((nextBars:Bar[],nextBaseBars:Bar[])=>{
  const p=params.current;if(!p.needed)return Promise.resolve(true);
  if(!request.current||!nextBars.length)return Promise.resolve(false);
  return request.current({id:++counter.current,key:frameKey(p.scope,nextBars,nextBaseBars,p.live,p.revision),source:p.source,bars:nextBars,baseBars:nextBaseBars,seconds:p.seconds,baseSeconds:p.baseSeconds,calendar:p.calendar,scripts:p.scripts,bundled:p.bundled,plotLimit:p.live?0:2000,live:p.live});
 },[]);
 useEffect(()=>{if(paused)pauseWork.current?.();else if(needed&&bars.length)void prepare(bars,baseBars);},[key,needed,paused,prepare]);
 // No older or prefetched result can leak into a rewind or a forming candle.
 const current=needed?frames.current.get(key)??empty:empty,valid=current.key===key;
 const frameError=current.errors.join(' · ')||error;
 const status=!needed?'':valid?(current.warnings.join(' · ')||(frameError?'บางอินดิเคเตอร์มีข้อผิดพลาด':'Pine พร้อมใช้งาน')):(progress.key===key||live&&progress.text)?progress.text:'กำลังเตรียมอินดิเคเตอร์';
 const previous=lastLive.current;
 const display=needed&&!valid&&live&&previous?.scope===scope&&previous.through<=live.asOf?previous.frame:current;
 const completed=completedLive.current?.scope===scope?completedLive.current.frame:current;
 const evaluatedIds=new Set(completed.studies.map(study=>study.id));
 const studies=valid?current.studies:[...completed.studies,...metadata.filter(study=>!evaluatedIds.has(study.id))];
 return {...display,settled:lastFinal.current?.scope===scope,settledKey:lastFinal.current?.scope===scope?lastFinal.current.key:undefined,key:current.key,requestedKey:key,completed,studies,status,error:frameError,calculating:needed&&!valid&&!error,prepare,retry:()=>setRun(v=>v+1)};
}
