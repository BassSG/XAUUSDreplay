import assert from 'node:assert/strict';
import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {aggregate} from '../src/lib/engine.ts';
import {periodEnd,replayProvider} from '../src/lib/pine-data.ts';
import {periods} from '../src/lib/live-market.ts';
import {adaptPineSource,optimizePrepared} from '../src/lib/pine-compat.ts';
let callback,progressCallback,partialCallback,historyCallback,sequence=0;
globalThis.self={postMessage:value=>{
 if(value.historyRequest)historyCallback?.(value.historyRequest);
 else if(value.progress)progressCallback?.(value);
 else if(value.partial)partialCallback?.(structuredClone(value));
 else callback(value);
}};
await import('../src/lib/pine.worker.ts');
const base=Array.from({length:2400},(_,i)=>({time:1700000100+i*60,open:2000+Math.sin(i/8)*3+i/100,high:2004+Math.sin(i/8)*3+i/100,low:1996+Math.sin(i/8)*3+i/100,close:2000.4+Math.sin(i/8)*3+i/100,volume:10+(i%7)}));
async function run(source,{bars=base,baseBars=bars,seconds=60,baseSeconds=60,scripts,plotLimit,live}={}){return new Promise(resolve=>{callback=resolve;self.onmessage({data:{id:++sequence,source,bars,baseBars,seconds,baseSeconds,calendar:'utc',scripts,plotLimit,live}})});}
const assertGood=r=>assert.deepEqual(r.errors,[],r.errors.join(' | '));
test('Live publishes a finished study before it evaluates the next script',async()=>{
 const events=[];
 const bars=base.slice(0,30);
 const scripts=[
  {id:'first',name:'First',source:'//@version=6\nindicator("First")\nplot(close,"First close")'},
  {id:'second',name:'Second',source:'//@version=6\nindicator("Second")\nplot(open,"Second open")'},
 ];
 partialCallback=value=>events.push(value);
 progressCallback=value=>events.push(value.progress);
 try{
  const result=await new Promise(resolve=>{callback=resolve;self.onmessage({data:{
   id:++sequence,scripts,bars,seconds:60,live:{asOf:bars.at(-1).time+60,minutes:bars},
  }});});
  assertGood(result);
  const first=events.findIndex(event=>event.partial);
  assert.ok(first>=0&&first<events.indexOf('Second'));
  assert.deepEqual(events[first].studies.map(study=>study.id),['first']);
  assert.equal(events[first].plots[0].data.at(-1).value,bars.at(-1).close);
  assert.deepEqual(result.studies.map(study=>study.id),['first','second']);
 }finally{partialCallback=undefined;progressCallback=undefined;}
});
test('the live Pine worker reports candle execution before returning its plots',async()=>{
 const progress=[];
 const bars=base.slice(0,30);
 progressCallback=value=>progress.push(value.progress);
 try{
  const source='//@version=6\nindicator("Tracked")\nplot(close,"Close")';
  const result=await new Promise(resolve=>{callback=resolve;self.onmessage({data:{
   id:++sequence,scripts:[{id:'tracked',name:'Tracked',source}],bars,seconds:60,
   live:{asOf:bars.at(-1).time+60,minutes:bars},
  }});});
  assertGood(result);
  assert.ok(progress.some(text=>text.startsWith('Tracked · ')&&text.endsWith('1/30')));
  assert.equal(result.plots[0].data.at(-1).value,bars.at(-1).close);
 }finally{progressCallback=undefined;}
});
test('EBW Basic builds the requested tuple history even when its chart guard would be false on the requested timeframe', async () => {
 const source=`//@version=6
indicator("EBW-Fibo 1.10.32 · Basic")
f_confirmedLevels() =>
    [high[1], low[1]]
bool useParent = timeframe.in_seconds() < 900
float priorHigh = na
if useParent
    [hi, lo] = request.security(syminfo.tickerid, "15", f_confirmedLevels(), lookahead=barmerge.lookahead_on, calc_bars_count=240)
    priorHigh := hi
plot(priorHigh, "Previous high")`;
 const result = await run(source);
 assertGood(result);
 const complete = aggregate(base,900);
 assert.ok(Math.abs(result.plots[0].data.at(-1).value-complete.at(-2).high)<1e-8);
});
test('All Indy 1.4.20 skips a missing lower-timeframe packet before reading its close time', async () => {
 const source=`//@version=6
indicator("All Indy 1.4.20 • Zone Context")
type s_Momentum
    int closedAt = na
    float value = na
array<s_Momentum> samples = array.new<s_Momentum>(2)
array.set(samples, 0, s_Momentum.new(time_close, 42.0))
float result = na
for index = array.size(samples) - 1 to 0
    s_Momentum sample = array.get(samples, index)
    if sample.closedAt <= time_close
        result := sample.value
        break
plot(result, "Last closed sample")`;
 assert.match(adaptPineSource(source),/if not na\(sample\) and sample\.closedAt <= time_close/);
 const result=await run(source,{bars:base.slice(0,30)});
 assertGood(result);
 assert.equal(result.plots[0].data.at(-1).value,42);
});
test('live higher-timeframe requests include the developing bucket built from revealed chart candles', async () => {
 const start=Date.UTC(2025,0,6,6)/1000;
 const bars=Array.from({length:6},(_,i)=>({time:start+i*900,open:100+i,high:103+i,low:98+i,close:101+i,volume:10}));
 const asOf=start+6*900;
 const native=aggregate(bars.slice(0,4),3600,'eightcap');
 const provider=replayProvider(bars,900,'eightcap',asOf,false,[],undefined,{tf:'15',bars},[],async()=>native);
 const rows=await provider.getMarketData('XAUUSD','60',240);
 assert.equal(rows.length,2);
 const last=rows.at(-1);
 assert.deepEqual([last.openTime,last.open,last.high,last.low,last.close,last.volume],[(start+3600)*1000,104,108,102,106,20]);
});
test('Pine hline bands carry their bounds, line styles and enabled fill colour to the chart',async()=>{
 const source=`//@version=6
indicator("Oscillator")
a=hline(80,"Upper",linestyle=hline.style_dotted)
b=hline(20,"Lower",linestyle=hline.style_solid)
fill(a,b,color.new(#FF0000,90),title="Band")
plot(close,"Pane",display=display.pane)`;
 const bars=base.slice(0,30);
 const result=await run(source,{bars});
 assertGood(result);
 assert.equal(result.plots.find(p=>p.name==='Upper').lineStyle,'dotted');
 assert.equal(result.fills.length,1);
 const [band]=result.fills;
 assert.equal(band.overlay,false);
 assert.deepEqual(band.runs,[{color:'#FF00001A',points:[[bars[0].time,80,20],[bars.at(-1).time,80,20]]}]);
});
test('an oscillator indexed by bar_index minus a stored swing index reads the anchor candle',async()=>{
 const bars=base.slice(0,40);
 const source=`//@version=6
indicator("Swing oscillator")
type Swing
    int index
    float momentum = na
f_value(float oscillator, Swing anchor) =>
    Swing swing = anchor
    swing.momentum := oscillator[bar_index - swing.index]
    swing.momentum
var Swing a=Swing.new(7)
plot(f_value(close,a),"Anchor")`;
 const result=await run(source,{bars});
 assertGood(result);
 assert.ok(Math.abs(result.plots[0].data.at(-1).value-bars[7].close)<1e-8);
});
test('live Pine can read native lower-timeframe history earlier than the in-memory minute window', async () => {
 const start=Date.UTC(2025,0,6,6)/1000;
 const asOf=start+90*60;
 const nativeBars=Array.from({length:19},(_,index)=>({
  time:start+index*300,open:2000,high:2010,low:1990,close:2000+index/10,volume:10,
 }));
 const hourly=aggregate(nativeBars.slice(0,-1),3600,'eightcap');
 const queries=[];
 const warnings=[];
 const provider=replayProvider(hourly,3600,'eightcap',asOf,false,warnings,undefined,{tf:'60',bars:hourly},[],
  async query=>{queries.push(query);return nativeBars;});
 const native=await provider.getMarketData('XAUUSD','5',50);
 assert.equal(queries[0].period,'5m');
 assert.equal(queries[0].before,asOf);
 assert.equal(native.length,18);
 assert.equal(native[0].openTime,start*1000);
 assert.equal(native.at(-1).close,2001.7);
 assert.deepEqual(warnings,[]);
 const ten=await provider.getMarketData('XAUUSD','10',50);
 assert.equal(queries[1].period,'5m');
 assert.equal(ten.length,9);
 assert.equal(ten.at(-1).volume,20);
});
test('All Indy Basic guarded scans evaluate on the requested timeframe and keep the last confirmed value', async () => {
 const source=`//@version=6
indicator("All Indy 1.4.33 · Basic", dynamic_requests=true)
bool scanAll = input.bool(true)
int seconds = timeframe.in_seconds()
f_scanSource(simple int lag) =>
    close[lag]
var array<string> scanTFs = array.from("15")
float result = na
if scanAll and barstate.islast
    for tf in scanTFs
        if timeframe.in_seconds(tf) > seconds
            result := request.security(syminfo.tickerid, tf, f_scanSource(1), lookahead=barmerge.lookahead_on)
plot(result, "Confirmed scan")`;
 const start=Date.UTC(2025,0,6,6)/1000;
 const minutes=Array.from({length:37},(_,i)=>({time:start+i*60,open:2000+i,high:2002+i,low:1999+i,close:2001+i,volume:10}));
 const bars=aggregate(minutes,300,'eightcap'),asOf=start+37*60;
 const result=await new Promise(resolve=>{callback=resolve;self.onmessage({data:{id:++sequence,source,bars,seconds:300,calendar:'eightcap',live:{asOf,minutes}}})});
 assertGood(result);
 assert.equal(result.plots[0].data.at(-1).value,2030);
});
test('external v5 indicators on a live hourly chart see only available Eightcap candles across timeframes', async () => {
 const start = Date.UTC(2025,0,6,6)/1000;
 const minutes = Array.from({length:145},(_,i)=>({time:start+i*60,open:2000+i,high:2002+i,low:1999+i,close:2001+i,volume:10}));
 const bars = aggregate(minutes,3600,'eightcap');
 const asOf = minutes.at(-1).time+60;
 const source='//@version=5\nindicator("Imported hours",overlay=true)\nlength=input.int(2,"Length")\nplot(ta.sma(close,length),"SMA")\nlows=request.security_lower_tf(syminfo.tickerid,"1",low)\nplot(array.size(lows),"Minute count")';
 const result=await new Promise(resolve=>{callback=resolve;self.onmessage({data:{id:++sequence,source,bars,seconds:3600,calendar:'eightcap',live:{asOf,minutes}}})});
 assertGood(result);
 assert.equal(result.plots.find(p=>p.name==='SMA').data.at(-1).value,2132.5);
 assert.equal(result.plots.find(p=>p.name==='Minute count').data.at(-1).value,25);
 assert.equal(result.studies[0].inputs.length,1);
});
test('an Eightcap minute correction refreshes a lower-timeframe study on a live hourly chart', async () => {
 const start=Date.UTC(2025,0,6,6)/1000;
 const minutes=Array.from({length:150},(_,i)=>({time:start+i*60,open:2000,high:2100,low:1900,close:2000,volume:10}));
 const bars=aggregate(minutes,3600,'eightcap'),asOf=start+150*60;
 const scripts=[{id:'minute-revision',name:'First close',source:'//@version=6\nindicator("First close")\nvalues=request.security_lower_tf(syminfo.tickerid,"1",close)\nplot(array.size(values)>0?array.get(values,0):na,"First")'}];
 const evaluate=rows=>new Promise(resolve=>{callback=resolve;self.onmessage({data:{id:++sequence,bars,seconds:3600,calendar:'eightcap',scripts,live:{asOf,minutes:rows}}})});
 const initial=await evaluate(minutes);assertGood(initial);assert.equal(initial.plots[0].data[1].value,2000);
 const revised=minutes.map((b,i)=>i===60?{...b,close:2010}:b);
 const result=await evaluate(revised);assertGood(result);assert.equal(result.plots[0].data[1].value,2010);
});
test('windowed worker output retains full TA history and ten-candle batches match cold output',async()=>{
 const source='//@version=6\nindicator("Fast replay",overlay=true)\nvar array<float> values=array.new_float()\nvalues.push(close)\nplot(ta.ema(close,200),"EMA")\nplot(ta.rsi(close,14),"RSI")\nplot(array.size(values),"Count")\nplot(request.security(syminfo.tickerid,"15",ta.ema(close,8)),"HTF")';
 let warm;for(const n of [2300,2310,2320]){const b=base.slice(0,n);warm=await run('',{bars:b,scripts:[{id:'fast-live',name:'Fast',source}],plotLimit:2000});assertGood(warm);assert.equal(warm.studies[0].mode,n===2300?'initial':'incremental');assert.ok(warm.plots.every(p=>p.data.length===2000));}
 const b=base.slice(0,2320),cold=await run('',{bars:b,scripts:[{id:'fast-cold',name:'Cold',source}]});assertGood(cold);
 assert.deepEqual(warm.plots.map(p=>p.data),cold.plots.map(p=>p.data.slice(-2000)));
 assert.equal(warm.plots.find(p=>p.name==='Count').data.at(-1).value,2320,'batch evaluates every intermediate candle');
});
test('EMA, RSI and mixed oscillator plots contain real numeric output',async()=>{
 const ema=await run('//@version=6\nindicator("EMA", overlay=true)\nplot(ta.ema(close,20),title="EMA",color=color.orange)');assertGood(ema);assert.equal(ema.plots.length,1);assert.equal(ema.plots[0].overlay,true);assert.ok(Number.isFinite(ema.plots[0].data.at(-1).value));
 const rsi=await run('//@version=6\nindicator("RSI",overlay=false)\nplot(ta.rsi(close,14))\nhline(70,"High")\nhline(30,"Low")');assertGood(rsi);assert.equal(rsi.plots.length,3);assert.equal(rsi.plots[0].overlay,false);
});
test('main_period remains the chart TF inside dynamic security function branches',async()=>{
 const source='//@version=6\nindicator("Dynamic")\nf(string tf)=>\n    float x=na\n    if timeframe.in_seconds(tf)>timeframe.in_seconds(timeframe.main_period)\n        x:=request.security(syminfo.tickerid,tf,close[1],lookahead=barmerge.lookahead_on)\n    else\n        x:=request.security(syminfo.tickerid,tf,close,lookahead=barmerge.lookahead_off)\n    x\nplot(f("15"),title="15m")\nplot(f("60"),title="1h")';
 const r=await run(source);assertGood(r);assert.equal(r.plots.length,2);assert.ok(r.plots.every(p=>Number.isFinite(p.data.at(-1).value)));
});
test('dynamic Hero slices bind the requested TF after the first invocation takes the lower branch',async()=>{
 const source='//@version=6\nindicator("Hero slice")\nf_heroFetch(string tf)=>\n    float result=na\n    [watchT,watchLow,watchHigh]=request.security(syminfo.tickerid,tf,[time,low,high],calc_bars_count=2000)\n    if timeframe.in_seconds(tf)<timeframe.in_seconds(timeframe.main_period)\n        array<float> packets=request.security_lower_tf(syminfo.tickerid,tf,close,ignore_invalid_timeframe=true,calc_bars_count=2000)\n        result:=packets.size()>0?packets.get(packets.size()-1):na\n    else\n        result:=request.security(syminfo.tickerid,tf,close[1],calc_bars_count=2000)\n    result\nhero10=f_heroFetch("10")\nhero30=f_heroFetch("30")\nplot(hero10,title="Lower")\nplot(hero30,title="Closed")\nplot(request.security(syminfo.tickerid,"30",close[1],calc_bars_count=2000),title="Control")';
 const b=base.slice(0,2200);const r=await run('',{bars:aggregate(b,900),baseBars:b,seconds:900,scripts:[{id:'hero-slice',name:'Hero slice',source}]});assertGood(r);const value=name=>r.plots.find(p=>p.name===name).data.at(-1).value;assert.ok(Number.isFinite(value('Closed')));assert.ok(Math.abs(value('Closed')-value('Control'))<1e-8);
 const hourlySource=source.replace('tf,close,ignore_invalid_timeframe','tf,ta.ema(close,2),ignore_invalid_timeframe').replace('plot(request.security(syminfo.tickerid,"30",close[1],calc_bars_count=2000),title="Control")','array<float> control=request.security_lower_tf(syminfo.tickerid,"30",ta.ema(close,2),calc_bars_count=2000)\nplot(control.size()>0?control.get(control.size()-1):na,title="Control")');
 const h=await run('',{bars:aggregate(b,3600),baseBars:b,seconds:3600,scripts:[{id:'hourly-hero-slice',name:'Hourly Hero slice',source:hourlySource}]});assertGood(h);const hourlyValue=name=>h.plots.find(p=>p.name===name).data.at(-1).value;assert.ok(Number.isFinite(hourlyValue('Closed')),'second lower-TF call must retain its own packets');assert.ok(Math.abs(hourlyValue('Closed')-hourlyValue('Control'))<1e-8);
});
test('input overrides change values and force_overlay drawings survive oscillator declarations',async()=>{
 const source='//@version=6\nindicator("Inputs",overlay=false,max_lines_count=10)\nn=input.int(5,"Length")\nplot(ta.ema(close,n),title="EMA")\nif barstate.islast\n    line.new(bar_index-10,low,bar_index,high,force_overlay=true)\n    label.new(bar_index,high,"TEST",force_overlay=true)';
 const initial=await run('',{scripts:[{id:'input',name:'Input',source}]});assertGood(initial);const id=initial.studies[0].inputs.find(m=>m.title==='Length').id;
 const changed=await run('',{scripts:[{id:'input',name:'Input',source,inputs:{[id]:30}}]});assertGood(changed);assert.notEqual(changed.plots[0].data.at(-1).value,initial.plots[0].data.at(-1).value);assert.ok(changed.drawings.some(d=>d.kind==='line'&&d.overlay));assert.ok(changed.drawings.some(d=>d.kind==='label'&&d.overlay));
});
test('Zone Bridge injects source values by timestamp, never substitutes close',async()=>{
 const names=['00 SYNC','01 D1 LOW','02 D1 HIGH','03 D1 SCORE','04 D1 CHECK','05 D2 LOW','06 D2 HIGH','07 D2 SCORE','08 D2 CHECK','09 S1 LOW','10 S1 HIGH','11 S1 SCORE','12 S1 CHECK','13 S2 LOW','14 S2 HIGH','15 S2 SCORE','16 S2 CHECK'].map(n=>'ZB '+n);
 const producer='//@version=6\nindicator("All Indy (EBW) V10.4.4 bridge fixture")\n'+names.map((n,i)=>`plot(${i+100},"${n}",display=display.none)`).join('\n');
 const consumer='//@version=6\nindicator("EBW-Fibo 1.9 bridge fixture")\nx=input.source(close,"ZB 00 SYNC")\ny=input.source(close,"ZB 01 D1 LOW")\nplot(x+y,"Bridge")';
 const r=await run('',{scripts:[{id:'consumer',name:'Consumer',source:consumer},{id:'producer',name:'Producer',source:producer}]});assertGood(r);assert.equal(r.studies.find(s=>s.id==='consumer').bridge,true);assert.equal(r.plots.length,1);assert.equal(r.plots[0].data.at(-1).value,201);
});
test('incremental forming candles restore arrays, UDTs, tables and drawing state',async()=>{
 const source='//@version=6\nindicator("Stateful",overlay=true)\ntype Packet\n    float price=na\nvar array<float> a=array.new_float()\nvar Packet p=Packet.new()\nif barstate.isconfirmed\n    a.push(close)\np.price:=close\nplot(array.size(a),"Count")\nplot(ta.ema(close,12),"EMA")\nplot(p.copy().price,"UDT")\nplot(request.security(syminfo.tickerid,"15",ta.ema(close,8)),"HTF")\nvar table t=table.new(position.top_right,1,1)\nif barstate.islast\n    table.cell(t,0,0,str.tostring(array.size(a)))\n    line.new(bar_index-1,low,bar_index,high)';
 const all=base.slice(0,125);let incremental;
 for(const n of [120,121,122,125]){const b=all.slice(0,n);incremental=await run('',{bars:aggregate(b,300),baseBars:b,seconds:300,scripts:[{id:'live',name:'Live',source}]});assertGood(incremental);assert.equal(incremental.studies[0].mode,n===120?'initial':'incremental');}
 const cold=await run('',{bars:aggregate(all,300),baseBars:all,seconds:300,scripts:[{id:'cold',name:'Cold',source}]});assertGood(cold);
 const values=r=>r.plots.map(p=>({name:p.name,data:p.data}));assert.deepEqual(values(incremental),values(cold));assert.deepEqual(incremental.tables.map(t=>t.cells),cold.tables.map(t=>t.cells));
});
test('invalid syntax and external imports produce actionable errors',async()=>{assert.ok((await run('//@version=6\nindicator("Broken")\nplot(')).errors.length);assert.match((await run('//@version=6\nimport Vendor/Library/1 as lib\nindicator("Import")')).errors.join(''),/import/);});
test('compiler optimization preserves strings and executable default-index semantics',()=>{
 const fn=new Function('$','return [$.get($.get(undefined,0),0),"$.get(undefined,0)",$.get([7],0)]');const ctx={get:(v,i)=>Array.isArray(v)?v[i]:v};assert.deepEqual(optimizePrepared(fn)(ctx),fn(ctx));
});
test('full Fibo on a 15m chart stays incremental and matches a cold forming-candle result',async()=>{
 const source=fs.readFileSync(new URL('../public/indicators/ebw-fibo-1.9-full.pine',import.meta.url),'utf8');let step;
 for(const n of [2200,2201,2205]){const b=base.slice(0,n);step=await run('',{bars:aggregate(b,900),baseBars:b,seconds:900,scripts:[{id:'fibo-15-live',name:'Fibo 15m',source}]});assertGood(step);assert.equal(step.studies[0].mode,n===2200?'initial':'incremental');assert.ok(step.plots.length>0);}
 const b=base.slice(0,2205),cold=await run('',{bars:aggregate(b,900),baseBars:b,seconds:900,scripts:[{id:'fibo-15-cold',name:'Fibo 15m',source}]});assertGood(cold);const output=r=>r.plots.map(p=>({name:p.name,data:p.data}));assert.deepEqual(output(step),output(cold));assert.deepEqual(step.tables.map(t=>t.cells),cold.tables.map(t=>t.cells));
});
test('both bundled scripts match full originals and produce plots, overlays, tables and linked bridge',async()=>{
 const full=id=>fs.readFileSync(new URL('../public/indicators/'+id+'-full.pine',import.meta.url));
 const a=full('all-indy-v10.4.4'),f=full('ebw-fibo-1.9');assert.equal(createHash('sha256').update(a).digest('hex'),'66f0c426e0d827616711bd115ba90eaad5fce7c26b0f9334299e62dbc0487107');assert.equal(createHash('sha256').update(f).digest('hex'),'581f4746eea09bef25e2762ff4a49a7d8101fb111bf13ce99446988cd7b98d72');
 const sourceA=a.toString(),sourceF=f.toString();assert.match(sourceA,/ZB 16 S2 CHECK/);assert.match(sourceF,/cf_packet/);
 const b=base.slice(0,2200);const scripts=[{id:'all',name:'All Indy',source:sourceA,inputs:{in_1:true}},{id:'fibo',name:'EBW-Fibo',source:sourceF}];
 const r=await run('',{bars:aggregate(b,300),baseBars:b,seconds:300,scripts});assertGood(r);assert.equal(r.plots.filter(p=>p.indicatorId==='all').length,12);assert.ok(r.plots.some(p=>p.indicatorId==='fibo'&&p.overlay));assert.ok(r.drawings.some(d=>d.indicatorId==='all'&&d.overlay));assert.ok(r.drawings.some(d=>d.indicatorId==='fibo'&&d.overlay));assert.ok(r.tables.some(t=>t.indicatorId==='all'&&t.cells.flat().some(c=>c?.text?.includes('EBW /'))));assert.ok(r.tables.some(t=>t.indicatorId==='fibo'));assert.equal(r.studies.find(s=>s.id==='fibo').bridge,true);assert.ok(r.studies.every(s=>s.inputs.length>20));
 let step;for(const n of [2201,2205,2210,2260]){const forward=base.slice(0,n);step=await run('',{bars:aggregate(forward,300),baseBars:forward,seconds:300,scripts});assertGood(step);assert.equal(step.plots.length,r.plots.length);assert.equal(step.studies.find(s=>s.id==='fibo').bridge,true);assert.ok(step.studies.every(s=>s.mode==='incremental'),'Play must reuse both compiled studies and their live state');}
 const final=base.slice(0,2260);const cold=await run('',{bars:aggregate(final,300),baseBars:final,seconds:300,scripts:scripts.map(s=>({...s,id:'cold-'+s.id}))});assertGood(cold);
 const output=result=>result.plots.map(p=>({name:p.name,overlay:p.overlay,data:p.data}));assert.deepEqual(output(step),output(cold),'full-script forward results must match fresh calculation across forming and closed candles');
 assert.deepEqual(step.tables.map(t=>t.cells),cold.tables.map(t=>t.cells),'full-script dashboard values must match a fresh calculation');
});

