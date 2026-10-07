import {createReadStream} from 'node:fs';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import path from 'node:path';
import Papa from 'papaparse';
import {normalizeImportBars} from '../src/lib/engine.ts';
const source=process.argv[2];if(!source)throw Error('Usage: npm run data:prepare -- <directory containing the six validated CSVs>');
const files=[['1m','XAUUSD_1m_1Min.csv',60],['1h','XAUUSD_1h_1Hour.csv',3600],['5m','XAUUSD_5m_5Min.csv',300],['15m','XAUUSD_15m_15Min.csv',900],['4h','XAUUSD_4h_4Hour.csv',14400],['1d','XAUUSD_1D_Daily.csv',86400]];
const datasets=[];
for(const [label,file,tf] of files){
 const original=await readFile(path.join(source,file));const hash=createHash('sha256').update(original).digest('hex');const id='eightcap-'+label+'-'+hash.slice(0,12);const target=path.join('public/data',id);await mkdir(target,{recursive:true});
 const stream=Papa.parse(Papa.NODE_STREAM_INPUT,{header:true,skipEmptyLines:'greedy'});createReadStream(path.join(source,file)).pipe(stream);
 let bars=[];let count=0;let start=0;let end=0;let last=0;const chunks=[];
 async function flush(){if(!bars.length)return;const name=String(chunks.length).padStart(3,'0')+'.json.gz';const gzip=gzipSync(Buffer.from(JSON.stringify(bars)),{level:9});await writeFile(path.join(target,name),gzip);chunks.push({file:'data/'+id+'/'+name,start:bars[0].time,end:bars.at(-1).time,count:bars.length,sha256:createHash('sha256').update(gzip).digest('hex')});bars=[];}
 for await(const row of stream){const b=normalizeImportBars([row],'eightcap')[0];if(last&&b.time<=last)throw Error('Duplicate/unordered timestamp in '+file);last=b.time;start||=b.time;end=b.time;count++;bars.push(b);if(bars.length===10000)await flush();}
 await flush();datasets.push({id,name:'XAUUSD · '+(label==='1d'?'1D':label)+' · '+new Date(start*1000).getUTCFullYear()+'–2026',timeframe:tf,calendar:'eightcap',count,start,end,source:'Eightcap · ประวัติถึง 7 ต.ค. 2026',status:'ready',created:1791345246000,version:hash,chunks});console.log(label+': '+count.toLocaleString()+' bars, '+chunks.length+' files');
}
// Keep immutable older bundles so existing rounds and backups keep working after data refresh.
const previous=await readFile('public/data/catalog.json','utf8').then(v=>JSON.parse(v).datasets??[]).catch(()=>[]);const retained=previous.filter(old=>!datasets.some(d=>d.id===old.id));
await writeFile('public/data/catalog.json',JSON.stringify({version:1,exportAsOf:'2026-10-07T03:54:06Z',datasets:[...datasets,...retained]}));
await mkdir('docs',{recursive:true});const quality=await readFile(path.join(source,'quality.json'));await writeFile('docs/history-quality.json',quality);
console.log('Prepared '+datasets.reduce((n,d)=>n+d.count,0)+' immutable candles for public replay.');
