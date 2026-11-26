import type {Bar,Drawing,DrawingPoint} from './engine.ts';
import {drawingKinds,drawingTools,type DrawingKind} from './drawing-definitions.ts';

export type XY={x:number;y:number};
export type LiveViewport={time:number;span:number};
export const drawingNames=Object.fromEntries(drawingKinds.map(kind=>[kind,drawingTools[kind].name])) as Record<DrawingKind,string>;

// Lightweight Charts returns x=0 for fractional logical indexes. Project the
// enclosing integer slots, including slots in the empty space after the candle.
export function coordinateAtLogical(index: number, barX: (slot: number) => number | null) {
 if (!Number.isFinite(index)) return null;
 const lower = Math.floor(index);
 const left = barX(lower);
 if (left === null || index === lower) return left;
 const right = barX(lower + 1);
 return right === null ? null : left + (right - left) * (index - lower);
}

// Fractional logical coordinates preserve anchors between candles and in empty
// space. Only revealed timestamps are used; no future market data is consulted.
export function logicalAtTime(time:number,bars:Pick<Bar,'time'>[],seconds:number){
 if(!bars.length)return 0;
 if(time<bars[0].time)return (time-bars[0].time)/seconds;
 const last=bars.length-1;
 if(time>bars[last].time)return last+(time-bars[last].time)/seconds;
 let lo=0,hi=last;
 while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(bars[mid].time<=time)lo=mid;else hi=mid-1;}
 return lo===last?lo:lo+(time-bars[lo].time)/(bars[lo+1].time-bars[lo].time);
}
export function timeAtLogical(logical:number,bars:Pick<Bar,'time'>[],seconds:number){
 if(!bars.length)return 0;
 const last=bars.length-1;
 if(logical<0)return Math.round(bars[0].time+logical*seconds);
 if(logical>=last)return Math.round(bars[last].time+(logical-last)*seconds);
 const lo=Math.floor(logical);
 return Math.round(bars[lo].time+(logical-lo)*(bars[lo+1].time-bars[lo].time));
}

export function captureLiveViewport(range:{from:number;to:number},bars:Pick<Bar,'time'>[],seconds:number):LiveViewport {
 const center=Math.max(0,Math.min(bars.length-1,(range.from+range.to)/2));
 return {time:timeAtLogical(center,bars,seconds),span:range.to-range.from};
}

export function restoreLiveViewport(view:LiveViewport,bars:Pick<Bar,'time'>[],seconds:number) {
 const span=Math.max(6,Math.min(bars.length+12,view.span));
 const center=Math.max(0,Math.min(bars.length-1,logicalAtTime(view.time,bars,seconds)));
 const from=Math.max(0,center-span/2);
 return {from,to:from+span};
}
export function rayEnd(a:XY,b:XY,width:number,height:number):XY{
 const dx=b.x-a.x,dy=b.y-a.y;
 if(Math.abs(dx)<.001&&Math.abs(dy)<.001)return b;
 const tx=Math.abs(dx)<.001?Infinity:((dx>0?width:0)-a.x)/dx;
 const ty=Math.abs(dy)<.001?Infinity:((dy>0?height:0)-a.y)/dy;
 const t=Math.min(...[tx,ty].filter(t=>t>=0));
 return Number.isFinite(t)?{x:a.x+dx*t,y:a.y+dy*t}:b;
}
export function moveDrawing(drawing:Drawing,start:DrawingPoint,end:DrawingPoint,handle:number|null,timeline:Pick<Bar,'time'>[],seconds:number):Drawing{
 if(drawing.locked)return drawing;
 if(handle!==null)return {...drawing,points:drawing.points.map((p,i)=>i===handle?end:p)};
 const delta=logicalAtTime(end.time,timeline,seconds)-logicalAtTime(start.time,timeline,seconds),price=end.price-start.price;
 const points=drawing.points.map(p=>({time:timeAtLogical(logicalAtTime(p.time,timeline,seconds)+delta,timeline,seconds),price:Math.round((p.price+price)*100)/100}));
 // A move is atomic. Do not distort the object at a data/price boundary.
 return points.every(p=>p.time>0&&p.price>0)?{...drawing,points}:drawing;
}
export function replayBatch(speed:number,remaining:number,pace?:{bars:number;ms:number}){
 if(speed<=20)return Math.max(0,Math.min(remaining,1));
 const minimum=Math.ceil(speed/10),budget=Math.ceil(speed/2);
 // Amortize MTF/worker overhead when a ten-candle frame cannot meet the target.
 // Bound the batch to half a second of requested replay time; all intermediate
 // candles are still evaluated by PineTS and the order engine.
 const proposed=pace&&pace.ms>0?Math.ceil(speed*pace.ms/1000):minimum;
 return Math.max(0,Math.min(remaining,budget,Math.max(minimum,proposed)));
}
export function replayRange(previous:{from:number;to:number}|null,oldCount:number,newCount:number,offsetDelta:number,follow:boolean){
 if(!previous||!oldCount)return {from:Math.max(0,newCount-90),to:newCount+35};
 const shift=follow?newCount-oldCount:-offsetDelta;
 return {from:previous.from+shift,to:previous.to+shift};
}
