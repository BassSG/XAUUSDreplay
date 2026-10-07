'use client';
import {useEffect,useRef,useState} from 'react';
import {createChart,CandlestickSeries,LineSeries,HistogramSeries,AreaSeries,ColorType,createSeriesMarkers} from 'lightweight-charts';
import type {Bar,Trade,Drawing,DrawingKind,DrawingPoint} from '../lib/engine';
export type PinePlot={name:string;style:string;overlay:boolean;color:string;width:number;indicatorId?:string;indicatorName?:string;data:{time:number;value:number|null;color?:string}[]};
const dateFmt=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Bangkok',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',hour12:false});
const tickTime=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Bangkok',hour:'2-digit',minute:'2-digit',hour12:false});
const tickDate=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Bangkok',day:'2-digit',month:'short'});
export default function ReplayChart({bars,trades,plots,onPrice,follow=true,drawings=[],drawingMode=null,onDrawing}:{bars:Bar[];trades:Trade[];plots:PinePlot[];follow?:boolean;onPrice?:(price:number)=>void;drawings?:Drawing[];drawingMode?:DrawingKind|null;onDrawing?:(drawing:Drawing)=>void}){
 const host=useRef<HTMLDivElement>(null);const ref=useRef<any>(null);const onPriceRef=useRef(onPrice);onPriceRef.current=onPrice;const drawingRef=useRef(onDrawing);drawingRef.current=onDrawing;const drawingsRef=useRef(drawings);drawingsRef.current=drawings;const modeRef=useRef(drawingMode);modeRef.current=drawingMode;const draft=useRef<DrawingPoint|null>(null);const redrawFrame=useRef<number|undefined>(undefined);const [viewTick,setViewTick]=useState(0);
 useEffect(()=>{
  if(!host.current)return;
  const chart=createChart(host.current,{autoSize:true,layout:{background:{type:ColorType.Solid,color:'#10151d'},textColor:'#8f9caf',fontSize:12,fontFamily:"'Segoe UI',sans-serif",panes:{separatorColor:'#2b3442',separatorHoverColor:'#46546a',enableResize:true}},grid:{vertLines:{color:'#19212c'},horzLines:{color:'#19212c'}},crosshair:{mode:0,vertLine:{color:'#778495',labelBackgroundColor:'#344155'},horzLine:{color:'#778495',labelBackgroundColor:'#344155'}},timeScale:{timeVisible:true,secondsVisible:false,tickMarkFormatter:(t:any,type:number)=>{const d=typeof t==='number'?new Date(t*1000):new Date(Date.UTC(t.year,t.month-1,t.day));return type>=3?tickTime.format(d):tickDate.format(d)},borderColor:'#293241',rightOffset:8,barSpacing:7},rightPriceScale:{borderColor:'#293241',scaleMargins:{top:.12,bottom:.1}},localization:{priceFormatter:(v:number)=>v.toFixed(2),timeFormatter:(t:any)=>dateFmt.format(new Date(Number(t)*1000))}});
  const series=chart.addSeries(CandlestickSeries,{upColor:'#35c4a0',downColor:'#ef6b79',wickUpColor:'#35c4a0',wickDownColor:'#ef6b79',borderVisible:false,priceFormat:{type:'price',precision:2,minMove:.01}});
  const markers=createSeriesMarkers(series,[]);ref.current={chart,series,markers,lines:[],studies:new Map(),count:0};
  chart.subscribeClick((p:any)=>{if(!p.point)return;const price=series.coordinateToPrice(p.point.y);const time=chart.timeScale().coordinateToTime(p.point.x);if(price===null||time===null)return;const point={time:Number(time),price};const mode=modeRef.current;if(!mode){onPriceRef.current?.(price);return;}if(mode==='hline'){drawingRef.current?.({id:crypto.randomUUID(),kind:mode,points:[point]});return;}if(!draft.current){draft.current=point;return;}drawingRef.current?.({id:crypto.randomUUID(),kind:mode,points:[draft.current,point]});draft.current=null;});
  const redraw=()=>{if(!drawingsRef.current.length||redrawFrame.current!==undefined)return;redrawFrame.current=requestAnimationFrame(()=>{redrawFrame.current=undefined;setViewTick(v=>v+1)})};
  chart.timeScale().subscribeVisibleLogicalRangeChange(redraw);
  return()=>{chart.timeScale().unsubscribeVisibleLogicalRangeChange(redraw);if(redrawFrame.current!==undefined)cancelAnimationFrame(redrawFrame.current);ref.current=null;chart.remove()};
 },[]);
 useEffect(()=>{const r=ref.current;if(!r)return;r.series.setData(bars as any);if(bars.length&&r.count===0)r.chart.timeScale().setVisibleLogicalRange({from:Math.max(0,bars.length-110),to:bars.length+8});else if(follow||bars.length<r.count)r.chart.timeScale().scrollToRealTime();r.count=bars.length;},[bars,follow]);
 useEffect(()=>{const r=ref.current;if(!r)return;for(const line of r.lines)r.series.removePriceLine(line);r.lines=[];
  for(const t of trades.filter(t=>t.remaining>0))for(const [price,color,title] of [[t.entry,'#819dca','Entry'],[t.sl,'#ef6b79','SL'],[t.tp,'#35c4a0','TP']] as const)r.lines.push(r.series.createPriceLine({price,color,lineWidth:1,lineStyle:2,axisLabelVisible:true,title}));
  const markerData=trades.flatMap(t=>[{time:t.time,position:t.side==='long'?'belowBar':'aboveBar',color:t.side==='long'?'#35c4a0':'#ef6b79',shape:t.side==='long'?'arrowUp':'arrowDown',text:t.side==='long'?'Buy':'Sell'},...t.exits.map(e=>({time:e.time,position:'aboveBar',color:e.pnl>=0?'#35c4a0':'#ef6b79',shape:'circle',text:e.reason.split(' ')[0]}))]);
  // Match fills to the displayed aggregated candle.
  const times=bars.map(b=>b.time);
  const mapped=markerData.map(m=>{let i=times.length-1;while(i>=0&&times[i]>m.time)i--;return i>=0?{...m,time:times[i]}:null}).filter(Boolean).sort((a:any,b:any)=>a.time-b.time);r.markers.setMarkers(mapped);
 },[trades,bars]);
 useEffect(()=>{const r=ref.current;if(!r)return;const live=new Set<string>();
  for(const p of plots){const key=(p.indicatorId||'legacy')+'|'+p.name+'|'+p.style+'|'+(p.overlay?'1':'0');live.add(key);let s=r.studies.get(key);
   if(!s){const type=['style_histogram','style_columns'].includes(p.style)?HistogramSeries:p.style==='style_area'?AreaSeries:LineSeries;const color=typeof p.color==='string'?p.color:'#d7b46a';const options:any={title:p.indicatorName? p.indicatorName+' · '+p.name:p.name,color,lineColor:color,topColor:color,bottomColor:'#10151d00',lineWidth:p.width,priceLineVisible:false,lastValueVisible:true};if(type!==AreaSeries){delete options.topColor;delete options.bottomColor;delete options.lineColor;}s=r.chart.addSeries(type,options,p.overlay?0:1);r.studies.set(key,s);}
   s.setData(p.data.map(d=>d.value===null?{time:d.time}:{...d,value:d.value}));
  }
  for(const [key,s] of r.studies)if(!live.has(key)){r.chart.removeSeries(s);r.studies.delete(key);}
  if(plots.some(p=>!p.overlay)&&r.chart.panes().length>1)r.chart.panes()[1].setHeight(150);
 },[plots]);
 const overlay=(()=>{const r=ref.current;if(!r||!host.current)return null;const w=host.current.clientWidth,h=host.current.clientHeight;const xy=(p:DrawingPoint)=>[r.chart.timeScale().timeToCoordinate(p.time as any),r.series.priceToCoordinate(p.price)] as const;const items:any[]=[];
  for(const d of drawings){const a=xy(d.points[0]);if(a[0]===null||a[1]===null)continue;if(d.kind==='hline'){items.push(<line key={d.id} x1={0} x2={w} y1={a[1]} y2={a[1]} className="drawing-line"/>);continue;}const b=d.points[1]&&xy(d.points[1]);if(!b||b[0]===null||b[1]===null)continue;
   if(d.kind==='trend')items.push(<line key={d.id} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} className="drawing-line"/>);
   if(d.kind==='rect')items.push(<rect key={d.id} x={Math.min(a[0],b[0])} y={Math.min(a[1],b[1])} width={Math.abs(a[0]-b[0])} height={Math.abs(a[1]-b[1])} className="drawing-box"/>);
   if(d.kind==='fib'){const levels=[0,.236,.382,.5,.618,.786,1];items.push(<g key={d.id}>{levels.map(level=>{const y=a[1]+(b[1]-a[1])*level;return <g key={level}><line x1={Math.min(a[0],b[0])} x2={Math.max(a[0],b[0])} y1={y} y2={y} className="drawing-fib"/><text x={Math.max(a[0],b[0])+5} y={y-2} className="drawing-label">{Math.round(level*1000)/10}%</text></g>})}</g>);}
  }return <svg key={viewTick} className="drawing-overlay" width={w} height={h}>{items}</svg>})();
 return <div className={'chart-stage'+(drawingMode?' drawing-active':'')}><div className="chart-canvas" ref={host} aria-label="กราฟแท่งเทียน XAUUSD พร้อมอินดิเคเตอร์"/>{overlay}</div>;
}
