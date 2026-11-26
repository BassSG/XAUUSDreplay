import test from 'node:test';
import assert from 'node:assert/strict';
import {captureLiveViewport,coordinateAtLogical,logicalAtTime,restoreLiveViewport,timeAtLogical,moveDrawing,rayEnd,replayBatch,replayRange} from '../src/lib/chart-tools.ts';
import {drawingGeometry, positionMetrics, placementError} from '../src/lib/drawing-geometry.ts';
import {drawingGroups,drawingKinds} from '../src/lib/drawing-definitions.ts';

const timeline=[{time:1700000000},{time:1700000300},{time:1700000600},{time:1700259900},{time:1700260200}];

test('All Indy box spans a 5m origin and a millisecond projection on a 15m chart', () => {
 const last = 1795678200;
 const bars = Array.from({length: 32}, (_, i) => ({time: last - (31-i)*900}));
 const barX = slot => {
  assert.ok(Number.isInteger(slot), 'the chart only accepts whole logical slots');
  return 100 + (slot-31)*6;
 };
 const x = ms => coordinateAtLogical(logicalAtTime(ms/1000, bars, 900), barX);
 assert.ok(Math.abs(x(1795656300000) - (100-24*6-2)) < .001);
 assert.ok(Math.abs(x(1795685399992) - (100+8*6)) < .001);
 assert.equal(x(last*1000), 100);
 assert.equal(coordinateAtLogical(-2.5, slot => slot*10), -25);
 assert.equal(coordinateAtLogical(.5, slot => slot === 0 ? 0 : null), null);
});

test('switching a panned chart between timeframes preserves the visible time under its center', () => {
 const start=1700000000;
 const minutes=Array.from({length:500},(_,i)=>({time:start+i*60}));
 const fiveMinutes=Array.from({length:100},(_,i)=>({time:start+i*300}));
 const view=captureLiveViewport({from:206,to:254},minutes,60);
 assert.equal(view.time,start+230*60);
 const range=restoreLiveViewport(view,fiveMinutes,300);
 assert.deepEqual(range,{from:22,to:70});
});

test('Long and Short measure the confirmed prices and reject a stop or target on the wrong side', () => {
 const points=[{time:10,price:2000},{time:30,price:2030},{time:30,price:1990}];
 assert.deepEqual(positionMetrics('long',points),{reward:30,risk:10,ratio:3});
 assert.deepEqual(positionMetrics('short',[points[0],points[2],points[1]]),{reward:10,risk:30,ratio:1/3});
 assert.equal(placementError('long',points),null);
 assert.match(placementError('long',[points[0],points[2]]),/Take Profit/);
 assert.match(placementError('long',[points[0],points[1],{time:40,price:2001}]),/Stop Loss/);
});

