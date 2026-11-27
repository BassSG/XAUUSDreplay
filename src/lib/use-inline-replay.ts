import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {periods,type Period} from './live-market';
import {replayFrame,type ReplayTape} from './inline-replay';
import {extendReplayTape,openReplayTape,replayPrefix} from './inline-replay-source';
import type {Bar} from './engine';

type Session={id:number;tape:ReplayTape;cursor:number};
type Resume={time:number;period:Period;base:Period};
const storageKey='ebw-inline-replay-v1';
const empty:Bar[]=[];
function restore():Resume|null {
  try {
    const saved=JSON.parse(localStorage.getItem(storageKey)??'null');
    if (saved && Object.hasOwn(periods,saved.period) && Object.hasOwn(periods,saved.base) &&
        Number.isSafeInteger(saved.time) && saved.time>0) return saved;
  } catch { /* Replay can run with storage disabled. */ }
  return null;
}

export function useInlineReplay(activePeriod: Period, now:()=>number, grid:boolean,historyTarget:number) {
  const [session,setSession]=useState<Session|null>(null);
  const [picking,setPicking]=useState(false);
  const [candidate,setCandidate]=useState<number|null>(null);
  const [period,setPeriod]=useState<Period>(activePeriod);
  const [playing,setPlaying]=useState(false);
  const [speed,setSpeed]=useState(2);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  const [resume,setResume]=useState(restore);
  const [prefixes,setPrefixes]=useState<Partial<Record<Period,{bars:Bar[];limit:number}>>>({});
  const operation=useRef<AbortController|null>(null);
  const generation=useRef(0);
  const tape=session?.tape;
  const cursor=session?.cursor ?? -1;
  const active=Boolean(session);
  const activePeriodForTape=active?period:activePeriod;
  const frames=useMemo(()=>{
    if(!tape)return {};
    const wanted=Object.keys(periods) as Period[];
    return Object.fromEntries((grid?wanted:[activePeriodForTape]).map(tf=>
      [tf,replayFrame(tape,cursor,tf,prefixes[tf]?.bars??empty)]));
  },[grid,tape,cursor,prefixes,activePeriodForTape]) as Partial<Record<Period,ReturnType<typeof replayFrame>>>;

  useEffect(()=>()=>operation.current?.abort(),[]);
  useEffect(()=>{
    if (!tape) return;
    const wanted=grid ? Object.keys(periods) as Period[] : [period];
    const controller=new AbortController();
    const ordered=[period,...wanted.filter(tf=>tf!==period)];
    async function prepareHistory(){
      for(const tf of ordered){
        if(!tape||controller.signal.aborted)return;
        if(periods[tf]<periods[tape.period])continue;
        const limit=tf===tape.period?historyTarget-cursor-1:historyTarget;
        if(limit<1||(prefixes[tf]?.limit??0)>=limit)continue;
        const rows=await replayPrefix(tape,tf,now(),controller.signal,limit).catch(()=>[]);
        if(controller.signal.aborted)return;
        setPrefixes(previous=>({...previous,[tf]:{bars:rows,limit}}));
      }
    }
    void prepareHistory();
    return ()=>controller.abort();
  },[session?.id,period,grid,now,historyTarget]);

  const resumeTime=tape?.bars[cursor]?.time;
  useEffect(()=>{
    if (!resumeTime||!tape)return;
    const saved={time:resumeTime,period,base:tape.period};
    setResume(saved);
    try {localStorage.setItem(storageKey,JSON.stringify(saved));} catch { /* Keep the in-memory session. */ }
  },[resumeTime,period,tape]);

  async function start(time:number, display=activePeriod, base?:Period) {
    operation.current?.abort();
    const request=new AbortController();operation.current=request;
    setPlaying(false);setLoading(true);setError('');
    try {
      const {tape,cursor}=await openReplayTape(time,display,now(),request.signal,base,historyTarget);
      if (request.signal.aborted) return;
      setPrefixes({});setPeriod(display);setSession({id:++generation.current,tape,cursor});
      setPicking(false);
    } catch (cause) {
      if(!request.signal.aborted)setError(cause instanceof Error?cause.message:'โหลด Replay ไม่สำเร็จ');
    } finally {
      if(operation.current===request){operation.current=null;setLoading(false);}
    }
  }
  function end(){
    operation.current?.abort();operation.current=null;
    setPlaying(false);setLoading(false);setPicking(false);setSession(null);setCandidate(null);setError('');
  }
  function pick(){
    setPlaying(false);setCandidate(null);setError('');setPicking(true);
  }
  const advance=useCallback((delta:number,expected?:number)=>{
    setSession(current=>current&&(expected===undefined||current.cursor===expected)?{...current,cursor:Math.max(0,Math.min(current.tape.bars.length-1,current.cursor+delta))}:current);
  },[]);
  function step(delta:number){setPlaying(false);advance(delta);}
  function cancelPick(){
    operation.current?.abort();operation.current=null;
    setLoading(false);setPicking(false);setCandidate(null);setError('');
  }
  async function more(){
    if(!session||operation.current)return;
    const request=new AbortController();operation.current=request;
    setLoading(true);setError('');
    try {
      const extra=await extendReplayTape(session.tape,now(),request.signal);
      if(request.signal.aborted)return;
      if(!extra.length){setError('ถึงแท่งล่าสุดที่แหล่งข้อมูลตอบกลับ');return;}
      setSession(current=>current?.id===session.id?{...current,tape:{...current.tape,bars:[...current.tape.bars,...extra]}}:current);
    } catch (cause) {
      if(!request.signal.aborted)setError(cause instanceof Error?cause.message:'โหลดช่วงถัดไปไม่สำเร็จ');
    } finally {
      if(operation.current===request){operation.current=null;setLoading(false);}
    }
  }
  return {active,picking,candidate,setCandidate,period,setPeriod,playing,setPlaying,speed,setSpeed,loading,error,resume,
    start,pick,cancelPick,end,advance,step,more,frames,base:tape?.period,id:session?.id,cursor,
    atEnd:Boolean(tape&&cursor===tape.bars.length-1),hasMore:Boolean(tape&&tape.bars.at(-1)!.time<tape.end),
    canRewind:cursor>0,lastTime:resumeTime,remaining:tape?tape.bars.length-1-cursor:0};
}
export type InlineReplay=ReturnType<typeof useInlineReplay>;
