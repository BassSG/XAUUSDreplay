import {Eye, EyeOff} from 'lucide-react';
import {studyStateLabel, type LiveStudyBadge} from '../lib/live-indicators';

export function StudyVisibilityButton({label, hidden, onToggle}: {label: string; hidden: boolean; onToggle: () => void}) {
  const action = (hidden ? 'แสดง ' : 'ซ่อน ') + label;
  const Icon = hidden ? EyeOff : Eye;
  return <button type="button" className="live-icon live-study-eye" title={action}
    aria-label={action} onClick={onToggle}><Icon size={16} aria-hidden="true"/></button>;
}

export default function LiveStudyLegend({badges, onOpen, details, onDetails, showTitles, hiddenStudies, onToggleStudy}: {
  badges: LiveStudyBadge[]; onOpen: () => void; details?: string; onDetails?: () => void;
  showTitles: boolean; hiddenStudies: readonly string[]; onToggleStudy: (id: string) => void;
}) {
  const message = details && onDetails && <button type="button" onClick={onDetails} title={details}>ดูข้อความ Pine</button>;
  if (!showTitles) return message ? <div className="live-study-legend">{message}</div> : null;
  const first = badges[0];
  if (!first) return null;
  const visible = badges.filter(badge => !hiddenStudies.includes(badge.id));
  const state = visible.some(badge => badge.state === 'loading') ? 'loading'
    : visible.some(badge => badge.state === 'error') ? 'error' : visible.length ? 'ready' : 'hidden';
  const summary = state === 'hidden' ? 'ซ่อนอยู่' : studyStateLabel[state];
  const title = badges.map(badge => badge.label + ' · ' + (hiddenStudies.includes(badge.id) ? 'ซ่อนอยู่' : studyStateLabel[badge.state])).join('\n');
  const firstHidden = hiddenStudies.includes(first.id);
  const label = <><i className="live-study-dot" aria-hidden="true"/><span className="live-study-name" data-hidden={firstHidden}>{first.label}</span>
    {badges.length > 1 && <span>+{badges.length - 1}</span>}</>;
  return <div className="live-study-legend" role="group" aria-label="อินดิเคเตอร์ที่ใช้งาน">
    <button type="button" className="live-study-chip" data-study-state={state} title={title}
      aria-haspopup="dialog" aria-label={'จัดการอินดิเคเตอร์ที่ใช้งาน · ' + summary} onClick={onOpen}>{label}</button>
    <StudyVisibilityButton label={first.label} hidden={firstHidden} onToggle={() => onToggleStudy(first.id)}/>
    {message}
  </div>;
}
