export const marketSymbols = ['XAUUSD', 'BTCUSDT'] as const;
export type MarketSymbol = typeof marketSymbols[number];
export const defaultMarketSymbol = 'XAUUSD';

export const marketInfo = {
  XAUUSD: {label: 'XAUUSD', source: 'Eightcap MT5', description: 'Gold CFD', currency: 'USD', calendar: 'eightcap'},
  BTCUSDT: {label: 'BTC/USDT', source: 'Binance TH', description: 'Spot', currency: 'USDT', calendar: 'utc'},
} as const;