test('inline Replay Pine uses revealed minutes when a higher chart requests a forming lower timeframe',async()=>{
 const start=1700002800;
 const minutes=Array.from({length:35},(_,i)=>({time:start+i*60,open:2000+i,high:2002+i,low:1999+i,close:2001+i,volume:1}));
 minutes[27].high=9999;
 const revealed=minutes.slice(0,27);
 const asOf=start+27*60;
 const native=aggregate(minutes,300,'utc');
 const provider=replayProvider(revealed,60,'utc',asOf,false,[],undefined,
  {tf:'60',bars:aggregate(revealed,3600,'utc')},revealed,async()=>native,true);
 const lower=await provider.getMarketData('XAUUSD','5',20);
 assert.equal(lower.at(-1).openTime,(start+25*60)*1000);
 assert.equal(lower.at(-1).high,2028);
 assert.equal(lower.at(-1).close,2027);
 assert.ok(lower.every(bar=>bar.openTime<asOf*1000));
});

test('the shipped Focus pair calculates 3,000 Replay bars with bounded drawing output',async()=>{
 const scripts=[
  {id:'focus-all',builtinId:'ebw-focus-all-indy',name:'All Indy Focus',file:'all-indy-ebw-focus.pine'},
  {id:'focus-fibo',builtinId:'ebw-focus-fibo',name:'EBW Fibo Focus',file:'ebw-fibo-focus.pine'},
 ].map(({file,...job})=>({...job,source:fs.readFileSync(new URL('../src/indicators/'+file,import.meta.url),'utf8')}));
 for(const script of scripts)assert.match(script.source,/calc_bars_count=3000/);
 const bars=Array.from({length:3050},(_,i)=>({...base[i%base.length],time:1700000100+i*300}));
 const result=await run('',{scripts,bars,seconds:300,baseSeconds:300,plotLimit:2000});
 assertGood(result);
 assert.deepEqual(result.studies.map(study=>study.id),['focus-all','focus-fibo']);
 assert.ok(result.studies[0].inputs.some(input=>input.varId==='sdBoxLimit'&&input.defval===4&&input.maxval===8));
 assert.ok(result.studies[0].inputs.some(input=>input.varId==='structBoxLimit'&&input.defval===4&&input.maxval===4));
 assert.ok(result.studies[1].inputs.some(input=>input.varId==='frameLimit'&&input.defval===3));
 assert.ok(result.studies[1].inputs.some(input=>input.varId==='showVacuum'&&input.defval===true));
 const osc=result.plots.filter(p=>p.indicatorId==='focus-all'&&p.style!=='hline');
 assert.equal(osc.length,3);
 assert.ok(osc.every(p=>!p.overlay&&p.data.some(point=>point.value!==null)));
 assert.ok(osc.every(p=>p.data.length===3000&&p.data[0].time===bars[50].time));
 assert.ok(result.drawings.filter(d=>d.kind==='box'&&d.indicatorId==='focus-all').length<=8);
 assert.equal(result.tables.length,0);
});

