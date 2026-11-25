import {useEffect, useState} from 'react';
import type {Bar} from './engine';
import {periods, readBars, readQuote, sampleOpenBar, type Period, type Quote} from './live-market';

type Market = {
  period: Period;
  closed: Bar[];
  open: Bar | null;
  quote: Quote | null;
  quoteError: boolean;
  barError: boolean;
};

const empty = (period: Period): Market => ({period, closed: [], open: null, quote: null, quoteError: false, barError: false});
const now = () => Math.floor(Date.now() / 1000);
const pagesOrigin = 'https://basssg.github.io';
const pagesBridge = 'https://anything-mrna-work-voted.trycloudflare.com';

async function request(route: string, signal: AbortSignal) {
  const publicBridge = import.meta.env.VITE_XAU_LIVE_PUBLIC_ORIGIN ||
    (location.origin === pagesOrigin ? pagesBridge : undefined);
  const suffix = route.startsWith('bars/') ? '?limit=1500&order=desc' : '';
  const url = publicBridge
    ? new URL('/api/' + route + suffix, publicBridge).href
    : '/api/xau-live/' + route;
  const response = await fetch(url, {
    cache: 'no-store',
    credentials: 'omit',
    redirect: 'error',
    headers: {Accept: 'application/json'},
    signal: AbortSignal.any([signal, AbortSignal.timeout(6500)]),
  });
  if (!response.ok) throw Error('Bridge ไม่ตอบกลับ');
  return response.json() as Promise<unknown>;
}

export function useLiveMarket(period: Period, retry: number) {
  const [data, setData] = useState(() => empty(period));

  useEffect(() => {
    const controller = new AbortController();
    const {signal} = controller;
    let quoteTimer: ReturnType<typeof setTimeout>;
    let barTimer: ReturnType<typeof setTimeout>;
    setData(current => current.period === period ? current : {...empty(period), quote: current.quote});
    const apply = (change: (state: Market) => Market) => {
      if (!signal.aborted) setData(state => signal.aborted || state.period !== period ? state : change(state));
    };

    async function pollQuote() {
      try {
        const quote = readQuote(await request('quote', signal), now());
        apply(state => {
          if (state.quote && quote.time < state.quote.time) {
            return {...state, quoteError: true, open: null};
          }
          return {...state, quote, quoteError: false,
            open: sampleOpenBar(state.closed.at(-1), state.open, quote, periods[period])};
        });
      } catch {
        apply(state => ({...state, quoteError: true, open: null}));
      } finally {
        if (!signal.aborted) quoteTimer = setTimeout(pollQuote, 2500);
      }
    }

    async function pollBars() {
      try {
        const rows = readBars(await request('bars/' + period, signal), periods[period], now());
        apply(state => {
          if ((rows.at(-1)?.time ?? 0) < (state.closed.at(-1)?.time ?? 0)) {
            return {...state, barError: true};
          }
          const unchanged = state.closed.length === rows.length &&
            rows.every((row, index) => {
              const old = state.closed[index];
              return old.time === row.time && old.open === row.open && old.high === row.high &&
                old.low === row.low && old.close === row.close && old.volume === row.volume && old.spread === row.spread;
            });
          const closed = unchanged ? state.closed : rows;
          const open = state.quote && !state.quoteError
            ? sampleOpenBar(closed.at(-1), state.open, readCurrentQuote(state.quote), periods[period])
            : null;
          return {...state, closed, open, barError: false};
        });
      } catch {
        apply(state => ({...state, barError: true}));
      } finally {
        if (!signal.aborted) barTimer = setTimeout(pollBars, 15000);
      }
    }

    void pollQuote();
    void pollBars();
    return () => {
      controller.abort();
      clearTimeout(quoteTimer);
      clearTimeout(barTimer);
    };
  }, [period, retry]);

  return data.period === period ? data : {...empty(period), quote: data.quote};
}

function readCurrentQuote(quote: Quote): Quote {
  return quote.status === 'live' && now() - quote.time > 120 ? {...quote, status: 'stale'} : quote;
}
