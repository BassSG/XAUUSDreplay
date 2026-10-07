import {useEffect,useRef,useState} from 'react';
import type {PointerEvent as ReactPointerEvent} from 'react';
import type {Bar,Drawing,DrawingKind,DrawingPoint} from '../lib/engine';
import {drawingNames,logicalAtTime,timeAtLogical,rayEnd,moveDrawing,onePoint,type XY} from '../lib/chart-tools';

type Api={chart:any;series:any};
type Props={api:Api|null;host:HTMLDivElement|null;timeline:Bar[];offset:number;seconds:number;drawings:Drawing[];mode:DrawingKind|null;hidden:boolean;magnet:boolean;selected:string|null;pricePicking:boolean;onSelect:(id:string|null)=>void;onCreate:(d:Drawing)=>void;onChange:(d:Drawing)=>void;onCancel:()=>void;onDelete:()=>void;onUndo:()=>void;onRedo:()=>void;onDragStart:()=>void;onDragEnd:()=>void;};
export default function ChartDrawings(props:Props){
 const [draft,setDraft]=useState<DrawingPoint|null>(null),[hover,setHover]=useState<DrawingPoint|null>(null),[moving,setMoving]=useState<Drawing|null>(null);
 const active=useRef<{original:Drawing;start:DrawingPoint;handle:number|null;target:Element;pointerId:number;changed:boolean}|null>(null);
 const state=useRef(props);state.current=props;const draftRef=useRef(draft);draftRef.current=draft;const moveRef=useRef(moving);moveRef.current=moving;
 function pointAt(x:number,y:number):DrawingPoint|null{
  const p=state.current;if(!p.api||!p.timeline.length)return null;
  if(x<0||x>p.api.chart.timeScale().width()||y<0||y>p.api.chart.panes()[0].getHeight())return null;
  const logical=p.api.chart.timeScale().coordinateToLogical(x);let price=p.api.series.coordinateToPrice(y);
  if(logical===null||price===null||!Number.isFinite(price)||price<=0)return null;
  if(p.magnet){const index=Math.round(logical+p.offset),bar=p.timeline[index];if(bar){const snap=[bar.open,bar.high,bar.low,bar.close].sort((a,b)=>Math.abs(a-price)-Math.abs(b-price))[0];if(Math.abs((p.api.series.priceToCoordinate(snap)??Infinity)-y)<=14){price=snap;return {time:bar.time,price:Math.round(price*100)/100};}}}
  const time=timeAtLogical(logical+p.offset,p.timeline,p.seconds);return time>0?{time,price:Math.round(price*100)/100}:null;
 }
 function eventPoint(e:ReactPointerEvent){const rect=state.current.host?.getBoundingClientRect();return rect?pointAt(e.clientX-rect.left,e.clientY-rect.top):null;}
 function cancelDrag(){const drag=active.current;active.current=null;if(drag){if(drag.target.hasPointerCapture(drag.pointerId))drag.target.releasePointerCapture(drag.pointerId);state.current.onDragEnd();}setMoving(null);}
 useEffect(()=>{draftRef.current=null;setDraft(null);setHover(null);cancelDrag();},[props.mode,props.hidden,props.seconds]);
 useEffect(()=>{if(props.selected&&!props.drawings.some(d=>d.id===props.selected))props.onSelect(null);},[props.drawings,props.selected]);
 useEffect(()=>{
  const api=props.api;if(!api)return;
  const click=(e:any)=>{
   const p=state.current;if(!e.point||(e.paneIndex??0)!==0)return;
   if(!p.mode){p.onSelect(null);return;}
   const point=pointAt(e.point.x,e.point.y);if(!point)return;
   if(onePoint(p.mode)){p.onCreate({id:crypto.randomUUID(),kind:p.mode,points:[point],...(p.mode==='text'?{text:'Note'}:{})});setDraft(null);setHover(null);return;}
   if(!draftRef.current){draftRef.current=point;setDraft(point);setHover(point);return;}
   const first=draftRef.current;if(Math.abs(first.time-point.time)<1&&Math.abs(first.price-point.price)<.01)return;
   p.onCreate({id:crypto.randomUUID(),kind:p.mode,points:[first,point]});draftRef.current=null;setDraft(null);setHover(null);
  };
  const crosshair=(e:any)=>{if(state.current.mode&&e.point&&(e.paneIndex??0)===0)setHover(pointAt(e.point.x,e.point.y));else setHover(null);};
  api.chart.subscribeClick(click);api.chart.subscribeCrosshairMove(crosshair);
  return()=>{api.chart.unsubscribeClick(click);api.chart.unsubscribeCrosshairMove(crosshair);};
 },[props.api]);
 useEffect(()=>{props.api?.chart.applyOptions({handleScroll:{pressedMouseMove:!props.mode,horzTouchDrag:!props.mode,vertTouchDrag:!props.mode,mouseWheel:true}});},[props.api,props.mode]);
 useEffect(()=>{
  const key=(e:KeyboardEvent)=>{
   if(e.altKey||(e.target as HTMLElement)?.isContentEditable||['INPUT','TEXTAREA','SELECT'].includes((e.target as HTMLElement)?.tagName)||document.querySelector('[aria-modal="true"]'))return;
   const p=state.current;
   if(e.key==='Escape'){if(active.current){cancelDrag();return;}setDraft(null);draftRef.current=null;setHover(null);p.onCancel();}
   if((e.key==='Delete'||e.key==='Backspace')&&p.selected){e.preventDefault();p.onDelete();}
   if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();setDraft(null);draftRef.current=null;p.onCancel();if(e.shiftKey)p.onRedo();else p.onUndo();}
   if(e.ctrlKey&&e.key.toLowerCase()==='y'){e.preventDefault();setDraft(null);draftRef.current=null;p.onCancel();p.onRedo();}
  };
  window.addEventListener('keydown',key);return()=>{window.removeEventListener('keydown',key);cancelDrag();};
 },[]);
 function begin(e:ReactPointerEvent<SVGGElement>,d:Drawing,handle:number|null){
  if(e.button!==0||state.current.mode||state.current.pricePicking)return;
  e.preventDefault();e.stopPropagation();state.current.onSelect(d.id);if(d.locked)return;
  const point=eventPoint(e);if(!point)return;
  e.currentTarget.setPointerCapture(e.pointerId);state.current.onDragStart();active.current={original:d,start:point,handle,target:e.currentTarget,pointerId:e.pointerId,changed:false};setMoving(d);
 }
 function drag(e:ReactPointerEvent<SVGGElement>){const a=active.current;if(!a||a.pointerId!==e.pointerId)return;const end=eventPoint(e);if(!end)return;const p=state.current,next=moveDrawing(a.original,a.start,end,a.handle,p.timeline,p.seconds);a.changed=JSON.stringify(next.points)!==JSON.stringify(a.original.points);moveRef.current=next;setMoving(next);}
 function end(e:ReactPointerEvent<SVGGElement>){const a=active.current;if(!a||a.pointerId!==e.pointerId)return;const result=moveRef.current;active.current=null;if(a.target.hasPointerCapture(e.pointerId))a.target.releasePointerCapture(e.pointerId);state.current.onDragEnd();setMoving(null);if(a.changed&&result)state.current.onChange(result);}
 const api=props.api;if(!api)return null;
 const width=api.chart.timeScale().width(),height=api.chart.panes()[0].getHeight();
 const xy=(p:DrawingPoint):XY=>({x:api.chart.timeScale().logicalToCoordinate(logicalAtTime(p.time,props.timeline,props.seconds)-props.offset)??NaN,y:api.series.priceToCoordinate(p.price)??NaN});
 const preview=props.mode&&hover?{id:'preview',kind:props.mode,points:onePoint(props.mode)?[hover]:draft?[draft,hover]:[hover],text:props.mode==='text'?'Note':undefined} as Drawing:null;
 const list=props.hidden?[]:props.drawings.map(d=>moving?.id===d.id?moving:d);
 if(preview)list.push(preview);
 return <>
  <svg className="user-drawing-overlay" width={width} height={height} aria-label="เส้นและวัตถุที่วาดบนกราฟ">
   <defs><clipPath id="userPriceClip"><rect width={width} height={height}/></clipPath></defs>
   <g clipPath="url(#userPriceClip)">{list.map(d=>{
    const a=xy(d.points[0]),b=d.points[1]?xy(d.points[1]):null;if(!Number.isFinite(a.y)||!Number.isFinite(a.x))return null;
    const isPreview=d.id==='preview',selected=!isPreview&&props.selected===d.id,color=d.color||'#d7b46a',interactive=!isPreview&&!props.mode&&!props.pricePicking;
    const strokes:any[]=[];const hits:any[]=[];
    const line=(a:XY,b:XY,key:string,dash?:string)=>{strokes.push(<line key={key} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color} strokeWidth={selected?2:1.5} strokeDasharray={dash} vectorEffect="non-scaling-stroke"/>);hits.push(<line key={key} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth="18" pointerEvents="stroke"/>);};
    if(d.kind==='hline')line({x:0,y:a.y},{x:width,y:a.y},'h');
    else if(d.kind==='vline')line({x:a.x,y:0},{x:a.x,y:height},'v');
    else if(d.kind==='text'){strokes.push(<text key="text" x={a.x+5} y={a.y-8} fill={color} fontSize="12">{d.text||'Note'}</text>);hits.push(<rect key="text" x={a.x-3} y={a.y-24} width={Math.max(44,(d.text||'Note').length*7+12)} height="30" fill="transparent" pointerEvents="all"/>);}
    else if(b&&Number.isFinite(b.x)&&Number.isFinite(b.y)){
     if(d.kind==='trend')line(a,b,'trend');
     else if(d.kind==='ray')line(a,rayEnd(a,b,width,height),'ray');
     else if(d.kind==='fib'){for(const level of [0,.236,.382,.5,.618,.786,1]){const y=a.y+(b.y-a.y)*level;line({x:Math.min(a.x,b.x),y},{x:Math.max(a.x,b.x),y},String(level),'5 4');strokes.push(<text key={'t'+level} x={Math.min(width-50,Math.max(a.x,b.x)+5)} y={y-3} fill={color} fontSize="11">{Math.round(level*1000)/10}%</text>);}}
     else {const box={x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),width:Math.max(1,Math.abs(a.x-b.x)),height:Math.max(1,Math.abs(a.y-b.y))};strokes.push(<rect key="box" {...box} fill={d.kind==='rect'?color+'18':d.points[1].price>=d.points[0].price?'#35c4a022':'#ef6b7922'} stroke={color} strokeWidth={selected?2:1.5}/>);hits.push(<rect key="box" {...box} fill="transparent" stroke="transparent" strokeWidth="16" pointerEvents="all"/>);
      if(d.kind!=='rect'){const delta=d.points[1].price-d.points[0].price,count=Math.abs(logicalAtTime(d.points[1].time,props.timeline,props.seconds)-logicalAtTime(d.points[0].time,props.timeline,props.seconds));strokes.push(<text key="value" x={box.x+6} y={box.y+16} fill={color} fontSize="11">{delta.toFixed(2)} USD · {(delta/d.points[0].price*100).toFixed(2)}% · {Math.round(count)} แท่ง</text>);}
     }
    }
    return <g key={d.id} data-drawing-id={d.id} data-kind={d.kind} data-selected={selected||undefined} opacity={isPreview?.7:1}>
     <g pointerEvents="none">{strokes}</g>
     {interactive&&<g data-drawing-interaction="body" className={d.locked?'drawing-locked':'drawing-hit'} onPointerDown={e=>begin(e,d,null)} onPointerMove={drag} onPointerUp={end} onPointerCancel={cancelDrag} onLostPointerCapture={()=>{if(active.current)cancelDrag();}}>{hits}</g>}
     {(selected||isPreview)&&d.points.map((p,i)=>{const point=xy(p);const cx=d.kind==='hline'?Math.max(10,Math.min(width-10,point.x)):point.x,cy=d.kind==='vline'?Math.max(10,Math.min(height-10,point.y)):point.y;return <g key={i} data-drawing-interaction="handle" data-handle={i} onPointerDown={e=>begin(e,d,i)} onPointerMove={drag} onPointerUp={end} onPointerCancel={cancelDrag}><circle cx={cx} cy={cy} r={selected?5:4} fill="#10151d" stroke={color} strokeWidth="2"/><circle cx={cx} cy={cy} r="13" fill="transparent" pointerEvents={selected&&!d.locked&&interactive?'all':'none'} className="drawing-anchor"/></g>;})}
    </g>;
   })}</g>
  </svg>
  {props.mode&&<div className="drawing-instruction" role="status">{drawingNames[props.mode]} · {onePoint(props.mode)?'คลิก / แตะเพื่อวาง':draft?'เลือกจุดที่สอง':'เลือกจุดแรก'} <button onClick={()=>{setDraft(null);draftRef.current=null;props.onCancel();}}>ยกเลิก · Esc</button></div>}
 </>;
}
