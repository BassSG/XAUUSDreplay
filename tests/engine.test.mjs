import test from 'node:test';
import assert from 'node:assert/strict';
import {simulate,appendCommand,normalizeBars,normalizeImportBars,aggregate,brokerTimeToUtc,utcToBrokerTime,defaultSettings} from '../src/lib/engine.ts';
const config={...defaultSettings,contractSize:1,spread:0,commission:0};
const t=1700000040;
const bar=(i,o=100,h=101,l=99,c=100)=>({time:t+i*60,open:o,high:h,low:l,close:c,volume:10});
const open=(extra={})=>({id:'entry',at:t,type:'open',side:'long',lots:10,sl:95,tp:120,...extra});

test('Eightcap import reconciles winter and US summer clock, including weeks outside EU DST',()=>{
 for(const [raw,utc] of [
  ['2021-01-04T00:00:00Z','2021-01-03T22:00:00Z'],
  ['2021-03-19T00:00:00Z','2021-03-18T21:00:00Z'],
  ['2021-11-03T00:00:00Z','2021-11-02T21:00:00Z'],
  ['2021-11-08T00:00:00Z','2021-11-07T22:00:00Z'],
 ]){const a=Date.parse(raw)/1000,b=Date.parse(utc)/1000;assert.equal(brokerTimeToUtc(a),b);assert.equal(utcToBrokerTime(b),a);}
 const raw=Date.parse('2026-10-07T06:45:00Z')/1000;
 const rows=[{time:raw,open:100,high:102,low:99,close:101,tick_volume:12}];
 assert.equal(normalizeImportBars(rows,'eightcap')[0].time,Date.parse('2026-10-07T03:45:00Z')/1000);
 assert.equal(normalizeImportBars(rows,'utc')[0].time,raw);
});

test('broker H4 aggregation keeps winter boundary across UTC midnight and revealed data only',()=>{
 const start=Date.parse('2021-01-04T00:00:00Z')/1000;
 const bars=Array.from({length:5},(_,i)=>({time:brokerTimeToUtc(start+i*3600),open:100+i,high:105+i,low:99+i,close:103+i,volume:10}));
 const partial=aggregate(bars.slice(0,2),14400,'eightcap');assert.equal(partial.length,1);assert.equal(partial[0].time,Date.parse('2021-01-03T22:00:00Z')/1000);assert.equal(partial[0].high,106);assert.equal(partial[0].close,104);assert.equal(partial[0].volume,20);
 const full=aggregate(bars,14400,'eightcap');assert.equal(full.length,2);assert.equal(full[0].high,108);assert.equal(full[0].close,106);assert.equal(full[0].volume,40);assert.equal(full[1].time,brokerTimeToUtc(start+14400));
});
test('new orders are pending at current close and fill next open; recompute is deterministic',()=>{
 const bars=[bar(0,100,130,90),bar(1,101,102,100)];
 const pending=simulate(bars,0,[open()],config);assert.equal(pending.trades.length,0);assert.equal(pending.pending.length,1);
 const full=simulate(bars,1,[open()],config);assert.equal(full.trades[0].entry,101);assert.equal(full.trades[0].risk,60);
 assert.deepEqual(full,simulate(bars,1,[open()],config));
});
test('same bar both protective levels: SL-first with ambiguity',()=>{
 const s=simulate([bar(0),bar(1,100,106,94) ],1,[open({lots:1,tp:105})],config);
 assert.equal(s.trades[0].pnl,-5);assert.equal(s.totalR,-1);assert.equal(s.trades[0].exits[0].ambiguous,true);
});
test('gap SL and TP are resolved at open before intrabar levels',()=>{
 const sl=simulate([bar(0),bar(1),bar(2,92,99,91)],2,[open({lots:1})],config);assert.equal(sl.totalR,-1.6);
 const tp=simulate([bar(0),bar(1),bar(2,108,110,94)],2,[open({lots:1,tp:105})],config);assert.equal(tp.totalR,1.6);assert.equal(tp.trades[0].exits[0].ambiguous,false);
});
test('partial close freezes initial risk and charges both commission sides',()=>{
 const cfg={...config,contractSize:100,commission:3};
 const commands=[open({lots:1}),{id:'half',at:t+60,type:'close',tradeId:'entry',fraction:.5}];
 const s=simulate([bar(0),bar(1),bar(2,110,111,109),bar(3,100,101,94)],3,commands,cfg);
 assert.equal(s.trades[0].risk,500);assert.equal(s.trades[0].pnl,244);assert.equal(s.totalR,.488);assert.equal(s.trades[0].remaining,0);
});
test('changed stop takes effect before next gap and initial risk survives breakeven',()=>{
 const cmd=[open({lots:1}),{id:'stop',at:t+60,type:'stop',tradeId:'entry',sl:90}];
 const s=simulate([bar(0),bar(1),bar(2,94,96,93)],2,cmd,config);
 assert.equal(s.trades[0].remaining,1);assert.equal(s.trades[0].sl,90);assert.equal(s.trades[0].risk,5);
 const be=simulate([bar(0),bar(1,100,104,99,103),bar(2,101,102,100)],2,[open({lots:1}),{id:'be',at:t+60,type:'stop',tradeId:'entry',sl:100}],config);
 assert.equal(be.trades[0].risk,5);assert.equal(be.totalR,0);
});
test('spread uses executable bid/ask levels once and commission is per side',()=>{
 const cfg={...config,contractSize:100,spread:.2,commission:3};
 for(const side of ['long','short']){
  const s=simulate([bar(0),bar(1),bar(2)],2,[open({side,lots:2,sl:side==='long'?95:105,tp:side==='long'?105:95}),{id:'close',at:t+60,type:'close',tradeId:'entry',fraction:1}],cfg);
  assert.equal(s.pnl,-52);
 }
 const s=simulate([bar(0),bar(1,100,100.5,99.05)],1,[open({lots:1,sl:99,tp:101})],{...config,spread:.2});
 assert.ok(Math.abs(s.trades[0].exits[0].price-99)<1e-9);
});
test('invalid orders and crossing stops rejected without corrupting account',()=>{
 for(const bad of [{tp:Infinity},{lots:NaN},{side:'invalid'}]){
  const s=simulate([bar(0),bar(1)],1,[open(bad)],config);assert.equal(s.trades.length,0);assert.equal(s.rejected.length,1);
 }
 for(const fraction of [0,NaN,2]){
  const s=simulate([bar(0),bar(1),bar(2)],2,[open(),{id:'close',at:t+60,type:'close',tradeId:'entry',fraction}],config);
  assert.equal(s.trades[0].remaining,10);assert.equal(s.rejected.length,1);
 }
 assert.throws(()=>simulate([bar(0)],0,[],{...config,spread:-1}));
});
test('rewinding reproduces pending order; later commands cannot leak into old cursor',()=>{
 const bars=[bar(0),bar(1),bar(2,110,111,109)];
 const commands=[open(),{id:'close',at:t+60,type:'close',tradeId:'entry'}];
 assert.equal(simulate(bars,0,commands,config).trades.length,0);
 const before=simulate(bars,1,commands,config);assert.equal(before.trades[0].remaining,10);
 assert.deepEqual(simulate(bars,2,commands,config),simulate(bars,2,commands,config));
});
test('normalization sorts, handles seconds/milliseconds/ISO and validates OHLC',()=>{
 const rows=[{...bar(1),timestamp:bar(1).time,time:undefined},{...bar(0),time:bar(0).time*1000},{...bar(0),time:new Date(bar(0).time*1000).toISOString()}];
 const normalized=normalizeBars(rows);assert.equal(normalized.length,2);assert.equal(normalized[0].time,t);
 assert.throws(()=>normalizeBars([{...bar(0),high:90}]));
});
test('higher timeframe contains only revealed minute bars',()=>{
 const prefix=[bar(0,100,103,98,102),bar(1,102,104,101,103)];const result=aggregate(prefix,3600);assert.equal(result[0].high,104);assert.equal(result[0].close,103);assert.equal(result[0].volume,20);assert.equal(prefix[0].high,103);
});


