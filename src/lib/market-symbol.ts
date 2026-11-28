export const marketSymbols = ['XAUUSD', 'BTCUSDT'] as const;
export type MarketSymbol = string;
export const defaultMarketSymbol = 'XAUUSD';
export const forexSymbols = ['EURUSD', 'AUDUSD', 'GBPUSD', 'NZDUSD', 'GBPJPY', 'USDCAD'] as const;
export function isForexSymbol(symbol: string): boolean {
  return (forexSymbols as readonly string[]).includes(symbol);
}

export const marketInfo = {
  XAUUSD: {label: 'XAUUSD', source: 'Eightcap MT5', description: 'Gold CFD', currency: 'USD', calendar: 'eightcap',
    baseAsset: 'XAU', quoteAsset: 'USD', tickSize: .01, pricePrecision: 2},
  BTCUSDT: {label: 'BTC/USDT', source: 'Binance TH', description: 'Spot', currency: 'USDT', calendar: 'utc',
    baseAsset: 'BTC', quoteAsset: 'USDT', tickSize: .01, pricePrecision: 2},
} as const;

export type SpotMarket = {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  tickSize: number;
  pricePrecision: number;
  type: string;
};

const spotMetadata = new Map<string, SpotMarket>();

export function isCryptoSymbol(symbol: string): boolean {
  return symbol !== defaultMarketSymbol && !isForexSymbol(symbol) && /^[A-Z0-9]{4,32}$/.test(symbol);
}

export function isMarketSymbol(symbol: string | null): symbol is MarketSymbol {
  return symbol === defaultMarketSymbol || Boolean(symbol && (isForexSymbol(symbol) || isCryptoSymbol(symbol)));
}

export function registerSpotMarkets(markets: readonly SpotMarket[]) {
  for (const market of markets) spotMetadata.set(market.symbol, market);
}

function fallbackPair(symbol: string) {
  const quotes = ['FDUSD', 'USDT', 'USDC', 'THB', 'TUSD', 'USDS', 'BUSD', 'BTC', 'BNB', 'ETH', 'EUR', 'TRY'];
  const quoteAsset = quotes.find(quote => symbol.endsWith(quote) && symbol.length > quote.length) ?? '';
  return {baseAsset: quoteAsset ? symbol.slice(0, -quoteAsset.length) : symbol, quoteAsset: quoteAsset || 'USD'};
}

export function marketInfoFor(symbol: MarketSymbol) {
  if (symbol === defaultMarketSymbol) return marketInfo.XAUUSD;
  if (isForexSymbol(symbol)) {
    const baseAsset = symbol.slice(0, 3), quoteAsset = symbol.slice(3);
    const pricePrecision = quoteAsset === 'JPY' ? 3 : 5;
    return {label: baseAsset + '/' + quoteAsset, source: 'Eightcap Forex', description: 'Forex',
      currency: quoteAsset, calendar: 'utc' as const, baseAsset, quoteAsset,
      tickSize: 10 ** -pricePrecision, pricePrecision};
  }
  const metadata = spotMetadata.get(symbol);
  const fallback = fallbackPair(symbol);
  const baseAsset = metadata?.baseAsset ?? (symbol === 'BTCUSDT' ? 'BTC' : fallback.baseAsset);
  const quoteAsset = metadata?.quoteAsset ?? (symbol === 'BTCUSDT' ? 'USDT' : fallback.quoteAsset);
  const tickSize = metadata?.tickSize ?? (symbol === 'BTCUSDT' ? .01 : .01);
  return {
    label: baseAsset + '/' + quoteAsset, source: 'Binance TH', description: 'Spot', currency: quoteAsset,
    calendar: 'utc' as const, baseAsset, quoteAsset, tickSize,
    pricePrecision: metadata?.pricePrecision ?? 2,
  };
}

const priceFormatters = new Map<number, Intl.NumberFormat>();
export function formatMarketPrice(symbol: MarketSymbol, value: number) {
  const precision = marketInfoFor(symbol).pricePrecision;
  let formatter = priceFormatters.get(precision);
  if (!formatter) {
    formatter = new Intl.NumberFormat('en-US', {minimumFractionDigits: precision, maximumFractionDigits: precision});
    priceFormatters.set(precision, formatter);
  }
  return formatter.format(value);
}
