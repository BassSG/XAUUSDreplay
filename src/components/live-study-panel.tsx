import {X} from 'lucide-react';
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

export default function LiveStudyPanel({selected, lengths, onToggle, onLength, onClose}: Props) {
  useDialog(true, onClose);
  return <div className="modal-shade" onMouseDown={event => {
    if (event.target === event.currentTarget) onClose();
  }}>
    <section className="modal live-study-panel" role="dialog" aria-modal="true" aria-labelledby="live-indicator-title">
      <header className="modal-head">
        <h2 id="live-indicator-title">อินดิเคเตอร์</h2>
        <button type="button" className="live-icon" aria-label="ปิดอินดิเคเตอร์" onClick={onClose}><X size={18}/></button>
      </header>
      <div className="live-study-list">
        {studies.map(study => {
          const length = studyLength(study, lengths[study]);
          const label = studyLabel(study, lengths);
          return <div className="live-study-row" key={study}>
            <label className="live-study-toggle">
              <input type="checkbox" checked={selected.includes(study)} onChange={() => onToggle(study)}/>
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
          </div>;
        })}
      </div>
    </section>
  </div>;
}
