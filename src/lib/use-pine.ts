'use client';
import {useEffect,useRef,useState} from 'react';
import type {Bar} from './engine';
import type {PinePlot} from '../components/replay-chart';
type ScriptJob={id:string;name:string;source:string};
type Job={id:number;source:string;bars:Bar[];seconds:number;scripts?:ScriptJob[]};
export function usePine(source:string|undefined,enabled:boolean|undefined,bars:Bar[],seconds:number,sessionId:string|undefined,scripts?:ScriptJob[]){
 const [plots,setPlots]=useState<PinePlot[]>([]);const [status,setStatus]=useState('');const [error,setError]=useState('');
 const latest=useRef<Job|null>(null);const counter=useRef(0);const dispatch=useRef<(()=>void)|null>(null);const lastTime=useRef(0);
 useEffect(()=>{
  setPlots([]);setError('');setStatus('');lastTime.current=0;latest.current=null;
  if(!enabled||(!source&&!scripts?.length))return;
  let worker:Worker;
  try{worker=new Worker(new URL('./pine.worker.ts',import.meta.url),{type:'module'})}catch(e){setError(e instanceof Error?e.message:'Pine runtime ไม่พร้อม');return;}
  let active:Job|null=null;let completed=0;let deadline:ReturnType<typeof setTimeout>|undefined;let dead=false;
  function send(){
   if(dead||active||!latest.current||completed===latest.current.id)return;
   active=latest.current;setStatus('กำลังคำนวณ');
   deadline=setTimeout(()=>{dead=true;worker.terminate();setStatus('');setError('สคริปต์ใช้เวลานานเกิน 10 วินาที ลองลดความซับซ้อนแล้ว Run อีกครั้ง')},10000);
   worker.postMessage(active);
  }
  dispatch.current=send;
  worker.onmessage=e=>{
   if(dead)return;clearTimeout(deadline);const result=e.data;completed=result.id;active=null;
   if(result.error){setError(result.error);setStatus('');setPlots([]);dead=true;worker.terminate();return;}
   // Only publish the current calculation; an earlier result cannot overwrite a rewind.
   if(result.id===latest.current?.id){setPlots(result.plots);setError('');setStatus(result.warnings?.join(' · ')||'Pine พร้อมใช้งาน');}
   send();
  };
  worker.onerror=e=>{dead=true;clearTimeout(deadline);setError(e.message||'Pine runtime ไม่พร้อม');setStatus('');worker.terminate();};
  send();
  return()=>{dead=true;dispatch.current=null;clearTimeout(deadline);worker.terminate()};
 },[source,enabled,seconds,sessionId,JSON.stringify(scripts?.map(s=>[s.id,s.name,s.source]))]);
 useEffect(()=>{
  if(!enabled||(!source&&!scripts?.length)||!bars.length){latest.current=null;setPlots([]);return;}
  const time=bars.at(-1)!.time;lastTime.current=time;
  latest.current={id:++counter.current,source,bars,seconds,scripts};dispatch.current?.();
 },[bars,source,enabled,seconds,sessionId,JSON.stringify(scripts?.map(s=>[s.id,s.source]))]);
 return {plots,status,error};
}
