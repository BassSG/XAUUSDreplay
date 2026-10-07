import assert from 'node:assert/strict';
let callback;
globalThis.self={postMessage:(v)=>callback(v)};
await import('../src/lib/pine.worker.ts');
const bars=Array.from({length:200},(_,i)=>({time:1700000040+i*60,open:100+i/10,high:101+i/10,low:99+i/10,close:100+i/10,volume:10}));
async function run(source){return new Promise(resolve=>{callback=resolve;self.onmessage({data:{id:1,source,bars,seconds:60}});});}
const ema=await run('//@version=6\nindicator("EMA", overlay=true)\nplot(ta.ema(close, 20), title="EMA", color=color.orange)');
assert.equal(ema.error,undefined);assert.equal(ema.plots.length,1);assert.equal(ema.plots[0].overlay,true);assert.equal(ema.plots[0].data.at(-1).time,bars.at(-1).time);
const rsi=await run('//@version=6\nindicator("RSI", overlay=false)\nplot(ta.rsi(close, 14))\nhline(70,"High")\nhline(30,"Low")');assert.equal(rsi.error,undefined);assert.equal(rsi.plots.length,3);assert.equal(rsi.plots[0].overlay,false);
const rejected=await run('//@version=6\nindicator("MTF")\nplot(request.security("XAUUSD","60",close))');assert.match(rejected.error,/request/);
const invalid=await run('//@version=6\nindicator("Broken")\nplot(');assert.ok(invalid.error);
console.log(JSON.stringify({passed:4,tests:'native Pine v6 EMA; RSI pane+hline; MTF rejection; syntax-error reporting'}));
