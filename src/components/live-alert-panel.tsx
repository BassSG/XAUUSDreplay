import {useState, type FormEvent} from 'react';
import {Bell, BellRing, Check, CirclePause, History, Link2, Play, Plus, Smartphone, Trash2} from 'lucide-react';
import type {Drawing} from '../lib/engine';
import {drawingTools} from '../lib/drawing-definitions';
import type {AlertDrawing, AlertDirection} from '../lib/price-alerts';
import {enableAlertNotifications} from '../lib/alert-push';
import {alertText, type usePriceAlerts} from '../lib/use-price-alerts';

const formatter = new Intl.NumberFormat('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
const times = new Intl.DateTimeFormat('th-TH', {timeZone: 'Asia/Bangkok', dateStyle: 'short', timeStyle: 'medium'});
const directions: Record<AlertDirection, string> = {cross: 'แตะหรือผ่านระดับ', up: 'ขึ้นแตะหรือทะลุ', down: 'ลงแตะหรือทะลุ'};

export default function LiveAlertPanel({alerts, bid, drawing}: {alerts: ReturnType<typeof usePriceAlerts>; bid?: number; drawing?: Drawing}) {
  const [tab, setTab] = useState<'rules' | 'history' | 'devices'>('rules');
  const [level, setLevel] = useState(() => bid?.toFixed(2) ?? '');
  const [name, setName] = useState(()=>drawing ? (drawing.text || drawingTools[drawing.kind].name).slice(0,64) : '');
  const [zone, setZone] = useState<'enter'|'exit'>('enter');
  const [direction, setDirection] = useState<AlertDirection>('cross');
  const [repeat, setRepeat] = useState(false);
  const [server, setServer] = useState(alerts.defaultServer);
  const [token, setToken] = useState('');
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<{text: string; error?: boolean} | null>(null);
  const notificationPermission = typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;

  async function act(operation: () => void | Promise<void>, success: string) {
    setFeedback(null);
    setPending(true);
    try {
      await operation();
      setFeedback({text: success});
    } catch (error) {
      setFeedback({error: true, text: error instanceof Error ? error.message : 'ทำรายการไม่สำเร็จ'});
    } finally {
      setPending(false);
    }
  }

  function add(event: FormEvent) {
    event.preventDefault();
    void act(async () => {
      if (drawing) {
        const [from,to]=[...drawing.points].sort((a,b)=>a.time-b.time);
        const extend={extendLeft:Boolean(drawing.style?.extendLeft),extendRight:Boolean(drawing.style?.extendRight)};
        const target: AlertDrawing=drawing.kind==='rect'
          ? {kind:'zone',from,to,condition:zone,...extend}
          : {kind:'line',from,to,...extend};
        await alerts.command({op:'add-drawing',drawing:target,level:from.price,label:name,direction,repeat});
      } else {
        await alerts.command({op:'add',level:Number(level),label:name,direction,repeat});
      }
      setName('');
    }, 'บันทึกแจ้งเตือนแล้ว');
  }

  return <div className="alerts-panel">
    <div className="alerts-status">
      <span><Bell size={15}/>{alerts.connection ? 'ข้ามอุปกรณ์' : 'ขณะเปิดหน้า Live'}</span>
      <span>{bid === undefined ? 'รอราคาสดจาก Eightcap' : 'Eightcap Bid ' + formatter.format(bid)}</span>
    </div>
    <div className="alerts-tabs" role="group" aria-label="จัดการแจ้งเตือน">
      <button type="button" aria-pressed={tab === 'rules'} onClick={() => {setTab('rules'); setFeedback(null);}}><Bell size={16}/>ตั้งเตือน</button>
      <button type="button" aria-pressed={tab === 'history'} onClick={() => {setTab('history'); setFeedback(null);}}><History size={16}/>ประวัติ</button>
      <button type="button" aria-pressed={tab === 'devices'} onClick={() => {setTab('devices'); setFeedback(null);}}><Smartphone size={16}/>อุปกรณ์</button>
    </div>
    {tab === 'rules' && <>
      <form className="alerts-form" onSubmit={add}>
        <div className="alerts-fields">
          {!drawing && <label className="chart-field">ราคาเป้าหมาย (USD)
            <input name="price" type="number" inputMode="decimal" step="0.01" min="0.01" max="1000000" required
              placeholder="เช่น 3580.00" value={level} onChange={event => setLevel(event.target.value)}/>
          </label>}
          <label className="chart-field">เงื่อนไข
            {drawing?.kind==='rect' ? <select value={zone} onChange={event=>setZone(event.target.value as 'enter'|'exit')}>
              <option value="enter">ราคาเข้าโซน</option><option value="exit">ราคาออกจากโซน</option>
            </select> : <select value={direction} onChange={event => setDirection(event.target.value as AlertDirection)}>
              {Object.entries(directions).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>}
          </label>
          <label className="chart-field">ชื่อแจ้งเตือน
            <input placeholder="เช่น แนวต้าน" value={name} maxLength={64} onChange={event => setName(event.target.value)}/>
          </label>
          <label className="chart-field">ความถี่
            <select value={String(repeat)} onChange={event => setRepeat(event.target.value === 'true')}>
              <option value="false">ครั้งเดียว</option><option value="true">ทุกครั้งที่แตะหรือผ่าน</option>
            </select>
          </label>
        </div>
        <p className="chart-hint">{drawing ? 'ใช้จุดยึด ณ เวลาที่สร้างแจ้งเตือน หากขยับวัตถุให้ตั้งรายการใหม่' :
          'เริ่มเฝ้าจาก Bid ล่าสุด เมื่อราคาจากอีกฝั่งมาแตะหรือข้ามเป้าจะส่งแจ้งเตือน'}</p>
        <button className="primary" type="submit" disabled={pending || !!alerts.connection && !alerts.remote}><Plus size={17}/>สร้างแจ้งเตือน</button>
      </form>
      <h3 className="alerts-list-title">รายการแจ้งเตือน <span>{alerts.state.rules.length}</span></h3>
      {!alerts.state.rules.length && <p className="chart-hint">ยังไม่มีรายการแจ้งเตือน</p>}
      <ul className="alerts-list">
        {alerts.state.rules.map(rule => <li key={rule.id}>
          <div>
            <strong>{formatter.format(rule.level)}{rule.label && <span> · {rule.label}</span>}</strong>
            <small>{rule.drawing?.kind==='zone' ? rule.drawing.condition==='enter'?'ราคาเข้าโซน':'ราคาออกจากโซน' : directions[rule.direction]} · {rule.repeat ? 'ทุกครั้ง' : 'ครั้งเดียว'}</small>
          </div>
          <span className="alerts-rule-status" data-armed={rule.status === 'armed'}>
            {rule.status === 'armed' ? 'เฝ้าราคา' : rule.status === 'paused' ? 'พัก' : 'แจ้งแล้ว'}
          </span>
          <button className="live-icon" type="button" disabled={pending}
            aria-label={(rule.status === 'armed' ? 'พักแจ้งเตือน ' : 'เปิดแจ้งเตือนอีกครั้ง ') + formatter.format(rule.level)}
            title={rule.status === 'armed' ? 'พัก' : 'เปิดอีกครั้ง'}
            onClick={() => void act(() => alerts.command({op: rule.status === 'armed' ? 'pause' : 'resume', id: rule.id}),
              rule.status === 'armed' ? 'พักแจ้งเตือนแล้ว' : 'เปิดแจ้งเตือนแล้ว')}>
            {rule.status === 'armed' ? <CirclePause size={16}/> : <Play size={16}/>}
          </button>
          <button className="live-icon" type="button" disabled={pending} title="ลบแจ้งเตือน"
            aria-label={'ลบแจ้งเตือน ' + formatter.format(rule.level)}
            onClick={() => void act(() => alerts.command({op: 'delete', id: rule.id}), 'ลบแจ้งเตือนแล้ว')}><Trash2 size={16}/></button>
        </li>)}
      </ul>
    </>}
    {tab === 'history' && <>
      {!alerts.state.events.length && <p className="chart-hint">ยังไม่มีราคาที่เข้าเงื่อนไข</p>}
      <ul className="alerts-list alerts-history">
        {alerts.state.events.map(item => <li key={item.id}>
          <BellRing size={16}/><div><strong>{item.label || 'XAUUSD'}</strong><small>{alertText(item)}</small></div>
          <time dateTime={new Date(item.time * 1000).toISOString()}>{times.format(item.time * 1000)}</time>
        </li>)}
      </ul>
    </>}
    {tab === 'devices' && <div className="alerts-devices">
      {alerts.connection ? <>
        <p className="chart-hint">
          {alerts.remote?.monitor === 'live' && alerts.remote.checkedAt && Date.now() - alerts.remote.checkedAt < 45000
            ? 'บริการกำลังรับราคา Eightcap สด' : 'บริการพร้อมเฝ้าราคาเมื่อมี Alert ที่เปิดอยู่และ Bid สด'}
          {' · '}เปิดรับแล้ว {alerts.remote?.devices.length ?? 0} เครื่อง
        </p>
        <p className="chart-hint">ใช้ลิงก์บริการและรหัสเดียวกันบนมือถือ เปิดรับแจ้งเตือนแยกในแต่ละเครื่อง</p>
        <div className="alerts-device-actions">
          <button type="button" className="primary" disabled={pending || !alerts.remote}
            onClick={() => void act(alerts.deviceEnabled ? alerts.disablePush : alerts.enablePush,
              alerts.deviceEnabled ? 'ปิด Push ในเครื่องนี้แล้ว' : 'เปิดรับ Push ในเครื่องนี้แล้ว')}>
            {alerts.deviceEnabled ? <Check size={16}/> : <BellRing size={16}/>}
            {alerts.deviceEnabled ? 'ปิด Push เครื่องนี้' : 'เปิดรับ Push เครื่องนี้'}
          </button>
          <button type="button" disabled={pending || !alerts.deviceEnabled} onClick={() => void act(alerts.testPush, 'ระบบส่ง Push ทดสอบแล้ว')}>ทดสอบ Push</button>
          <button type="button" disabled={pending} onClick={() => void act(async () => {
            if (alerts.deviceEnabled) await alerts.disablePush();
            alerts.disconnect();
          }, 'ยกเลิกการเชื่อมต่อแล้ว')}>ยกเลิกการเชื่อมต่อ</button>
        </div>
        <p className="chart-hint">iPhone หรือ iPad ให้เพิ่ม EBW ไปยังหน้าจอโฮมผ่าน Safari แล้วเปิดรับ Push จากไอคอน EBW</p>
      </> : <>
        <p className="chart-hint">เปิดสิทธิ์ในเครื่องนี้เพื่อให้แจ้งเตือนขึ้นบนเดสก์ท็อประหว่างเปิดหน้า Live</p>
        <button type="button" disabled={pending || notificationPermission === 'granted' || notificationPermission === 'unsupported'}
          onClick={() => void act(enableAlertNotifications, 'เปิดแจ้งเตือนเบราว์เซอร์แล้ว')}>
          <BellRing size={17}/>{notificationPermission === 'granted' ? 'อนุญาตแจ้งเตือนแล้ว' : 'เปิดแจ้งเตือนเบราว์เซอร์'}
        </button>
        <form className="alerts-connect" onSubmit={event => {
          event.preventDefault();
          void act(async () => {await alerts.connect(server, token); setToken('');}, 'เชื่อมบริการแจ้งเตือนแล้ว');
        }}>
          <h3>เชื่อมการแจ้งเตือนข้ามอุปกรณ์</h3>
          <p className="chart-hint">ใช้บริการ EBW Alerts ที่ออนไลน์เพื่อเฝ้าราคาและส่ง Push หลังปิดหน้าเว็บ</p>
          <label className="chart-field">ลิงก์บริการ EBW Alerts<input required type="url" placeholder="https://…"
            value={server} onChange={event => setServer(event.target.value)} autoComplete="off"/></label>
          <label className="chart-field">รหัสเชื่อมอุปกรณ์<input required type="password" value={token}
            onChange={event => setToken(event.target.value)} autoComplete="off"/></label>
          <button type="submit" disabled={pending}><Link2 size={16}/>เชื่อมต่อ</button>
        </form>
      </>}
    </div>}
    {alerts.remoteError && <p className="chart-error" role="alert">{alerts.remoteError}</p>}
    {feedback && <p className={feedback.error ? 'chart-error' : 'chart-feedback'} role={feedback.error ? 'alert' : 'status'}>{feedback.text}</p>}
  </div>;
}
