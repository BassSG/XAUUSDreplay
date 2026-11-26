import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  barsQuery, candleWindow, candlesFromMinutes, candlesWithBid, recordBidMinute, liveTailUpdate, mergeClosedBars, olderBarsEnd, prependOlderBars, readBars, readHistoryPages, readOlderBars, readQuote,
} from '../src/lib/live-market.ts';
import {livePlots, studyLabel} from '../src/lib/live-indicators.ts';

const now = 1795620180;
const minute = now - 60;
const candle = {time: minute, open: 4000, high: 4010, low: 3990, close: 4005, tick_volume: 20, spread: 14};
test('history can cross short source pages and stops at the first empty page', async () => {
  const seen = [];
  const result = await readHistoryPages(now, Infinity, new AbortController().signal, async before => {
    seen.push(before);
    return before === now ? [{...candle, time: minute}] : before === minute
      ? [{...candle, time: minute - 60}] : [];
  });
  assert.deepEqual(seen, [now, minute, minute - 60]);
  assert.deepEqual(result.bars.map(bar => bar.time), [minute - 60, minute]);
  assert.equal(result.ended, true);
  assert.equal(result.failed, false);
});

test('stopping a history load keeps finished pages without marking the source exhausted', async () => {
  const controller = new AbortController();
  const result = await readHistoryPages(now, Infinity, controller.signal, async before => [
    {...candle, time: before - 60},
  ], () => controller.abort());
  assert.deepEqual(result.bars.map(bar => bar.time), [minute]);
  assert.equal(result.ended, false);
  assert.equal(result.failed, false);
});
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

test('entering 1h partway through the hour includes the real open, highs, and lows from earlier minutes', () => {
  const time = Date.parse('2026-11-26T01:00:00Z') / 1000;
  const closed = [{time: time - 3600, open: 3565, high: 3572, low: 3560, close: 3562, volume: 1000}];
  const minutes = [
    {time: time - 60, open: 3561, high: 3564, low: 3558, close: 3562, volume: 135},
    {time, open: 3563, high: 3568, low: 3560, close: 3565, volume: 105},
    {time: time + 60, open: 3565, high: 3580, low: 3563, close: 3575, volume: 179},
    {time: time + 120, open: 3575, high: 3576, low: 3550, close: 3561, volume: 206},
  ];
  assert.deepEqual(candlesFromMinutes(closed, minutes, 3600), [
    ...closed, {time, open: 3563, high: 3580, low: 3550, close: 3561, volume: 490},
  ]);
  assert.equal(candlesFromMinutes(closed, minutes.slice(-2), 3600), closed, 'missing the opening minute cannot establish the open');
  assert.equal(candlesFromMinutes(minutes, minutes, 60), minutes, 'waiting for a minute close leaves the latest real 1m bar intact');
});

test('higher timeframes share Eightcap’s boundaries and promote a bar when native OHLC arrives', () => {
  const at = value => Date.parse(value) / 1000;
  const winter = at('2026-11-26T04:15:02Z');
  const summer = at('2026-08-24T04:15:02Z');
  assert.deepEqual(candleWindow(winter, 14400), {open: at('2026-11-26T02:00:00Z'), close: at('2026-11-26T06:00:00Z')});
  assert.deepEqual(candleWindow(summer, 14400), {open: at('2026-08-24T01:00:00Z'), close: at('2026-08-24T05:00:00Z')});
  assert.equal(candleWindow(winter, 86400).open, at('2026-11-25T22:00:00Z'));
  const native = [{...candle, time: at('2026-11-26T02:00:00Z'), volume: 940}];
  const oneMinute = [{...native[0], time: at('2026-11-26T05:59:00Z'), volume: 20},
    {...native[0], time: at('2026-11-26T06:00:00Z'), volume: 30}];
  assert.deepEqual(candlesFromMinutes(native, oneMinute, 14400), [...native, oneMinute[1]]);
});

