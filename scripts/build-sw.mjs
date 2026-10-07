import {readdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
const base='/XAUUSDreplay/';
async function walk(dir){const files=[];for(const e of await readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())files.push(...await walk(p));else files.push(p);}return files;}
const all=await walk('dist');const shell=all.filter(p=>!p.replaceAll('\\','/').startsWith('dist/data/')&&!p.replaceAll('\\','/').startsWith('dist/brand/')&&!p.endsWith('sw.js')).map(p=>base+p.replaceAll('\\','/').slice(5));shell.push(base+'data/catalog.json');
const digest=createHash('sha256');for(const url of shell){digest.update(url);digest.update(await readFile('dist/'+url.slice(base.length)));}const hash=digest.digest('hex').slice(0,12);
const sw=`const SCOPE=${JSON.stringify(base)}, CACHE='xau-replay-${hash}', SHELL=${JSON.stringify(shell)};
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL))));
self.addEventListener('message',e=>{if(e.data==='SKIP_WAITING')self.skipWaiting()});
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('xau-replay-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{const r=e.request,u=new URL(r.url);if(r.method!=='GET'||u.origin!==self.location.origin||!u.pathname.startsWith(SCOPE))return;
if(r.mode==='navigate'){e.respondWith((async()=>{const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),4000);try{const response=await fetch(r,{signal:controller.signal});return response.ok?response:await caches.match(SCOPE+'index.html');}catch{return await caches.match(SCOPE+'index.html');}finally{clearTimeout(timer)}})());return;}
e.respondWith(caches.open(CACHE).then(async c=>{const old=await c.match(r);if(old)return old;const response=await fetch(r);if(response.ok)await c.put(r,response.clone());return response}));});`;
await writeFile('dist/sw.js',sw);await writeFile('dist/.nojekyll','');console.log('Offline shell prepared: '+shell.length+' assets.');
