import {studyStateLabel, type LiveStudyBadge} from '../lib/live-indicators';

export default function LiveStudyLegend({badges, onOpen, details, onDetails}: {
  badges: LiveStudyBadge[]; onOpen?: () => void; details?: string; onDetails?: () => void;
}) {
  const first = badges[0];
  if (!first) return null;
  const state = badges.some(badge => badge.state === 'loading') ? 'loading'
    : badges.some(badge => badge.state === 'error') ? 'error' : 'ready';
  const summary = studyStateLabel[state];
  const title = badges.map(badge => badge.label + ' · ' + studyStateLabel[badge.state]).join('\n');
  const label = <><i className="live-study-dot" aria-hidden="true"/>{first.label}
    {badges.length > 1 && <span>+{badges.length - 1}</span>}</>;
  return <div className="live-study-legend" aria-label="อินดิเคเตอร์ที่ใช้งาน">
    {onOpen ? <button type="button" className="live-study-chip" data-study-state={state} title={title}
      aria-label={'จัดการอินดิเคเตอร์ที่ใช้งาน · ' + summary} onClick={onOpen}>{label}</button>
      : <span className="live-study-chip" data-study-state={state} title={title} aria-label={title}>{label}</span>}
    {details && onDetails && <button type="button" onClick={onDetails} title={details}>ดูข้อความ Pine</button>}
  </div>;
}