test('Focus overrides change the chart window and draw the selected zone and Fibo layers',async()=>{
 const calendar='eightcap', seconds=14400;
 const root=new URL('../public/',import.meta.url);
 const {datasets}=JSON.parse(fs.readFileSync(new URL('data/catalog-v2.json',root),'utf8'));
 const sources=new Map(datasets.map(dataset=>{
   const chunk=dataset.chunks.at(-1);
   const data=JSON.parse(gunzipSync(fs.readFileSync(new URL(chunk.file,root))));
   return [dataset.timeframe,data.bars??data];
 }));
 const bars=sources.get(seconds).slice(-1400);
 const asOf=periodEnd(bars.at(-1).time,'240',calendar);
 const scripts=[
   {id:'zones-options',builtinId:'ebw-focus-all-indy',name:'Zones',file:'all-indy-ebw-focus.pine',
     inputs:{sdBoxLimit:1,structBoxLimit:0,'ebw-history-bars':850}},
   {id:'fibo-options',builtinId:'ebw-focus-fibo',name:'Fibo',file:'ebw-fibo-focus.pine',
     inputs:{frameLimit:0,levelsLimit:1,showVacuum:false,showSwingLink:false,show1618:false,showTFPanel:true,'ebw-history-bars':1300}},
 ].map(({file,...job})=>({...job,source:fs.readFileSync(new URL('../src/indicators/'+file,import.meta.url),'utf8')}));
 const result=await new Promise(resolve=>{
   callback=resolve;
   historyCallback=({number,query})=>{
     const rows=sources.get(periods[query.period]).filter(bar=>bar.time<query.before).slice(-query.limit);
     queueMicrotask(()=>self.onmessage({data:{historyResponse:{number,bars:rows}}}));
   };
   self.onmessage({data:{id:++sequence,scripts,bars,seconds,calendar,live:{asOf,minutes:[],nativeHistory:true}}});
 }).finally(()=>{historyCallback=undefined;});
 assertGood(result);
 assert.equal(result.plots.find(plot=>plot.name==='RSI').data.length,850);
 const boxes=result.drawings.filter(drawing=>drawing.kind==='box');
 assert.deepEqual(boxes.map(box=>box.indicatorId),['zones-options']);
 assert.match(boxes[0].text,/ · [DS]$/);
 const targets=result.drawings.filter(drawing=>drawing.kind==='label'&&drawing.indicatorId==='fibo-options'&&/[↑↓].+%/.test(drawing.text));
 assert.ok(targets.length>0);
 assert.ok(targets.every(target=>!target.text.includes('161.8%')));
 assert.equal(result.tables.filter(table=>table.indicatorId==='fibo-options').length,1);
});