test('Fibonacci levels and anchored tick VWAP use price and volume before screen projection', () => {
 const bars=[{time:10,open:100,high:100,low:100,close:100,volume:1},
  {time:20,open:120,high:120,low:120,close:120,volume:3},
  {time:30,open:200,high:200,low:200,close:200,volume:0}];
 const atIndex=(index,price)=>({x:index*25+10,y:(200-price)*2});
 const index=time=>(time-10)/10;
 const view={width:200,height:200,bars,visibleFrom:0,visibleTo:2,index,atIndex,at:p=>atIndex(index(p.time),p.price)};
 const fib=drawingGeometry({id:'f',kind:'fib',points:[{time:10,price:100},{time:30,price:150}]},view);
 assert.deepEqual(fib.filter(mark=>mark.kind==='label').map(mark=>mark.value),[
  '0% · 100.00','100% · 150.00','161.8% · 180.90','200% · 200.00',
  '261.8% · 230.90','350% · 275.00','423.6% · 311.80','547.2% · 373.60',
 ]);
 const custom=drawingGeometry({id:'f',kind:'fib',points:[{time:10,price:100},{time:30,price:150}],
  fib:{levels:[{value:1.75,enabled:true,text:'Target'},{value:.5,enabled:false}]}},view);
 assert.deepEqual(custom.filter(mark=>mark.kind==='label').map(mark=>mark.value),['175% · 187.50 · Target']);
 const vwap=drawingGeometry({id:'v',kind:'vwap',points:[{time:10,price:108}]},view);
 assert.deepEqual(vwap.find(mark=>mark.kind==='path').points,[{x:10,y:200},{x:35,y:170},{x:60,y:170}]);
 assert.deepEqual(Object.values(drawingGroups).flatMap(g=>g.tools).sort(),[...drawingKinds].sort());
});
test('anchors round-trip between candles, across weekend gaps and in empty future space',()=>{
 for(const logical of [-3,0,.5,1.3,2.25,3.5,4,9]){
  const time=timeAtLogical(logical,timeline,300);
  assert.ok(Math.abs(logicalAtTime(time,timeline,300)-logical)<.002);
 }
 assert.equal(timeAtLogical(5,timeline,300),timeline.at(-1).time+300);
});
test('moving an object keeps its candle span across a market gap and leaves the original untouched',()=>{
 const d={id:'trend',kind:'trend',points:[{time:timeline[0].time,price:2000},{time:timeline[1].time,price:2002}]};
 const moved=moveDrawing(d,d.points[0],{time:timeline[2].time,price:2005},null,timeline,300);
 assert.deepEqual(moved.points,[{time:timeline[2].time,price:2005},{time:timeline[3].time,price:2007}]);
 assert.equal(d.points[0].price,2000);
});
test('endpoint edits affect only that endpoint; locked and invalid whole moves are rejected',()=>{
 const d={id:'ray',kind:'ray',points:[{time:timeline[0].time,price:2},{time:timeline[1].time,price:3}]};
 const end={time:timeline[2].time,price:4};
 assert.deepEqual(moveDrawing(d,d.points[0],end,1,timeline,300).points,[d.points[0],end]);
 const locked={...d,locked:true};assert.equal(moveDrawing(locked,d.points[0],end,1,timeline,300),locked);
 assert.equal(moveDrawing(d,d.points[1],{time:timeline[2].time,price:.5},null,timeline,300),d);
});
test('rays extend toward the second point including leftward and vertical rays',()=>{
 assert.deepEqual(rayEnd({x:50,y:50},{x:70,y:60},100,100),{x:100,y:75});
 assert.deepEqual(rayEnd({x:50,y:50},{x:30,y:60},100,100),{x:0,y:75});
 assert.deepEqual(rayEnd({x:50,y:50},{x:50,y:20},100,100),{x:50,y:0});
 assert.deepEqual(rayEnd({x:50,y:50},{x:50,y:50},100,100),{x:50,y:50});
});
test('high-speed batches respect the endpoint while low speeds remain one candle per frame',()=>{
 assert.deepEqual([1,2,4,10,20,30,40,50,100].map(n=>replayBatch(n,100)),[1,1,1,1,1,3,4,5,10]);
 assert.equal(replayBatch(100,4),4);assert.equal(replayBatch(100,0),0);
 assert.equal(replayBatch(100,100,{bars:10,ms:450}),45);
 assert.equal(replayBatch(100,100,{bars:10,ms:1500}),50);
 assert.equal(replayBatch(30,100,{bars:3,ms:450}),14);
 assert.equal(replayBatch(20,100,{bars:1,ms:1000}),1);
});
test('Play follows at the chosen candle position without snapping the viewport to the right',()=>{
 const range={from:1900,to:2030};
 assert.deepEqual(replayRange(range,2000,2000,10,true),range);
 assert.deepEqual(replayRange(range,120,130,0,true),{from:1910,to:2040});
 const initial=replayRange(null,0,2000,0,true);assert.ok((1999-initial.from)/(initial.to-initial.from)<.75);
});
test('free chart view retains absolute timestamps when the 2,000 candle window rolls or rewinds',()=>{
 const range={from:1900,to:2030};
 assert.deepEqual(replayRange(range,2000,2000,10,false),{from:1890,to:2020});
 assert.deepEqual(replayRange(range,2000,2000,-10,false),{from:1910,to:2040});
 assert.deepEqual(replayRange(range,120,130,0,false),range);
});
