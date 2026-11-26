import type {Connect, Plugin} from 'vite';
import {barsQuery, minutePollSize, olderPageSize, recentBarsSize} from '../src/lib/live-market';

const prefix = '/api/xau-live/';
const recentBars = /^bars\/(1m|5m|15m|1h|4h|1d)$/;
const defaultOrigin = 'https://anything-mrna-work-voted.trycloudflare.com';

export function liveBridge(): Plugin {
  const bridge = new URL(process.env.XAU_LIVE_API_URL || defaultOrigin);
  if (bridge.protocol !== 'https:' || bridge.username || bridge.password || bridge.origin + '/' !== bridge.href) {
    throw Error('XAU_LIVE_API_URL must be an HTTPS origin');
  }
  const headers: Record<string, string> = {Accept: 'application/json'};
  if (process.env.XAU_LIVE_API_URL && process.env.XAU_LIVE_API_KEY) {
    headers['X-API-Key'] = process.env.XAU_LIVE_API_KEY;
  }
  if (/\.ngrok-free\.(dev|app)$/.test(bridge.hostname)) headers['ngrok-skip-browser-warning'] = '1';

  const handle: Connect.NextHandleFunction = async (req, res, next) => {
    if (!req.url?.startsWith(prefix)) return next();
    const [route, query] = req.url.slice(prefix.length).split('?', 2);
    const bars = recentBars.exec(route);
    const params = new URLSearchParams(query);
    const value = params.get('end');
    const rawEnd = value === null ? undefined : Number(value);
    const limit = params.get('limit');
    const order = params.get('order');
    const supportedLimit = limit === null || (bars?.[1] === '1m' && value === null && limit === String(minutePollSize));
    const defaultLimit = String(value === null ? recentBarsSize : olderPageSize);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (req.method !== 'GET' || (!bars && route !== 'quote') ||
        [...params].length > (bars ? Number(value !== null) + Number(limit !== null) + Number(order !== null) : 0) ||
        (order !== null && order !== 'desc') || (!supportedLimit && limit !== defaultLimit) ||
        (value !== null && (!/^\d{1,12}$/.test(value) || rawEnd! <= 0))) {
      res.statusCode = 404;
      res.end(JSON.stringify({error: 'Unknown market data route'}));
      return;
    }
    const endpoint = bars ? '/api/bars/' + bars[1] + '?' + barsQuery(rawEnd, limit === null ? undefined : Number(limit)).toString() : '/api/quote';
    try {
      const result = await fetch(new URL(endpoint, bridge), {
        headers, redirect: 'error', signal: AbortSignal.timeout(5500),
      });
      if (!result.ok) throw Error('Bridge unavailable');
      res.end(JSON.stringify(await result.json()));
    } catch {
      res.statusCode = 502;
      res.end(JSON.stringify({error: 'Market data unavailable'}));
    }
  };
  return {
    name: 'xau-live-bridge',
    configureServer(server) { server.middlewares.use(handle); },
    configurePreviewServer(server) { server.middlewares.use(handle); },
  };
}
