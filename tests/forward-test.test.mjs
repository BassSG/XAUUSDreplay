import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startForwardTest, updateForwardTest, forwardPlan} from '../src/lib/forward-test.ts';

const quote = (bid, ask, time, status = 'live') => ({bid, ask, time, serverTime:time, status});
const drawing = (side, prices) => ({kind:side, points:prices.map((price, i) => ({price, time:1000+i*60}))});

test('Long observes Ask at entry and Bid at target, and preserves its result', () => {
  const plan = forwardPlan(drawing('long', [2350, 2360, 2345]));
  let run = startForwardTest(plan, quote(2352, 2352.2, 100));
  assert.equal(updateForwardTest(run, quote(2349.95, 2350.15, 103)), run);
  run = updateForwardTest(run, quote(2349.8, 2350, 106));
  assert.deepEqual(run.entry, {time:106, price:2350});
  assert.equal(updateForwardTest(run, quote(2359.9, 2360.1, 109)), run);
  run = updateForwardTest(run, quote(2360, 2360.2, 112));
  assert.deepEqual(run.exit, {time:112, price:2360, kind:'tp'});
  assert.equal(updateForwardTest(run, quote(2344, 2344.2, 115)), run);
});

test('Short observes Bid at entry and Ask at both exits', () => {
  const plan = forwardPlan(drawing('short', [2350, 2340, 2355]));
  let run = startForwardTest(plan, quote(2348, 2348.2, 100));
  assert.equal(updateForwardTest(run, quote(2349.9, 2350.1, 103)), run);
  run = updateForwardTest(run, quote(2350, 2350.2, 106));
  assert.deepEqual(run.entry, {time:106, price:2350});
  assert.equal(updateForwardTest(run, quote(2339.9, 2340.1, 109)), run);
  run = updateForwardTest(run, quote(2354.8, 2355, 112));
  assert.deepEqual(run.exit, {time:112, price:2355, kind:'sl'});
});

test('Starting or reconnecting without a new observed crossing does not fill a pending entry', () => {
  const plan = forwardPlan(drawing('long', [2350, 2360, 2345]));
  let run = startForwardTest(plan, quote(2352, 2352.2, 100));
  assert.equal(updateForwardTest(run, quote(2349, 2349.2, 99)), run);
  assert.equal(updateForwardTest(run, quote(2349, 2349.2, 103, 'stale')), run);
  run = updateForwardTest(run, quote(2349, 2349.2, 150), true);
  assert.equal(run.entry, null);
  run = updateForwardTest(run, quote(2350.3, 2350.5, 153));
  assert.deepEqual(run.entry, {time:153, price:2350.5});
  assert.equal(updateForwardTest(run, quote(2360, 2360.2, 153)), run);
  assert.equal(forwardPlan(drawing('short', [2350, 2360, 2340])), null);
});