test('limit order remains cancellable until touched',()=>{
 const bars=[bar(0,100,101,99),bar(1,100,102,99),bar(2,100,111,89)];
 const pending={...open({lots:1,sl:90,tp:120}),orderType:'limit',entry:95};
 const first=simulate(bars,1,[pending],config);assert.equal(first.trades.length,0);assert.equal(first.orders.length,1);
 const cancelled=simulate(bars,2,[pending,{id:'cancel',at:t+60,type:'cancel',orderId:'entry'}],config);
 assert.equal(cancelled.trades.length,0);assert.equal(cancelled.orders.length,0);
});
test('pending order can be modified before fill',()=>{
 const bars=[bar(0),bar(1,100,103,98),bar(2,100,103,96)];
 const pending={...open({lots:1,sl:90,tp:120}),orderType:'limit',entry:95};
 const commands=[pending,{id:'modify',at:t+60,type:'modify',orderId:'entry',entry:97,sl:90,tp:120,lots:1}];
 const s=simulate(bars,2,commands,config);assert.equal(s.trades.length,1);assert.equal(s.trades[0].entry,97);
});
test('position protective TP can be modified without changing initial risk',()=>{
 const bars=[bar(0),bar(1,100,104,99,103),bar(2,103,108,102,107)];
 const commands=[open({lots:1,tp:120}),{id:'protect',at:t+60,type:'protect',tradeId:'entry',tp:110}];
 const s=simulate(bars,2,commands,config);assert.equal(s.trades[0].tp,110);assert.equal(s.trades[0].risk,5);
});

test('dragging SL then TP on the same candle keeps both next-bar amendments',()=>{
 const first={id:'sl',at:t+60,type:'protect',tradeId:'entry',sl:99};
 const second={id:'tp',at:t+60,type:'protect',tradeId:'entry',tp:108};
 const cmds=appendCommand(appendCommand([open({lots:1})],first),second);
 assert.equal(cmds.length,2);assert.equal(cmds[1].sl,99);assert.equal(cmds[1].tp,108);
 const bars=[bar(0),bar(1,100,104,99,103),bar(2,103,107,102,106)];
 const before=simulate(bars,1,cmds,config);assert.equal(before.trades[0].sl,95);assert.equal(before.trades[0].tp,120);
 const after=simulate(bars,2,cmds,config);assert.equal(after.trades[0].sl,99);assert.equal(after.trades[0].tp,108);assert.equal(after.trades[0].risk,5);
});
test('limit fill does not award a TP which may have occurred before entry',()=>{
 const cmd=open({orderType:'limit',entry:95,lots:1,sl:90,tp:105});
 const bars=[bar(0),bar(1,100,106,94,96),bar(2,96,106,95,105)];
 const early=simulate(bars,1,[cmd],config);assert.equal(early.trades[0].remaining,1);assert.equal(early.pnl,0);
 const later=simulate(bars,2,[cmd],config);assert.equal(later.trades[0].remaining,0);assert.equal(later.pnl,10);
});
test('pending gap across protection is rejected instead of creating an impossible profitable stop',()=>{
 const cmd=open({orderType:'limit',entry:95,lots:1,sl:90,tp:105});
 const s=simulate([bar(0),bar(1,85,88,84,86)],1,[cmd],config);assert.equal(s.trades.length,0);assert.equal(s.pnl,0);assert.equal(s.rejected.length,1);
});
