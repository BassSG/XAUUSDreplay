'use client';
import {useEffect,useRef} from 'react';
import {createChart,CandlestickSeries,LineSeries,HistogramSeries,AreaSeries,ColorType,createSeriesMarkers} from 'lightweight-charts';
import type {Bar,Trade} from '../lib/engine';
export type PinePlot={name:string;style:string;overlay:boolean;color:string;width:number;data:{time:number;value:number|null;color?:string}[]};
const dateFmt=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Bangkok',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',hour12:false});
const tickTime=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Bangkok',hour:'2-digit',minute:'2-digit',hour12:false});
const tickDate=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Bangkok',day:'2-digit',month:'short'});
export default function ReplayChart({bars,trades,plots,onPrice,follow=true}:{bars:Bar[];trades:Trade[];plots:PinePlot[];follow?:boolean;onPrice?:(price:number)=>void}){
 const host=useRef<HTMLDivElement>(null);const ref=useRef<any>(null);const onPriceRef=useRef(onPrice);onPriceRef.current=onPrice;
 useEffect(()=>{
  if(!host.current)return;
  const chart=createChart(host.current,{autoSize:true,layout:{background:{type:ColorType.Solid,color:'#10151d'},textColor:'#8f9caf',fontSize:12,fontFamily:"'Segoe UI',sans-serif",panes:{separatorColor:'#2b3442',separatorHoverColor:'#46546a',enableResize:true}},grid:{vertLines:{color:'#19212c'},horzLines:{color:'#19212c'}},crosshair:{mode:0,vertLine:{color:'#778495',labelBackgroundColor:'#344155'},horzLine:{color:'#778495',labelBackgroundColor:'#344155'}},timeScale:{timeVisible:true,secondsVisible:false,tickMarkFormatter:(t:any,type:number)=>{const d=typeof t==='number'?new Date(t*1000):new Date(Date.UTC(t.year,t.month-1,t.day));return type>=3?tickTime.format(d):tickDate.format(d)},borderColor:'#293241',rightOffset:8,barSpacing:7},rightPriceScale:{borderColor:'#293241',scaleMargins:{top:.12,bottom:.1}},localization:{priceFormatter:(v:number)=>v.toFixed(2),timeFormatter:(t:any)=>dateFmt.format(new Date(Number(t)*1000))}});
  const series=chart.addSeries(CandlestickSeries,{upColor:'#35c4a0',downColor:'#ef6b79',wickUpColor:'#35c4a0',wickDownColor:'#ef6b79',borderVisible:false,priceFormat:{type:'price',precision:2,minMove:.01}});
  const markers=createSeriesMarkers(series,[]);ref.current={chart,series,markers,lines:[],studies:[],count:0};
  chart.subscribeClick((p:any)=>{if(p.point){const price=series.coordinateToPrice(p.point.y);if(price!==null)onPriceRef.current?.(price)}});
  return()=>{ref.current=null;chart.remove()};
 },[]);
 useEffect(()=>{const r=ref.current;if(!r)return;r.series.setData(bars as any);if(bars.length&&r.count===0)r.chart.timeScale().setVisibleLogicalRange({from:Math.max(0,bars.length-110),to:bars.length+8});else if(follow||bars.length<r.count)r.chart.timeScale().scrollToRealTime();r.count=bars.length;},[bars,follow]);
 useEffect(()=>{const r=ref.current;if(!r)return;for(const line of r.lines)r.series.removePriceLine(line);r.lines=[];
  for(const t of trades.filter(t=>t.remaining>0))for(const [price,color,title] of [[t.entry,'#819dca','Entry'],[t.sl,'#ef6b79','SL'],[t.tp,'#35c4a0','TP']] as const)r.lines.push(r.series.createPriceLine({price,color,lineWidth:1,lineStyle:2,axisLabelVisible:true,title}));
  const markerData=trades.flatMap(t=>[{time:t.time,position:t.side==='long'?'belowBar':'aboveBar',color:t.side==='long'?'#35c4a0':'#ef6b79',shape:t.side==='long'?'arrowUp':'arrowDown',text:t.side==='long'?'Buy':'Sell'},...t.exits.map(e=>({time:e.time,position:'aboveBar',color:e.pnl>=0?'#35c4a0':'#ef6b79',shape:'circle',text:e.reason.split(' ')[0]}))]);
  // Match fills to the displayed aggregated candle.
  const times=bars.map(b=>b.time);
  const mapped=markerData.map(m=>{let i=times.length-1;while(i>=0&&times[i]>m.time)i--;return i>=0?{...m,time:times[i]}:null}).filter(Boolean).sort((a:any,b:any)=>a.time-b.time);r.markers.setMarkers(mapped);
 },[trades,bars]);
 useEffect(()=>{const r=ref.current;if(!r)return;for(const s of r.studies)r.chart.removeSeries(s);r.studies=[];
  for(const p of plots){const type=['style_histogram','style_columns'].includes(p.style)?HistogramSeries:p.style==='style_area'?AreaSeries:LineSeries;const color=typeof p.color==='string'?p.color:'#d7b46a';const options:any={title:p.name,color,lineColor:color,topColor:color,bottomColor:'#10151d00',lineWidth:p.width,priceLineVisible:false,lastValueVisible:true};if(type!==AreaSeries){delete options.topColor;delete options.bottomColor;delete options.lineColor;}const s=r.chart.addSeries(type,options,p.overlay?0:1);s.setData(p.data.map(d=>d.value===null?{time:d.time}:{...d,value:d.value}));r.studies.push(s);}
  if(plots.some(p=>!p.overlay)&&r.chart.panes().length>1)r.chart.panes()[1].setHeight(150);
 },[plots]);
 return <div className="chart-canvas" ref={host} aria-label="กราฟแท่งเทียน XAUUSD พร้อมอินดิเคเตอร์"/>;
}