const focusZoneSource=fs.readFileSync(new URL('../src/indicators/all-indy-ebw-focus.pine',import.meta.url),'utf8');
async function chartZoneBoxes(bars,inputs={},seconds=60,asOf) {
 const live=asOf===undefined?undefined:{asOf,minutes:[]};
 const result=await run('',{bars,seconds,baseSeconds:seconds,live,scripts:[{id:'chart-zones',builtinId:'ebw-focus-all-indy',name:'All Indy',
   source:focusZoneSource,inputs:{scanAll:false,showParent:false,showStruct:false,showLiquidity:false,showStatus:true,...inputs}}]});
 assertGood(result);
 return result.drawings.filter(d=>d.kind==='box');
}

test('Focus draws the whole compact base only after departure and counts separate visits on either side',async()=>{
 const warm=Array.from({length:42},()=>[99.2,101,99,100.8]);
 const baseCandles=[[100,100.9,99.8,100.3],[100.3,100.75,99.95,100.05],[100,100.6,99.7,100.1]];
 const departure=[100.1,103.2,100,103];
 const firstVisit=[102,102.2,100.8,101.5], stay=[101.5,101.7,100.7,101.4], away=[101.4,102.8,101.2,102.6];
 for(const side of [1,-1]){
   const bars=([...warm,...baseCandles,departure,firstVisit,stay,away,firstVisit]).map(([open,high,low,close],i)=>({
     time:1700000100+i*60,volume:10,open:side===1?open:200-open,close:side===1?close:200-close,
     high:side===1?high:200-low,low:side===1?low:200-high,
   }));
   const start=warm.length,cut=start+baseCandles.length;
   const boxesAt=async n=>(await chartZoneBoxes(bars.slice(0,n))).filter(b=>b.text.includes(side===1?' · D ·':' · S ·'));
   assert.equal((await boxesAt(cut)).length,0);
   const confirming=bars.slice(0,cut+1);
   assert.equal((await chartZoneBoxes(confirming,{},60,bars[cut].time+59)).length,0,'a forming departure cannot create the zone');
   const [box]=await boxesAt(cut+1);
   assert.ok(box,'a confirmed departure creates the zone');
   assert.deepEqual([box.left,box.top,box.bottom],[bars[start].time*1000,side===1?100.9:200-99.7,side===1?99.7:200-100.9]);
   assert.match(box.text,/Fresh$/);
   assert.equal((await chartZoneBoxes(confirming,{sdBaseLimit:2})).length,0,'a three-bar base must not be truncated to two bars');
   const wickHeavy={...bars[cut],[side===1?'high':'low']:side===1?110:90};
   assert.equal((await chartZoneBoxes([...confirming.slice(0,-1),wickHeavy])).length,0,'a wick-dominated departure does not qualify');
   assert.match((await boxesAt(cut+3))[0]?.text??'',/Tested$/);
   assert.equal((await boxesAt(cut+5)).length,0);
   assert.equal((await chartZoneBoxes(confirming,{sdBaseLimit:2})).length,0,'an overlong base must not be truncated to its last candles');
   const wick={...bars[cut],high:side===1?110:bars[cut].high,low:side===1?bars[cut].low:90};
   assert.equal((await chartZoneBoxes([...confirming.slice(0,-1),wick])).length,0,'a long rejection wick is a weak departure');
 }
});

