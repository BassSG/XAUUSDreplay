import {useEffect, useRef, useState} from 'react';
import {Download, FolderOpen, Plus, Save, Trash2, Upload} from 'lucide-react';
import {layoutName, readLayoutFile, type LiveLayoutFile} from '../lib/live-layouts';
import {deleteLiveLayout, listLiveLayouts, saveLiveLayout, type SavedLayout} from '../lib/storage';

export type ActiveLayout = Pick<SavedLayout, 'id' | 'revision'> & {name: string};
type Props = {
  active: ActiveLayout | null;
  capture: (name: string) => LiveLayoutFile;
  onSave: (layout: SavedLayout | null) => void;
  onOpen: (layout: SavedLayout) => void;
};
function downloadLayout(file: LiveLayoutFile) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], {type: 'application/json'}));
  const link = document.createElement('a');
  link.href = url;
  link.download = (file.name.replace(/[^\p{L}\p{N}\p{M} ._-]/gu, '_') || 'XAUUSD') + '.xau-layout.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export default function LiveLayoutPanel({active, capture, onSave, onOpen}: Props) {
  const [rows, setRows] = useState<SavedLayout[]>([]);
  const [name, setName] = useState(active?.name ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [removing, setRemoving] = useState('');
  const [pastedLayout, setPastedLayout] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let mounted = true;
    const refresh = () => listLiveLayouts().then(records => { if (mounted) setRows(records); }).catch(e => { if (mounted) setError(e.message); });
    void refresh();
    window.addEventListener('xau-live-layouts-changed', refresh);
    return () => { mounted = false; window.removeEventListener('xau-live-layouts-changed', refresh); };
  }, []);

  async function act(task: () => Promise<void>) {
    setBusy(true); setError(''); setMessage('');
    try { await task(); }
    catch (e) { setError(e instanceof Error ? e.message : 'บันทึกเลย์เอาต์ไม่สำเร็จ'); }
    finally {
      try { setRows(await listLiveLayouts()); } catch (e) { setError(String(e)); }
      setBusy(false);
    }
  }
  function save(asNew: boolean) {
    void act(async () => {
      const parsed = layoutName.safeParse(name);
      if (!parsed.success) throw Error('ตั้งชื่อเลย์เอาต์ 1–100 ตัวอักษร');
      const file = capture(parsed.data);
      const record = await saveLiveLayout(file, asNew ? undefined : active ?? undefined);
      onSave(record); setName(file.name); setMessage('บันทึก ' + file.name + ' แล้ว');
    });
  }
  async function importLayout(read: () => string | Promise<string>) {
    await act(async () => {
      let json: unknown;
      try { json = JSON.parse(await read()); } catch { throw Error('อ่านข้อมูลเลย์เอาต์ JSON ไม่ได้'); }
      const imported = readLayoutFile(json);
      const saved = await saveLiveLayout(imported);
      setPastedLayout('');
      setMessage('นำเข้า ' + saved.file.name + ' แล้ว กดชื่อเพื่อเปิด');
    });
  }
  return <div className="layout-manager">
    <label className="chart-field">ชื่อเลย์เอาต์
      <input value={name} placeholder="เช่น ทองคำ 15 นาที" maxLength={100}
        onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && name.trim() && !busy) save(!active); }}/>
    </label>
    <div className="layout-actions">
      <button className="primary" disabled={busy || !name.trim()} onClick={() => save(!active)}><Save size={16}/>{active ? 'บันทึกทับเลย์เอาต์นี้' : 'บันทึกเลย์เอาต์'}</button>
      {active && <button disabled={busy || !name.trim()} onClick={() => save(true)}><Plus size={16}/>บันทึกเป็นชุดใหม่</button>}
    </div>
    <h3>เลย์เอาต์และบันทึกในเครื่อง</h3>
    <p className="chart-hint">กราฟนี้บันทึกอัตโนมัติทุก 5 นาทีและกดบันทึกได้จากแถบบน ขณะนี้ข้อมูลยังอยู่ในเบราว์เซอร์เครื่องนี้</p>
    {!rows.length && <p className="chart-hint">เลย์เอาต์ที่บันทึกจะอยู่ที่นี่</p>}
    <div className="layout-list">
      {rows.map(row => <div className="layout-row" key={row.id}>
        <button className="layout-open" disabled={busy} title={'เปิด ' + row.file.name} onClick={() => onOpen(row)}>
          <FolderOpen size={17}/><span><strong>{row.isAutoSave ? 'บันทึกอัตโนมัติ' : row.file.name}</strong><small>{row.file.workspace.period} · {new Date(row.updated).toLocaleString('th-TH', {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'})}{active?.id === row.id ? ' · กำลังใช้' : ''}</small></span>
        </button>
        {!row.isAutoSave && (removing === row.id ? <>
          <button disabled={busy} onClick={() => void act(async () => {
            await deleteLiveLayout(row); if (active?.id === row.id) onSave(null); setRemoving(''); setMessage('ลบเลย์เอาต์แล้ว');
          })}>ยืนยันลบ</button><button onClick={() => setRemoving('')}>ยกเลิก</button>
        </> : <button className="live-icon" aria-label={'ลบ ' + row.file.name} disabled={busy} onClick={() => setRemoving(row.id)}><Trash2 size={16}/></button>)}
      </div>)}
    </div>
    <div className="layout-transfer">
      <p className="chart-hint">ย้ายกราฟไปอีกเครื่องได้ด้วยการส่งออกไฟล์แล้วนำเข้า ส่วนซิงก์อัตโนมัติข้ามเครื่องจะต้องเชื่อมต่อบริการคลาวด์</p>
      <div className="layout-actions">
        <button onClick={() => downloadLayout(capture(name.trim() || 'XAUUSD'))}><Download size={16}/>ส่งออกกราฟนี้</button>
        <button disabled={busy} onClick={() => fileInput.current?.click()}><Upload size={16}/>นำเข้าเลย์เอาต์</button>
        <input type="file" hidden ref={fileInput} aria-label="ไฟล์เลย์เอาต์" accept=".json,application/json"
          onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importLayout(() => f.text()); }}/>
      </div>
      <details className="layout-paste">
        <summary>วางข้อมูลเลย์เอาต์</summary>
        <label className="chart-field">ข้อมูลเลย์เอาต์ JSON
          <textarea className="script-source" value={pastedLayout} spellCheck={false}
            onChange={event => setPastedLayout(event.target.value)}/>
        </label>
        <button type="button" disabled={busy || !pastedLayout.trim()}
          onClick={() => void importLayout(() => pastedLayout)}>นำเข้าข้อมูลที่วาง</button>
      </details>
    </div>
    {message && <p role="status" className="chart-feedback">{message}</p>}
    {error && <p role="alert" className="chart-error">{error}</p>}
  </div>;
}
