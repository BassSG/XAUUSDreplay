'use client';
import {useEffect,useId,useImperativeHandle,useMemo,useRef,useState,type ReactNode,type Ref} from 'react';
import {createChart,CrosshairMode,CandlestickSeries,LineSeries,HistogramSeries,AreaSeries,ColorType,createSeriesMarkers,type IChartApi,type Logical,type MouseEventParams,type UTCTimestamp} from 'lightweight-charts';
import ChartDrawings from './chart-drawings';
import type {IPrimitivePaneRenderer} from 'lightweight-charts';
import {PineBandLayer} from './pine-band-layer';
import {PineBox,PineLabel,pineDash,pineStroke} from './pine-annotations';
import './mobile-chart.css';
import type {PineBand} from '../lib/pine-bands';
import {LivePriceCountdown,LivePriceMarker} from './live-price-marker';
import {defaultMarketSymbol,marketInfo,type MarketSymbol} from '../lib/market-symbol';
import {captureLiveViewport,coordinateAtLogical,logicalAtTime,replayRange,restoreLiveViewport,type LiveViewport} from '../lib/chart-tools';
import {liveTailUpdate, sameMarketBar} from '../lib/live-market';
import {studyStateLabel, type LiveStudyBadge} from '../lib/live-indicators';
import {StudyVisibilityButton} from './live-study-legend';
import type {Bar,Trade,Drawing,DrawingKind} from '../lib/engine';
import type {ChartAppearance,ChartView} from '../lib/live-layouts';
export type ChartLevel={id:string;price:number;kind:'entry'|'sl'|'tp';label:string;color:string;draft?:boolean;tradeId?:string;orderId?:string;editable:boolean;pending?:boolean};
export type PinePlot={name:string;style:string;lineStyle?:string;overlay:boolean;color:string;width:number;indicatorId?:string;indicatorName?:string;data:{time:number;value:number|null;color?:string}[]};
const brandMarkUrl = import.meta.env.BASE_URL + 'icons/ebw-mark.png';
const brandMarkWidth = 48, brandMarkHeight = 13, brandMarkInset = 10;
const noLevels: ChartLevel[] = [];
const noAlertLevels: number[] = [];
const noFills: PineBand[] = [];
export type PineShape={indicatorId:string;indicatorName:string;time:number;shape:string;location:string;color:string;text:string;textcolor:string;size:string};
export type PineDrawing={kind:'line'|'box'|'label'|'linefill';indicatorId:string;indicatorName:string;overlay?:boolean;[key:string]:any};
export type PineTable={indicatorId:string;indicatorName:string;position:string;columns:number;rows:number;cells:any[][];bgcolor?:string;frame_color?:string;frame_width?:number;border_color?:string;border_width?:number;[key:string]:any};
const noShapes: PineShape[] = [];
const noPineDrawings: PineDrawing[] = [];
const noPineTables: PineTable[] = [];
const dateFmt=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Bangkok',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',hour12:false});
const tickTime=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Bangkok',hour:'2-digit',minute:'2-digit',hour12:false});
const tickDate=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Bangkok',day:'2-digit',month:'short'});
const ohlcNumber=new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const compactChartMedia='(max-width: 720px), (orientation: landscape) and (max-height: 500px) and (pointer: coarse)';
const prices=[['open','O','เปิด'],['high','H','สูงสุด'],['low','L','ต่ำสุด'],['close','C','ปิด']] as const;
function latestLiveRange(count:number,width:number){
 // Reserve useful space for projected Pine zones while keeping the latest
 // candle near the usual TradingView position instead of crowding it at the
 // edge or showing too much old price action by default.
 const visible=Math.max(30,Math.round(width/(width<600?6.5:6.25)));
 const room=Math.max(6,Math.round(visible*.22));
 const to=count-1+room;
 return {from:to-visible,to};
}
const markerShape=(s:string)=>{const v=(s||'').toLowerCase();return v.includes('up')?'arrowUp':v.includes('down')?'arrowDown':v.includes('square')?'square':'circle'};
const markerPosition=(s:string)=>{const v=(s||'').toLowerCase();return v.includes('below')?'belowBar':v.includes('above')?'aboveBar':'inBar'};
const cssColor=(v:any,fallback='transparent')=>typeof v==='string'&&v&&v!=='na'?v:fallback;
function chartPreference(key:string){try{return localStorage.getItem(key)==='true';}catch{return false;}}
type ChartUtility = 'cross'|'dot'|'arrow'|'demo'|'magic'|'erase'|'zoom';
type ReplayPicker = {time:number|null;onPick:(time:number)=>void};
function readPaneSizes(chart:IChartApi, studies:[string,PinePlot][]):ChartView['paneSizes'] {
 const panes=chart.panes();
 const sizes:ChartView['paneSizes']={price:panes[0].getStretchFactor()};
 studies.forEach(([id],index)=>{
  if(panes[index+1])sizes[id]=panes[index+1].getStretchFactor();
 });
 return sizes;
}
export type LiveChartActions = {
 utility: (tool:ChartUtility)=>void;
 fit: () => void;
 first: () => void;
 latest: () => void;
 resetView: () => void;
 viewport: () => LiveViewport | null;
 captureView: (follow: boolean) => ChartView | null;
 exportPng: () => Promise<void>;
 copyPng: () => Promise<void>;
};

