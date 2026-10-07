import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {aggregate} from '../src/lib/engine.ts';
import {optimizePrepared} from '../src/lib/pine-compat.ts';
let callback,sequence=0;
globalThis.self={postMessage:v=>{if(!v.progress)callback(v)}};
await import('../src/lib/pine.worker.ts');
const base=Array.from({length:2400},(_,i)=>({time:1700000100+i*60,open:2000+Math.sin(i/8)*3+i/100,high:2004+Math.sin(i/8)*3+i/100,low:1996+Math.sin(i/8)*3+i/100,close:2000.4+Math.sin(i/8)*3+i/100,volume:10+(i%7)}));
async function run(source,{bars=base,baseBars=bars,seconds=60,scripts,plotLimit}={}){return new Promise(resolve=>{callback=resolve;self.onmessage({data:{id:++sequence,source,bars,baseBars,seconds,baseSeconds:60,calendar:'utc',scripts,plotLimit}})});}
const assertGood=r=>assert.deepEqual(r.errors,[],r.errors.join(' | '));
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
