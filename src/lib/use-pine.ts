'use client';
import {useEffect,useRef,useState} from 'react';
import type {Bar,CandleCalendar} from './engine';
import type {PinePlot,PineShape,PineDrawing,PineTable} from '../components/replay-chart';
type ScriptJob={id:string;name:string;source:string};
type Job={id:number;source:string;bars:Bar[];baseBars:Bar[];seconds:number;baseSeconds:number;calendar:CandleCalendar;scripts?:ScriptJob[]};
export function usePine(source:string|undefined,enabled:boolean|undefined,bars:Bar[],seconds:number,sessionId:string|undefined,scripts?:ScriptJob[],baseBars:Bar[]=bars,baseSeconds:number=seconds,calendar:CandleCalendar='utc'){
 const [plots,setPlots]=useState<PinePlot[]>([]);const [shapes,setShapes]=useState<PineShape[]>([]);const [drawings,setDrawings]=useState<PineDrawing[]>([]);const [tables,setTables]=useState<PineTable[]>([]);const [status,setStatus]=useState('');const [error,setError]=useState('');
 const latest=useRef<Job|null>(null);const counter=useRef(0);const dispatch=useRef<(()=>void)|null>(null);
 const scriptKey=JSON.stringify(scripts?.map(s=>[s.id,s.name,s.source]));
 useEffect(()=>{
  setPlots([]);setShapes([]);setDrawings([]);setTables([]);setError('');setStatus('');latest.current=null;
  if(!enabled||(!source&&!scripts?.length))return;
  let worker:Worker;
  try{worker=new Worker(new URL('./pine.worker.ts',import.meta.url),{type:'module'})}catch(e){setError(e instanceof Error?e.message:'Pine runtime ไม่พร้อม');return;}
  let active:Job|null=null;let completed=0;let deadline:ReturnType<typeof setTimeout>|undefined;let dead=false;
  function send(){
   if(dead||active||!latest.current||completed===latest.current.id)return;
   active=latest.current;setStatus('กำลังคำนวณ Pine');
   deadline=setTimeout(()=>{dead=true;worker.terminate();setStatus('');setError('Pine Script ใช้เวลานานเกิน 30 วินาที กรุณาลดจำนวนแท่งหรือปิดอินดิเคเตอร์ที่ไม่ใช้')},30000);
   worker.postMessage(active);
  }
  dispatch.current=send;
  worker.onmessage=e=>{
   if(dead)return;clearTimeout(deadline);const result=e.data;completed=result.id;active=null;
   if(result.id===latest.current?.id){
    setPlots(result.plots||[]);setShapes(result.shapes||[]);setDrawings(result.drawings||[]);setTables(result.tables||[]);
    const errs=(result.errors||[]) as string[];setError(errs.join(' · '));
    const warn=(result.warnings||[]) as string[];setStatus(errs.length?(result.plots?.length||result.drawings?.length?'บางอินดิเคเตอร์มีข้อผิดพลาด':'Pine รันไม่สำเร็จ'):(warn.join(' · ')||'Pine พร้อมใช้งาน'));
   }
   send();
  };
  worker.onerror=e=>{dead=true;clearTimeout(deadline);setError(e.message||'Pine runtime ไม่พร้อม');setStatus('');worker.terminate();};
  send();
  return()=>{dead=true;dispatch.current=null;clearTimeout(deadline);worker.terminate()};
 },[source,enabled,seconds,sessionId,scriptKey,baseSeconds,calendar]);
 useEffect(()=>{
  if(!enabled||(!source&&!scripts?.length)||!bars.length){latest.current=null;setPlots([]);setShapes([]);setDrawings([]);setTables([]);return;}
  latest.current={id:++counter.current,source:source||'',bars,baseBars,seconds,baseSeconds,calendar,scripts};dispatch.current?.();
 },[bars,baseBars,source,enabled,seconds,baseSeconds,calendar,sessionId,scriptKey]);
 return {plots,shapes,drawings,tables,status,error};
}
