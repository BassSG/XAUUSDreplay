import {historyCatalog,loadBefore,loadWindow} from './history';
import {historyPage} from './live-feed';
import {candleWindow,periods,readHistoryPages,type Period} from './live-market';
import type {ReplayTape} from './inline-replay';

const pagePeriods=Object.keys(periods) as Period[];
const warmBars=3600;
const upcomingBars=1500;

export async function openReplayTape(time:number, display:Period, now:number, signal:AbortSignal, savedBase?:Period) {
  const catalog=await historyCatalog().catch(()=>[]);
  signal.throwIfAborted();
  const archive=catalog.filter(d=>d.calendar==='eightcap' && d.start<=time && d.end+d.timeframe>time &&
    pagePeriods.some(period=>periods[period]===d.timeframe) && d.timeframe<=periods[display] &&
    (!savedBase || d.timeframe===periods[savedBase])).sort((a,b)=>a.timeframe-b.timeframe)[0];
  if (archive) {
    const period=pagePeriods.find(period=>periods[period]===archive.timeframe)!;
    const window=await loadWindow(archive.id,time,warmBars,upcomingBars).catch(()=>null);
    signal.throwIfAborted();
    if (window&&window.bars[window.index].time<candleWindow(time,periods[display]).close)
      return {tape:{bars:window.bars,period,dataset:archive.id,end:archive.end},cursor:window.index};
  }
  for (const period of pagePeriods.filter(period=>periods[period]<=periods[display] && (!savedBase||period===savedBase))) {
    const seconds=periods[period];
    // Work backwards from just beyond the entry so that both warmup and a
    // bounded number of playback candles fit in the same broker window.
    const before=Math.min(now,time+seconds*180);
    const result=await readHistoryPages(before,warmBars+180,signal,edge=>historyPage(period,edge,now,signal));
    signal.throwIfAborted();
    const cursor=result.bars.findIndex(bar=>bar.time>=time);
    if (cursor>=0 && result.bars[cursor].time<candleWindow(time,periods[display]).close)
      return {tape:{bars:result.bars,period,end:now-seconds},cursor};
    if (result.failed) break;
  }
  throw Error('ไม่พบแท่งที่ปิดแล้วสำหรับจุดเริ่มนี้ ลองเลือกแท่งก่อนหน้า หรือขยับไปช่วงที่มีประวัติ Eightcap');
}

export async function replayPrefix(tape: ReplayTape,period: Period,now:number,signal:AbortSignal) {
  const seconds=periods[period];
  if (seconds<=periods[tape.period]) return [];
  const first=candleWindow(tape.bars[0].time,seconds);
  const before=tape.bars[0].time===first.open?first.open:first.close;
  const archive=(await historyCatalog().catch(()=>[])).find(d=>d.calendar==='eightcap'&&d.timeframe===seconds&&
    d.start<before&&d.end+seconds>=first.open);
  signal.throwIfAborted();
  if (archive) return loadBefore(archive.id,before,1800);
  const history=await readHistoryPages(before,1800,signal,edge=>historyPage(period,edge,now,signal));
  return history.bars;
}

export async function extendReplayTape(tape: ReplayTape, now:number, signal:AbortSignal) {
  const time=tape.bars.at(-1)!.time;
  if (tape.dataset) {
    if (time>=tape.end) return [];
    return (await loadWindow(tape.dataset,time+1,0,upcomingBars)).bars;
  }
  const seconds=periods[tape.period];
  const before=Math.min(now,time+seconds*500);
  if (before<=time+seconds) return [];
  const pages=await readHistoryPages(before,500,signal,edge=>historyPage(tape.period,edge,now,signal));
  signal.throwIfAborted();
  const extra=pages.bars.filter(bar=>bar.time>time);
  if(pages.failed&&!extra.length)throw Error('โหลดประวัติ Eightcap ช่วงถัดไปไม่สำเร็จ');
  return extra;
}