test('Focus preserves both timeframe zones at a one-tick overlap and merges their shared half',async()=>{
 const warm5=[[103.8,104,103,103.1],[103.1,103.2,102.3,102.4],[102.4,102.5,101.6,101.7],[101.7,101.8,100.9,101],[101,101.1,99.8,100.2]];
 const base5=Array.from({length:5},()=>[100.4,101,100,100.6]);
 const depart5=Array.from({length:5},(_,i)=>[100.6+i*1.08,101.78+i*1.08,100.5+i*1.08,101.68+i*1.08]);
 const prefix=[...Array.from({length:30},()=>warm5).flat(),...base5,...depart5,
   [106,106.2,105.8,106],[106,106.15,105.7,105.8],[105.8,105.9,103.9,104],[104,104.1,101.55,101.65]];
 for(const [edge,threshold,expected] of [
   [100.99,50,[[100,101],[100.99,102]]],
   [100.5,50,[[100.5,101]]],
   [100.5,75,[[100,101],[100.5,102]]],
 ]){
   const rows=[...prefix,[101.65,102,edge,101.7],[101.7,104.1,101.6,104],...Array.from({length:9},()=>[104,104.5,103.8,104.1])];
   const bars=rows.map(([open,high,low,close],i)=>({time:1700000100+i*60,volume:10,open,high,low,close}));
   const boxes=await chartZoneBoxes(bars,{showParent:true,sdBoxLimit:8,mergeOverlapPct:threshold});
   const demand=boxes.filter(b=>b.text.includes(' · D ·')).sort((a,b)=>a.bottom-b.bottom);
   assert.ok(demand.every(b=>b.layer==='zone'));
   assert.equal(demand.filter(b=>b.bgcolor.startsWith('#FFD166')).length,expected.length===1?1:0);
   assert.deepEqual(demand.map(b=>[b.bottom,b.top]),expected);
   if(demand.length===1){
     assert.equal(demand[0].text,'1m+5m · D · Tested');
     assert.equal(demand[0].left,bars[prefix.length].time*1000);
   }
 }
});

