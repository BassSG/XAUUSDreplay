import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWatchlist, deleteWatchlist, loadWatchlists, renameWatchlist, toggleWatchlistSymbol, moveWatchlistSymbol} from '../src/lib/watchlists.ts';

test('watchlists keep symbols independent and survive a save and reload', () => {
  let state = loadWatchlists(null);
  const first = state.activeId;
  state = createWatchlist(state, 'Forex', 'forex');
  state = toggleWatchlistSymbol(state, 'forex', 'EURUSD');
  state = toggleWatchlistSymbol(state, 'forex', 'GBPJPY');
  state = toggleWatchlistSymbol(state, 'forex', 'EURUSD');
  state = renameWatchlist(state, 'forex', 'คู่เงิน');
  const saved = loadWatchlists(JSON.stringify(state));
  assert.equal(saved.activeId, 'forex');
  assert.deepEqual(saved.lists.find(list => list.id === 'forex').symbols, ['GBPJPY']);
  assert.ok(saved.lists.find(list => list.id === first));
  assert.equal(saved.lists.find(list => list.id === first).symbols.includes('GBPJPY'), false);
  const removed = deleteWatchlist(saved, 'forex');
  assert.equal(removed.activeId, first);
  assert.equal(removed.lists.some(list => list.id === 'forex'), false);
});

test('reordering is limited to the selected list and persists across reloads', () => {
  let state = createWatchlist(loadWatchlists(null), 'Forex', 'forex');
  state = toggleWatchlistSymbol(state, 'forex', 'EURUSD');
  state = toggleWatchlistSymbol(state, 'forex', 'GBPJPY');
  state = toggleWatchlistSymbol(state, 'forex', 'AUDUSD');
  state = moveWatchlistSymbol(state, 'forex', 'AUDUSD', -1);
  state = moveWatchlistSymbol(state, 'forex', 'EURUSD', 1);
  state = moveWatchlistSymbol(state, 'forex', 'GBPJPY', 1);
  const saved = loadWatchlists(JSON.stringify(state));
  assert.deepEqual(saved.lists.find(list => list.id === 'forex').symbols, ['AUDUSD', 'EURUSD', 'GBPJPY']);
  assert.deepEqual(saved.lists.find(list => list.id === 'default').symbols, ['XAUUSD', 'BTCUSDT']);
});

test('invalid or duplicate list names and invalid symbols do not corrupt saved lists', () => {
  const state = loadWatchlists(null);
  assert.throws(() => createWatchlist(state, ' ', 'a'));
  assert.throws(() => createWatchlist(state, state.lists[0].name, 'a'));
  assert.throws(() => toggleWatchlistSymbol(state, state.activeId, '../not-a-symbol'));
  const recovered = loadWatchlists('{broken');
  assert.ok(recovered.lists.length);
});
