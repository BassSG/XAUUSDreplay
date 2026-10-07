import Papa from 'papaparse';
import { normalizeImportBars, type Bar, type CandleCalendar } from './engine';
import { localRequest, getLocalData } from './storage';
export { exportBackup, restoreBackup } from './storage';

/** Same interface as the original server app, backed entirely by this browser. */
export async function api(action: string, payload?: any): Promise<any> {
 return payload ? localRequest(action, payload) : getLocalData('action=' + encodeURIComponent(action));
}
export async function getData(query: string): Promise<any> { return getLocalData(query); }
export async function uploadRows(name: string, tf: number, source: string, rows: Bar[], progress: (s: string) => void, calendar: CandleCalendar = 'utc') {
 if (!rows.length) throw Error('ไม่พบแท่งราคาในข้อมูล');
 const id = crypto.randomUUID(); await api('createDataset', { id, name, timeframe: tf, calendar, source });
 try {
  for (let i = 0; i < rows.length; i += 10000) {
   await api('uploadChunk', { id, chunkId: crypto.randomUUID(), bars: rows.slice(i, i + 10000) });
   progress('บันทึก ' + Math.min(i + 10000, rows.length).toLocaleString() + ' / ' + rows.length.toLocaleString() + ' แท่ง');
  }
  await api('finishDataset', { id }); return id;
 } catch (error) { await api('discardDataset', { id }).catch(() => {}); throw error; }
}
export async function importFile(file: File, tf: number, progress: (s: string) => void, clock: CandleCalendar = 'utc'): Promise<string> {
 if (file.name.toLowerCase().endsWith('.json')) {
  if (file.size > 50 * 1024 * 1024) throw Error('JSON รองรับไม่เกิน 50 MB ต่อไฟล์ สำหรับประวัติหลายปีใช้ CSV แบบเรียงเวลา');
  let value: any; try { value = JSON.parse(await file.text()); } catch { throw Error('อ่าน JSON ไม่สำเร็จ กรุณาตรวจรูปแบบไฟล์'); }
  const key: Record<number, string> = { 60: '1m', 300: '5m', 900: '15m', 3600: '1h', 14400: '4h', 86400: '1d' };
  const rows = Array.isArray(value) ? value : value.bars ?? value.timeframes?.[key[tf]];
  if (!Array.isArray(rows)) throw Error('JSON ต้องเป็นรายการ OHLC หรือรูปแบบ API /bars/all');
  return uploadRows(file.name, tf, clock === 'eightcap' ? 'Imported JSON · Eightcap broker → UTC' : 'Imported JSON · UTC', normalizeImportBars(rows, clock), progress, clock);
 }
 const id = crypto.randomUUID();
 await api('createDataset', { id, name: file.name.slice(0, 120), timeframe: tf, calendar: clock, source: clock === 'eightcap' ? 'Imported CSV · Eightcap broker → UTC' : 'Imported CSV · UTC' });
 let total = 0; let last = 0; let failed = false;
 try {
  await new Promise<void>((resolve, reject) => {
   Papa.parse<Record<string, unknown>>(file, {
    header: true, skipEmptyLines: 'greedy', chunkSize: 1024 * 1024,
    transformHeader: h => h.trim().replace(/[<>]/g, '').toLowerCase(),
    chunk(results, parser) {
     parser.pause();
     (async () => {
      if (results.errors.length) throw Error('CSV อ่านไม่สำเร็จ: ' + results.errors[0].message);
      const rows = results.data.map(row => {
       const r = { ...row };
       if (r.date && r.time && String(r.time).includes(':')) { r.datetime_utc = String(r.date).replaceAll('.', '-') + ' ' + r.time; delete r.time; }
       if (r.tickvol && !r.volume) r.volume = r.tickvol;
       return r;
      });
      const bars = normalizeImportBars(rows, clock);
      if (bars.length && bars[0].time <= last) throw Error('CSV ต้องเรียงจากอดีตไปปัจจุบัน และไม่มีเวลาซ้ำข้ามช่วงข้อมูล');
      for (let i = 0; i < bars.length; i += 10000) {
       const batch = bars.slice(i, i + 10000); await api('uploadChunk', { id, chunkId: crypto.randomUUID(), bars: batch });
       total += batch.length; progress('นำเข้าแล้ว ' + total.toLocaleString() + ' แท่ง');
      }
      if (bars.length) last = bars.at(-1)!.time; parser.resume();
     })().catch(error => { failed = true; parser.abort(); reject(error); });
    },
    complete() { if (!failed) resolve(); }, error(error) { failed = true; reject(error); },
   });
  });
  await api('finishDataset', { id }); return id;
 } catch (error) { await api('discardDataset', { id }).catch(() => {}); throw error; }
}
export function download(name: string, content: string, type = 'application/json') {
 const url = URL.createObjectURL(new Blob([content], { type })); const a = document.createElement('a');
 a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