test('Focus STRUCT zones follow the confirmed source swing, its origin and the selected evidence filter',async()=>{
 const warm=Array.from({length:30},(_,i)=>{const c=110-0.25*i;return [c+0.1,c+0.56,c-0.56,c];});
 const swing=[
   [102.75,102.85,100.8,101.15],[101.15,102.65,101,102.4],[102.4,104.3,102.3,104],[104,106.15,103.9,105.8],
   [105.8,105.95,104.7,104.9],[104.9,105,104,104.3],[104.3,104.45,103.7,103.9],
 ];
 const departure=[[103.9,104.65,103.85,104.6],[104.6,105.5,104.55,105.45],[105.45,107.3,105.4,107.2]];
 const noGap=[[103.9,105.2,103.85,104.4],[104.4,105.5,104,105.45],[105.45,107.3,105.05,107.2]];
 const visits=[[107.2,107.4,106.5,106.8],[106.8,106.9,104.2,104.35],[104.35,105.5,104.3,105.3],[105.3,105.4,103,103.1]];
 for(const buy of [true,false]){
   const boxes=async(tail,structScope='ทั้งหมด')=>{
     const bars=[...warm,...swing,...tail].map(([o,h,l,c],i)=>({time:1700000100+i*300,volume:20,
       open:buy?o:220-o,high:buy?h:220-l,low:buy?l:220-h,close:buy?c:220-c}));
     return chartZoneBoxes(bars,{showSD:false,showStruct:true,z_swingLen:2,structScope},300);
   };
   assert.equal((await boxes(departure.slice(0,2))).length,0,'pending swing cannot draw a STRUCT box');
   const [zone]=await boxes(departure,'สวิงหลัก + FVG');
   assert.ok(zone);
   assert.deepEqual([zone.left,zone.top,zone.bottom],[(1700000100+36*300)*1000,buy?104.45:220-103.7,buy?103.7:220-104.45]);
   assert.equal(zone.text,`5m · ${buy?'SB':'SS'} · Fresh`);
   assert.match((await boxes([...departure,...visits.slice(0,2)]))[0]?.text??'',/Tested$/);
   assert.match((await boxes([...departure,...visits.slice(0,3)]))[0]?.text??'',/Defended$/);
   assert.equal((await boxes([...departure,...visits])).length,0);
   assert.equal((await boxes(noGap,'สวิงหลัก')).length,1);
   assert.equal((await boxes(noGap,'สวิงหลัก + FVG')).length,0,'a close through the swing alone is insufficient for this filter');
   const changedSwing=[...departure,[107.2,107.3,103.62,103.65]];
   assert.equal((await boxes(changedSwing)).length,1,'zone remains inside its ATR break tolerance');
   assert.equal((await boxes(changedSwing,'สวิงหลัก')).length,0,'the original protected swing has reversed');
 }
});
