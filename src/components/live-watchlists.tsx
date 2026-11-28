import {useEffect, useState} from 'react';
import {Plus, Pencil, Trash2, Search, ArrowLeft, ChevronRight, ChevronUp, ChevronDown, ListFilter, Layers3} from 'lucide-react';
import {forexSymbols, marketInfoFor, type SpotMarket} from '../lib/market-symbol';
import {createWatchlist, deleteWatchlist, loadWatchlists, moveWatchlistSymbol, renameWatchlist, toggleWatchlistSymbol, watchlistStorageKey} from '../lib/watchlists';

type Props = {symbol: string; markets: SpotMarket[]; catalogState: string; catalogError: string; retry: () => void; onSelect: (symbol: string) => void};

function SymbolIdentity({symbol, detail}: {symbol: string; detail: string}) {
  const info = marketInfoFor(symbol);
  const tone = symbol === 'XAUUSD' ? 'gold' : info.description === 'Forex' ? 'forex' : 'crypto';
  return <span className="watchlists-identity"><span className="watchlists-symbol-mark" data-tone={tone} aria-hidden="true">{info.baseAsset.slice(0, 3)}</span><span className="watchlists-symbol-text"><strong>{info.label}</strong><small>{detail}</small></span></span>;
}

export default function LiveWatchlists({symbol, markets, catalogState, catalogError, retry, onSelect}: Props) {
  const [state, setState] = useState(() => { try { return loadWatchlists(localStorage.getItem(watchlistStorageKey)); } catch { return loadWatchlists(null); } });
  const [storageError, setStorageError] = useState(false);
  const [adding, setAdding] = useState(false);
  const [view, setView] = useState<'markets' | 'lists'>('markets');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<'new' | 'rename' | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [category, setCategory] = useState<'all' | 'forex' | 'crypto'>('all');
  const active = state.lists.find(list => list.id === state.activeId) ?? state.lists[0];
  useEffect(() => { try { localStorage.setItem(watchlistStorageKey, JSON.stringify(state)); setStorageError(false); } catch { setStorageError(true); } }, [state]);
  useEffect(() => {
    const onStorage = (event: StorageEvent) => { if (event.key === watchlistStorageKey && event.newValue) setState(loadWatchlists(event.newValue)); };
    window.addEventListener('storage', onStorage); return () => window.removeEventListener('storage', onStorage);
  }, []);
  const saveName = () => {
    try {
      setState(editing === 'new' ? createWatchlist(state, name, crypto.randomUUID()) : renameWatchlist(state, active.id, name));
      setEditing(null); setError('');
    } catch (e) { setError(e instanceof Error ? e.message : 'ไม่สามารถบันทึกได้'); }
  };
  const items = [{symbol: 'XAUUSD', group: 'forex', detail: 'Gold · Eightcap'},
    ...forexSymbols.map(item => ({symbol: item, group: 'forex', detail: 'Forex · Eightcap'})),
    ...markets.map(item => ({symbol: item.symbol, group: 'crypto', detail: 'Crypto · Binance TH'}))];
  const needle = query.trim().toUpperCase().replaceAll('/', '');
  const filtered = items.filter(item => (category === 'all' || item.group === category) && (!needle || item.symbol.includes(needle) || marketInfoFor(item.symbol).label.replaceAll('/', '').includes(needle)));
  return <div className="watchlists" data-adding={adding}>
    <div className="watchlists-view-tabs" role="group" aria-label="เลือกหน้ารายการ Symbol">
      <button type="button" aria-pressed={view === 'markets'} onClick={() => {setView('markets'); setAdding(false);}}>ตลาดทั้งหมด</button>
      <button type="button" aria-pressed={view === 'lists'} onClick={() => {setView('lists'); setAdding(false);}}><Layers3 size={16}/> รายการของฉัน</button>
    </div>
    {view === 'markets' ? <>
      <div className="watchlists-section-label">เลือก Symbol <span>MARKETS</span></div>
      <label className="live-market-search"><Search size={16}/><input type="search" placeholder="ค้นหา Symbol เช่น EURUSD หรือ BTC" aria-label="ค้นหา Symbol" value={query} onChange={event => setQuery(event.target.value)}/></label>
      <div className="live-market-filters" role="group" aria-label="ประเภทตลาด"><ListFilter size={16} aria-hidden="true"/>{([['all','ทั้งหมด'],['forex','ทอง / Forex'],['crypto','Crypto']] as const).map(([id,label]) => <button key={id} type="button" aria-pressed={category === id} onClick={() => setCategory(id)}>{label}</button>)}</div>
      {catalogState === 'loading' && <p className="watchlists-message" role="status">กำลังโหลดรายการ Crypto…</p>}{catalogState === 'error' && <p className="watchlists-message">โหลด Crypto ไม่สำเร็จ: {catalogError} <button type="button" onClick={retry}>ลองอีกครั้ง</button></p>}
      <div className="watchlists-rows">{filtered.map(item => <button key={item.symbol} type="button" className="watchlists-row" aria-current={symbol === item.symbol ? 'true' : undefined} onClick={() => onSelect(item.symbol)}><SymbolIdentity symbol={item.symbol} detail={item.detail}/><span className="watchlists-row-end">{symbol === item.symbol && <small className="watchlists-current">กำลังดู</small>}<ChevronRight size={16}/></span></button>)}{!filtered.length && <div className="watchlists-empty"><Search size={20}/><strong>ไม่พบ Symbol ที่ค้นหา</strong><span>ลองใช้ชื่อย่อหรือเลือกประเภทตลาดอื่น</span></div>}</div>
    </> : <>
    <div className="watchlists-intro"><div className="watchlists-intro-icon"><Layers3 size={19}/></div><div><strong>รายการของฉัน</strong><span>จัดกลุ่มตลาดที่ติดตามไว้ในที่เดียว</span></div><span className="watchlists-count">{state.lists.length} ลิสต์</span></div>
    <div className="watchlists-section-label">ลิสต์ที่เลือก <span>WATCHLIST</span></div>
    <div className="watchlists-header">
      <select aria-label="เลือกรายการ Symbol" value={active.id} onChange={event => {setState({...state, activeId: event.target.value}); setEditing(null);}}>{state.lists.map(list => <option key={list.id} value={list.id}>{list.name}</option>)}</select>
      <button type="button" aria-label="สร้างรายการใหม่" title="สร้างรายการใหม่" onClick={() => {setName(''); setError(''); setEditing('new');}}><Plus size={18}/></button>
      <button type="button" aria-label="เปลี่ยนชื่อรายการ" title="เปลี่ยนชื่อรายการ" onClick={() => {setName(active.name); setError(''); setEditing('rename');}}><Pencil size={17}/></button>
      <button type="button" aria-label="ลบรายการ" title="ลบรายการ" onClick={() => {if (window.confirm('ลบรายการ “' + active.name + '” ใช่หรือไม่?')) {setState(deleteWatchlist(state, active.id)); setEditing(null);}}}><Trash2 size={17}/></button>
    </div>
    {editing && <form className="watchlists-name" onSubmit={event => {event.preventDefault(); saveName();}}><input autoFocus maxLength={50} aria-label="ชื่อรายการ" placeholder="ชื่อรายการ" value={name} onChange={event => setName(event.target.value)}/><button type="submit">บันทึก</button><button type="button" onClick={() => setEditing(null)}>ยกเลิก</button>{error && <p role="alert">{error}</p>}</form>}
    {storageError && <p role="alert" className="watchlists-message">ไม่สามารถบันทึกรายการบนอุปกรณ์นี้ได้</p>}
    <div className="watchlists-actions">{adding ? <><button className="watchlists-back" type="button" onClick={() => setAdding(false)}><ArrowLeft size={16}/> กลับไปรายการ</button><span>เลือกได้หลาย Symbol</span></> : <><span className="watchlists-list-label">Symbol ในลิสต์ <b>{active.symbols.length}</b></span><button className="watchlists-add" type="button" onClick={() => setAdding(true)}><Plus size={16}/> เพิ่ม Symbol</button></>}</div>
    {adding && <><label className="live-market-search"><Search size={16}/><input type="search" placeholder="ค้นหา Symbol เช่น EURUSD หรือ BTC" aria-label="ค้นหา Symbol" value={query} onChange={event => setQuery(event.target.value)}/></label>
      <div className="live-market-filters" role="group" aria-label="ประเภทตลาด"><ListFilter size={16} aria-hidden="true"/>{([['all','ทั้งหมด'],['forex','ทอง / Forex'],['crypto','Crypto']] as const).map(([id,label]) => <button key={id} type="button" aria-pressed={category === id} onClick={() => setCategory(id)}>{label}</button>)}</div>
      {catalogState === 'loading' && <p className="watchlists-message" role="status">กำลังโหลดรายการ Crypto…</p>}{catalogState === 'error' && <p className="watchlists-message">โหลด Crypto ไม่สำเร็จ: {catalogError} <button type="button" onClick={retry}>ลองอีกครั้ง</button></p>}</>}
    <div className="watchlists-rows">
      {adding ? filtered.map(item => <label key={item.symbol} className="watchlists-row"><SymbolIdentity symbol={item.symbol} detail={item.detail}/><input type="checkbox" aria-label={'เพิ่มหรือนำ ' + marketInfoFor(item.symbol).label + ' ออกจากรายการ'} checked={active.symbols.includes(item.symbol)} onChange={() => setState(toggleWatchlistSymbol(state, active.id, item.symbol))}/></label>) : active.symbols.map((item, index) => {const info = marketInfoFor(item); return <div className="watchlists-saved-row" key={item}><button type="button" className="watchlists-row" aria-current={symbol === item ? 'true' : undefined} onClick={() => onSelect(item)}><SymbolIdentity symbol={item} detail={info.source + ' · ' + info.description}/><span className="watchlists-row-end">{symbol === item && <small className="watchlists-current">กำลังดู</small>}<ChevronRight size={16}/></span></button><div className="watchlists-reorder"><button type="button" aria-label={'เลื่อน ' + info.label + ' ขึ้น'} disabled={index === 0} onClick={() => setState(current => moveWatchlistSymbol(current, active.id, item, -1))}><ChevronUp size={17}/></button><button type="button" aria-label={'เลื่อน ' + info.label + ' ลง'} disabled={index === active.symbols.length - 1} onClick={() => setState(current => moveWatchlistSymbol(current, active.id, item, 1))}><ChevronDown size={17}/></button></div></div>;})}
      {!(adding ? filtered.length : active.symbols.length) && <div className="watchlists-empty"><Search size={20}/><strong>{adding ? 'ไม่พบ Symbol ที่ค้นหา' : 'ลิสต์นี้ยังว่างอยู่'}</strong><span>{adding ? 'ลองใช้ชื่อย่อหรือเลือกประเภทตลาดอื่น' : 'กดเพิ่ม Symbol เพื่อเลือกตลาดที่ต้องการติดตาม'}</span></div>}
    </div>
    </>}
  </div>;
}
