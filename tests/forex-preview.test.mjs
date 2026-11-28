import {test} from 'node:test';
import assert from 'node:assert/strict';
import {forexHistoryPage, forexSnapshot} from '../src/lib/forex-feed.ts';
import {readHistoryPages} from '../src/lib/live-market.ts';
import {isCryptoSymbol, isForexSymbol, marketInfoFor} from '../src/lib/market-symbol.ts';

test('Forex pairs use their own market metadata and the adapter rejects cross-symbol responses', async () => {
  assert.equal(isForexSymbol('EURUSD'), true);
  assert.equal(isCryptoSymbol('EURUSD'), false);
  assert.equal(isCryptoSymbol('BTCUSDT'), true);
  assert.equal(isForexSymbol('XAUUSD'), false);
  assert.equal(marketInfoFor('EURUSD').pricePrecision, 5);
  assert.equal(marketInfoFor('GBPJPY').pricePrecision, 3);
  const original = globalThis.fetch;
  const signal = new AbortController().signal;
  try {
    globalThis.fetch = async () => ({ok: true, json: async () => ({symbol: 'AUDUSD', timeframes: {}})});
    await assert.rejects(forexSnapshot('EURUSD', '1m', signal), /ผิดคู่/);
    const frame = [
      {time: 120, open: 1.2, high: 1.3, low: 1.1, close: 1.25, tick_volume: 10},
      {time: 60, open: 1.1, high: 1.2, low: 1.0, close: 1.15, tick_volume: 8},
    ];
    globalThis.fetch = async () => ({ok: true, json: async () => ({symbol: 'EURUSD',
      timeframes: Object.fromEntries(['1m','5m','15m','1h','4h','1d'].map(tf => [tf, frame]))})});
    const bars = await forexSnapshot('EURUSD', '1m', signal);
    assert.deepEqual(bars.map(bar => bar.time), [60, 120]);
    assert.equal(bars[0].close, 1.15);
    await assert.rejects(forexSnapshot('XAUUSD', '1m', signal), /ไม่ถูกต้อง/);
  } finally { globalThis.fetch = original; }
});

test('Forex history follows exclusive raw cursors and stops at the stored-history boundary', async () => {
  const oldFetch = globalThis.fetch;
  const requested = [];
  const signal = new AbortController().signal;
  const bar = time => ({time, open: 209, high: 210, low: 208, close: 209.5, tick_volume: 10});
  try {
    globalThis.fetch = async url => {
      const query = new URL(url).searchParams;
      const before = Number(query.get('before'));
      requested.push({symbol: query.get('symbol'), tf: query.get('timeframe'), before});
      const bars = before === 300 ? [bar(180), bar(240)] : [bar(60), bar(120)];
      return {ok: true, json: async () => ({symbol:'GBPJPY', timeframe:'1h', bars, has_more: before === 300})};
    };
    const result = await readHistoryPages(300, Infinity, signal,
      before => forexHistoryPage('GBPJPY', '1h', before, signal, 1000));
    assert.deepEqual(result.bars.map(b => b.time), [60, 120, 180, 240]);
    assert.equal(result.ended, true);
    assert.deepEqual(requested, [{symbol:'GBPJPY',tf:'1h',before:300},{symbol:'GBPJPY',tf:'1h',before:180}]);
    globalThis.fetch = async () => ({ok:true,json:async()=>({symbol:'EURUSD',timeframe:'1h',bars:[bar(60)],has_more:false})});
    await assert.rejects(forexHistoryPage('GBPJPY', '1h', 300, signal), /ผิดคู่/);
    globalThis.fetch = async () => ({ok:true,json:async()=>({symbol:'GBPJPY',timeframe:'1h',bars:[bar(300)],has_more:false})});
    await assert.rejects(forexHistoryPage('GBPJPY', '1h', 300, signal), /ช่วงย้อนหลัง/);
  } finally { globalThis.fetch = oldFetch; }
});

test('Forex history retries a temporary rate limit without changing the requested cursor', async () => {
  const oldFetch = globalThis.fetch;
  const urls = [];
  try {
    globalThis.fetch = async url => {
      urls.push(String(url));
      if (urls.length === 1) return {ok:false, status:429, headers:new Headers({'Retry-After':'0'})};
      return {ok:true,json:async()=>({symbol:'GBPJPY',timeframe:'1h',has_more:false,
        bars:[{time:60,open:209,high:210,low:208,close:209.5,tick_volume:10}]})};
    };
    const result = await forexHistoryPage('GBPJPY', '1h', 300, new AbortController().signal);
    assert.equal(result.bars.length, 1);
    assert.equal(urls.length, 2);
    assert.equal(urls[0], urls[1]);
  } finally { globalThis.fetch = oldFetch; }
});
