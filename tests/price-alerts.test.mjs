import {test} from 'node:test';
import assert from 'node:assert/strict';
import {blankAlerts, changeAlerts, checkAlerts} from '../src/lib/price-alerts.ts';

test('Eightcap Bid reaching a price fires a one-time alert only after a live crossing', () => {
  let state = checkAlerts(blankAlerts(), 2350, 100).state;
  state = changeAlerts(state, {op:'add', level:2360, direction:'up', repeat:false, label:'Breakout'}, 100000, 'test-rule');
  assert.equal(checkAlerts(state, 2361, 99).fired.length, 0);
  const hit = checkAlerts(state, 2360, 101);
  assert.equal(hit.fired.length, 1);
  assert.deepEqual(hit.fired[0], {id:'test-rule:101:2360', ruleId:'test-rule', label:'Breakout', level:2360, bid:2360, time:101});
  assert.equal(hit.state.rules[0].status, 'fired');
  assert.equal(checkAlerts(hit.state, 2370, 102).fired.length, 0);
});

test('repeating alerts re-arm on the other side and pause/resume resets the baseline', () => {
  let state = checkAlerts(blankAlerts(), 2365, 100).state;
  state = changeAlerts(state, {op:'add', level:2360, direction:'down', repeat:true}, 100000, 'a');
  const first = checkAlerts(state, 2359, 101);
  assert.equal(first.fired.length, 1);
  assert.equal(checkAlerts(first.state, 2358, 102).fired.length, 0);
  state = changeAlerts(first.state, {op:'pause', id:'a'}, 103000);
  state = checkAlerts(state, 2362, 103).state;
  state = changeAlerts(state, {op:'resume', id:'a'}, 103000);
  assert.equal(checkAlerts(state, 2360, 104).fired.length, 1);
  assert.equal(checkAlerts(state, 2361, 104).fired.length, 0);
});

test('a rule created after a stale quote starts with the next fresh price as a baseline', () => {
  const state = changeAlerts(checkAlerts(blankAlerts(), 2350, 100).state,
    {op:'add', level:2360, direction:'cross', repeat:false}, 220000, 'b');
  const first = checkAlerts(state, 2370, 221);
  assert.equal(first.fired.length, 0);
  assert.equal(checkAlerts(first.state, 2359, 222).fired.length, 1);
  assert.throws(() => changeAlerts(state, {op:'add', level:-1, direction:'up', repeat:false}, 220000));
});
