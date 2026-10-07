import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { test, beforeEach, after } from 'node:test';
import { gzipSync } from 'node:zlib';
import { createHash, randomUUID } from 'node:crypto';
import { DATABASE_NAME, localRequest, getLocalData, exportBackup, restoreBackup, resetStorageConnection } from '../src/lib/storage.ts';

const originalFetch = globalThis.fetch;
const first = 1609459200;
const makeBars = n => Array.from({ length: n }, (_, i) => ({ time: first + i * 60, open: 1900 + i / 100, high: 1902 + i / 100, low: 1898 + i / 100, close: 1901 + i / 100, volume: i + 1 }));
let online;
let bundled;
let catalog;
let files;
let chunkRequests;
async function erase() {
 await resetStorageConnection();
 await new Promise((resolve, reject) => { const r = indexedDB.deleteDatabase(DATABASE_NAME); r.onsuccess = resolve; r.onerror = () => reject(r.error); r.onblocked = () => reject(Error('DB blocked')); });
}
function fixture(count = 12) {
 bundled = makeBars(count); const bytes = gzipSync(JSON.stringify(bundled)); const file = 'data/xauusd-m1/chunk-0000.json.gz';
 files = new Map([[file, bytes]]);
 catalog = [{ id: 'xauusd-m1', name: 'XAUUSD · M1', timeframe: 60, calendar: 'eightcap', count, start: first, end: bundled.at(-1).time, source: 'Public fixture', status: 'ready', created: 1, chunks: [{ file, start: first, end: bundled.at(-1).time, count, sha256: createHash('sha256').update(bytes).digest('hex') }] }];
 online = true; chunkRequests = 0;
 globalThis.fetch = async url => {
  if (!online) throw new TypeError('offline');
  const path = String(url).replace(/^\//, '');
  if (path === 'data/catalog.json') return new Response(JSON.stringify({ datasets: catalog }), { headers: { 'Content-Type': 'application/json' } });
  if (files.has(path)) { chunkRequests++; return new Response(files.get(path)); }
  return new Response('not found', { status: 404 });
 };
}
function session(dataset = 'xauusd-m1') {
 return { id: randomUUID(), name: 'Test replay', dataset, from: first, cursor: 2, furthest: 2, commands: [], settings: { balance: 10000, contractSize: 100, spread: 0.16, commission: 0, slippage: 0 }, notes: {}, pine: '', indicatorEnabled: false, timeframe: 60, revision: 0, engineVersion: 1 };
}
async function custom() {
 const id = randomUUID(); const bars = makeBars(8);
 await localRequest('createDataset', { id, name: 'Custom data', timeframe: 60, calendar: 'utc', source: 'Local CSV' });
 const chunkId = randomUUID(); await localRequest('uploadChunk', { id, chunkId, bars });
 await localRequest('finishDataset', { id }); return { id, bars, chunkId };
}
beforeEach(async () => { await erase(); fixture(); });
after(async () => { await erase(); globalThis.fetch = originalFetch; });

test('saves and reloads local session with committed revision', async () => {
 const s = session(); const saved = await localRequest('saveSession', { session: s }); assert.equal(saved.revision, 1);
 await resetStorageConnection(); const reloaded = await getLocalData('action=session&id=' + s.id);
 assert.equal(reloaded.revision, 1); assert.equal(reloaded.name, s.name); assert.deepEqual(reloaded.settings, s.settings);
 const catalog = await getLocalData('action=catalog'); assert.equal(catalog.sessions.length, 1); assert.equal(catalog.sessions[0].dataset, 'xauusd-m1');
});
test('atomic revision check prevents two tabs overwriting each other', async () => {
 const s = session(); s.revision = (await localRequest('saveSession', { session: s })).revision;
 const results = await Promise.allSettled([localRequest('saveSession', { session: { ...s, name: 'Window A' } }), localRequest('saveSession', { session: { ...s, name: 'Window B' } })]);
 assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
 const rejected = results.find(r => r.status === 'rejected'); assert.equal(rejected.reason.status, 409);
 const latest = await getLocalData('action=session&id=' + s.id); assert.equal(latest.revision, 2);
});
test('dataset, start and execution settings remain immutable after saving', async () => {
 const s = session(); s.revision = (await localRequest('saveSession', { session: s })).revision;
 await assert.rejects(localRequest('saveSession', { session: { ...s, settings: { ...s.settings, spread: 1 } } }), /ล็อก/);
 await assert.rejects(localRequest('saveSession', { session: { ...s, from: first + 60 } }), /ล็อก/);
 const loaded = await getLocalData('action=session&id=' + s.id); assert.equal(loaded.revision, 1); assert.equal(loaded.settings.spread, 0.16);
});
test('bundled gzip data is verified, cached and available offline', async () => {
 const initial = await getLocalData('action=bars&id=xauusd-m1&from=' + first + '&limit=5');
 assert.equal(initial.bars.length, 5); assert.equal(initial.hasMore, true); assert.equal(chunkRequests, 1);
 online = false; await resetStorageConnection(); const cached = await getLocalData('action=bars&id=xauusd-m1&from=' + first);
 assert.deepEqual(cached.bars, bundled); assert.equal(cached.hasMore, false); assert.equal(chunkRequests, 1);
 const listing = await getLocalData('action=catalog'); assert.equal(listing.datasets.length, 1);
});
test('uncached range reports actionable offline error without fabricating bars', async () => {
 await getLocalData('action=catalog'); online = false;
 await assert.rejects(getLocalData('action=bars&id=xauusd-m1'), /เชื่อมต่ออินเทอร์เน็ต/);
});
test('downloaded corrupted bytes never enter the cache', async () => {
 const file = catalog[0].chunks[0].file; files.set(file, gzipSync(JSON.stringify(makeBars(13))));
 await assert.rejects(getLocalData('action=bars&id=xauusd-m1'), /ไม่สมบูรณ์/);
 online = false; await assert.rejects(getLocalData('action=bars&id=xauusd-m1'), /เชื่อมต่ออินเทอร์เน็ต/);
});
test('bars default to 30000 with explicit continuation up to 100000', async () => {
 fixture(30005); const start = await getLocalData('action=bars&id=xauusd-m1');
 assert.equal(start.bars.length, 30000); assert.equal(start.hasMore, true);
 const all = await getLocalData('action=bars&id=xauusd-m1&limit=100000'); assert.equal(all.bars.length, 30005); assert.equal(all.hasMore, false);
 await assert.rejects(getLocalData('action=bars&id=xauusd-m1&limit=100001'), /100,000/);
});
test('custom imports are append-only and retries are idempotent', async () => {
 const id = randomUUID(); const chunkId = randomUUID(); const bars = makeBars(8);
 await localRequest('createDataset', { id, name: 'Local', timeframe: 60, calendar: 'utc', source: 'CSV' });
 await localRequest('uploadChunk', { id, chunkId, bars }); await localRequest('uploadChunk', { id, chunkId, bars });
 await assert.rejects(localRequest('uploadChunk', { id, chunkId: randomUUID(), bars }), /ซ้ำ/);
 await localRequest('finishDataset', { id }); await assert.rejects(localRequest('uploadChunk', { id, chunkId: randomUUID(), bars }), /ล็อก/);
 const result = await getLocalData('action=bars&id=' + id); assert.deepEqual(result.bars, bars); assert.equal(result.dataset.count, 8);
});
test('full backup transfers custom data and journal while referencing bundled data only', async () => {
 const local = await custom(); const s = session(local.id); await localRequest('saveSession', { session: s });
 const publicSession = session(); await localRequest('saveSession', { session: publicSession });
 const backup = await exportBackup(); const value = JSON.parse(backup);
 assert.equal(value.datasets.length, 1); assert.equal(value.chunks.length, 1); assert.deepEqual(value.bundledDatasetIds, ['xauusd-m1']);
 await erase(); const restored = await restoreBackup(backup); assert.deepEqual(restored, { sessions: 2, datasets: 1, skipped: 0 });
 assert.deepEqual((await getLocalData('action=bars&id=' + local.id)).bars, local.bars);
 assert.equal((await getLocalData('action=session&id=' + s.id)).revision, 1);
 const duplicate = await restoreBackup(backup); assert.deepEqual(duplicate, { sessions: 0, datasets: 0, skipped: 2 });
});
test('backup override captures unsaved current round without modifying any saved round', async () => {
 const current = session(); current.revision = (await localRequest('saveSession', { session: current })).revision;
 const other = session(); other.name = 'Other saved round'; await localRequest('saveSession', { session: other });
 const draft = { ...current, name: 'Unsaved changes', cursor: 5, furthest: 5, notes: { review: 'Still on screen' } };
 const backup = JSON.parse(await exportBackup(draft));
 const exported = backup.sessions.find(row => row.id === current.id); assert.equal(exported.payload.cursor, 5); assert.equal(exported.payload.name, 'Unsaved changes');
 assert.equal(backup.sessions.find(row => row.id === other.id).payload.name, 'Other saved round');
 const persisted = await getLocalData('action=session&id=' + current.id); assert.equal(persisted.name, 'Test replay'); assert.equal(persisted.cursor, 2); assert.equal(persisted.revision, 1);
 const restored = await restoreBackup(JSON.stringify(backup)); assert.equal(restored.sessions, 1); assert.equal(restored.skipped, 1);
 const listing = await getLocalData('action=catalog'); assert.equal(listing.sessions.length, 3); assert.ok(listing.sessions.some(row => row.name === 'Unsaved changes · imported'));
});
test('backup override preserves a never-saved revision-zero draft as a restorable round', async () => {
 const draft = session(); const backup = JSON.parse(await exportBackup(draft));
 assert.equal(backup.sessions.length, 1); assert.equal(backup.sessions[0].revision, 1); assert.equal(backup.sessions[0].payload.revision, 1);
 await assert.rejects(getLocalData('action=session&id=' + draft.id), e => e.status === 404);
 const restored = await restoreBackup(JSON.stringify(backup)); assert.equal(restored.sessions, 1); assert.equal((await getLocalData('action=session&id=' + draft.id)).revision, 1);
});
test('conflicting session backup becomes a separate copy and protects newer journal', async () => {
 const local = await custom(); const s = session(local.id); await localRequest('saveSession', { session: s });
 const backup = JSON.parse(await exportBackup()); await erase();
 const existing = { ...s, dataset: 'xauusd-m1', name: 'Newer work' }; await localRequest('saveSession', { session: existing });
 const restored = await restoreBackup(JSON.stringify(backup)); assert.deepEqual(restored, { sessions: 1, datasets: 1, skipped: 0 });
 const list = await getLocalData('action=catalog'); assert.equal(list.datasets.length, 2); assert.equal(list.sessions.length, 2);
 const copy = list.sessions.find(row => row.id !== s.id); assert.ok(copy.name.endsWith(' · imported')); assert.equal(copy.dataset, local.id);
 assert.equal((await getLocalData('action=session&id=' + s.id)).dataset, 'xauusd-m1');
 const repeated = await restoreBackup(JSON.stringify(backup)); assert.deepEqual(repeated, { sessions: 0, datasets: 0, skipped: 1 });
});
test('conflicting dataset backup rolls back all writes', async () => {
 const local = await custom(); const backup = JSON.parse(await exportBackup());
 const s = session(); s.name = 'Only in backup'; s.revision = 1; backup.sessions.push({ id: s.id, payload: s, revision: 1, updated: Date.now() }); backup.datasets[0].name = 'Altered data';
 const newId = randomUUID(); const newChunkId = randomUUID();
 backup.datasets.unshift({ ...backup.datasets[0], id: newId, name: 'Should roll back' });
 backup.chunks.unshift({ ...backup.chunks[0], key: 'custom:' + newId + ':' + newChunkId, dataset: newId, chunkId: newChunkId });
 await assert.rejects(restoreBackup(JSON.stringify(backup)), e => e.status === 409);
 const list = await getLocalData('action=catalog'); assert.equal(list.datasets.length, 2); assert.equal(list.datasets.find(d => d.id === local.id).name, 'Custom data'); assert.equal(list.sessions.length, 0);
});
test('gzip fallback loads price data on browsers without DecompressionStream', async () => {
 const native = globalThis.DecompressionStream;
 try { globalThis.DecompressionStream = undefined; const result = await getLocalData('action=bars&id=xauusd-m1'); assert.deepEqual(result.bars, bundled); }
 finally { globalThis.DecompressionStream = native; }
});
test('invalid backup candle rejects before writing any journal or dataset', async () => {
 const local = await custom(); const s = session(local.id); await localRequest('saveSession', { session: s });
 const backup = JSON.parse(await exportBackup()); backup.chunks[0].bars[0].high = 1; await erase();
 await assert.rejects(restoreBackup(JSON.stringify(backup)), /ไม่ถูกต้อง/);
 const list = await getLocalData('action=catalog'); assert.equal(list.datasets.length, 1); assert.equal(list.sessions.length, 0);
});

test('persists rewind window, drawing kinds and more than eight studies with inputs',async()=>{
 const s=session();s.windowStart=first-60;s.indicators=Array.from({length:12},(_,i)=>({id:randomUUID(),name:'Study '+i,source:'//@version=6\nindicator("Test")\nplot(close)',enabled:true,inputs:{length:20},builtinId:'test'}));s.drawings=[{id:randomUUID(),kind:'text',points:[{time:first,price:1900}],text:'Trade note'}];
 await localRequest('saveSession',{session:s});const loaded=await getLocalData('action=session&id='+s.id);assert.equal(loaded.windowStart,first-60);assert.equal(loaded.indicators.length,12);assert.equal(loaded.indicators[11].inputs.length,20);assert.equal(loaded.drawings[0].text,'Trade note');
});
test('auto-decompressed HTTP gzip is checked using decoded SHA-256 and remains offline',async()=>{
 const payload=Buffer.from(JSON.stringify(bundled));catalog[0].chunks[0].contentSha256=createHash('sha256').update(payload).digest('hex');files.set(catalog[0].chunks[0].file,payload);
 const loaded=await getLocalData('action=bars&id=xauusd-m1');assert.deepEqual(loaded.bars,bundled);online=false;await resetStorageConnection();assert.deepEqual((await getLocalData('action=bars&id=xauusd-m1')).bars,bundled);
});
test('a new imported child follows the imported copy of its conflicting parent',async()=>{
 const parent=session(),child={...session(),parent:parent.id,name:'Child'};await localRequest('saveSession',{session:parent});await localRequest('saveSession',{session:child});const backup=await exportBackup();await erase();await localRequest('saveSession',{session:{...parent,name:'New local parent'}});
 await restoreBackup(backup);const listing=await getLocalData('action=catalog');const copy=listing.sessions.find(s=>s.name==='Test replay · imported');assert.ok(copy);assert.equal((await getLocalData('action=session&id='+child.id)).parent,copy.id);assert.equal((await getLocalData('action=session&id='+parent.id)).name,'New local parent');
});
