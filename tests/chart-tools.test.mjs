import test from 'node:test';
import assert from 'node:assert/strict';
import {logicalAtTime,timeAtLogical,moveDrawing,rayEnd,replayBatch,replayRange} from '../src/lib/chart-tools.ts';

const timeline=[{time:1700000000},{time:1700000300},{time:1700000600},{time:1700259900},{time:1700260200}];
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
