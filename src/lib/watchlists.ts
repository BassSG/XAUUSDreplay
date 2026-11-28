import {isMarketSymbol} from './market-symbol.ts';

export type Watchlist = {id: string; name: string; symbols: string[]};
export type WatchlistState = {activeId: string; lists: Watchlist[]};
export const watchlistStorageKey = 'ebw-watchlists-v1';
const defaults = (): WatchlistState => ({activeId: 'default', lists: [{id: 'default', name: 'รายการโปรด', symbols: ['XAUUSD', 'BTCUSDT']}]});

export function loadWatchlists(raw: string | null): WatchlistState {
  try {
    const value = raw ? JSON.parse(raw) : null;
    if (!value || !Array.isArray(value.lists)) return defaults();
    const ids = new Set<string>();
    const lists: Watchlist[] = [];
    for (const item of value.lists.slice(0, 50)) {
      if (!item || typeof item.id !== 'string' || !item.id || ids.has(item.id) || typeof item.name !== 'string' || !item.name.trim() || !Array.isArray(item.symbols)) continue;
      ids.add(item.id);
      lists.push({id: item.id, name: item.name.trim().slice(0, 50), symbols: [...new Set<string>(item.symbols.filter((s: unknown): s is string => typeof s === 'string' && isMarketSymbol(s)))].slice(0, 1000)});
    }
    return lists.length ? {lists, activeId: ids.has(value.activeId) ? value.activeId : lists[0].id} : defaults();
  } catch { return defaults(); }
}
function validName(state: WatchlistState, name: string, except?: string) {
  const result = name.trim();
  if (!result || result.length > 50 || state.lists.some(list => list.id !== except && list.name.toLocaleLowerCase() === result.toLocaleLowerCase())) throw new Error('กรุณาใส่ชื่อรายการที่ไม่ซ้ำกัน (ไม่เกิน 50 ตัวอักษร)');
  return result;
}
export function createWatchlist(state: WatchlistState, name: string, id: string): WatchlistState {
  if (!id || state.lists.some(list => list.id === id) || state.lists.length >= 50) throw new Error('ไม่สามารถสร้างรายการเพิ่มได้');
  return {activeId: id, lists: [...state.lists, {id, name: validName(state, name), symbols: []}]};
}
export function renameWatchlist(state: WatchlistState, id: string, name: string): WatchlistState {
  const nextName = validName(state, name, id);
  return {...state, lists: state.lists.map(list => list.id === id ? {...list, name: nextName} : list)};
}
export function deleteWatchlist(state: WatchlistState, id: string): WatchlistState {
  const lists = state.lists.filter(list => list.id !== id);
  if (!lists.length) return defaults();
  return {lists, activeId: state.activeId === id ? lists[0].id : state.activeId};
}
export function toggleWatchlistSymbol(state: WatchlistState, id: string, symbol: string): WatchlistState {
  if (!isMarketSymbol(symbol)) throw new Error('Symbol ไม่ถูกต้อง');
  return {...state, lists: state.lists.map(list => list.id !== id ? list : {...list, symbols: list.symbols.includes(symbol) ? list.symbols.filter(item => item !== symbol) : [...list.symbols, symbol]})};
}
export function moveWatchlistSymbol(state: WatchlistState, id: string, symbol: string, direction: -1 | 1): WatchlistState {
  return {...state, lists: state.lists.map(list => {
    if (list.id !== id) return list;
    const index = list.symbols.indexOf(symbol), target = index + direction;
    if (index < 0 || target < 0 || target >= list.symbols.length) return list;
    const symbols = [...list.symbols];
    [symbols[index], symbols[target]] = [symbols[target], symbols[index]];
    return {...list, symbols};
  })};
}
