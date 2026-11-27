import {ArrowLeft,CalendarDays,Play,Pause,SkipBack,SkipForward,Shuffle,Target,X} from 'lucide-react';
import {useState,type FormEvent} from 'react';
import type {InlineReplay} from '../lib/use-inline-replay';
import {timeframeName} from './live-overview-chart';

const dateTime=new Intl.DateTimeFormat('th-TH',{timeZone:'Asia/Bangkok',dateStyle:'medium',timeStyle:'short'});
const date=(time:number)=>dateTime.format(time*1000);

export default function InlineReplayControls({replay,asOf,waiting,studyError,onStart,onResume,onRecenter,onPickDate,onRandom,onExit,onJournal}:{
  replay:InlineReplay;asOf?:number;waiting:boolean;studyError?:string;onStart:()=>void;onResume:()=>void;onRecenter:()=>void;
  onPickDate:(time:number)=>void;onRandom:()=>void;onExit:()=>void;onJournal:()=>void;
}){
  const [showDate,setShowDate]=useState(false);
  const [day,setDay]=useState('');
  function submit(event:FormEvent){
    event.preventDefault();
    const time=Date.parse(day+'T00:00:00+07:00')/1000;
    if(Number.isFinite(time)){onPickDate(time);setShowDate(false);}
  }
  return <section className="inline-replay-controls" aria-label="ควบคุม Bar Replay" data-picking={replay.picking}>
    {replay.picking ? <>
      <div className="inline-replay-clock" aria-live="polite">
        <strong>เลือกแท่งเริ่มต้น</strong><span>{replay.candidate===null?'แตะหรือคลิกบนกราฟ':date(replay.candidate)+' · กรุงเทพฯ'}</span>
      </div>
      <div className="inline-replay-buttons">
        <button type="button" className="primary" disabled={replay.candidate===null||replay.loading} onClick={onStart}>
          <Target size={16}/><span>เริ่มจากตรงนี้</span>
        </button>
        <button type="button" aria-label="เลือกวันที่ Replay" aria-expanded={showDate} disabled={replay.loading} onClick={()=>setShowDate(value=>!value)}>
          <CalendarDays size={17}/>
        </button>
        <button type="button" aria-label="สุ่มแท่งเริ่ม" title="สุ่มจากแท่งที่โหลดไว้" disabled={replay.loading} onClick={onRandom}>
          <Shuffle size={17}/>
        </button>
        {replay.resume&&!replay.active&&<button type="button" title={date(replay.resume.time)} disabled={replay.loading} onClick={onResume}>เล่นต่อ</button>}
        <button type="button" aria-label="ยกเลิกเลือกแท่ง" onClick={replay.cancelPick}><X size={17}/></button>
      </div>
    </> : <>
      <div className="inline-replay-clock">
        <strong>Replay</strong><time dateTime={asOf?new Date(asOf*1000).toISOString():undefined}>{asOf?date(asOf):'—'}</time>
        {replay.base&&<span title="ความละเอียดจริงของข้อมูล">ข้อมูล {timeframeName(replay.base)}</span>}
      </div>
      <div className="inline-replay-buttons">
        <button type="button" aria-label="ย้อนหนึ่งแท่ง Replay" title="ย้อนหนึ่งแท่ง" disabled={!replay.canRewind||replay.loading} onClick={()=>{onRecenter();replay.step(-1)}}><SkipBack size={17}/></button>
        <button type="button" className="primary" aria-label={replay.playing?'หยุด Replay':'เล่น Replay'} disabled={replay.atEnd||replay.loading}
          onClick={()=>{onRecenter();replay.setPlaying(value=>!value)}}>{replay.playing?<Pause size={17}/>:<Play size={17}/>}</button>
        <button type="button" aria-label="เดินหนึ่งแท่ง Replay" title="เดินหนึ่งแท่ง" disabled={replay.atEnd||replay.loading} onClick={()=>{onRecenter();replay.step(1)}}><SkipForward size={17}/></button>
        <select aria-label="ความเร็ว Bar Replay" value={replay.speed} onChange={event=>replay.setSpeed(Number(event.target.value))}>
          {[1,2,4,8,15,30].map(speed=><option key={speed} value={speed}>{speed}×</option>)}
        </select>
        <button type="button" title="เลือกจุดเริ่มใหม่" aria-label="เลือกจุดเริ่มใหม่" disabled={replay.loading} onClick={replay.pick}><Target size={17}/></button>
        {replay.atEnd&&replay.hasMore&&<button type="button" disabled={replay.loading} onClick={()=>void replay.more()}>โหลดต่อ</button>}
        <button className="inline-replay-exit" type="button" onClick={onExit}><ArrowLeft size={16}/><span>กลับ Live</span></button>
      </div>
    </>}
    {replay.picking&&showDate&&<form className="inline-replay-date" onSubmit={submit}>
      <label>วันที่กรุงเทพฯ <input aria-label="วันที่เริ่ม Replay" type="date" value={day} required onChange={event=>setDay(event.target.value)}/></label>
      <button type="submit">ไปวันที่</button>
    </form>}
    {(replay.loading||replay.error||waiting||studyError||replay.atEnd&&!replay.hasMore)&&<span className="inline-replay-feedback" role="status" title={studyError}>
      {replay.error || (replay.loading ? 'กำลังโหลดข้อมูล Replay…'
        : replay.atEnd&&!replay.hasMore ? 'ถึงท้ายข้อมูลชุดนี้'
        : studyError ? 'อินดิเคเตอร์บางตัวคำนวณไม่สำเร็จ'
        : replay.playing ? 'กำลังเล่น · อินดิเคเตอร์กำลังอัปเดตตาม'
        : 'กำลังคำนวณอินดิเคเตอร์ ณ จุดที่หยุด…')}
    </span>}
    {!replay.picking&&<button type="button" className="inline-replay-journal" onClick={onJournal}>สมุดฝึกรอบเต็ม</button>}
  </section>;
}
