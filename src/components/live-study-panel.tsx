import {useState} from 'react';
import {
  Activity, BarChart3, ChartArea, ChartLine, ChartSpline, ChevronUp, CircleHelp, Gauge,
  MoveVertical, Search, TrendingUp, Waves, X, type LucideIcon,
} from 'lucide-react';
import {studyDefinitions, studyLabel, studyLength, type LiveStudy, type LiveStudyLengths} from '../lib/live-indicators';
import {useDialog} from '../lib/use-dialog';

type Props = {
  selected: LiveStudy[];
  lengths: LiveStudyLengths;
  onToggle: (study: LiveStudy) => void;
  onLength: (study: LiveStudy, length: number) => void;
  onClose: () => void;
};

const studies = Object.keys(studyDefinitions) as LiveStudy[];
const icons: Record<LiveStudy, LucideIcon> = {
  ema20: ChartSpline, ema50: ChartSpline, sma: ChartLine, wma: TrendingUp, vwma: ChartArea,
  bollinger: Waves, donchian: MoveVertical, keltner: Waves, supertrend: ChevronUp,
  rsi14: Gauge, stochastic: Activity, roc: TrendingUp, macd: BarChart3, atr: Activity,
  volume: BarChart3, obv: ChartArea,
};

export default function LiveStudyPanel({selected, lengths, onToggle, onLength, onClose}: Props) {
  const [query, setQuery] = useState('');
  const [help, setHelp] = useState<LiveStudy | null>(null);
  useDialog(true, onClose);
  const search = query.trim().toLocaleLowerCase();
  const matches = studies.filter(study => [studyLabel(study, lengths), studyDefinitions[study].help]
    .some(value => value.toLocaleLowerCase().includes(search)));
  return <div className="modal-shade" onMouseDown={event => {
    if (event.target === event.currentTarget) onClose();
  }}>
    <section className="modal live-picker live-study-panel" role="dialog" aria-modal="true" aria-labelledby="live-indicator-title">
      <header className="modal-head">
        <h2 id="live-indicator-title">อินดิเคเตอร์</h2>
        <button type="button" className="live-icon" aria-label="ปิดอินดิเคเตอร์" onClick={onClose}><X size={18}/></button>
      </header>
      <div className="live-picker-search">
        <label><Search size={16}/><input type="search" aria-label="ค้นหาอินดิเคเตอร์" placeholder="ค้นหาชื่ออินดิเคเตอร์"
          value={query} onChange={event => setQuery(event.currentTarget.value)}/></label>
      </div>
      <div className="live-picker-list live-study-list">
        {!matches.length && <p role="status">ไม่พบอินดิเคเตอร์ที่ตรงกับคำค้น</p>}
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