test('closed or stale quotes remain visible as status and cannot update the chart', () => {
  assert.equal(readQuote({...quote, market_status: 'closed', quote_usable: false}, now).status, 'closed');
  assert.equal(readQuote(quote, now + 121).status, 'stale');
  assert.equal(readQuote({...quote, tick_age_seconds: 3}, now + 1200).serverTime, now + 3);
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

test('history query ends before the first candle in broker time through summer and winter', () => {
  const utc = date => Date.parse(date) / 1000;
  const summer = olderBarsEnd(utc('2026-08-24T11:00:00Z'));
  const winter = olderBarsEnd(utc('2026-11-25T02:00:00Z'));
  assert.equal(summer, utc('2026-08-24T13:59:59Z'));
  assert.equal(winter, utc('2026-11-25T03:59:59Z'));
  assert.equal(barsQuery(winter).toString(), 'limit=1000&order=desc&end=' + winter);
});

test('history prepends ordered, strictly older bars and preserves verified bars through quote refreshes', () => {
  const latest = readBars([candle], 60, now);
  const page = readOlderBars([
    {...candle, time: minute - 60},
    {...candle, time: minute - 120},
  ], minute, 60, now);
  assert.deepEqual(page.map(bar => bar.time), [minute - 120, minute - 60]);
  const merged = prependOlderBars(latest, page);
  assert.deepEqual(merged, [...page, ...latest]);
  assert.equal(prependOlderBars(merged, page), merged);
  assert.equal(mergeClosedBars(merged, latest, Infinity), merged);
  assert.throws(() => readOlderBars([candle], minute, 60, now), /Bridge/);
  assert.deepEqual(readOlderBars([], minute, 60, now), []);
});

test('the latest candle may update in place, while earlier broker revisions refresh the chart', () => {
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

test('WMA, tick-weighted averages, Donchian Channels and OBV work across moving windows', () => {
  const bars = [[10, 0], [13, 0], [16, 3], [10, 1]].map(([close, volume], i) =>
    ({time: now + i * 60, open: close, high: close + 1, low: close - 1, close, volume}));
  const studies = livePlots(bars, ['wma', 'vwma', 'donchian', 'obv'], {wma: 2, vwma: 2, donchian: 2});
  const values = name => studies.find(series => series.name === name).data.map(point => point.value);
  assert.deepEqual(values('WMA 2'), [null, 12, 15, 12]);
  assert.deepEqual(values('VWMA (Tick Volume) 2'), [null, null, 16, 14.5]);
  assert.deepEqual(values('Donchian High'), [null, 14, 17, 17]);
  assert.deepEqual(values('Donchian Low'), [null, 9, 12, 9]);
  assert.deepEqual(values('OBV (Tick Volume)'), [0, 0, 3, 2]);
});

test('live Bid builds a moving M1 candle before the broker publishes its close', () => {
  const openTime = Date.parse('2026-11-26T10:00:00Z') / 1000;
  const prior = {time:openTime-60, open:4000, high:4002, low:3999, close:4001, volume:24};
  let sampled = [];
  for (const [offset,bid] of [[2,4004],[5,4007],[8,4002],[10,4006]]) {
    sampled = recordBidMinute(sampled, {time:openTime+offset,bid,status:'live'});
  }
  const result = candlesWithBid([prior], prior, prior.time, sampled, 60);
  assert.deepEqual(result, [prior, {time:openTime, open:4004, high:4007, low:4002, close:4006, volume:0}]);
  assert.equal(recordBidMinute(sampled, {time:openTime+12,bid:5000,status:'stale'}), sampled);
  const settled = {time:openTime, open:4003, high:4009, low:4000, close:4005, volume:176};
  sampled = recordBidMinute(sampled, {time:openTime+62,bid:4008,status:'live'});
  assert.deepEqual(candlesWithBid([prior,settled], settled, settled.time, sampled, 60), [prior, settled,
    {time:openTime+60, open:4008, high:4008, low:4008, close:4008, volume:0}]);
});

test('live Bid updates higher timeframes using their authentic open and broker boundaries', () => {
  const openTime = Date.parse('2026-11-26T14:00:00Z') / 1000;
  const seconds = 14400;
  const prior = {time:openTime-seconds, open:3990, high:4017, low:3988, close:4000, volume:17};
  const developing = {time:openTime, open:4001, high:4009, low:3999, close:4003, volume:43};
  let sampled = recordBidMinute([], {time:openTime+61,bid:4014,status:'live'});
  sampled = recordBidMinute(sampled, {time:openTime+62,bid:4002,status:'live'});
  assert.deepEqual(candlesWithBid([prior,developing], prior, openTime, sampled, seconds),
    [prior, {...developing, high:4014, close:4002}]);
  const native = {...developing, close:4008, high:4016, volume:212};
  sampled = recordBidMinute(sampled, {time:openTime+seconds+2,bid:4011,status:'live'});
  assert.deepEqual(candlesWithBid([prior,native], native, openTime+seconds-60, sampled, seconds),
    [prior,native,{time:openTime+seconds,open:4011,high:4011,low:4011,close:4011,volume:0}]);
});
