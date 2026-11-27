import {isFocusedIndicator} from '../lib/focused-indicators';
import {useState} from 'react';
import {
  Activity, BarChart3, ChartArea, ChartLine, ChartSpline, ChevronUp, CircleHelp, Gauge,
  Code2, MoveVertical, Pencil, Search, SlidersHorizontal, TrendingUp, Waves, X, type LucideIcon,
} from 'lucide-react';
import {studyDefinitions, studyLabel, studyLength, type LiveStudy, type LiveStudyLengths} from '../lib/live-indicators';
import {useDialog} from '../lib/use-dialog';
import type {IndicatorSpec} from '../lib/engine';
import type {StudyStatus} from '../lib/use-pine';
import PineInputs from './pine-inputs';

type Props = {
  selected: LiveStudy[];
  lengths: LiveStudyLengths;
  onToggle: (study: LiveStudy) => void;
  onLength: (study: LiveStudy, length: number) => void;
  onClose: () => void;
  onPine: () => void;
  message: string;
  scripts: IndicatorSpec[];
  evaluations: StudyStatus[];
  pendingId?: string;
  pendingStatus: string;
  onCancelApply: () => void;
  onEdit: (script: IndicatorSpec) => void;
  onScriptChange: (script: IndicatorSpec) => void;
};

const studies = Object.keys(studyDefinitions) as LiveStudy[];
const icons: Record<LiveStudy, LucideIcon> = {
  ema20: ChartSpline, ema50: ChartSpline, sma: ChartLine, wma: TrendingUp, vwma: ChartArea,
  bollinger: Waves, donchian: MoveVertical, keltner: Waves, supertrend: ChevronUp,
  rsi14: Gauge, stochastic: Activity, roc: TrendingUp, macd: BarChart3, atr: Activity,
  volume: BarChart3, obv: ChartArea,
};

export default function LiveStudyPanel({
  selected, lengths, onToggle, onLength, onClose, onPine, message, scripts, evaluations,
  pendingId, pendingStatus, onCancelApply, onEdit, onScriptChange,
}: Props) {
  const [query, setQuery] = useState('');
  const [help, setHelp] = useState<LiveStudy | null>(null);
  const [inputsFor, setInputsFor] = useState<string | null>(null);
  useDialog(true, onClose);
  const search = query.trim().toLocaleLowerCase();
  const matches = studies.filter(study => [studyLabel(study, lengths), studyDefinitions[study].help]
    .some(value => value.toLocaleLowerCase().includes(search)));
  const custom = scripts.filter(script => (script.name + ' Pine').toLocaleLowerCase().includes(search));
  return <div className="modal-shade" onMouseDown={event => {
    if (event.target === event.currentTarget) onClose();
  }}>
    <section className="modal live-picker live-study-panel" role="dialog" aria-modal="true" aria-labelledby="live-indicator-title">
      <header className="modal-head">
        <h2 id="live-indicator-title">อินดิเคเตอร์</h2>
        <button type="button" className="live-icon" aria-label="ปิดอินดิเคเตอร์" onClick={onClose}><X size={18}/></button>
      </header>
      <button className="study-pine-entry" type="button" disabled={Boolean(pendingId)} onClick={onPine}><Code2 size={19}/><span><strong>Pine Editor</strong><small>วางสคริปต์หรือนำเข้าไฟล์ .pine</small></span></button>
      {message && <p className="chart-feedback" role="status">{message}</p>}
      <div className="live-picker-search">
        <label><Search size={16}/><input type="search" aria-label="ค้นหาอินดิเคเตอร์" placeholder="ค้นหาชื่ออินดิเคเตอร์"
          value={query} onChange={event => setQuery(event.currentTarget.value)}/></label>
      </div>
      <div className="live-picker-list live-study-list">
        {!matches.length && !custom.length && <p role="status">ไม่พบอินดิเคเตอร์ที่ตรงกับคำค้น</p>}
        {custom.length > 0 && <h3>อินดิเคเตอร์ของฉัน</h3>}
        {custom.map(script => {
          const evaluation = evaluations.find(item => item.id === script.id);
          const pending = pendingId === script.id;
          return <div className="live-study-item live-custom-study" key={script.id}>
            <div className="live-study-row">
              <label className="live-study-toggle">
                <input type="checkbox" checked={script.enabled} disabled={Boolean(pendingId)}
                  onChange={() => onScriptChange({...script, enabled: !script.enabled})}/>
                <Code2 size={17} aria-hidden="true"/><span>{script.name}{isFocusedIndicator(script.builtinId)&&<small> · พื้นฐาน</small>}</span>
              </label>
              <button className="live-icon" type="button" aria-label={'ตั้งค่า ' + script.name}
                aria-expanded={inputsFor === script.id} title="ตั้งค่าพารามิเตอร์"
                disabled={pending || (!evaluation?.inputs.length && !script.enabled)}
                onClick={() => setInputsFor(inputsFor === script.id ? null : script.id)}><SlidersHorizontal size={16}/></button>
              {!isFocusedIndicator(script.builtinId)&&<button className="live-icon" type="button" aria-label={'แก้ไขโค้ด ' + script.name}
                disabled={Boolean(pendingId)} title="แก้ไขโค้ด" onClick={() => onEdit(script)}><Pencil size={16}/></button>}
            </div>
            {pending && <div className="live-custom-progress">
              <span role="status">{pendingStatus || 'กำลังคำนวณสคริปต์'}</span><button type="button" onClick={onCancelApply}>ยกเลิก</button>
            </div>}
            {script.enabled && evaluation?.error && <p role="alert">{evaluation.error}</p>}
            {inputsFor === script.id && <PineInputs study={evaluation} values={script.inputs}
              managed={isFocusedIndicator(script.builtinId)}
              onChange={inputs => { if (!pendingId) onScriptChange({...script, inputs}); }}/>}
          </div>;
        })}
        {custom.length > 0 && matches.length > 0 && <h3>อินดิเคเตอร์ในตัว</h3>}
        {matches.map(study => {
          const length = studyLength(study, lengths[study]);
          const label = studyLabel(study, lengths);
          const description = studyDefinitions[study].help;
          const Icon = icons[study];
          return <div className="live-study-item" key={study}>
            <div className="live-study-row">
            <label className="live-study-toggle" title={label + ' · ' + description}>
              <input type="checkbox" checked={selected.includes(study)} onChange={() => onToggle(study)}/>
              <Icon size={17} aria-hidden="true"/>
              <span>{label}</span>
            </label>
            {length !== null && <label className="live-study-length">
              <span>คาบ</span>
              <input key={length} aria-label={'คาบ ' + label} type="number" inputMode="numeric"
                min={1} max={500} step={1} defaultValue={length}
                onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}
                onBlur={event => {
                  const value = event.currentTarget.valueAsNumber;
                  const next = studyLength(study, value);
                  event.currentTarget.value = String(next ?? length);
                  if (next !== null && next !== length) onLength(study, next);
                }}/>
            </label>}
            <button className="live-icon live-study-help" type="button" aria-label={'วิธีใช้ ' + label}
              title={description} aria-expanded={help === study} aria-controls={'study-help-' + study}
              onClick={() => setHelp(help === study ? null : study)}><CircleHelp size={17}/></button>
            </div>
            <p id={'study-help-' + study} hidden={help !== study}>{description}</p>
          </div>;
        })}
      </div>
    </section>
  </div>;
}
