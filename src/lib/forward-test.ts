import type {Drawing, Side} from './engine.ts';
import type {Quote} from './live-market.ts';

export type ForwardPlan = {side: Side; entry: number; tp: number; sl: number};
type Observation = {time: number; price: number};
type Approach = 'above' | 'below' | 'at';
export type ForwardTest = {
  plan: ForwardPlan;
  approach: Approach | null;
  after: number | null;
  entry: Observation | null;
  exit: (Observation & {kind: 'tp' | 'sl'}) | null;
};

export const forwardQuoteMaxAge = 30;

export function isForwardPosition(drawing: Pick<Drawing, 'kind'>): boolean {
  return drawing.kind === 'long' || drawing.kind === 'short';
}

export function forwardPlan(drawing: Pick<Drawing, 'kind' | 'points'>): ForwardPlan | null {
  const {kind, points} = drawing;
  if ((kind !== 'long' && kind !== 'short') || points.length !== 3) return null;
  const [entry, tp, sl] = points.map(point => point.price);
  if (![entry, tp, sl].every(price => Number.isFinite(price) && price > 0)) return null;
  const valid = kind === 'long' ? sl < entry && entry < tp : tp < entry && entry < sl;
  return valid ? {side: kind, entry, tp, sl} : null;
}

export function matchesForwardPlan(run: ForwardTest, plan: ForwardPlan | null) {
  return !!plan && run.plan.side === plan.side && run.plan.entry === plan.entry &&
    run.plan.tp === plan.tp && run.plan.sl === plan.sl;
}

export function isFreshForwardQuote(quote: Quote | null | undefined): quote is Quote {
  return !!quote && quote.status === 'live' && quote.serverTime - quote.time >= -2 &&
    quote.serverTime - quote.time <= forwardQuoteMaxAge;
}

function entryQuote(plan: ForwardPlan, quote: Quote) {
  return plan.side === 'long' ? quote.ask : quote.bid;
}

function sideOfEntry(price: number, entry: number): Approach {
  return price === entry ? 'at' : price > entry ? 'above' : 'below';
}

export function startForwardTest(plan: ForwardPlan, quote: Quote | null): ForwardTest {
  const live = isFreshForwardQuote(quote);
  return {
    plan,
    approach: live ? sideOfEntry(entryQuote(plan, quote), plan.entry) : null,
    after: live ? quote.time : null,
    entry: null,
    exit: null,
  };
}

export function updateForwardTest(run: ForwardTest, quote: Quote, rebaseline = false): ForwardTest {
  if (!isFreshForwardQuote(quote) || run.exit || (run.after !== null && quote.time <= run.after)) return run;
  const {plan} = run;
  if (!run.entry) {
    const price = entryQuote(plan, quote);
    const side = sideOfEntry(price, plan.entry);
    const crossed = !rebaseline && run.approach !== null && run.approach !== 'at' && side !== run.approach;
    if (side === 'at' || crossed) return {...run, after: quote.time, entry: {time: quote.time, price}};
    if (side !== run.approach) return {...run, approach: side, after: quote.time};
    return run;
  }

  // The spread matters: a simulated long exits on Bid and a short exits on Ask.
  const price = plan.side === 'long' ? quote.bid : quote.ask;
  const target = plan.side === 'long' ? price >= plan.tp : price <= plan.tp;
  const stop = plan.side === 'long' ? price <= plan.sl : price >= plan.sl;
  if (!target && !stop) return run;
  return {...run, after: quote.time, exit: {time: quote.time, price, kind: target ? 'tp' : 'sl'}};
}

export function forwardStatus(drawing: Drawing) {
  const run = drawing.forwardTest;
  if (!run) return 'idle';
  if (!matchesForwardPlan(run, forwardPlan(drawing))) return 'changed';
  return run.exit?.kind ?? (run.entry ? 'open' : 'waiting');
}

export const forwardStatusLabel = {
  idle: 'ยังไม่ติดตาม', changed: 'ระดับเปลี่ยน', waiting: 'รอ Entry', open: 'ชน Entry แล้ว', tp: 'ถึง TP', sl: 'ถึง SL',
};
