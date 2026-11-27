import {buildPushPayload} from '@block65/webcrypto-web-push';
import {blankAlerts, changeAlerts, checkAlerts, isFreshAlertQuote} from '../../src/lib/price-alerts.ts';
import {readQuote} from '../../src/lib/live-market.ts';

const STATE_KEY = 'workspace';
const SCAN_MS = 5000;
const SLOW_MS = 30000;
const PUSH_TTL = 180;
const deviceLimit = 6;
const primarySource = 'https://anything-mrna-work-voted.trycloudflare.com/api/quote';
const backupSource = 'https://theft-volatile-relock.ngrok-free.dev/api/quote';
const savedState = () => ({alerts: blankAlerts(), devices: [], queue: [], monitor: 'waiting', checkedAt: null});
const response = (body, status = 200) => Response.json(body, {status, headers: {'Cache-Control': 'no-store'}});
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const devicePattern = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;
const subscriptionKeys = /^[\w-]+$/;

function sameToken(a, b) {
  if (!tokenPattern.test(a) || !tokenPattern.test(b)) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

function parseSubscription(value) {
  const u = new URL(value?.endpoint);
  const providers = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'];
  const allowed = providers.includes(u.hostname) || u.hostname.endsWith('.push.apple.com') || u.hostname.endsWith('.notify.windows.com');
  if (!allowed || u.protocol !== 'https:' || u.port || u.username || u.password || u.hash || u.href.length > 2048) {
    throw Error('บริการ Push ของอุปกรณ์นี้ยังไม่รองรับ');
  }
  const {p256dh, auth} = value.keys ?? {};
  if (typeof p256dh !== 'string' || p256dh.length !== 87 || !subscriptionKeys.test(p256dh) ||
      typeof auth !== 'string' || auth.length !== 22 || !subscriptionKeys.test(auth)) throw Error('ข้อมูล Push ไม่สมบูรณ์');
  return {endpoint: u.href, keys: {p256dh, auth}, expirationTime: null};
}

async function latestQuote(env) {
  const routes = env.ALERT_QUOTE_URL ? [env.ALERT_QUOTE_URL] : [primarySource, backupSource];
  for (const route of routes) {
    try {
      const result = await fetch(route, {
        redirect: 'manual', signal: AbortSignal.timeout(3500),
        headers: {Accept: 'application/json', ...(route === backupSource ? {'ngrok-skip-browser-warning': '1'} : {}),
          ...(env.ALERT_QUOTE_URL && env.ALERT_QUOTE_KEY ? {'X-API-Key': env.ALERT_QUOTE_KEY} : {})},
      });
      if (!result.ok) continue;
      return readQuote(await result.json(), Date.now() / 1000);
    } catch { /* Try the other configured bridge. */ }
  }
  return null;
}

function pushNotification(item) {
  return {
    title: 'EBW · ' + (item.label || 'XAUUSD'),
    body: 'Bid ' + item.bid.toFixed(2) + ' ถึงระดับ ' + item.level.toFixed(2),
    tag: item.id,
  };
}

async function sendPush(env, device, notice) {
  let result;
  try {
    const payload = await buildPushPayload({
      data: JSON.stringify(notice), options: {ttl: PUSH_TTL, urgency: 'high'},
    }, device.subscription, {
      subject: env.VAPID_SUBJECT,
      publicKey: env.VAPID_PUBLIC_KEY,
      privateKey: env.VAPID_PRIVATE_KEY,
    });
    result = await fetch(device.subscription.endpoint, {...payload, redirect: 'manual', signal: AbortSignal.timeout(5500)});
  } catch { return 'retry'; }
  if (result.ok) return 'sent';
  if (result.status === 404 || result.status === 410) return 'expired';
  return result.status === 429 || result.status >= 500 ? 'retry' : 'failed';
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    if (origin && origin !== env.ALERT_WEB_ORIGIN) return response({error: 'Origin forbidden'}, 403);
    const headers = {
      'Access-Control-Allow-Origin': env.ALERT_WEB_ORIGIN, 'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', Vary: 'Origin',
    };
    if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers});
    const token = (request.headers.get('Authorization') ?? '').slice(7);
    const allowed = request.headers.get('Authorization')?.startsWith('Bearer ') && sameToken(token, env.ALERT_ACCESS_TOKEN || '');
    if (!allowed) {
      const result = response({error: 'รหัสเชื่อมอุปกรณ์ไม่ถูกต้อง'}, 401);
      for (const [key, value] of Object.entries(headers)) result.headers.set(key, value);
      return result;
    }
    const result = await env.ALERT_HUB.get(env.ALERT_HUB.idFromName('xauusd')).fetch(request);
    const output = new Response(result.body, result);
    for (const [key, value] of Object.entries(headers)) output.headers.set(key, value);
    return output;
  },
};

export class AlertHub {
  constructor(ctx, env) {
    this.store = ctx.storage;
    this.env = env;
  }

  async read(store = this.store) {
    return await store.get(STATE_KEY) ?? savedState();
  }

  publicState(state) {
    return {...state.alerts, pushKey: this.env.VAPID_PUBLIC_KEY, devices: state.devices.map(device => device.id),
      monitor: state.monitor, checkedAt: state.checkedAt};
  }

