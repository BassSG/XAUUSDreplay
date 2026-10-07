import { z } from 'zod';
import { gunzipSync } from 'fflate';
import type { Bar, Session } from './engine';
import type { Dataset } from './types';

/** Every browser owns its journal. No account, token or remote writes are used. */
export const DATABASE_NAME = 'xau-replay-v1';
const DATABASE_VERSION = 1;
const MAX_WINDOW = 100000;
const safeId = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/);
const uuid = z.string().uuid();
const barSchema = z.object({
 time: z.number().int().min(1e9), open: z.number().positive(), high: z.number().positive(),
 low: z.number().positive(), close: z.number().positive(), volume: z.number().nonnegative(),
 spread: z.number().nonnegative().optional(),
}).refine(b => b.high >= Math.max(b.open, b.close) && b.low <= Math.min(b.open, b.close) && b.high >= b.low, 'OHLC ไม่ถูกต้อง');
const datasetSchema = z.object({
 id: safeId, name: z.string().trim().min(1).max(120), timeframe: z.number().int().min(60).max(86400),
 calendar: z.enum(['utc', 'eightcap']).default('utc'), count: z.number().int().nonnegative(),
 start: z.number().int().nonnegative(), end: z.number().int().nonnegative(), source: z.string().max(500),
 status: z.enum(['ready', 'uploading']), created: z.number().nonnegative(),
});
const chunkSchema = z.object({
 file: z.string().regex(/^data\/[a-zA-Z0-9._/-]+\.json(?:\.gz)?$/).refine(s => !s.split('/').includes('..')),
 start: z.number().int().min(1e9), end: z.number().int().min(1e9), count: z.number().int().positive().max(100000),
 sha256: z.string().regex(/^[a-fA-F0-9]{64}$/).optional(),
});
const bundledSchema = datasetSchema.extend({ chunks: z.array(chunkSchema).min(1).max(10000) });
const settingsSchema = z.object({
 balance: z.number().positive().max(1e9), contractSize: z.number().positive().max(1e6),
 spread: z.number().nonnegative().max(1000), commission: z.number().nonnegative().max(10000), slippage: z.number().nonnegative().max(1000),
});
const commandSchema = z.object({
 id: uuid, at: z.number().int().positive(), type: z.enum(['open', 'close', 'stop']), side: z.enum(['long', 'short']).optional(),
 lots: z.number().positive().max(10000).optional(), sl: z.number().positive().optional(), tp: z.number().positive().optional(),
 tradeId: uuid.optional(), fraction: z.number().positive().max(1).optional(),
}).superRefine((v, ctx) => {
 if (v.type === 'open' && (!v.side || !v.lots || !v.sl || !v.tp)) ctx.addIssue({ code: 'custom', message: 'ออเดอร์ไม่สมบูรณ์' });
 if (v.type !== 'open' && !v.tradeId) ctx.addIssue({ code: 'custom', message: 'ไม่พบออเดอร์' });
 if (v.type === 'stop' && !v.sl) ctx.addIssue({ code: 'custom', message: 'ไม่พบ SL' });
});
const sessionSchema = z.object({
 id: uuid, name: z.string().trim().min(1).max(120), dataset: safeId, from: z.number().int().positive(),
 cursor: z.number().int().min(0).max(999999), furthest: z.number().int().min(0).max(999999),
 commands: z.array(commandSchema).max(10000), settings: settingsSchema, parent: uuid.optional(),
 notes: z.record(z.string().max(5000)).refine(v => Object.keys(v).length <= 10000), pine: z.string().max(30000),
 indicatorEnabled: z.boolean(), timeframe: z.number().int().min(60).max(86400), revision: z.number().int().min(0), engineVersion: z.literal(1),
}).refine(s => s.cursor <= s.furthest, 'ตำแหน่ง Replay ไม่ถูกต้อง')
 .refine(s => new Set(s.commands.map(c => c.id)).size === s.commands.length, 'คำสั่งซ้ำ');
