import {Pencil, Radio, TrendingDown, TrendingUp} from 'lucide-react';
import type {Drawing, Side} from '../lib/engine';
import {drawingTools} from '../lib/drawing-definitions';
import {forwardPlan, forwardStatus, forwardStatusLabel, isForwardPosition} from '../lib/forward-test';
import {positionMetrics} from '../lib/drawing-geometry';

const price = new Intl.NumberFormat('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
const clock = new Intl.DateTimeFormat('th-TH', {timeZone: 'Asia/Bangkok', dateStyle: 'short', timeStyle: 'medium'});

export default function LiveForwardPanel({drawings, enabled, live, selected, onPick, onEdit, onTrack}: {
  drawings: Drawing[];
  enabled: boolean;
  live: boolean;
  selected: string | null;
  onPick: (side: Side) => void;
  onEdit: (id: string) => void;
  onTrack: (id: string) => void;
}) {
  const positions = drawings.filter(isForwardPosition);
  return <div className="live-forward-panel">
    <div className="forward-readout">
      <span data-live={live}><Radio size={15}/>{live ? 'Eightcap สด' : 'รอราคา Eightcap สด'}</span>
      <span>โหมดจำลอง</span>
    </div>
    <div className="forward-pick">
      <button type="button" data-side="long" disabled={!enabled} onClick={() => onPick('long')}><TrendingUp size={18}/>Long Position</button>
      <button type="button" data-side="short" disabled={!enabled} onClick={() => onPick('short')}><TrendingDown size={18}/>Short Position</button>
    </div>
    <p className="chart-hint">วาง Entry, TP และ SL บนกราฟ ระบบจะบันทึกเวลาที่พบเงื่อนไขจากราคาที่ได้รับระหว่างเปิดหน้า Live</p>
    <p className="chart-hint">Long ใช้ Ask เข้าและ Bid ออก ส่วน Short ใช้ Bid เข้าและ Ask ออก</p>
    {positions.length === 0 && <p className="forward-empty">ยังไม่มีตำแหน่งสำหรับทดสอบ</p>}
    <ul className="forward-list">
      {positions.map(drawing => {
        const plan = forwardPlan(drawing);
        const state = forwardStatus(drawing);
        const run = drawing.forwardTest;
        const metrics = plan && positionMetrics(plan.side, drawing.points);
        return <li key={drawing.id} data-current={selected === drawing.id}>
          <div className="forward-position-head">
            <strong>{drawingTools[drawing.kind].name}{drawing.text?.trim() && <span>{drawing.text}</span>}</strong>
            <span className="forward-state" data-forward-state={state}>{forwardStatusLabel[state]}</span>
          </div>
          {plan && <dl className="forward-prices">
            <div><dt>Entry</dt><dd>{price.format(plan.entry)}</dd></div>
            <div><dt>TP</dt><dd>{price.format(plan.tp)}</dd></div>
            <div><dt>SL</dt><dd>{price.format(plan.sl)}</dd></div>
            {metrics && <div><dt>R/R</dt><dd>{metrics.ratio.toFixed(2)}</dd></div>}
          </dl>}
          {drawing.size && metrics && <p className="chart-hint">
            {drawing.size.lots} ล็อต · เสี่ยง {price.format(metrics.risk*drawing.size.lots*drawing.size.contract)} USD ·
            เป้ากำไร {price.format(metrics.reward*drawing.size.lots*drawing.size.contract)} USD ก่อนค่าธรรมเนียม
            {state !== 'changed' && run?.entry && run.exit && ' · ผลจำลอง ' +
              price.format((run.exit.price-run.entry.price)*(plan?.side==='short'?-1:1)*drawing.size.lots*drawing.size.contract)+' USD'}
          </p>}
          {state === 'changed' && <p className="chart-hint">กดติดตามระดับใหม่เพื่อเริ่มรอบใหม่</p>}
          {state !== 'changed' && run?.entry && <p className="forward-event">
            <span>Entry {price.format(run.entry.price)}</span><time dateTime={new Date(run.entry.time * 1000).toISOString()}>{clock.format(run.entry.time * 1000)}</time>
          </p>}
          {state !== 'changed' && run?.exit && <p className="forward-event">
            <span>{run.exit.kind.toUpperCase()} {price.format(run.exit.price)}</span><time dateTime={new Date(run.exit.time * 1000).toISOString()}>{clock.format(run.exit.time * 1000)}</time>
          </p>}
          <div className="forward-position-actions">
            <button type="button" onClick={() => onEdit(drawing.id)}><Pencil size={14}/>แก้ระดับ</button>
            {plan && (state === 'idle' || state === 'changed') && <button className="primary" type="button" onClick={() => onTrack(drawing.id)}>
              <Radio size={14}/>{state === 'changed' ? 'ติดตามระดับใหม่' : 'เริ่มติดตาม'}
            </button>}
          </div>
        </li>;
      })}
    </ul>
  </div>;
}