  async fetch(request) {
    const path = new URL(request.url).pathname;
    try {
      if (path === '/state' && request.method === 'GET') return response(this.publicState(await this.read()));
      if (request.method !== 'POST' || !['/rules', '/devices', '/devices/remove', '/devices/test'].includes(path)) {
        return response({error: 'ไม่พบเส้นทาง'}, 404);
      }
      const raw = await request.text();
      if (raw.length > 8000) return response({error: 'ข้อมูลยาวเกินไป'}, 413);
      const body = JSON.parse(raw);
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw Error('ข้อมูลไม่ถูกต้อง');
      if (path === '/rules') {
        const before = await this.read();
        const now = Date.now();
        const initialise = (body.op === 'add' || body.op === 'add-drawing' || body.op === 'resume') &&
          (!before.alerts.last || Math.abs(now / 1000 - before.alerts.last.time) > 30);
        const seed = initialise ? await latestQuote(this.env) : null;
        const state = await this.store.transaction(async txn => {
          const current = await this.read(txn);
          if (!current.alerts.rules.some(rule => rule.status === 'armed') && isFreshAlertQuote(seed)) {
            current.alerts.last = {time: seed.time, bid: seed.bid};
          }
          current.alerts = changeAlerts(current.alerts, body, Date.now());
          await txn.put(STATE_KEY, current);
          if (current.alerts.rules.some(rule => rule.status === 'armed') && await txn.getAlarm() === null) {
            await txn.setAlarm(Date.now() + 1000);
          }
          return current;
        });
        return response(this.publicState(state));
      }

      if (typeof body.id !== 'string' || !devicePattern.test(body.id)) throw Error('ข้อมูลอุปกรณ์ไม่ถูกต้อง');
      if (path === '/devices/test') {
        const state = await this.read();
        const device = state.devices.find(entry => entry.id === body.id);
        if (!device) return response({error: 'เปิดรับ Push ในเครื่องนี้ก่อน'}, 409);
        const outcome = await sendPush(this.env, device, {title: 'EBW · แจ้งเตือนทดสอบ',
          body: 'อุปกรณ์นี้รับแจ้งเตือน XAUUSD ได้แล้ว', tag: 'ebw-test-' + crypto.randomUUID()});
        if (outcome !== 'sent') return response({error: 'ส่งทดสอบไม่สำเร็จ ลองปิดและเปิดรับ Push อีกครั้ง'}, 502);
        return response({ok: true});
      }

      const subscription = path === '/devices' ? parseSubscription(body.subscription) : null;
      const state = await this.store.transaction(async txn => {
        const state = await this.read(txn);
        state.devices = state.devices.filter(device => device.id !== body.id &&
          (!subscription || device.subscription.endpoint !== subscription.endpoint));
        if (subscription) {
          if (state.devices.length >= deviceLimit) throw Error('เชื่อมได้สูงสุด 6 อุปกรณ์');
          state.devices.push({id: body.id, subscription});
        } else {
          state.queue = state.queue.filter(job => job.deviceId !== body.id);
        }
        await txn.put(STATE_KEY, state);
        return state;
      });
      return response(this.publicState(state));
    } catch (error) {
      return response({error: error instanceof Error ? error.message : 'ประมวลผลแจ้งเตือนไม่สำเร็จ'}, 400);
    }
  }

  async alarm() {
    // Keep a recovery alarm scheduled while making external requests.
    await this.store.setAlarm(Date.now() + SLOW_MS);
    const initial = await this.read();
    const armed = initial.alerts.rules.some(rule => rule.status === 'armed');
    const quote = armed ? await latestQuote(this.env) : null;
    const now = Date.now();
    const live = isFreshAlertQuote(quote, now);
    const state = await this.store.transaction(async txn => {
      const current = await this.read(txn);
      current.monitor = live ? 'live' : 'waiting';
      current.checkedAt = now;
      current.queue = current.queue.filter(job => job.expires > now);
      if (live) {
        const {state, fired} = checkAlerts(current.alerts, quote.bid, quote.time);
        current.alerts = state;
        for (const event of fired) {
          for (const device of current.devices) {
            const id = event.id + ':' + device.id;
            if (!current.queue.some(job => job.id === id)) {
              current.queue.push({id, deviceId: device.id, notice: pushNotification(event), next: now, expires: now + PUSH_TTL * 1000});
            }
          }
        }
      }
      await txn.put(STATE_KEY, current);
      return current;
    });

    const due = state.queue.filter(job => job.next <= now).slice(0, 5);
    const outcomes = await Promise.all(due.map(async job => {
      const device = state.devices.find(entry => entry.id === job.deviceId);
      const outcome = device ? await sendPush(this.env, device, job.notice) : 'failed';
      return {job, device, outcome};
    }));

    await this.store.transaction(async txn => {
      const state = await this.read(txn);
      for (const {job, device, outcome} of outcomes) {
        state.queue = outcome === 'retry'
          ? state.queue.map(item => item.id === job.id ? {...item, next: Date.now() + 15000} : item)
          : state.queue.filter(item => item.id !== job.id);
        if (outcome === 'expired') {
          state.devices = state.devices.filter(entry => entry.subscription.endpoint !== device.subscription.endpoint);
        }
      }
      await txn.put(STATE_KEY, state);
      const hasRules = state.alerts.rules.some(rule => rule.status === 'armed');
      if (!hasRules && !state.queue.length) await txn.deleteAlarm();
      else await txn.setAlarm(Date.now() + (state.queue.length || live || !armed ? SCAN_MS : SLOW_MS));
    });
  }
}
