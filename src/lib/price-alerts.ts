export type AlertDirection = 'cross' | 'up' | 'down';
type Anchor = {time:number;price:number};
export type AlertDrawing =
  | {kind:'line';from:Anchor;to:Anchor;extendLeft:boolean;extendRight:boolean}
  | {kind:'zone';from:Anchor;to:Anchor;condition:'enter'|'exit';extendLeft?:boolean;extendRight?:boolean};
export type AlertRule = {
  drawing?:AlertDrawing;
  id: string;
  level: number;
  label: string;
  direction: AlertDirection;
  repeat: boolean;
  status: 'armed' | 'paused' | 'fired';
  baseline: number | null;
  firedAt?: number;
};
export type AlertEvent = {id: string; ruleId: string; label: string; level: number; bid: number; time: number};
export type AlertState = {rules: AlertRule[]; events: AlertEvent[]; last: {bid: number; time: number} | null};
export type AlertCommand =
  | {op: 'add'; level: number; label?: string; direction: AlertDirection; repeat: boolean}
  | {op:'add-drawing';level:number;label?:string;direction:AlertDirection;repeat:boolean;drawing:AlertDrawing}
  | {op: 'pause' | 'resume' | 'delete'; id: string};

export const alertLimit = 30;
const validPrice = (price: unknown): price is number =>
  typeof price === 'number' && Number.isFinite(price) && price >= .01 && price <= 1_000_000;
const validDirection = (direction: unknown): direction is AlertDirection =>
  direction === 'cross' || direction === 'up' || direction === 'down';

export function blankAlerts(): AlertState {
  return {rules: [], events: [], last: null};
}

export function changeAlerts(state: AlertState, command: AlertCommand, now: number, id = crypto.randomUUID()): AlertState {
  const baseline = state.last && Math.abs(now / 1000 - state.last.time) <= 30 ? state.last.bid : null;
  if (command.op === 'add' || command.op === 'add-drawing') {
    if (command.op === 'add-drawing' && !validDrawing(command.drawing)) throw Error('ตรวจจุดยึดของวัตถุแจ้งเตือน');
    if (!validPrice(command.level) || !validDirection(command.direction) || typeof command.repeat !== 'boolean' ||
        (command.label !== undefined && (typeof command.label !== 'string' || command.label.length > 64))) {
      throw Error('ตรวจสอบราคา เงื่อนไข และชื่อแจ้งเตือน');
    }
    if (state.rules.length >= alertLimit) throw Error('ตั้งได้สูงสุด 30 รายการ ลบรายการเก่าก่อนเพิ่ม');
    const rule: AlertRule = {
      id, level: command.level, label: command.label?.trim() ?? '',
      direction: command.direction, repeat: command.repeat, ...(command.op === 'add-drawing' ? {drawing:command.drawing} : {}), status: 'armed', baseline,
    };
    return {...state, rules: [rule, ...state.rules]};
  }
  if (!['pause', 'resume', 'delete'].includes(command.op) || !state.rules.some(rule => rule.id === command.id)) {
    throw Error('ไม่พบรายการแจ้งเตือนนี้');
  }
  if (command.op === 'delete') return {...state, rules: state.rules.filter(rule => rule.id !== command.id)};
  const rules = state.rules.map((rule): AlertRule => {
    if (rule.id !== command.id) return rule;
    if (command.op === 'pause' && rule.status === 'armed') return {...rule, status: 'paused', baseline: null};
    if (command.op === 'resume' && rule.status !== 'armed') return {...rule, status: 'armed', baseline, firedAt: undefined};
    return rule;
  });
  return {...state, rules};
}

function validDrawing(drawing: AlertDrawing | undefined) {
  if (!drawing || (drawing.kind !== 'line' && drawing.kind !== 'zone')) return false;
  const validAnchor=(anchor: Anchor|undefined)=>Boolean(anchor && Number.isSafeInteger(anchor.time) && anchor.time>0 && validPrice(anchor.price));
  return validAnchor(drawing.from) && validAnchor(drawing.to) && drawing.from.time<drawing.to.time &&
    (drawing.kind === 'line' || drawing.condition === 'enter' || drawing.condition === 'exit') &&
    [drawing.extendLeft,drawing.extendRight].every(value=>value===undefined || typeof value==='boolean');
}

function withinDrawing(drawing: AlertDrawing,time:number) {
  return (drawing.extendLeft || time>=drawing.from.time) && (drawing.extendRight || time<=drawing.to.time);
}
function linePrice(drawing: AlertDrawing,time:number) {
  const {from,to}=drawing;
  return from.price+(to.price-from.price)*(time-from.time)/(to.time-from.time);
}

export function checkAlerts(state: AlertState, bid: number, time: number): {state: AlertState; fired: AlertEvent[]} {
  if (!validPrice(bid) || !Number.isSafeInteger(time) || time <= 0 ||
      (state.last && (time < state.last.time || time === state.last.time && bid === state.last.bid))) {
    return {state, fired: []};
  }

  const fired: AlertEvent[] = [];
  const rules = state.rules.map((rule): AlertRule => {
    if (rule.status !== 'armed') return rule;
    const from = rule.baseline;
    const drawing=rule.drawing;
    const lastTime=state.last?.time ?? time;
    const level=drawing?.kind==='line'?linePrice(drawing,time):rule.level;
    const previous=drawing?.kind==='line'?linePrice(drawing,lastTime):rule.level;
    const up=from!==null && from<previous && bid>=level && rule.direction!=='down';
    const down=from!==null && from>previous && bid<=level && rule.direction!=='up';
    let triggered=up||down;
    if (drawing?.kind==='zone') {
      const inside=(price:number,at:number)=>withinDrawing(drawing,at) &&
        price>=Math.min(drawing.from.price,drawing.to.price) && price<=Math.max(drawing.from.price,drawing.to.price);
      const wasInside=from!==null && inside(from,lastTime);
      triggered=from!==null && withinDrawing(drawing,time) && (drawing.condition==='enter'
        ? !wasInside && inside(bid,time) : wasInside && !inside(bid,time));
    } else if (drawing) {
      triggered=triggered && Boolean(withinDrawing(drawing,lastTime) && withinDrawing(drawing,time));
    }
    if (!triggered) return from===bid ? rule : {...rule,baseline:bid};
    fired.push({id: rule.id + ':' + time + ':' + bid, ruleId: rule.id, label: rule.label, level, bid, time});
    return {...rule, baseline: bid, status: rule.repeat ? 'armed' : 'fired', firedAt: time};
  });
  return {state: {rules, events: fired.length ? [...fired, ...state.events].slice(0, 40) : state.events, last: {bid, time}}, fired};
}

export function isFreshAlertQuote(quote: {status: string; time: number} | null | undefined, now = Date.now()) {
  return !!quote && quote.status === 'live' && Math.abs(now / 1000 - quote.time) <= 30;
}
