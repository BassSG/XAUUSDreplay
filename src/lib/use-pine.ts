import {useEffect,useRef,useState} from 'react';
import type {Bar,CandleCalendar} from './engine';
import type {ScriptJob} from './pine.worker';
import type {PinePlot,PineShape,PineDrawing,PineTable} from '../components/replay-chart';
export type StudyStatus={id:string;name:string;inputs:any[];error:string;bridge:boolean;ms:number};
type Job={id:number;key:string;source:string;bars:Bar[];baseBars:Bar[];seconds:number;baseSeconds:number;calendar:CandleCalendar;scripts?:ScriptJob[];bundled:boolean};
type Snapshot={key:string;plots:PinePlot[];shapes:PineShape[];drawings:PineDrawing[];tables:PineTable[];studies:StudyStatus[]};
const empty:Snapshot={key:'',plots:[],shapes:[],drawings:[],tables:[],studies:[]};
function hash(s:string){let h=2166136261;for(let i=0;i<s.length;i++)h=Math.imul(h^s.charCodeAt(i),16777619);return (h>>>0).toString(36)+':'+s.length;}
export function usePine(source:string|undefined,enabled:boolean|undefined,bars:Bar[],seconds:number,sessionId:string|undefined,scripts?:ScriptJob[],baseBars:Bar[]=bars,baseSeconds=seconds,calendar:CandleCalendar='utc',bundled=false){
 const [snapshot,setSnapshot]=useState(empty),[status,setStatus]=useState(''),[error,setError]=useState(''),[run,setRun]=useState(0);
 const [metadata,setMetadata]=useState<StudyStatus[]>([]);
 const latest=useRef<Job|null>(null),counter=useRef(0),dispatch=useRef<(()=>void)|null>(null);
 const scriptKey=hash(JSON.stringify(scripts?.length?scripts:source)??'');
 const key=[sessionId,seconds,baseSeconds,calendar,bars[0]?.time,baseBars[0]?.time,bars.length,baseBars.length,JSON.stringify(bars.at(-1)),scriptKey,run].join('|');
 const expected=useRef(key);expected.current=key;
 const needed=!!enabled&&!!(source||scripts?.length);
 useEffect(()=>{
  setSnapshot(empty);setError('');setStatus('');latest.current=null;if(!needed)return;
  const worker=new Worker(new URL('./pine.worker.ts',import.meta.url),{type:'module'});
  let active:Job|null=null,completed=0,dead=false,deadline:ReturnType<typeof setTimeout>|undefined;
  const arm=()=>{clearTimeout(deadline);deadline=setTimeout(()=>{dead=true;worker.terminate();setSnapshot(empty);setStatus('');setError('คำนวณอินดิเคเตอร์นานเกิน 180 วินาที กด Retry หรือปรับการตั้งค่าอินดิเคเตอร์')},180000)};
  function send(){if(dead||active||!latest.current||completed===latest.current.id)return;active=latest.current;setError('');setStatus('กำลังคำนวณ Pine');arm();worker.postMessage(active);}
  dispatch.current=send;
  worker.onmessage=e=>{
   if(dead)return;const result=e.data;
   if(result.progress){arm();if(result.metadata)setMetadata(old=>[...old.filter(m=>m.id!==result.metadata.id),result.metadata]);if(active?.key===expected.current)setStatus('กำลังคำนวณ '+result.progress);return;}
   clearTimeout(deadline);const finished=active;active=null;completed=result.id;
   if(finished?.key===expected.current){
    setSnapshot({key:finished.key,plots:result.plots||[],shapes:result.shapes||[],drawings:result.drawings||[],tables:result.tables||[],studies:result.studies||[]});
    setMetadata(result.studies||[]);
    setError((result.errors||[]).join(' · '));setStatus((result.warnings||[]).join(' · ')||(result.errors?.length?'บางอินดิเคเตอร์มีข้อผิดพลาด':'Pine พร้อมใช้งาน'));
   }send();
  };
  worker.onerror=e=>{dead=true;clearTimeout(deadline);worker.terminate();setSnapshot(empty);setError(e.message||'Pine runtime ไม่พร้อม');setStatus('');};
  return()=>{dead=true;dispatch.current=null;clearTimeout(deadline);worker.terminate()};
 },[needed,sessionId,seconds,baseSeconds,calendar,run,scriptKey]);
 useEffect(()=>{
  if(!needed||!bars.length){latest.current=null;setSnapshot(empty);return;}
  latest.current={id:++counter.current,key,source:source||'',bars,baseBars,seconds,baseSeconds,calendar,scripts,bundled};dispatch.current?.();
 },[key,needed,bars,baseBars]);
 // Never render a result from another cursor, including an older computation
 // of the SAME partially formed hourly candle after a rewind.
 const valid=needed&&snapshot.key===key;const current=valid?snapshot:empty;
 return {...current,studies:metadata,status,error,calculating:needed&&!valid&&!error,retry:()=>setRun(v=>v+1)};
}
