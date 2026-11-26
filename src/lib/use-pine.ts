import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {createLivePineWorker} from './live-pine-worker';
import {createPineHistoryLoader} from './live-feed';
import type {LivePineFrame,PineHistoryQuery} from './live-pine';
import type {Bar,CandleCalendar} from './engine';
import type {ScriptJob} from './pine.worker';
import type {PinePlot,PineShape,PineDrawing,PineTable} from '../components/replay-chart';
export type StudyStatus={id:string;name:string;inputs:any[];error:string;bridge:boolean;ms:number;mode?:'initial'|'incremental'};
type Job={id:number;key:string;source:string;bars:Bar[];baseBars:Bar[];seconds:number;baseSeconds:number;calendar:CandleCalendar;scripts?:ScriptJob[];bundled:boolean;plotLimit:number;live?:LivePineFrame};
type Snapshot={key:string;plots:PinePlot[];shapes:PineShape[];drawings:PineDrawing[];tables:PineTable[];studies:StudyStatus[];errors:string[];warnings:string[]};
const empty:Snapshot={key:'',plots:[],shapes:[],drawings:[],tables:[],studies:[],errors:[],warnings:[]};
function hash(s:string){let h=2166136261;for(let i=0;i<s.length;i++)h=Math.imul(h^s.charCodeAt(i),16777619);return (h>>>0).toString(36)+':'+s.length;}
function frameKey(scope:string,bars:Bar[],baseBars:Bar[],live?:LivePineFrame,revision=0){return [scope,bars.length,baseBars.length,JSON.stringify(bars.at(-1)),JSON.stringify(baseBars.at(-1)),live?.asOf,revision].join('|');}
export function usePine(source:string|undefined,enabled:boolean|undefined,bars:Bar[],seconds:number,sessionId:string|undefined,scripts?:ScriptJob[],baseBars:Bar[]=bars,baseSeconds=seconds,calendar:CandleCalendar='utc',bundled=false,live?:LivePineFrame){
 const [,refresh]=useState(0),[error,setError]=useState(''),[run,setRun]=useState(0),[progress,setProgress]=useState({key:'',text:''});
 const [metadata,setMetadata]=useState<StudyStatus[]>([]);
 const frames=useRef(new Map<string,Snapshot>()),counter=useRef(0);
 const liveData=useRef<{bars:Bar[];minutes:Bar[];revision:number}|null>(null);
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
 const scope=[sessionId,seconds,baseSeconds,calendar,bundled,!!live,bars[0]?.time,baseBars[0]?.time,scriptKey,run].join('|');
 const key=frameKey(scope,bars,baseBars,live,revision),expected=useRef(key);expected.current=key;
 const needed=!!enabled&&!!(source||scripts?.length);
 const params=useRef({scope,source:source||'',seconds,baseSeconds,calendar,scripts,bundled,needed,live,revision});params.current={scope,source:source||'',seconds,baseSeconds,calendar,scripts,bundled,needed,live,revision};
 useEffect(()=>{
  frames.current.clear();lastLive.current=null;completedLive.current=null;refresh(v=>v+1);setError('');setProgress({key:'',text:''});setMetadata([]);if(!needed)return;
  const worker=params.current.live?createLivePineWorker():new Worker(new URL('./pine.worker.ts',import.meta.url),{type:'module'});
  const historyAbort=new AbortController();
  type Task={job:Job;resolve:((ready:boolean)=>void)[]};
  const queue:Task[]=[];let active:Task|null=null,dead=false,deadline:ReturnType<typeof setTimeout>|undefined;
  function fail(message:string){dead=true;clearTimeout(deadline);historyAbort.abort();worker.terminate();setError(message);active?.resolve.forEach(resolve=>resolve(false));for(const task of queue)task.resolve.forEach(resolve=>resolve(false));active=null;queue.length=0;}
  const arm=()=>{clearTimeout(deadline);deadline=setTimeout(()=>fail('ตัวประมวลผล Pine ไม่ตอบสนอง 180 วินาที กด Retry เพื่อลองใหม่'),180000)};
  function send(){if(dead||active||!queue.length)return;active=queue.shift()!;arm();worker.postMessage(active.job);}
  request.current=job=>{
   if(dead)return Promise.resolve(false);
   const cached=frames.current.get(job.key);if(cached)return Promise.resolve(!cached.errors.length);
   if(job.key===expected.current)for(let i=queue.length-1;i>=0;i--)if(queue[i].job.key!==job.key){queue[i].resolve.forEach(resolve=>resolve(false));queue.splice(i,1);}
   return new Promise(resolve=>{const pending=active?.job.key===job.key?active:queue.find(t=>t.job.key===job.key);if(pending)pending.resolve.push(resolve);else queue.push({job,resolve:[resolve]});send();});
  };
  worker.onmessage=e=>{
   if(dead||!active||active.job.id!==e.data.id)return;const result=e.data;
   if(result.historyRequest&&active.job.live?.nativeHistory){
    const {number,query}=result.historyRequest as {number:number;query:PineHistoryQuery};
    if(!Number.isSafeInteger(number)||!query||typeof query!=='object')return;
    const job=active.job;
    arm();
    void loadHistory(query,active.job.live.asOf,historyAbort.signal).catch(()=>[]).then(bars=>{
     if(!dead&&active?.job===job)worker.postMessage({historyResponse:{number,bars}});
    });
    return;
   }
   if(result.progress){arm();if(result.metadata)setMetadata(old=>[...old.filter(m=>m.id!==result.metadata.id),result.metadata]);
    if(active.job.live||active.job.key===expected.current)setProgress({key:active.job.key,text:'กำลังคำนวณ '+result.progress});return;}
   clearTimeout(deadline);const finished=active;active=null;
   // Prepared frames stay private until the replay cursor selects their exact key.
   const frame:Snapshot={key:finished.job.key,plots:result.plots||[],shapes:result.shapes||[],drawings:result.drawings||[],tables:result.tables||[],studies:result.studies||[],errors:result.errors||[],warnings:result.warnings||[]};
   frames.current.set(frame.key,frame);
   if(finished.job.live){completedLive.current={scope,frame};if(!frame.errors.length)lastLive.current={scope,through:finished.job.live.asOf,frame};}
   const points=()=>[...frames.current.values()].reduce((n,f)=>n+f.plots.reduce((sum,p)=>sum+p.data.length,0),0);
   while(frames.current.size>6||frames.current.size>2&&points()>400000){const oldest=[...frames.current.keys()].find(k=>k!==expected.current&&k!==frame.key);if(!oldest)break;frames.current.delete(oldest);}
   if(finished.job.live||frame.key===expected.current)refresh(v=>v+1);finished.resolve.forEach(resolve=>resolve(!frame.errors.length));send();
  };
  worker.onerror=(e:{message:string})=>fail(e.message||'Pine runtime ไม่พร้อม');
  return()=>{dead=true;request.current=null;clearTimeout(deadline);historyAbort.abort();worker.terminate();active?.resolve.forEach(resolve=>resolve(false));for(const task of queue)task.resolve.forEach(resolve=>resolve(false));};
 },[needed,scope,loadHistory]);
 const prepare=useCallback((nextBars:Bar[],nextBaseBars:Bar[])=>{
  const p=params.current;if(!p.needed)return Promise.resolve(true);
  if(!request.current||!nextBars.length)return Promise.resolve(false);
  return request.current({id:++counter.current,key:frameKey(p.scope,nextBars,nextBaseBars,p.live,p.revision),source:p.source,bars:nextBars,baseBars:nextBaseBars,seconds:p.seconds,baseSeconds:p.baseSeconds,calendar:p.calendar,scripts:p.scripts,bundled:p.bundled,plotLimit:p.live?0:2000,live:p.live});
 },[]);
 useEffect(()=>{if(needed&&bars.length)void prepare(bars,baseBars);},[key,needed,prepare]);
 // No older or prefetched result can leak into a rewind or a forming candle.
 const current=needed?frames.current.get(key)??empty:empty,valid=current.key===key;
 const frameError=current.errors.join(' · ')||error;
 const status=!needed?'':valid?(current.warnings.join(' · ')||(frameError?'บางอินดิเคเตอร์มีข้อผิดพลาด':'Pine พร้อมใช้งาน')):(progress.key===key||live&&progress.text)?progress.text:'กำลังเตรียมอินดิเคเตอร์';
 const previous=lastLive.current;
 const display=needed&&!valid&&!frameError&&live&&previous?.scope===scope&&previous.through<=live.asOf?previous.frame:current;
 const completed=completedLive.current?.scope===scope?completedLive.current.frame:current;
 const studies=valid?current.studies:completed.key?completed.studies:metadata;
 return {...display,key:current.key,completed,studies,status,error:frameError,calculating:needed&&!valid&&!error,prepare,retry:()=>setRun(v=>v+1)};
}
