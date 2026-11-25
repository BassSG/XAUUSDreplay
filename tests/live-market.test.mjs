import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readBars, readQuote, sampleOpenBar} from '../src/lib/live-market.ts';

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
  assert.equal(sampleOpenBar(closed, partial, afterGap, 60), null);
});

test('closed or stale quotes remain visible as status and cannot update the chart', () => {
  assert.equal(readQuote({...quote, market_status: 'closed', quote_usable: false}, now).status, 'closed');
  assert.equal(readQuote(quote, now + 121).status, 'stale');
  assert.throws(() => readQuote({...quote, ask: 3999}, now));
});
