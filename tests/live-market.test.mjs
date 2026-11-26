import {test} from 'node:test';
import assert from 'node:assert/strict';
import {liveTailUpdate, mergeClosedBars, readBars, readQuote, sampleOpenBar} from '../src/lib/live-market.ts';
import {livePlots, studyLabel} from '../src/lib/live-indicators.ts';

const now = 1795620180;
const minute = now - 60;
const candle = {time: minute, open: 4000, high: 4010, low: 3990, close: 4005, tick_volume: 20, spread: 14};
const quote = {
  symbol: 'XAUUSD', source_id: 'Eightcap-MT5-Live', price_basis: 'Bid',
  timestamp: now, bid: 4015, ask: 4015.14, quote_usable: true,
  market_status: 'open', connection_status: 'connected', feed_status: 'fresh',
};

test('broker candles are chronological and only settled candles are accepted', () => {
  const rows = readBars([
    {...candle, time: now},
    candle,
    {...candle, time: minute - 60},
  ], 60, now);
  assert.deepEqual(rows.map(row => row.time), [minute - 60, minute]);
  assert.throws(() => readBars([{...candle, high: 3990}], 60, now));
});

test('the open candle uses observed Bid and never fills a gap with fabricated bars', () => {
  const [closed] = readBars([candle], 60, now);
  const first = sampleOpenBar(closed, null, readQuote(quote, now - 60), 60);
  assert.equal(first, null);
  const partial = sampleOpenBar(closed, null, readQuote(quote, now), 60);
  assert.deepEqual(partial, {time: now, open: 4015, high: 4015, low: 4015, close: 4015, volume: 0});
  const lower = readQuote({...quote, timestamp: now + 1, bid: 4014}, now + 1);
  assert.equal(sampleOpenBar(closed, partial, lower, 60).low, 4014);
  const afterGap = readQuote({...quote, timestamp: now + 120}, now + 120);
  assert.deepEqual(sampleOpenBar(closed, partial, afterGap, 60), {
    time: now + 120, open: 4015, high: 4015, low: 4015, close: 4015, volume: 0,
  });
});

test('a live H4 candle starts at the broker boundary when last closed prices arrive late', () => {
  const time = Date.parse('2026-11-26T04:15:02Z') / 1000;
  const expected = Date.parse('2026-11-26T02:00:00Z') / 1000;
  const stale = {...candle, time: Date.parse('2026-11-25T18:00:00Z') / 1000, volume: 20};
  const live = readQuote({...quote, timestamp: time}, time);
  assert.equal(sampleOpenBar(stale, null, live, 14400).time, expected);
});

test('closed or stale quotes remain visible as status and cannot update the chart', () => {
  assert.equal(readQuote({...quote, market_status: 'closed', quote_usable: false}, now).status, 'closed');
  assert.equal(readQuote(quote, now + 121).status, 'stale');
  assert.throws(() => readQuote({...quote, ask: 3999}, now));
});

test('rolling broker requests preserve earlier candles until the workspace hits capacity', () => {
  const [last] = readBars([candle], 60, now);
  const first = {...last, time: minute - 120};
  const second = {...last, time: minute - 60};
  const newest = {...last, time: now};
  const before = [first, second, last];
  assert.equal(mergeClosedBars(before, [{...last}]), before);
  assert.deepEqual(mergeClosedBars(before, [last, newest]), [first, second, last, newest]);
  assert.deepEqual(mergeClosedBars(before, [last, newest], 3), [second, last, newest]);
});

test('live quote updates may edit the latest candle, while broker revisions refresh history', () => {
  const [last] = readBars([candle], 60, now);
  const first = {...last, time: minute - 60};
  const previous = [first, last];
  assert.ok(liveTailUpdate(previous, [first, {...last, close: 4006}]));
  assert.ok(liveTailUpdate(previous, [first, last, {...last, time: now}]));
  assert.ok(!liveTailUpdate(previous, [{...first, high: 4015}, last]));
  assert.ok(!liveTailUpdate(previous, [last, {...last, time: now}]));
  assert.ok(!liveTailUpdate(previous, [first]));
});

test('adjusted moving averages, Bollinger Bands and Wilder RSI use the configured period', () => {
  const bars = [1, 2, 3, 4].map((close, i) => ({time: now + i * 60, open: close, high: close, low: close, close, volume: 1}));
  const studies = livePlots(bars, ['sma', 'bollinger', 'rsi14'], {sma: 2, bollinger: 2, rsi14: 2});
  const values = name => studies.find(series => series.name === name).data.map(point => point.value);
  assert.deepEqual(values('SMA 2'), [null, 1.5, 2.5, 3.5]);
  assert.deepEqual(values('BB Upper'), [null, 2.5, 3.5, 4.5]);
  assert.deepEqual(values('BB Lower'), [null, 0.5, 1.5, 2.5]);
  assert.deepEqual(values('RSI 2'), [null, null, 100, 100]);
  assert.equal(studyLabel('ema20', {ema20: -1}), 'EMA 20');
});