export default function ReplayChart({symbol=defaultMarketSymbol,bars,timeline=bars,seconds=60,trades,plots:studyPlots,fills:studyFills=noFills,shapes:studyShapes=noShapes,pineDrawings:studyDrawings=noPineDrawings,pineTables:studyTables=noPineTables,barIndexOffset=0,onPrice,replayPicker,follow=true,drawings=[],drawingMode=null,onDrawing,onDrawingChange,onDrawingSelect,onDrawingEdit,selectedDrawing=null,onDrawingCancel,onDrawingDelete,onDrawingRemove,onDrawingUndo,onDrawingRedo,pricePicking=false,levels=noLevels,onLevelPreview,onLevelCommit,onDragStart,calculating=false,magnet=false,strongMagnet=false,onToggleMagnet,confirmDrawingPlacement,hiddenDrawings=false,live=false,compact=false,readOnlyDrawings=false,alertLevels=noAlertLevels,liveActions,liveViewport,appearance,initialView,liveBid,liveClock,liveLegend,liveStudyBadges,hiddenStudies,onToggleStudy,liveSelection,onHistoryEdge,onLeaveLatest}:{symbol?:MarketSymbol;bars:Bar[];timeline?:Bar[];seconds?:number;trades:Trade[];plots:PinePlot[];fills?:PineBand[];shapes?:PineShape[];pineDrawings?:PineDrawing[];pineTables?:PineTable[];barIndexOffset?:number;follow?:boolean;onPrice?:(price:number)=>void;replayPicker?:ReplayPicker;drawings?:Drawing[];drawingMode?:DrawingKind|null;onDrawing?:(drawing:Drawing)=>void;onDrawingChange?:(drawing:Drawing)=>void;onDrawingSelect?:(id:string|null)=>void;onDrawingEdit?:(id:string)=>void;selectedDrawing?:string|null;onDrawingCancel?:()=>void;onDrawingDelete?:()=>void;onDrawingRemove?:(id:string)=>void;onDrawingUndo?:()=>void;onDrawingRedo?:()=>void;pricePicking?:boolean;levels?:ChartLevel[];onLevelPreview?:(level:ChartLevel,price:number)=>void;onLevelCommit?:(level:ChartLevel,price:number)=>void;onDragStart?:()=>void;calculating?:boolean;magnet?:boolean;strongMagnet?:boolean;confirmDrawingPlacement?: boolean;onToggleMagnet?:()=>void;hiddenDrawings?:boolean;live?:boolean;compact?:boolean;readOnlyDrawings?:boolean;alertLevels?:number[];liveActions?:Ref<LiveChartActions>;liveViewport?:LiveViewport|null;appearance?:ChartAppearance;initialView?:ChartView|null;liveBid?:number;liveClock?:()=>number;liveLegend?:ReactNode;liveStudyBadges?:LiveStudyBadge[];hiddenStudies?:readonly string[];onToggleStudy?:(id:string)=>void;liveSelection?:ReactNode;onHistoryEdge?:()=>void;onLeaveLatest?:()=>void}){
 const hiddenStudyIds=useMemo(()=>new Set(hiddenStudies),[hiddenStudies]);
 const [priceExpanded,setPriceExpanded]=useState(false);
 const normalPaneSizes=useRef<ChartView['paneSizes']|null>(null);
 const {plots,fills,shapes,pineDrawings,pineTables}=useMemo(()=>{
  const visible=<T extends {indicatorId?:string;overlay?:boolean},>(items:T[])=>hiddenStudyIds.size||priceExpanded
   ? items.filter(item=>(!item.indicatorId||!hiddenStudyIds.has(item.indicatorId))&&(!priceExpanded||item.overlay!==false))
   : items;
  return {plots:visible(studyPlots),fills:visible(studyFills),shapes:visible(studyShapes),
   pineDrawings:visible(studyDrawings),pineTables:visible(studyTables)};
 },[hiddenStudyIds,priceExpanded,studyPlots,studyFills,studyShapes,studyDrawings,studyTables]);
 const [expanded,setExpanded]=useState(false),[paneCount,setPaneCount]=useState(0),[focus,setFocus]=useState('draft');
 const [utility,setUtility]=useState<ChartUtility>('cross');
 const [zoomBox,setZoomBox]=useState<{x:number;y:number;right:number;bottom:number}|null>(null);
 const [drawingPane,setDrawingPane]=useState('');
 const pricePaneClip=useId();
 const [snapshotMessage,setSnapshotMessage]=useState('');
 const [cursorTime,setCursorTime]=useState<number|null>(null);
 const livePriceMarker=useRef<LivePriceMarker|null>(null);
 const brandMark=useRef<HTMLImageElement>(null);
 const paneStudies=useMemo(()=>{
  const studies=new Map<string,PinePlot>();
  for(const plot of plots){
   const id=plot.indicatorId||'legacy';
   if(!plot.overlay&&!studies.has(id))studies.set(id,plot);
  }
  return [...studies.entries()];
 },[plots]);
 const activePane = paneStudies.some(([id])=>id===drawingPane) ? drawingPane : '';
 const drawingPanes = [{id:'',index:0}, ...paneStudies.map(([id],i)=>({id,index:i+1}))];
 const selectedObject = drawings.find(drawing=>drawing.id===selectedDrawing);
 const selectedPane = selectedObject?.pane ?? '';
 const keyboardPane = drawingMode ? activePane : selectedPane;
 // Selection belongs to the chart. Each drawing layer only receives that pane's drawings.
 useEffect(()=>{
  if(selectedDrawing&&(!selectedObject||selectedPane&&!paneStudies.some(([id])=>id===selectedPane)))onDrawingSelect?.(null);
 },[selectedDrawing,selectedObject,selectedPane,paneStudies,onDrawingSelect]);
 const navigation=useRef({onHistoryEdge,onLeaveLatest});
 navigation.current={onHistoryEdge,onLeaveLatest};
 const [replayText,setShowPineText]=useState(()=>chartPreference('xau-pine-text')),[replayTables,setShowPineTables]=useState(()=>chartPreference('xau-pine-tables'));
 const showPineText=appearance?.pineText??replayText,showPineTables=appearance?.pineTables??replayTables;
 function toggleText(){setShowPineText(v=>{try{localStorage.setItem('xau-pine-text',String(!v));}catch{}return !v;});}
 function toggleTables(){setShowPineTables(v=>{try{localStorage.setItem('xau-pine-tables',String(!v));}catch{}return !v;});}
 const [preview,setPreview]=useState<{id:string;price:number}|null>(null);const activeDrag=useRef<{level:ChartLevel;price:number}|null>(null);const levelRef=useRef({levels,onLevelPreview,onLevelCommit,onDragStart,magnet});levelRef.current={levels,onLevelPreview,onLevelCommit,onDragStart,magnet};
 const pickRef=useRef(replayPicker);pickRef.current=replayPicker;
 const host=useRef<HTMLDivElement>(null);const placementHost=useRef<HTMLDivElement>(null);const ref=useRef<any>(null);const onPriceRef=useRef(onPrice);onPriceRef.current=onPrice;const drawingsRef=useRef({user:drawings,pine:pineDrawings});drawingsRef.current={user:drawings,pine:pineDrawings};const modeRef=useRef(drawingMode);modeRef.current=drawingMode;const redrawFrame=useRef<number|undefined>(undefined);const [,setViewTick]=useState(0);
 useEffect(()=>{
  if(!host.current)return;
  const chart=createChart(host.current,{autoSize:true,layout:{attributionLogo:false,background:{type:ColorType.Solid,color:live?'#0d141e':'#10151d'},textColor:live?'#93a4ba':'#8f9caf',fontSize:12,fontFamily:"'Segoe UI',sans-serif",panes:{separatorColor:'#2b3442',separatorHoverColor:'#46546a',enableResize:true}},grid:{vertLines:{color:live?'#1a2635':'#19212c'},horzLines:{color:live?'#1a2635':'#19212c'}},crosshair:{mode:0,vertLine:{color:'#778495',labelBackgroundColor:'#344155'},horzLine:{color:'#778495',labelBackgroundColor:'#344155'}},timeScale:{timeVisible:true,secondsVisible:false,tickMarkFormatter:(t:any,type:number)=>{const d=typeof t==='number'?new Date(t*1000):new Date(Date.UTC(t.year,t.month-1,t.day));return type>=3?tickTime.format(d):tickDate.format(d)},borderColor:'#293241',rightOffset:35,barSpacing:7,minBarSpacing:live?.001:.5,shiftVisibleRangeOnNewBar:false,allowShiftVisibleRangeOnWhitespaceReplacement:false},rightPriceScale:{minimumWidth:live?66:0,borderColor:'#293241',scaleMargins:{top:.12,bottom:.1}},localization:{priceFormatter:(v:number)=>v.toFixed(2),timeFormatter:(t:any)=>dateFmt.format(new Date(Number(t)*1000))}});
  const series=chart.addSeries(CandlestickSeries,{upColor:'#35c4a0',downColor:'#ef6b79',wickUpColor:'#35c4a0',wickDownColor:'#ef6b79',borderVisible:false,priceFormat:{type:'price',precision:2,minMove:.01}});
  const markers=createSeriesMarkers(series,[]);ref.current={chart,series,markers,lines:[],studies:new Map(),horizontals:new Map(),count:0};
  const priceMarker=live?new LivePriceMarker():null;
  if(priceMarker)series.attachPrimitive(priceMarker);
  livePriceMarker.current=priceMarker;
  chart.subscribeClick(p=>{
   if(!p.point||(p.paneIndex??0)!==0)return;
   const pick=pickRef.current;
   if(pick){
    const row=typeof p.time==='number'&&p.seriesData.get(series);
    if(row && 'open' in row && typeof row.time==='number')pick.onPick(row.time);
    return;
   }
   if(modeRef.current)return;
   const price=series.coordinateToPrice(p.point.y);
   if(price!==null)onPriceRef.current?.(price);
  });
  if(live)chart.subscribeCrosshairMove((p)=>{
   const bar=p.seriesData.get(series);
   setCursorTime(typeof p.time==='number'&&bar&&'open' in bar?p.time:null);
  });
  const redraw=()=>{
   if(redrawFrame.current!==undefined)return;
   if(!pickRef.current&&!modeRef.current&&!drawingsRef.current.user.length&&!drawingsRef.current.pine.length&&!levelRef.current.levels.length&&
      !(live&&chart.panes().length>1))return;
   redrawFrame.current=requestAnimationFrame(()=>{redrawFrame.current=undefined;setViewTick(v=>v+1)});
  };
  let edgeFrame:number|undefined,wasAtEdge=false;
  const onRange=()=>{
   redraw();
   if(!live||edgeFrame!==undefined)return;
   edgeFrame=requestAnimationFrame(()=>{
    edgeFrame=undefined;
    const range=chart.timeScale().getVisibleLogicalRange();
    const atEdge=Boolean(range&&range.from<80&&range.to>0);
    const count=ref.current?.count;
    if(range&&count&&range.to<count-1.5)navigation.current.onLeaveLatest?.();
    if(atEdge&&!wasAtEdge&&count)navigation.current.onHistoryEdge?.();
    wasAtEdge=atEdge;
   });
  };
  chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);const el=host.current;el.addEventListener('wheel',redraw);el.addEventListener('pointermove',redraw);const observer=new ResizeObserver(redraw);observer.observe(el);
  return()=>{observer.disconnect();el.removeEventListener('wheel',redraw);el.removeEventListener('pointermove',redraw);chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange);if(edgeFrame!==undefined)cancelAnimationFrame(edgeFrame);if(redrawFrame.current!==undefined)cancelAnimationFrame(redrawFrame.current);redrawFrame.current=undefined;ref.current=null;livePriceMarker.current=null;if(priceMarker)series.detachPrimitive(priceMarker);chart.remove()};
 },[]);
 useEffect(()=>{
  const chart:IChartApi|undefined=ref.current?.chart;
  if(!chart||!live||drawingMode||pricePicking||replayPicker||(!priceExpanded&&!paneStudies.length))return;
  const toggle=(event:MouseEventParams)=>{
   if(!event.point||(event.paneIndex??0)!==0)return;
   if(!priceExpanded)normalPaneSizes.current=readPaneSizes(chart,paneStudies);
   setPriceExpanded(!priceExpanded);
  };
  chart.subscribeDblClick(toggle);
  return ()=>chart.unsubscribeDblClick(toggle);
 },[live,drawingMode,pricePicking,replayPicker,priceExpanded,paneStudies]);
 useEffect(()=>{
  const r=ref.current;
  if(!appearance||!r)return;
  const {background,text,grid,verticalGrid,horizontalGrid,upColor,downColor,wickUpColor,wickDownColor,
    borderUpColor,borderDownColor,wickVisible,borderVisible}=appearance;
  r.chart.applyOptions({layout:{background:{type:ColorType.Solid,color:background},textColor:text,panes:{separatorColor:grid}},
    grid:{vertLines:{color:grid,visible:verticalGrid},horzLines:{color:grid,visible:horizontalGrid}},
    rightPriceScale:{borderColor:grid},timeScale:{borderColor:grid}});
  r.series.applyOptions({upColor,downColor,wickUpColor,wickDownColor,borderUpColor,borderDownColor,wickVisible,borderVisible});
 },[appearance]);
 useEffect(()=>{
  const r=ref.current;if(!r)return;
  const scale=r.chart.timeScale(),previous=scale.getVisibleLogicalRange();
  const old:Bar[]=r.data??[];
  const tail=bars.at(-1);
  let range;
  if(live){
   if(old===bars)return;
   const removed=old.findIndex(bar=>bar.time===bars[0]?.time);
   const inserted=removed<0?bars.findIndex(bar=>bar.time===old[0]?.time):0;
   const offset=inserted>0?-inserted:Math.max(0,removed);
   range=previous&&old.length&&(removed>=0||inserted>=0)
    ? replayRange(previous,old.length,bars.length,offset,follow&&inserted<=0)
    : !follow&&liveViewport&&bars.length
      ? restoreLiveViewport(liveViewport,bars,seconds)
      : latestLiveRange(bars.length,host.current?.clientWidth??700);
   if(tail&&liveTailUpdate(old,bars)){
    if(old.length!==bars.length||!sameMarketBar(old[old.length-1],tail))r.series.update(tail);
    if(follow&&old.length!==bars.length)scale.setVisibleLogicalRange(range);
   }else{
    if(!old.length&&initialView?.follow&&initialView.viewport){
     const to=bars.length-1+initialView.rightOffset;
     range={from:to-initialView.viewport.span,to};
    }
    r.series.setData(bars);
    if(tail)scale.setVisibleLogicalRange(range);
    if(!old.length&&initialView?.priceRange)r.series.priceScale().setVisibleRange(initialView.priceRange);
   }
  }else{
   range=replayRange(previous,r.count,bars.length,barIndexOffset-(r.offset||0),follow);
   r.series.setData(bars);
   if(tail)scale.setVisibleLogicalRange(range);
  }
  r.data=bars;r.count=bars.length;r.offset=barIndexOffset;setViewTick(v=>v+1);
 },[bars,follow,barIndexOffset,live,liveViewport,seconds]);
 useEffect(()=>{const r=ref.current;if(!r)return;r.series.applyOptions({autoscaleInfoProvider:(base:Function)=>{const info=base();if(!info)return info;if(r.dragRange)return {...info,priceRange:r.dragRange};const selected=levels.some(l=>(l.tradeId||l.orderId||'draft')===focus)?focus:'draft';const prices=levels.filter(l=>(l.tradeId||l.orderId||'draft')===selected).map(l=>l.price).filter(p=>Number.isFinite(p)&&p>0);const range={minValue:Math.min(info.priceRange.minValue,...prices),maxValue:Math.max(info.priceRange.maxValue,...prices)};r.lastRange=range;return {...info,priceRange:range};}});setViewTick(v=>v+1)},[levels,focus]);
 const alertPrices=alertLevels.join(',');
 useEffect(()=>{
  const current=ref.current;
  if(!current||!alertPrices)return;
  const lines=alertPrices.split(',').map(Number).map(price=>current.series.createPriceLine({
   price,color:'#bb9658',lineStyle:2,lineWidth:1,axisLabelVisible:true,title:'Alert',
  }));
  return()=>{if(ref.current===current)for(const line of lines)current.series.removePriceLine(line)};
 },[alertPrices]);
 useEffect(()=>{const r=ref.current;if(!r)return;for(const line of r.lines)r.series.removePriceLine(line);r.lines=[];
  const selected=levels.some(l=>(l.tradeId||l.orderId||'draft')===focus)?focus:'draft';
  for(const l of levels.filter(l=>(l.tradeId||l.orderId||'draft')===selected))r.lines.push(r.series.createPriceLine({price:preview?.id===l.id?preview.price:l.price,color:l.color,lineWidth:1,lineStyle:l.pending||l.draft?2:0,axisLabelVisible:true,title:l.label}));
  const markerData:any[]=[...trades.flatMap(t=>[{time:t.time,position:t.side==='long'?'belowBar':'aboveBar',color:t.side==='long'?'#35c4a0':'#ef6b79',shape:t.side==='long'?'arrowUp':'arrowDown',text:t.side==='long'?'Buy':'Sell'},...t.exits.map(e=>({time:e.time,position:'aboveBar',color:e.pnl>=0?'#35c4a0':'#ef6b79',shape:'circle',text:e.reason.split(' ')[0]}))]),...shapes.map(s=>({time:s.time,position:markerPosition(s.location),color:s.color,shape:markerShape(s.shape),text:showPineText?(s.text||s.indicatorName):''}))];
  const times=bars.map(b=>b.time);const mapped=markerData.map(m=>{let i=times.length-1;while(i>=0&&times[i]>m.time)i--;return i>=0?{...m,time:times[i]}:null}).filter(Boolean).sort((a:any,b:any)=>a.time-b.time);r.markers.setMarkers(mapped);
 },[trades,bars,shapes,levels,preview,focus,showPineText]);
 useEffect(()=>{const r=ref.current;if(!r)return;const visible=new Set<string>();const panes=paneStudies.map(([id])=>id);const previousPanes=r.chart.panes().length;
  for(const p of plots){
   const id=p.indicatorId||'legacy', key=[id,p.name,p.style,p.overlay?'1':'0'].join('|');
   const pane=p.overlay?0:panes.indexOf(id)+1;
   const horizontal=p.style==='hline', pattern=pineStroke(p.lineStyle), lineStyle=pattern==='dotted'?1:pattern==='dashed'?2:0;
   // Lightweight Charts draws a scale title even with lastValueVisible=false.
   // Pine captions belong on their drawings; display.pane plots need a clean scale.
   const title=live||horizontal?'':showPineText?p.name:'';
   visible.add(key);
   let series=r.studies.get(key);
   if(!series){
    const type=['style_histogram','style_columns'].includes(p.style)?HistogramSeries:p.style==='style_area'?AreaSeries:LineSeries;
    const options={title,color:p.color,lineWidth:p.width,priceLineVisible:false,lastValueVisible:false,
     ...(type===AreaSeries?{lineColor:p.color,topColor:p.color,bottomColor:'#10151d00'}:{}),
     ...(horizontal?{lineVisible:false,crosshairMarkerVisible:false}:{})};
    series=r.chart.addSeries(type,options,pane);
    r.studies.set(key,series);
   }
   series.moveToPane(pane);
   series.applyOptions({title,color:p.color,lineWidth:p.width,lineStyle,lastValueVisible:false});
   series.setData(p.data.map(d=>d.value===null?{time:d.time}:{...d,value:d.value}));
   if(horizontal){
    const price=p.data.at(-1)?.value, existing=r.horizontals.get(key);
    if(price!=null){
     const options={price,color:p.color,lineWidth:p.width,lineStyle,axisLabelVisible:false,title:''};
     if(existing)existing.applyOptions(options);
     else r.horizontals.set(key,series.createPriceLine(options));
    }else if(existing){series.removePriceLine(existing);r.horizontals.delete(key);}
   }
  }
  for(const [key,series] of r.studies)if(!visible.has(key)){
   const line=r.horizontals.get(key);
   if(line){series.removePriceLine(line);r.horizontals.delete(key);}
   const hidden=hiddenStudyIds.has(key.split('|',1)[0])||priceExpanded&&key.endsWith('|0');
   if(calculating&&!hidden)series.setData([]);
   else{r.chart.removeSeries(series);r.studies.delete(key);}
  }
  if(!priceExpanded&&live&&(r.chart.panes().length!==previousPanes||normalPaneSizes.current)){
   const panes:ReturnType<IChartApi['panes']>=r.chart.panes();
   const sizes=normalPaneSizes.current??initialView?.paneSizes;
   panes[0].setStretchFactor(sizes?.price??3);
   panes.slice(1).forEach((pane,i)=>pane.setStretchFactor(sizes?.[paneStudies[i]?.[0]]??1));
   normalPaneSizes.current=null;
  }else if(!live&&r.chart.panes().length>previousPanes){
   for(let i=1;i<r.chart.panes().length;i++)r.chart.panes()[i].setHeight(150);
  }
 setPaneCount(Math.max(0,r.chart.panes().length-1));setViewTick(v=>v+1);},[plots,paneStudies,calculating,hiddenStudyIds,priceExpanded,showPineText,live]);
 useEffect(()=>{
  const r=ref.current;
  if(!r||!fills.length)return;
  const layers:PineBandLayer[]=[];
  const hosts=new Map<PineBandLayer, typeof r.series>();
  const groups=new Map<typeof r.series,PineBand[]>();
  for(const fill of fills){
   const plot=plots.find(p=>p.indicatorId===fill.indicatorId&&p.overlay===fill.overlay);
   const series=fill.overlay?r.series:plot&&r.studies.get([plot.indicatorId,plot.name,plot.style,'0'].join('|'));
   if(series)groups.set(series,[...(groups.get(series)??[]),fill]);
  }
  for(const [series,bands] of groups){
   const layer=new PineBandLayer(bands);
   series.attachPrimitive(layer);layers.push(layer);hosts.set(layer,series);
  }
  return ()=>{if(ref.current===r)for(const layer of layers)hosts.get(layer).detachPrimitive(layer);};
 },[fills,plots]);
 useEffect(()=>{
  const r=ref.current;
  if(!r || !timeline.length)return;
  const frames=pineDrawings.filter(d=>d.layer==='background' && pineDash(d.border_style)==='1 3' && d.overlay!==false);
  if(!frames.length)return;
  const scale=r.chart.timeScale();
  const anchors=frames.map(d=>({d,
   left:logicalAtTime(d.left/1000,timeline,seconds)-barIndexOffset,
   right:logicalAtTime(d.right/1000,timeline,seconds)-barIndexOffset}));
  const renderer:IPrimitivePaneRenderer={draw:target=>target.useMediaCoordinateSpace(({context})=>{
   const barX=(slot:number)=>scale.logicalToCoordinate(slot as Logical);
   context.save();
   for(const {d,left,right} of anchors){
    const x=scale.timeToCoordinate((d.left/1000 as UTCTimestamp))??coordinateAtLogical(left,barX);
    const end=scale.timeToCoordinate((d.right/1000 as UTCTimestamp))??coordinateAtLogical(right,barX);
    const y=r.series.priceToCoordinate(d.top),base=r.series.priceToCoordinate(d.bottom);
    if(x===null||end===null||y===null||base===null)continue;
    context.fillStyle=d.bgcolor||'transparent';
    context.fillRect(x,y,end-x,base-y);
    context.strokeStyle=d.border_color||'transparent';
    context.lineWidth=d.border_width||1;
    context.setLineDash((pineDash(d.border_style)||'').split(' ').filter(Boolean).map(Number));
    context.strokeRect(x,y,end-x,base-y);
   }
   context.restore();
  })};
  const views=[{zOrder:()=>'bottom' as const,renderer:()=>renderer}];
  const primitive={paneViews:()=>views};
  r.series.attachPrimitive(primitive);
  return ()=>{if(ref.current===r)r.series.detachPrimitive(primitive);};
 },[pineDrawings,timeline,seconds,barIndexOffset]);
 const overlay=(()=>{
  const r=ref.current;
  if(!r||!host.current||!pineDrawings.length)return null;
  const scale=(r.chart as IChartApi).timeScale();
  const w=scale.width(),h=host.current.clientHeight;
  const narrow = live && window.matchMedia(compactChartMedia).matches;
  const paneHeight = r.chart.panes()[0].getHeight();
  const barX = (slot: number) => scale.logicalToCoordinate(slot as Logical);
  function pineX(value:unknown,xloc:unknown): number|null {
   if(value==null)return null;
   const x=Number(value);
   if(!Number.isFinite(x))return null;
   const location=String(xloc??'').toLowerCase();
   if(!location.includes('time')&&location!=='bt')return coordinateAtLogical(x-barIndexOffset,barX);
   if(!timeline.length)return null;
   const time=(x>=1e12?x/1000:x) as UTCTimestamp;
   const exact = scale.timeToCoordinate(time);
   if (exact !== null) return exact;
   return coordinateAtLogical(logicalAtTime(time,timeline,seconds)-barIndexOffset,barX);
  }
  const items:ReactNode[]=[], backgrounds:ReactNode[]=[], zones:ReactNode[]=[];
  const zoneBounds:{left:number;right:number;top:number;bottom:number;study:string}[]=[];
  const clusterPath:string[]=[];
  for(const d of [...pineDrawings.filter(d=>d.kind==='linefill'),...pineDrawings.filter(d=>d.kind!=='linefill')]){if(d.overlay===false)continue;
   if(d.kind==='linefill'&&d.line1&&d.line2&&!d.line1._deleted&&!d.line2._deleted){const points=[d.line1,d.line2].map(line=>{let ax=pineX(line.x1,line.xloc),bx=pineX(line.x2,line.xloc),ay=r.series.priceToCoordinate(Number(line.y1)),by=r.series.priceToCoordinate(Number(line.y2));if(ax===null||bx===null||ay===null||by===null)return null;const slope=(by-ay)/(bx-ax||1);if(['l','b','left','both'].includes(String(line.extend))){ay+=slope*(0-ax);ax=0;}if(['r','b','right','both'].includes(String(line.extend))){by+=slope*(w-bx);bx=w;}return [[ax,ay],[bx,by]];});if(points.every(Boolean)){const [a,b]=points as number[][][];items.push(<polygon key={'p-f-'+d.indicatorId+'-'+d.id} points={[...a,...b.slice().reverse()].map(p=>p.join(',')).join(' ')} fill={cssColor(d.color)}/>);}}

   if(d.kind==='line'){let x1=pineX(d.x1,d.xloc),x2=pineX(d.x2,d.xloc),y1=r.series.priceToCoordinate(Number(d.y1)),y2=r.series.priceToCoordinate(Number(d.y2));if(x1===null||x2===null||y1===null||y2===null)continue;const ax=x1,ay=y1,bx=x2,by=y2;const slope=(by-ay)/(bx-ax||1);if(['l','b','left','both'].includes(String(d.extend))){x1=0;y1=ay+slope*(x1-ax);}if(['r','b','right','both'].includes(String(d.extend))){x2=w;y2=ay+slope*(x2-ax);}items.push(<line key={'p-l-'+d.indicatorId+'-'+d.id} x1={x1} y1={y1} x2={x2} y2={y2} stroke={cssColor(d.color,'#d7b46a')} strokeWidth={Math.max(1,Number(d.width)||1)} strokeDasharray={pineDash(d.style)}/>);}
   if(d.kind==='box'){
    if(d.layer==='background' && pineDash(d.border_style)==='1 3')continue;
    const left=pineX(d.left,d.xloc),right=pineX(d.right,d.xloc);
    if(left===null||right===null||!Number.isFinite(d.top)||!Number.isFinite(d.bottom))continue;
    const top=r.series.priceToCoordinate(d.top),bottom=r.series.priceToCoordinate(d.bottom);
    if(top===null||bottom===null)continue;
    const layer=d.layer==='zone'?zones:d.layer==='background'?backgrounds:items;
    layer.push(<PineBox key={'p-b-'+d.indicatorId+'-'+d.id} d={d} left={left} right={right} top={top} bottom={bottom} paneWidth={w} showText={showPineText} compact={narrow}/>);
    if(d.layer==='zone'){
     const bounds={left:Math.max(0,Math.min(left,right)),right:Math.min(w,Math.max(left,right)),
      top:Math.max(0,Math.min(top,bottom)),bottom:Math.min(paneHeight,Math.max(top,bottom)),study:d.indicatorId};
     for(const prior of zoneBounds){
      if(prior.study!==bounds.study)continue;
      const x=Math.max(prior.left,bounds.left),end=Math.min(prior.right,bounds.right);
      const y=Math.max(prior.top,bounds.top),base=Math.min(prior.bottom,bounds.bottom);
      if(end>x&&base>y)clusterPath.push(`M${x} ${y}H${end}V${base}H${x}Z`);
     }
     zoneBounds.push(bounds);
    }
   }
   if(d.kind==='label'&&showPineText&&Number.isFinite(d.y)){
    const x=pineX(d.x,d.xloc),y=r.series.priceToCoordinate(d.y);
    if(x!==null&&y!==null)items.push(<PineLabel key={'p-t-'+d.indicatorId+'-'+d.id} d={d} x={x} y={y}
     bounds={narrow ? {width:w,height:paneHeight} : undefined}/>);
   }
  }
  return <svg className="drawing-overlay" width={w} height={h} pointerEvents="none"><defs><clipPath id={pricePaneClip}><rect width={w} height={paneHeight}/></clipPath></defs>
   <g clipPath={'url(#'+pricePaneClip+')'}>{backgrounds}{zones}{clusterPath.length>0&&<path className="pine-cluster" d={clusterPath.join(' ')} fill="#ffd166" fillOpacity={.32}/>} {items}</g></svg>})();
 const priceAt=(clientY:number)=>{const r=ref.current;if(!r||!host.current)return null;const y=clientY-host.current.getBoundingClientRect().top;if(y<0||y>r.chart.panes()[0].getHeight())return null;const value=r.series.coordinateToPrice(y);return value===null?null:Math.round(value*100)/100;};
 const groups=[...new Set(levels.map(l=>l.tradeId||l.orderId||'draft'))];const handles=levels.filter(l=>(l.tradeId||l.orderId||'draft')===(groups.includes(focus)?focus:'draft')).map(l=>{const r=ref.current;if(!r)return null;const price=preview?.id===l.id?preview.price:l.price;const y=r.series.priceToCoordinate(price);if(y===null||y<0||y>r.chart.panes()[0].getHeight())return null;return <button key={l.id} className={'chart-price-handle '+l.kind+(l.pending?' pending-level':'')} style={{top:y-17,borderColor:l.color,color:l.color}} aria-label={l.label+' '+price.toFixed(2)+(l.editable?' ลากเพื่อปรับราคา':'')} disabled={!l.editable} onPointerDown={e=>{e.preventDefault();e.stopPropagation();levelRef.current.onDragStart?.();e.currentTarget.setPointerCapture(e.pointerId);if(ref.current?.lastRange)ref.current.dragRange={...ref.current.lastRange};activeDrag.current={level:l,price:l.price};setPreview({id:l.id,price:l.price});}} onPointerMove={e=>{if(!activeDrag.current||activeDrag.current.level.id!==l.id)return;const value=priceAt(e.clientY);if(value===null)return;activeDrag.current.price=value;setPreview({id:l.id,price:value});if(l.draft)levelRef.current.onLevelPreview?.(l,value);}} onPointerUp={e=>{if(!activeDrag.current)return;const drag=activeDrag.current;activeDrag.current=null;if(ref.current)ref.current.dragRange=null;e.currentTarget.releasePointerCapture(e.pointerId);setPreview(null);if(drag.price!==drag.level.price)levelRef.current.onLevelCommit?.(drag.level,drag.price);}} onPointerCancel={()=>{if(activeDrag.current?.level.draft)levelRef.current.onLevelPreview?.(activeDrag.current.level,activeDrag.current.level.price);activeDrag.current=null;if(ref.current)ref.current.dragRange=null;setPreview(null);}} onKeyDown={e=>{if(e.key==='Escape'){if(activeDrag.current?.level.draft)levelRef.current.onLevelPreview?.(activeDrag.current.level,activeDrag.current.level.price);activeDrag.current=null;if(ref.current)ref.current.dragRange=null;setPreview(null);}if(e.key==='ArrowUp'||e.key==='ArrowDown'){e.preventDefault();levelRef.current.onDragStart?.();levelRef.current.onLevelCommit?.(l,Math.round((l.price+(e.key==='ArrowUp'?1:-1)*(e.shiftKey?1:.01))*100)/100);}}}><span>{l.label}</span><strong>{price.toFixed(2)}</strong>{l.editable&&<span className="handle-grip">⠿</span>}</button>;});
 async function chartPng(): Promise<Blob> {
  const current=ref.current;
  const container=host.current;
  if(!current||!container||!container.clientWidth)throw Error('กราฟยังไม่พร้อมสร้างภาพ');
  const canvas: HTMLCanvasElement=current.chart.takeScreenshot(live);
  const ctx=canvas.getContext('2d');
  if(!ctx)throw Error('สร้างภาพกราฟไม่สำเร็จ');
  const scale=canvas.width/container.clientWidth;
  const mark=brandMark.current;
  if(mark?.naturalWidth){
   const bottom=current.chart.timeScale().height()+brandMarkInset;
   ctx.save();
   ctx.globalAlpha=.85;
   ctx.drawImage(mark,brandMarkInset*scale,canvas.height-(bottom+brandMarkHeight)*scale,brandMarkWidth*scale,brandMarkHeight*scale);
   ctx.restore();
  }
  const overlays=container.parentElement?.querySelectorAll('.drawing-overlay,.user-drawing-overlay')??[];
  for(const svg of overlays){
   const clone=svg.cloneNode(true) as SVGElement;
   clone.querySelectorAll('[data-drawing-interaction]').forEach(el=>el.remove());
   const style=document.createElementNS('http://www.w3.org/2000/svg','style');
   style.textContent='.drawing-line,.drawing-fib{stroke:#d7b46a;stroke-width:1.4}.drawing-box{fill:#d7b46a18;stroke:#d7b46a}.drawing-label{fill:#d7b46a;font:11px sans-serif}';
   clone.prepend(style);
   const url=URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)],{type:'image/svg+xml'}));
   try {
    const image=new Image();
    image.src=url;
    await image.decode();
    ctx.drawImage(image,0,(parseFloat(clone.style.top)||0)*scale,Number(clone.getAttribute('width'))*scale,Number(clone.getAttribute('height'))*scale);
   } finally { URL.revokeObjectURL(url); }
  }
  return new Promise((resolve,reject)=>canvas.toBlob(blob=>{
   if(blob)resolve(blob);
   else reject(Error('สร้างภาพกราฟไม่สำเร็จ'));
  },'image/png'));
 }
 async function exportChart(){
  const blob=await chartPng();
  const url=URL.createObjectURL(blob);
  const link=document.createElement('a');
  link.href=url;
  link.download=symbol+(live?'-live.png':'-replay.png');
  link.click();
  setTimeout(()=>URL.revokeObjectURL(url),10000);
 }
 async function copyChart(){
  if(!navigator.clipboard?.write||typeof ClipboardItem==='undefined'
    ||(ClipboardItem.supports&&!ClipboardItem.supports('image/png'))){
   throw Error('เบราว์เซอร์นี้คัดลอกรูปไม่ได้ ใช้ดาวน์โหลด PNG ได้');
  }
  // Start writing inside the click so Safari retains the user gesture during PNG creation.
  const png=chartPng();
  void png.catch(()=>{});
  try {
   await navigator.clipboard.write([new ClipboardItem({'image/png':png})]);
  } catch(error) {
   if(error instanceof DOMException&&error.name==='NotAllowedError'){
    throw Error('เบราว์เซอร์ไม่อนุญาตให้คัดลอกรูป ใช้ดาวน์โหลด PNG ได้');
   }
   throw Error('คัดลอกรูปไม่สำเร็จ ใช้ดาวน์โหลด PNG ได้');
  }
 }
 async function replaySnapshot(action:'copy'|'download'){
  setSnapshotMessage('กำลังสร้างภาพกราฟ…');
  try {
   await (action==='copy'?copyChart():exportChart());
   setSnapshotMessage(action==='copy'?'คัดลอกรูปกราฟแล้ว':'เริ่มดาวน์โหลด PNG แล้ว');
  } catch(error) {
   setSnapshotMessage(error instanceof Error?error.message:'สร้างภาพกราฟไม่สำเร็จ');
  }
 }
 useEffect(()=>{const next=levels.filter(l=>l.tradeId).at(-1)?.tradeId;if(next)setFocus(next);},[trades.filter(t=>t.remaining>0).length]);
 const tableGroups=new Map<string,PineTable[]>();for(const t of (showPineTables?pineTables:[]).filter(t=>t.cells?.some(row=>row.some(cell=>cell?.text?.trim())))){const pos=String(t.position||'top_right').replaceAll('_','-');tableGroups.set(pos,[...(tableGroups.get(pos)||[]),t]);}
 const tables=[...tableGroups].map(([position,group])=><div key={position} className={'pine-table-group pine-table-'+position}>{group.map(t=><details open key={t.indicatorId+'-'+t.id} className="pine-table" style={{background:cssColor(t.bgcolor,'#10151de6'),borderColor:cssColor(t.frame_color||t.border_color,'#334155')}}><summary className="pine-table-name">{t.indicatorName}</summary><table><tbody>{(t.cells||[]).map((row:any[],ri:number)=><tr key={ri}>{row.map((cell:any,ci:number)=><td key={ci} style={{background:cssColor(cell?.bgcolor,'transparent'),color:cssColor(cell?.text_color,'#dbe4ef'),textAlign:(cell?.text_halign||'left').replace('text.align_','') as any}} title={cell?.tooltip||''}>{cell?.text||''}</td>)}</tr>)}</tbody></table></details>)}</div>);
 const shownBar=live?(bars.find(bar=>bar.time===cursorTime)??bars.at(-1)):undefined;
 function goFirst(){
  const width=host.current?.clientWidth??700;
  const count=Math.max(24,Math.min(110,Math.floor(width/8)));
  ref.current?.chart.timeScale().setVisibleLogicalRange({from:0,to:Math.min(count,bars.length)});
 }
 function goLatest(){
  const range=live?latestLiveRange(bars.length,ref.current?.chart.timeScale().width()||host.current?.clientWidth||700):replayRange(null,0,bars.length,0,true);
  ref.current?.chart.timeScale().setVisibleLogicalRange(range);
 }
 useImperativeHandle(liveActions,()=>({
  fit:()=>ref.current?.chart.timeScale().setVisibleLogicalRange({from:-1,to:bars.length+4}),
  first:goFirst,
  latest:goLatest,
  resetView:()=>{
   const r=ref.current;
   if(!r)return;
   r.series.priceScale().applyOptions({autoScale:true});
   const panes:ReturnType<IChartApi['panes']>=r.chart.panes();
   panes.forEach((pane,i)=>pane.setStretchFactor(i?1:3));
   goLatest();
  },
  viewport:()=>{
   const range=ref.current?.chart.timeScale().getVisibleLogicalRange();
   return range&&bars.length?captureLiveViewport(range,bars,seconds):null;
  },
  captureView:(following)=>{
   const r=ref.current,range=r?.chart.timeScale().getVisibleLogicalRange();
   if(!range||!bars.length)return null;
   const axis=r.series.priceScale();
   const paneSizes=normalPaneSizes.current??readPaneSizes(r.chart,paneStudies);
   return {follow:following,viewport:captureLiveViewport(range,bars,seconds),rightOffset:range.to-bars.length+1,
    priceRange:axis.options().autoScale?null:axis.getVisibleRange(),paneSizes};
  },
  utility:chooseUtility,
  exportPng:exportChart,
  copyPng:copyChart,
 }));

 function chooseUtility(tool:ChartUtility) {
  onDrawingCancel?.();
  setZoomBox(null);
  setUtility(tool);
  const chart=ref.current?.chart;
  chart?.applyOptions({crosshair:{
    mode:['dot','arrow','erase','zoom'].includes(tool)?CrosshairMode.Hidden:CrosshairMode.Normal,
    vertLine:{color:tool==='magic'?'#ba8af0':tool==='demo'?'#dbb76e':'#536278'},
    horzLine:{color:tool==='magic'?'#ba8af0':tool==='demo'?'#dbb76e':'#536278'},
  }});
 }
 const brandMarkBottom=(ref.current?.chart.timeScale().height()||26)+brandMarkInset;
 const canvas = <>
  <div className="chart-canvas" data-chart-utility={drawingMode?"cross":utility} ref={host} tabIndex={live?0:undefined} aria-label={'กราฟแท่งเทียน '+marketInfo[symbol].label+' พร้อมอินดิเคเตอร์'}/>{overlay}{drawingPanes.map(pane=><ChartDrawings key={pane.id} api={ref.current} pane={pane.id ? pane : undefined} host={host.current} controlsHost={placementHost.current} confirmPlacement={live || confirmDrawingPlacement} readOnly={Boolean(replayPicker)||readOnlyDrawings||Boolean(drawingMode&&pane.id!==activePane)} keyboardOwner={pane.id===keyboardPane} timeline={timeline} offset={barIndexOffset} seconds={seconds} drawings={drawings.filter(d=>(d.pane??'')===pane.id)} mode={pane.id===activePane ? drawingMode : null} hidden={hiddenDrawings} magnet={magnet} strongMagnet={strongMagnet} onToggleMagnet={onToggleMagnet} selected={selectedDrawing} pricePicking={pricePicking} onSelect={id=>onDrawingSelect?.(id)} onEdit={onDrawingEdit} onErase={!drawingMode && utility==='erase' ? onDrawingRemove : undefined} onCreate={d=>onDrawing?.(d)} onChange={d=>onDrawingChange?.(d)} onCancel={()=>onDrawingCancel?.()} onDelete={()=>onDrawingDelete?.()} onUndo={()=>onDrawingUndo?.()} onRedo={()=>onDrawingRedo?.()} onDragStart={()=>{onDragStart?.();if(ref.current?.lastRange)ref.current.dragRange={...ref.current.lastRange};}} onDragEnd={()=>{if(ref.current){ref.current.dragRange=null;ref.current.series.applyOptions({});}setViewTick(v=>v+1);}}/>)}{!drawingMode&&!selectedDrawing&&handles}{tables}
  {replayPicker && replayPicker.time!==null && (() => {
    const r=ref.current;
    if(!r)return null;
    const scale=r.chart.timeScale();
    const x=coordinateAtLogical(logicalAtTime(replayPicker.time,bars,seconds),slot=>scale.logicalToCoordinate(slot as Logical));
    if(x===null || x<0 || x>scale.width())return null;
    return <div className="inline-replay-marker" style={{left:x,height:r.chart.panes()[0]?.getHeight()}}>
      <button type="button" aria-label="เลื่อนจุดเริ่ม Replay" title="ลากเพื่อเลื่อนจุดเริ่ม"
        onPointerDown={event=>{if(event.isPrimary&&event.button===0)event.currentTarget.setPointerCapture(event.pointerId)}}
        onPointerMove={event=>{
          if(!event.currentTarget.hasPointerCapture(event.pointerId)||!host.current)return;
          const logical=scale.coordinateToLogical(event.clientX-host.current.getBoundingClientRect().left);
          const bar=logical===null?undefined:bars[Math.round(logical)];
          if(bar)replayPicker.onPick(bar.time);
        }}
        onKeyDown={event=>{
          if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight')return;
          const index=Math.round(logicalAtTime(replayPicker.time!,bars,seconds))+(event.key==='ArrowLeft'?-1:1);
          const bar=bars[index];
          if(bar){event.preventDefault();replayPicker.onPick(bar.time);}
        }}>↔</button>
    </div>;
  })()}
  {!replayPicker && !drawingMode && utility==='zoom' && <div className="chart-zoom-drag" aria-label="ลากกรอบเพื่อซูมกราฟ"
    style={{width:ref.current?.chart.timeScale().width(),height:ref.current?.chart.panes()[0]?.getHeight()}}
    onPointerDown={event=>{
      if (!event.isPrimary || event.button!==0)return;
      const r=event.currentTarget.getBoundingClientRect();
      const x=event.clientX-r.left,y=event.clientY-r.top;
      event.currentTarget.setPointerCapture(event.pointerId);
      setZoomBox({x,y,right:x,bottom:y});
    }}
    onPointerMove={event=>{
      if (!event.currentTarget.hasPointerCapture(event.pointerId))return;
      const r=event.currentTarget.getBoundingClientRect();
      setZoomBox(box=>box?{...box,right:Math.max(0,Math.min(r.width,event.clientX-r.left)),
       bottom:Math.max(0,Math.min(r.height,event.clientY-r.top))}:null);
    }}
    onPointerCancel={()=>setZoomBox(null)}
    onPointerUp={()=>{
      const r=ref.current;
      if (!r || !zoomBox)return;
      if (Math.abs(zoomBox.x-zoomBox.right)>=12) {
        const scale=r.chart.timeScale();
        const from=scale.coordinateToLogical(Math.min(zoomBox.x,zoomBox.right));
        const to=scale.coordinateToLogical(Math.max(zoomBox.x,zoomBox.right));
        if(from!==null&&to!==null&&to-from>=1) {
          onLeaveLatest?.();
          scale.setVisibleLogicalRange({from,to});
        }
      }
      chooseUtility('cross');
    }}>
    {zoomBox && <span style={{left:Math.min(zoomBox.x,zoomBox.right),top:Math.min(zoomBox.y,zoomBox.bottom),
      width:Math.abs(zoomBox.x-zoomBox.right),height:Math.abs(zoomBox.y-zoomBox.bottom)}}/>}
  </div>}
  <img ref={brandMark} className="chart-brand-mark" src={brandMarkUrl} alt=""
   width={brandMarkWidth} height={brandMarkHeight} style={{left:brandMarkInset,bottom:brandMarkBottom}}/>
 </>;

 const ohlcValues=shownBar&&<div>{prices.map(([key,label,description])=><span key={key} aria-label={description} data-price={key}>
  <small>{label}</small> {ohlcNumber.format(shownBar[key])}
 </span>)}</div>;
 const candleTime=shownBar&&<time dateTime={new Date(shownBar.time*1000).toISOString()}>{dateFmt.format(shownBar.time*1000)}</time>;
 const plotTop=live&&paneCount?host.current?.getBoundingClientRect().top:undefined;
 const livePanes:ReturnType<IChartApi['panes']>|undefined=plotTop===undefined?undefined:ref.current?.chart.panes();
 const showStudyTitles=appearance?.studyTitles!==false;

 if(live) return <div className={'chart-stage live-chart-stage'+(drawingMode?' drawing-active':'')}>
  <div className="live-plot-scroll">
   <div className="chart-scroll-content" style={paneCount?{minHeight:compact?168+paneCount*72:240+paneCount*112}:undefined}>
    {canvas}
    {liveBid!==undefined&&liveClock&&livePriceMarker.current&&
     <LivePriceCountdown marker={livePriceMarker.current} price={liveBid} seconds={seconds} serverNow={liveClock} calendar={marketInfo[symbol].calendar}/>}
    <div className="live-chart-meta">
     {shownBar&&<div className="live-ohlc" aria-label="ราคาแท่งเทียน" data-up={shownBar.close>=shownBar.open}>
      {candleTime}{ohlcValues}
     </div>}
     {liveLegend}
    </div>
    {plotTop!==undefined&&livePanes&&paneStudies.map(([id,plot],index)=>{
     const row=livePanes[index+1]?.getHTMLElement();
     const badge=liveStudyBadges?.find(item=>item.id===id);
     return row&&(showStudyTitles||badge)&&<span className="live-pane-title" key={id}
      data-study-state={badge?.state} data-status-only={!showStudyTitles || undefined}
      role={showStudyTitles ? undefined : 'img'}
      aria-label={badge ? (showStudyTitles ? badge.label + ' · ' : '') + studyStateLabel[badge.state] : undefined}
      style={{top:row.getBoundingClientRect().top-plotTop+5}}>
      <i className="live-study-dot" style={badge ? undefined : {backgroundColor:plot.color}} aria-hidden="true"/>
      {showStudyTitles && <>{plot.indicatorName??plot.name}
        {onToggleStudy && badge && <StudyVisibilityButton label={badge.label} hidden={false} onToggle={() => onToggleStudy(id)}/>}
      </>}
     </span>;
    })}
   </div>
  </div>
  {drawingMode && paneStudies.length>0 && !readOnlyDrawings && <label className="drawing-pane-select">
    <span>วาดบน</span><select aria-label="ช่องสำหรับวาด" value={activePane} onChange={event=>setDrawingPane(event.target.value)}>
      <option value="">กราฟราคา</option>
      {paneStudies.map(([id,plot])=><option key={id} value={id}>{plot.indicatorName||plot.name}</option>)}
    </select>
  </label>}
  <div className="live-placement-slot" ref={placementHost}/>
  {liveSelection}
 </div>;

 return <div className={'chart-stage'+(drawingMode?' drawing-active':'')+(expanded?' chart-expanded':'')}>
  <div className="chart-view-tools">
   {groups.length>0&&<select aria-label="เลือกออเดอร์ที่จะลากบนกราฟ" value={groups.includes(focus)?focus:'draft'} onChange={e=>setFocus(e.target.value)}>
    {groups.map(g=><option key={g} value={g}>{g==='draft'?'Draft SL / TP':(levels.find(l=>l.tradeId===g||l.orderId===g)?.label.split(' ').slice(0,2).join(' ')||g)}</option>)}
   </select>}
   <button onClick={()=>ref.current?.chart.timeScale().fitContent()} title="ดูช่วงที่เปิดแล้วทั้งหมด">Fit</button>
   <select value={utility} aria-label="เคอร์เซอร์และซูม" onChange={event=>chooseUtility(event.target.value as ChartUtility)}>
    <option value="cross">กากบาท</option><option value="dot">จุด</option><option value="arrow">ลูกศร</option>
    <option value="demo">นำเสนอ</option><option value="magic">เส้นเน้นสีม่วง</option><option value="erase">ยางลบ</option><option value="zoom">ลากกรอบซูม</option>
   </select>
   <button onClick={goLatest}>แท่งล่าสุด</button>
   <button onClick={goLatest}>Reset</button>
   <button onClick={()=>setExpanded(v=>!v)}>{expanded?'ย่อกราฟ':'ขยายกราฟ'}</button>
   <button onClick={()=>void replaySnapshot('download')}>PNG</button>
   <button onClick={()=>void replaySnapshot('copy')}>คัดลอกรูป</button>
   <span className="replay-snapshot-message" role="status">{snapshotMessage}</span>
   <button aria-pressed={showPineText} onClick={toggleText}>ข้อความอินดี้</button>
   <button aria-pressed={showPineTables} onClick={toggleTables}>Dashboard</button>
  </div>
  <div className="chart-scroll-content" style={{height:Math.max(420,320+paneCount*150)}}>{canvas}</div>
 </div>;
}
