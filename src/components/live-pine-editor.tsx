import {isFocusedIndicator} from '../lib/focused-indicators';
import {useRef, useState} from 'react';
import {Code2, FileUp, Pencil, Play, Plus, SlidersHorizontal, Trash2} from 'lucide-react';
import {pineExamples} from '../lib/pine-examples';
import {checkPineIndicator} from '../lib/live-pine';
import type {IndicatorSpec} from '../lib/engine';
import type {StudyStatus} from '../lib/use-pine';
import PineInputs from './pine-inputs';

export type ScriptDraft = {id: string | null; name: string; source: string};
export const newScriptDraft: ScriptDraft = {id: null, name: '', source: ''};
type Props = {
  marketName: string;
  scripts: IndicatorSpec[]; studies: StudyStatus[]; draft: ScriptDraft; setDraft: (v: ScriptDraft) => void;
  pending: boolean; hasBars: boolean; status: string; error: string;
  onApply: (s: IndicatorSpec) => void; onChange: (s: IndicatorSpec[]) => void; onRetry: () => void; onShowChart: () => void;
};
export default function LivePineEditor({marketName, scripts, studies, draft, setDraft, pending, hasBars, status, error, onApply, onChange, onRetry, onShowChart}: Props) {
  const [issue, setIssue] = useState('');
  const [inputsFor, setInputsFor] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  function edit(next: ScriptDraft) { setIssue(''); setDraft(next); }
  function apply() {
    try {
      const source = draft.source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
      const title = checkPineIndicator(source);
      const existing = scripts.find(s => s.id === draft.id);
      setIssue('');
      onApply({...existing, id: draft.id ?? crypto.randomUUID(), name: draft.name.trim() || title, source, enabled: true});
    } catch (e) { setIssue(e instanceof Error ? e.message : String(e)); }
  }
  async function openFile(file: File) {
    try {
      if (file.size > 1000000) throw Error('ไฟล์ใหญ่เกินขนาดที่ Pine Editor รองรับ');
      const text = new TextDecoder('utf-8', {fatal: true}).decode(await file.arrayBuffer());
      if (text.length > 250000) throw Error('สคริปต์ยาวเกิน 250,000 ตัวอักษร');
      edit({...newScriptDraft, source: text});
    } catch (e) { setIssue(e instanceof Error ? e.message : 'อ่านไฟล์ไม่ได้ กรุณาเลือกไฟล์ข้อความ UTF-8'); }
  }
  return <div className="live-script-editor">
    {scripts.length > 0 && <div className="script-library" aria-label="สคริปต์บนกราฟ">
      {scripts.map(s => {
        const study = studies.find(row => row.id === s.id);
        return <div key={s.id}>
          <div className="script-row">
            <label title={'แสดง ' + s.name}><input type="checkbox" checked={s.enabled} disabled={pending}
              onChange={() => onChange(scripts.map(row => row.id === s.id ? {...row, enabled: !row.enabled} : row))}/>{s.name}</label>
            {!isFocusedIndicator(s.builtinId)&&<button className="live-icon" disabled={pending} aria-label={'แก้ไข ' + s.name} title="แก้ไขซอร์ส"
              onClick={() => edit({id: s.id, name: s.name, source: s.source})}><Pencil size={15}/></button>}
            <button className="live-icon" disabled={(!s.enabled && !study?.inputs.length) || pending} aria-label={'ตั้งค่า ' + s.name} title="ตั้งค่าพารามิเตอร์"
              aria-expanded={inputsFor === s.id} onClick={() => setInputsFor(inputsFor === s.id ? '' : s.id)}><SlidersHorizontal size={15}/></button>
            {!isFocusedIndicator(s.builtinId)&&<button className="live-icon" disabled={pending} aria-label={'ถอด ' + s.name} title="ถอดจากกราฟ"
              onClick={() => { onChange(scripts.filter(row => row.id !== s.id)); if (draft.id === s.id) edit({...newScriptDraft, source: s.source, name: s.name}); }}><Trash2 size={15}/></button>}
          </div>
          {inputsFor === s.id && <PineInputs study={study} values={s.inputs} managed={isFocusedIndicator(s.builtinId)}
            onChange={inputs => onChange(scripts.map(row => row.id === s.id ? {...row, inputs} : row))}/>}
        </div>;
      })}
    </div>}
    <div className="script-file-actions">
      <button disabled={pending} onClick={() => edit(newScriptDraft)}><Plus size={15}/>สคริปต์ใหม่</button>
      <button disabled={pending} onClick={() => fileInput.current?.click()}><FileUp size={15}/>เปิดไฟล์ Pine</button>
      <input type="file" hidden ref={fileInput} aria-label="ไฟล์ Pine Script" accept=".pine,.txt,text/plain" onChange={e => {
        const f = e.target.files?.[0]; e.target.value = ''; if (f) void openFile(f);
      }}/>
      <select aria-label="ตัวอย่าง Pine" disabled={pending} value="" onChange={e => {
        const source = pineExamples[e.target.value as keyof typeof pineExamples]; if (source) edit({...newScriptDraft, source});
      }}><option value="">ตัวอย่าง Pine</option>{Object.keys(pineExamples).map(name => <option key={name}>{name}</option>)}</select>
    </div>
    <label className="chart-field">ชื่อบนกราฟ
      <input disabled={pending} maxLength={120} value={draft.name} placeholder="ใช้ชื่อจาก indicator()"
        onChange={e => edit({...draft, name: e.target.value})}/>
    </label>
    <label className="script-source-label" htmlFor="live-pine-source"><Code2 size={16}/>Pine Script</label>
    <textarea id="live-pine-source" className="script-source" spellCheck={false} autoCapitalize="off" autoCorrect="off"
      readOnly={pending} value={draft.source} placeholder={'//@version=6\nindicator("My EMA", overlay=true)\nplot(ta.ema(close, 20))'}
      onChange={e => edit({...draft, source: e.target.value})} onKeyDown={e => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !pending && hasBars && draft.source.trim()) { e.preventDefault(); apply(); }
      }}/>
    <p className="chart-hint">ใช้ซอร์สของ indicator() ใน Pine v5/v6 กับข้อมูล {marketName} ผ่าน PineTS ส่วน strategy() และ library import ยังใช้ไม่ได้</p>
    {(issue || error) && <p role="alert" className="chart-error">{issue || error}</p>}
    {status && <p role="status" className="chart-feedback">{status}</p>}
    <div className="script-run">
      {scripts.length > 0 && <button disabled={pending} onClick={onShowChart}>ดูกราฟ</button>}
      {error && !pending && scripts.some(s => s.enabled) && <button onClick={onRetry}>ลองคำนวณใหม่</button>}
      <button className="primary" disabled={pending || !draft.source.trim() || !hasBars} onClick={apply}><Play size={15}/>
        {pending ? 'กำลังตรวจสคริปต์…' : !hasBars ? 'รอแท่งราคา' : draft.id ? 'อัปเดตบนกราฟ' : 'เพิ่มลงกราฟ'}
      </button>
    </div>
  </div>;
}