type BundledDataset = z.infer<typeof bundledSchema>;
type StoredDataset = Dataset & { kind: 'custom' };
type StoredSession = { id: string; payload: Session; revision: number; updated: number; importedSignature?: string };
type StoredChunk = { key: string; dataset: string; chunkId?: string; kind: 'custom' | 'bundled'; start: number; end: number; count: number; bars: Bar[] };
let database: Promise<IDBDatabase> | undefined;
let catalogRequest: Promise<BundledDataset[]> | undefined;
export class StorageError extends Error {
 status: number;
 constructor(message: string, status = 400) { super(message); this.name = 'StorageError'; this.status = status; }
}
function friendly(error: unknown): Error {
 if (error instanceof StorageError) return error;
 if (error instanceof z.ZodError) return new StorageError('ข้อมูลไม่ถูกต้อง กรุณาตรวจไฟล์และค่าที่กรอก');
 if (error instanceof SyntaxError) return new StorageError('อ่านไฟล์ JSON ไม่สำเร็จ กรุณาตรวจว่าไฟล์สมบูรณ์และเป็นไฟล์ของ Replay');
 if (error instanceof Error && error.name === 'QuotaExceededError') return new StorageError('พื้นที่เครื่องไม่พอ กรุณาสำรองรอบก่อน แล้วเพิ่มพื้นที่ว่างหรือเลือกข้อมูลช่วงที่สั้นลง', 507);
 if (error instanceof Error && (error.name === 'SecurityError' || error.name === 'InvalidStateError')) return new StorageError('เบราว์เซอร์ไม่อนุญาตให้บันทึกข้อมูล กรุณาเปิดแอปในโหมดปกติและอนุญาตพื้นที่เว็บไซต์', 503);
 return error instanceof Error ? error : new StorageError('บันทึกข้อมูลไม่สำเร็จ กรุณาลองใหม่');
}
function request<T>(r: IDBRequest<T>): Promise<T> {
 return new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
}
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value;
function equivalent(a: unknown, b: unknown): boolean { return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b)); }
function openDatabase(): Promise<IDBDatabase> {
 if (!database) database = new Promise((resolve, reject) => {
  if (typeof indexedDB === 'undefined') { reject(new StorageError('เครื่องนี้ไม่รองรับการบันทึกในเบราว์เซอร์', 503)); return; }
  const r = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
  r.onupgradeneeded = () => {
   const db = r.result;
   db.createObjectStore('datasets', { keyPath: 'id' });
   const chunks = db.createObjectStore('chunks', { keyPath: 'key' }); chunks.createIndex('dataset', 'dataset');
   db.createObjectStore('sessions', { keyPath: 'id' }); db.createObjectStore('meta', { keyPath: 'key' });
  };
  r.onsuccess = () => { const db = r.result; db.onversionchange = () => { db.close(); database = undefined; }; resolve(db); };
  r.onerror = () => { database = undefined; reject(friendly(r.error)); };
  r.onblocked = () => reject(new StorageError('กรุณาปิดแท็บ Replay อื่นแล้วเปิดใหม่ เพื่อปรับพื้นที่บันทึก', 503));
 });
 return database;
}
async function transaction<T>(names: string[], mode: IDBTransactionMode, work: (tx: IDBTransaction) => Promise<T>): Promise<T> {
 const db = await openDatabase(); const tx = db.transaction(names, mode);
 const done = new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error || new StorageError('ยกเลิกการบันทึกแล้ว')); tx.onerror = () => {}; });
 // Attach immediately: validation can abort before callers await completion.
 done.catch(() => {});
 try { const result = await work(tx); await done; return result; }
 catch (error) { try { tx.abort(); } catch {} await done.catch(() => {}); throw friendly(error); }
}
export async function resetStorageConnection() { const db = await database?.catch(() => undefined); db?.close(); database = undefined; catalogRequest = undefined; }
function baseURL() { return (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/'; }
async function cachedCatalog() {
 return transaction(['meta'], 'readonly', async tx => (await request<{ key: string; datasets: BundledDataset[] } | undefined>(tx.objectStore('meta').get('catalog')))?.datasets);
}
async function loadCatalog(): Promise<BundledDataset[]> {
 if (catalogRequest) return catalogRequest;
 catalogRequest = (async () => {
  try {
   const response = await fetch(baseURL() + 'data/catalog.json', { cache: 'no-cache' });
   if (!response.ok) throw new Error('โหลดรายการข้อมูลไม่สำเร็จ');
   const value: unknown = await response.json();
   const rows = z.array(bundledSchema).max(1000).parse(Array.isArray(value) ? value : (value as { datasets?: unknown })?.datasets);
   if (new Set(rows.map(d => d.id)).size !== rows.length) throw new StorageError('รายการชุดข้อมูลมีรหัสซ้ำ');
   for (const ds of rows) {
    if (ds.status !== 'ready' || ds.count !== ds.chunks.reduce((n, c) => n + c.count, 0) || ds.start !== ds.chunks[0].start || ds.end !== ds.chunks.at(-1)!.end) throw new StorageError('รายการข้อมูลราคาไม่สมบูรณ์');
    let end = 0; for (const c of ds.chunks) { if (c.start <= end || c.end < c.start) throw new StorageError('ช่วงข้อมูลราคาซ้ำหรือไม่เรียงเวลา'); end = c.end; }
   }
   await transaction(['meta'], 'readwrite', async tx => { await request(tx.objectStore('meta').put({ key: 'catalog', datasets: rows, saved: Date.now() })); });
   return rows;
  } catch (error) {
   const cached = await cachedCatalog(); if (cached) return z.array(bundledSchema).parse(cached);
   if (error instanceof StorageError || error instanceof z.ZodError) throw friendly(error);
   throw new StorageError('ยังไม่มีรายการข้อมูลในเครื่อง กรุณาเชื่อมต่ออินเทอร์เน็ตแล้วเปิดแอปครั้งแรก', 503);
  }
 })();
 try { return await catalogRequest; } finally { catalogRequest = undefined; }
}
function datasetMetadata(ds: BundledDataset | StoredDataset): Dataset { const { id, name, timeframe, calendar, count, start, end, source, status, created } = ds; return { id, name, timeframe, calendar, count, start, end, source, status, created }; }
async function findDataset(id: string): Promise<BundledDataset | StoredDataset> {
 safeId.parse(id);
 const custom = await transaction(['datasets'], 'readonly', tx => request<StoredDataset | undefined>(tx.objectStore('datasets').get(id)));
 if (custom) return custom;
 const bundled = (await loadCatalog()).find(d => d.id === id);
 if (!bundled) throw new StorageError('ไม่พบชุดข้อมูลที่รอบนี้ใช้ กรุณานำเข้าข้อมูลหรือเชื่อมต่ออินเทอร์เน็ต', 404);
 return bundled;
}
function parseBars(value: unknown): Bar[] {
 const bars = z.array(barSchema).min(1).max(100000).parse(value);
 let previous = 0; for (const b of bars) { if (b.time <= previous) throw new StorageError('เวลาในข้อมูลซ้ำหรือไม่เรียงจากอดีตไปปัจจุบัน'); previous = b.time; }
 return bars;
}
async function loadBundledChunk(ds: BundledDataset, descriptor: z.infer<typeof chunkSchema>): Promise<Bar[]> {
 const key = 'bundle:' + descriptor.file + ':' + (descriptor.sha256 || descriptor.start + ':' + descriptor.end + ':' + descriptor.count);
 const cached = await transaction(['chunks'], 'readonly', tx => request<StoredChunk | undefined>(tx.objectStore('chunks').get(key)));
 if (cached) return cached.bars;
 let bytes: ArrayBuffer;
 try { const response = await fetch(baseURL() + descriptor.file); if (!response.ok) throw new Error(String(response.status)); bytes = await response.arrayBuffer(); }
 catch { throw new StorageError('ข้อมูลช่วงนี้ยังไม่ได้เก็บในเครื่อง กรุณาเชื่อมต่ออินเทอร์เน็ตเพื่อดาวน์โหลดก่อนใช้งานออฟไลน์', 503); }
 if (descriptor.sha256) {
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('');
  if (hash !== descriptor.sha256.toLowerCase()) throw new StorageError('ไฟล์ราคาดาวน์โหลดไม่สมบูรณ์ กรุณาลองใหม่', 503);
 }
 let text: string;
 try {
  if (descriptor.file.endsWith('.gz')) {
   text = typeof DecompressionStream === 'undefined' ? new TextDecoder().decode(gunzipSync(new Uint8Array(bytes))) : await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  } else text = new TextDecoder().decode(bytes);
 } catch { throw new StorageError('อ่านไฟล์ราคาที่ดาวน์โหลดไม่สำเร็จ กรุณาเชื่อมต่ออินเทอร์เน็ตแล้วลองใหม่', 503); }
 const value: unknown = JSON.parse(text); const bars = parseBars(Array.isArray(value) ? value : (value as { bars?: unknown })?.bars);
 if (bars.length !== descriptor.count || bars[0].time !== descriptor.start || bars.at(-1)!.time !== descriptor.end) throw new StorageError('ข้อมูลราคาไม่ตรงกับรายการชุดข้อมูล กรุณาลองใหม่', 503);
 // A full disk should not prevent an online replay. Custom data and sessions never silently skip saving.
 try { await transaction(['chunks'], 'readwrite', async tx => { await request(tx.objectStore('chunks').put({ key, dataset: ds.id, kind: 'bundled', start: descriptor.start, end: descriptor.end, count: bars.length, bars } satisfies StoredChunk)); }); }
 catch (error) { if (!(error instanceof StorageError && error.status === 507)) throw error; }
 return bars;
}
export async function getLocalData(query: string): Promise<any> {
 try {
  const p = new URLSearchParams(query); const action = p.get('action');
  if (action === 'catalog') {
   const bundled = await loadCatalog();
   return transaction(['datasets', 'sessions'], 'readonly', async tx => {
    const custom = await request<StoredDataset[]>(tx.objectStore('datasets').getAll()); const sessions = await request<StoredSession[]>(tx.objectStore('sessions').getAll());
    return { datasets: [...bundled.map(datasetMetadata), ...custom.filter(d => d.status === 'ready').map(datasetMetadata)], sessions: sessions.sort((a, b) => b.updated - a.updated).map(s => ({ id: s.id, name: s.payload.name, dataset: s.payload.dataset, updated: s.updated, revision: s.revision })) };
   });
  }
  if (action === 'session') return transaction(['sessions'], 'readonly', async tx => {
   const row = await request<StoredSession | undefined>(tx.objectStore('sessions').get(uuid.parse(p.get('id'))));
   if (!row) throw new StorageError('ไม่พบรอบทดสอบในเครื่องนี้', 404); return { ...row.payload, revision: row.revision };
  });
  if (action === 'bars') {
   const ds = await findDataset(safeId.parse(p.get('id'))); if (ds.status !== 'ready') throw new StorageError('ข้อมูลยังนำเข้าไม่เสร็จ');
   const start = Math.max(ds.start, Number(p.get('from') || ds.start)); const limit = Number(p.get('limit') || 30000);
   if (!Number.isFinite(start) || !Number.isInteger(limit) || limit < 1 || limit > MAX_WINDOW) throw new StorageError('ช่วงข้อมูลต้องอยู่ระหว่าง 1–100,000 แท่ง');
   const bars: Bar[] = [];
   const append = (values: Bar[]) => { for (const bar of values) { if (bar.time >= start) bars.push(bar); if (bars.length >= limit) break; } };
   if ('chunks' in ds) { for (const c of ds.chunks) { if (c.end < start) continue; append(await loadBundledChunk(ds, c)); if (bars.length >= limit) break; } }
   else {
    const chunks = await transaction(['chunks'], 'readonly', tx => request<StoredChunk[]>(tx.objectStore('chunks').index('dataset').getAll(ds.id)));
    for (const chunk of chunks.filter(c => c.kind === 'custom' && c.end >= start).sort((a, b) => a.start - b.start)) { append(chunk.bars); if (bars.length >= limit) break; }
   }
   return { bars, dataset: datasetMetadata(ds), hasMore: bars.length > 0 && bars.at(-1)!.time < ds.end };
  }
  throw new StorageError('ไม่พบคำสั่ง', 404);
 } catch (error) { throw friendly(error); }
}
function validateSessionDataset(s: Session, ds: Dataset) {
 if (ds.status !== 'ready') throw new StorageError('ชุดข้อมูลยังไม่พร้อม');
 if (s.timeframe < ds.timeframe || s.timeframe % ds.timeframe !== 0) throw new StorageError('Timeframe กราฟต้องไม่น้อยกว่าชุดข้อมูล และต้องหารลงตัว');
 if (s.from < ds.start || s.from > ds.end) throw new StorageError('จุดเริ่มต้นอยู่นอกชุดข้อมูล');
 if (s.commands.some(c => c.at < s.from || c.at > ds.end)) throw new StorageError('เวลาคำสั่งอยู่นอกชุดข้อมูล');
}
export async function localRequest(action: string, input: any = {}): Promise<any> {
 try {
  if (action === 'createDataset') {
   const v = datasetSchema.pick({ id: true, name: true, timeframe: true, calendar: true, source: true }).parse(input);
   const bundled = await loadCatalog(); if (bundled.some(d => d.id === v.id)) throw new StorageError('รหัสชุดข้อมูลซ้ำกับข้อมูลของแอป');
   return transaction(['datasets'], 'readwrite', async tx => {
    if (await request(tx.objectStore('datasets').get(v.id))) throw new StorageError('ชุดข้อมูลนี้มีอยู่แล้ว');
    await request(tx.objectStore('datasets').add({ ...v, count: 0, start: 0, end: 0, status: 'uploading', created: Date.now(), kind: 'custom' })); return { id: v.id };
   });
  }
  if (action === 'uploadChunk') {
   const id = safeId.parse(input.id); const chunkId = uuid.parse(input.chunkId); const bars = parseBars(input.bars);
   if (bars.length > 10000) throw new StorageError('นำเข้าได้ครั้งละไม่เกิน 10,000 แท่ง');
   return transaction(['datasets', 'chunks'], 'readwrite', async tx => {
    const ds = await request<StoredDataset | undefined>(tx.objectStore('datasets').get(id)); if (!ds) throw new StorageError('ไม่พบชุดข้อมูล', 404); if (ds.status !== 'uploading') throw new StorageError('ชุดข้อมูลถูกล็อกแล้ว');
    const key = 'custom:' + id + ':' + chunkId; const existing = await request<StoredChunk | undefined>(tx.objectStore('chunks').get(key));
    if (existing) { if (!equivalent(existing.bars, bars)) throw new StorageError('รหัสช่วงข้อมูลซ้ำแต่ราคาแตกต่าง'); return { ok: true, count: existing.count }; }
    if (ds.end && bars[0].time <= ds.end) throw new StorageError('เวลาในไฟล์ซ้ำหรือไม่เรียงเก่าไปใหม่ กรุณาเรียงข้อมูลและนำเข้าใหม่');
    await request(tx.objectStore('chunks').add({ key, dataset: id, chunkId, kind: 'custom', start: bars[0].time, end: bars.at(-1)!.time, count: bars.length, bars } satisfies StoredChunk));
    await request(tx.objectStore('datasets').put({ ...ds, count: ds.count + bars.length, start: ds.start || bars[0].time, end: bars.at(-1)!.time })); return { count: bars.length };
   });
  }
  if (action === 'finishDataset') return transaction(['datasets'], 'readwrite', async tx => {
   const id = safeId.parse(input.id); const ds = await request<StoredDataset | undefined>(tx.objectStore('datasets').get(id)); if (!ds) throw new StorageError('ไม่พบชุดข้อมูล', 404); if (!ds.count) throw new StorageError('ไม่มีแท่งราคาในชุดข้อมูล');
   await request(tx.objectStore('datasets').put({ ...ds, status: 'ready' })); return { id, count: ds.count, start: ds.start, end: ds.end };
  });
  if (action === 'discardDataset') return transaction(['datasets', 'chunks'], 'readwrite', async tx => {
   const id = safeId.parse(input.id); const ds = await request<StoredDataset | undefined>(tx.objectStore('datasets').get(id)); if (!ds || ds.status !== 'uploading') throw new StorageError('ลบได้เฉพาะข้อมูลที่นำเข้าไม่สำเร็จ');
   const chunks = await request<StoredChunk[]>(tx.objectStore('chunks').index('dataset').getAll(id)); for (const c of chunks) await request(tx.objectStore('chunks').delete(c.key)); await request(tx.objectStore('datasets').delete(id)); return { ok: true };
  });
  if (action === 'saveSession') {
   const s = sessionSchema.parse(input.session) as Session; if (JSON.stringify(s).length > 3000000) throw new StorageError('รอบนี้มีข้อมูลมากเกินไป กรุณาเริ่มรอบใหม่');
   const ds = await findDataset(s.dataset); validateSessionDataset(s, ds);
   return transaction(['sessions'], 'readwrite', async tx => {
    const store = tx.objectStore('sessions'); const previous = await request<StoredSession | undefined>(store.get(s.id));
    if (previous) {
     if (previous.payload.dataset !== s.dataset || previous.payload.from !== s.from || !equivalent(previous.payload.settings, s.settings)) throw new StorageError('ข้อมูลราคาและกติกาของรอบถูกล็อกไว้แล้ว');
     if (previous.revision !== s.revision) throw new StorageError('รอบนี้ถูกแก้ไขจากอีกหน้าต่าง กรุณาสำรองงานในหน้านี้แล้วโหลดรอบล่าสุด', 409);
    } else if (s.revision !== 0) throw new StorageError('ไม่พบรอบเดิม กรุณาเปิดใหม่จากรายการ', 409);
    const revision = s.revision + 1; await request(store.put({ id: s.id, payload: { ...s, revision }, revision, updated: Date.now() } satisfies StoredSession)); return { revision };
   });
  }
  if (!Object.keys(input).length) return getLocalData('action=' + encodeURIComponent(action));
  throw new StorageError('ไม่พบคำสั่ง', 404);
 } catch (error) { throw friendly(error); }
}
const backupSchema = z.object({
 format: z.literal('alphasense-replay-backup'), version: z.literal(1), exported: z.number(),
 bundledDatasetIds: z.array(safeId), datasets: z.array(datasetSchema.extend({ kind: z.literal('custom') })).max(1000),
 chunks: z.array(z.object({ key: z.string().max(300), dataset: safeId, chunkId: uuid, kind: z.literal('custom'), start: z.number(), end: z.number(), count: z.number().int().positive().max(10000), bars: z.array(barSchema).min(1).max(10000) })).max(10000),
 sessions: z.array(z.object({ id: uuid, payload: sessionSchema, revision: z.number().int().positive(), updated: z.number(), importedSignature: z.string().regex(/^[a-f0-9]{64}$/).optional() })).max(10000),
});
export async function exportBackup(override?: Session): Promise<string> {
 const catalog = await loadCatalog();
 const current = override ? sessionSchema.parse(override) as Session : undefined;
 if (current) validateSessionDataset(current, await findDataset(current.dataset));
 return transaction(['datasets', 'chunks', 'sessions'], 'readonly', async tx => {
  const datasets = await request<StoredDataset[]>(tx.objectStore('datasets').getAll()); const chunks = await request<StoredChunk[]>(tx.objectStore('chunks').getAll()); const sessions = await request<StoredSession[]>(tx.objectStore('sessions').getAll());
  const ready = datasets.filter(d => d.status === 'ready'); const ids = new Set(ready.map(d => d.id));
  if (current) {
   // A failed save must never block a downloadable copy of the work still on screen.
   // Revision zero is a valid new draft; the portable backup represents it as its first saved version.
   const revision = Math.max(1, current.revision); const row: StoredSession = { id: current.id, payload: { ...current, revision }, revision, updated: Date.now() };
   const index = sessions.findIndex(s => s.id === current.id); if (index < 0) sessions.push(row); else sessions[index] = row;
  }
  return JSON.stringify({ format: 'alphasense-replay-backup', version: 1, exported: Date.now(), bundledDatasetIds: catalog.map(d => d.id), datasets: ready, chunks: chunks.filter(c => c.kind === 'custom' && ids.has(c.dataset)), sessions });
 });
}
export async function restoreBackup(file: Blob | string): Promise<{ sessions: number; datasets: number; skipped: number }> {
 try {
  if (typeof file !== 'string' && file.size > 250 * 1024 * 1024) throw new StorageError('ไฟล์สำรองใหญ่เกิน 250 MB กรุณานำเข้ารอบกับข้อมูลแยกกัน');
  const backup = backupSchema.parse(JSON.parse(typeof file === 'string' ? file : await file.text()));
  const bundled = await loadCatalog(); const datasetMap = new Map<string, Dataset>([...bundled, ...backup.datasets].map(d => [d.id, d]));
  if (new Set(backup.datasets.map(d => d.id)).size !== backup.datasets.length || new Set(backup.sessions.map(s => s.id)).size !== backup.sessions.length || new Set(backup.chunks.map(c => c.key)).size !== backup.chunks.length) throw new StorageError('ไฟล์สำรองมีรหัสซ้ำ');
  if (backup.datasets.some(d => bundled.some(b => b.id === d.id))) throw new StorageError('ชุดข้อมูลสำรองใช้รหัสซ้ำกับข้อมูลของแอป');
  const customIds = new Set(backup.datasets.map(d => d.id));
  if (backup.chunks.some(c => !customIds.has(c.dataset) || c.key !== 'custom:' + c.dataset + ':' + c.chunkId)) throw new StorageError('ช่วงข้อมูลสำรองไม่มีชุดข้อมูลที่ตรงกัน');
  for (const ds of backup.datasets) {
   const chunks = backup.chunks.filter(c => c.dataset === ds.id).sort((a, b) => a.start - b.start); let end = 0; let count = 0;
   for (const c of chunks) { const bars = parseBars(c.bars); if (c.start <= end || c.count !== bars.length || c.start !== bars[0].time || c.end !== bars.at(-1)!.time) throw new StorageError('ไฟล์สำรองมีช่วงราคาผิดรูปแบบ'); end = c.end; count += c.count; }
   if (ds.status !== 'ready' || !chunks.length || ds.count !== count || ds.start !== chunks[0].start || ds.end !== end) throw new StorageError('ชุดข้อมูลสำรองไม่สมบูรณ์');
  }
  for (const row of backup.sessions) {
   if (row.id !== row.payload.id || row.revision !== row.payload.revision) throw new StorageError('รอบในไฟล์สำรองมีรหัสหรือรุ่นไม่ตรงกัน');
   const ds = datasetMap.get(row.payload.dataset); if (!ds) throw new StorageError('ไฟล์สำรองอ้างอิงข้อมูลที่ไม่มีในแอป'); validateSessionDataset(row.payload as Session, ds);
  }
  const signatures = new Map<string, string>();
  for (const row of backup.sessions) {
   const bytes = new TextEncoder().encode(JSON.stringify(canonical(row.payload)));
   signatures.set(row.id, Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join(''));
  }
  // Read conflict checks and all writes are in one transaction: a failed restore adds nothing.
  return transaction(['datasets', 'chunks', 'sessions'], 'readwrite', async tx => {
   let skipped = 0; let datasets = 0; let sessions = 0;
   for (const ds of backup.datasets) {
    const old = await request<StoredDataset | undefined>(tx.objectStore('datasets').get(ds.id));
    if (old && !equivalent(old, ds)) throw new StorageError('ชุดข้อมูลนี้มีอยู่แล้วแต่ต่างจากไฟล์สำรอง กรุณานำเข้าในเครื่องใหม่เพื่อเก็บทั้งสองชุด', 409);
    if (!old) { await request(tx.objectStore('datasets').add(ds)); datasets++; }
   }
   for (const c of backup.chunks) {
    const old = await request<StoredChunk | undefined>(tx.objectStore('chunks').get(c.key));
    if (old && !equivalent(old, c)) throw new StorageError('ราคาที่บันทึกไว้ต่างจากไฟล์สำรอง การนำเข้าถูกยกเลิก', 409);
    if (!old) await request(tx.objectStore('chunks').add(c));
   }
   const existing = await request<StoredSession[]>(tx.objectStore('sessions').getAll());
   const mappedIds = new Map<string, string>(); const planned: { row: StoredSession; cloned: boolean }[] = [];
   for (const s of backup.sessions) {
    const old = existing.find(row => row.id === s.id); const signature = signatures.get(s.id)!;
    const imported = existing.find(row => row.importedSignature === signature);
    if (old && equivalent(old.payload, s.payload)) { mappedIds.set(s.id, old.id); skipped++; }
    else if (imported) { mappedIds.set(s.id, imported.id); skipped++; }
    else if (old) {
     const id = crypto.randomUUID(); mappedIds.set(s.id, id);
     planned.push({ row: { id, payload: { ...s.payload, id, name: s.payload.name.slice(0, 100) + ' · imported', revision: 1 } as Session, revision: 1, updated: Date.now(), importedSignature: signature }, cloned: true });
    } else { mappedIds.set(s.id, s.id); planned.push({ row: s as StoredSession, cloned: false }); }
   }
   for (const { row, cloned } of planned) {
    // Copies preserve the relationship between backed-up branches even when the parent was copied.
    if (cloned && row.payload.parent && mappedIds.has(row.payload.parent)) row.payload.parent = mappedIds.get(row.payload.parent);
    await request(tx.objectStore('sessions').add(row)); sessions++;
   }
   return { sessions, datasets, skipped };
  });
 } catch (error) { throw friendly(error); }
}
