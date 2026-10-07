import {useCallback,useEffect,useRef,useState} from 'react';
import type {Bar,CandleCalendar} from './engine';
import type {ScriptJob} from './pine.worker';
import type {PinePlot,PineShape,PineDrawing,PineTable} from '../components/replay-chart';
export type StudyStatus={id:string;name:string;inputs:any[];error:string;bridge:boolean;ms:number;mode?:'initial'|'incremental'};
type Job={id:number;key:string;source:string;bars:Bar[];baseBars:Bar[];seconds:number;baseSeconds:number;calendar:CandleCalendar;scripts?:ScriptJob[];bundled:boolean};
type Snapshot={key:string;plots:PinePlot[];shapes:PineShape[];drawings:PineDrawing[];tables:PineTable[];studies:StudyStatus[];errors:string[];warnings:string[]};
const empty:Snapshot={key:'',plots:[],shapes:[],drawings:[],tables:[],studies:[],errors:[],warnings:[]};
function hash(s:string){let h=2166136261;for(let i=0;i<s.length;i++)h=Math.imul(h^s.charCodeAt(i),16777619);return (h>>>0).toString(36)+':'+s.length;}
function frameKey(scope:string,bars:Bar[],baseBars:Bar[]){return [scope,bars.length,baseBars.length,JSON.stringify(bars.at(-1)),JSON.stringify(baseBars.at(-1))].join('|');}
export function usePine(source:string|undefined,enabled:boolean|undefined,bars:Bar[],seconds:number,sessionId:string|undefined,scripts?:ScriptJob[],baseBars:Bar[]=bars,baseSeconds=seconds,calendar:CandleCalendar='utc',bundled=false){
 const [,refresh]=useState(0),[error,setError]=useState(''),[run,setRun]=useState(0),[progress,setProgress]=useState({key:'',text:''});
 const [metadata,setMetadata]=useState<StudyStatus[]>([]);
 const frames=useRef(new Map<string,Snapshot>()),counter=useRef(0);
 const request=useRef<((job:Job)=>Promise<boolean>)|null>(null);
 const scriptKey=hash(JSON.stringify(scripts?.length?scripts:source)??'');
 const scope=[sessionId,seconds,baseSeconds,calendar,bundled,bars[0]?.time,baseBars[0]?.time,scriptKey,run].join('|');
 const key=frameKey(scope,bars,baseBars),expected=useRef(key);expected.current=key;
 const needed=!!enabled&&!!(source||scripts?.length);
 const params=useRef({scope,source:source||'',seconds,baseSeconds,calendar,scripts,bundled,needed});params.current={scope,source:source||'',seconds,baseSeconds,calendar,scripts,bundled,needed};
 useEffect(()=>{
  frames.current.clear();refresh(v=>v+1);setError('');setProgress({key:'',text:''});setMetadata([]);if(!needed)return;
  const worker=new Worker(new URL('./pine.worker.ts',import.meta.url),{type:'module'});
  type Task={job:Job;resolve:((ready:boolean)=>void)[]};
  const queue:Task[]=[];let active:Task|null=null,dead=false,deadline:ReturnType<typeof setTimeout>|undefined;
  function fail(message:string){dead=true;clearTimeout(deadline);worker.terminate();setError(message);active?.resolve.forEach(resolve=>resolve(false));for(const task of queue)task.resolve.forEach(resolve=>resolve(false));active=null;queue.length=0;}
  const arm=()=>{clearTimeout(deadline);deadline=setTimeout(()=>fail('คำนวณอินดิเคเตอร์นานเกิน 180 วินาที กด Retry หรือปรับการตั้งค่าอินดิเคเตอร์'),180000)};
  function send(){if(dead||active||!queue.length)return;active=queue.shift()!;arm();worker.postMessage(active.job);}
  request.current=job=>{
   if(dead)return Promise.resolve(false);
   const cached=frames.current.get(job.key);if(cached)return Promise.resolve(!cached.errors.length);
   if(job.key===expected.current)for(let i=queue.length-1;i>=0;i--)if(queue[i].job.key!==job.key){queue[i].resolve.forEach(resolve=>resolve(false));queue.splice(i,1);}
   return new Promise(resolve=>{const pending=active?.job.key===job.key?active:queue.find(t=>t.job.key===job.key);if(pending)pending.resolve.push(resolve);else queue.push({job,resolve:[resolve]});send();});
  };
  worker.onmessage=e=>{
   if(dead||!active||active.job.id!==e.data.id)return;const result=e.data;
   if(result.progress){arm();if(active.job.key===expected.current){if(result.metadata)setMetadata(old=>[...old.filter(m=>m.id!==result.metadata.id),result.metadata]);setProgress({key:active.job.key,text:'กำลังคำนวณ '+result.progress});}return;}
   clearTimeout(deadline);const finished=active;active=null;
   // Prepared frames stay private until the replay cursor selects their exact key.
   const frame:Snapshot={key:finished.job.key,plots:result.plots||[],shapes:result.shapes||[],drawings:result.drawings||[],tables:result.tables||[],studies:result.studies||[],errors:result.errors||[],warnings:result.warnings||[]};
   frames.current.set(frame.key,frame);
   const points=()=>[...frames.current.values()].reduce((n,f)=>n+f.plots.reduce((sum,p)=>sum+p.data.length,0),0);
   while(frames.current.size>6||frames.current.size>2&&points()>400000){const oldest=[...frames.current.keys()].find(k=>k!==expected.current&&k!==frame.key);if(!oldest)break;frames.current.delete(oldest);}
   if(frame.errors.length)setError(frame.errors.join(' · '));
   if(frame.key===expected.current)refresh(v=>v+1);finished.resolve.forEach(resolve=>resolve(!frame.errors.length));send();
  };
  worker.onerror=e=>fail(e.message||'Pine runtime ไม่พร้อม');
  return()=>{dead=true;request.current=null;clearTimeout(deadline);worker.terminate();active?.resolve.forEach(resolve=>resolve(false));for(const task of queue)task.resolve.forEach(resolve=>resolve(false));};
 },[needed,scope]);
 const prepare=useCallback((nextBars:Bar[],nextBaseBars:Bar[])=>{
  const p=params.current;if(!p.needed)return Promise.resolve(true);
  if(!request.current||!nextBars.length)return Promise.resolve(false);
  return request.current({id:++counter.current,key:frameKey(p.scope,nextBars,nextBaseBars),source:p.source,bars:nextBars,baseBars:nextBaseBars,seconds:p.seconds,baseSeconds:p.baseSeconds,calendar:p.calendar,scripts:p.scripts,bundled:p.bundled});
 },[]);
 useEffect(()=>{if(needed&&bars.length)void prepare(bars,baseBars);},[key,needed,prepare]);
 // No older or prefetched result can leak into a rewind or a forming candle.
 const current=needed?frames.current.get(key)??empty:empty,valid=current.key===key;
 const frameError=current.errors.join(' · ')||error;
 const status=!needed?'':valid?(current.warnings.join(' · ')||(frameError?'บางอินดิเคเตอร์มีข้อผิดพลาด':'Pine พร้อมใช้งาน')):progress.key===key?progress.text:'กำลังเตรียมอินดิเคเตอร์';
 return {...current,studies:valid?current.studies:metadata,status,error:frameError,calculating:needed&&!valid&&!error,prepare,retry:()=>setRun(v=>v+1)};
}
