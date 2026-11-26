import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createECDH, randomBytes} from 'node:crypto';
import worker, {AlertHub} from '../server/price-alerts/index.mjs';

test('the service watches fresh quotes without a page and sends one encrypted push per enrolled device', async t => {
  let persisted;
  let alarmAt = null;
  const storage = {
    get: async () => structuredClone(persisted),
    put: async (_key, next) => { persisted = structuredClone(next); },
    getAlarm: async () => alarmAt,
    setAlarm: async time => { alarmAt = time; },
    deleteAlarm: async () => { alarmAt = null; },
    transaction: async operation => operation(storage),
  };
  const vapid = createECDH('prime256v1');
  const receiver = createECDH('prime256v1');
  vapid.generateKeys();
  receiver.generateKeys();
  const token = randomBytes(32).toString('base64url');
  const env = {
    ALERT_ACCESS_TOKEN: token, ALERT_WEB_ORIGIN:'https://basssg.github.io',
    ALERT_QUOTE_URL:'https://quotes.invalid/api/quote', VAPID_SUBJECT:'https://basssg.github.io/XAUUSDreplay/',
    VAPID_PUBLIC_KEY:vapid.getPublicKey('base64url'), VAPID_PRIVATE_KEY:vapid.getPrivateKey('base64url'),
  };
  const hub = new AlertHub({storage}, env);
  env.ALERT_HUB = {idFromName: name => name, get: () => hub};
  const requests = [];
  let bid = 3450;
  let live = true;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url === env.ALERT_QUOTE_URL) return Response.json({
      symbol:'XAUUSD', source_id:'Eightcap-MT5-Live', price_basis:'Bid', bid, ask:bid+.1,
      timestamp:Math.floor(Date.now()/1000), quote_usable:live,
      connection_status:'connected', market_status:'open', feed_status:live ? 'fresh' : 'stale',
    });
    requests.push({url, headers: new Headers(options.headers), body: options.body});
    return new Response(null, {status: 201});
  });
  const endpoint = 'https://fcm.googleapis.com/fcm/send/isolated-test';
  const send = (path, body, authorization = 'Bearer ' + token) => worker.fetch(new Request('https://alerts.invalid' + path, {
    method: body ? 'POST' : 'GET',
    headers: {Authorization:authorization, Origin:env.ALERT_WEB_ORIGIN, 'Content-Type':'application/json'},
    body: body && JSON.stringify(body),
  }), env);
  assert.equal((await send('/state', null, 'Bearer no')).status, 401);
  assert.equal((await send('/devices', {id:crypto.randomUUID(), subscription:{endpoint:'https://127.0.0.1'}})).status, 400);
  assert.equal((await send('/devices', {id:crypto.randomUUID(), subscription:{endpoint, keys:{
    p256dh:receiver.getPublicKey('base64url'), auth:randomBytes(16).toString('base64url'),
  }}})).status, 200);
  assert.equal((await send('/rules', {op:'add', level:3460, direction:'up', repeat:false, label:'Target'})).status, 200);
  assert.equal(typeof alarmAt, 'number');
  live=false;
  bid=3460;
  await hub.alarm();
  assert.equal(requests.length,0);
  live=true;
  await hub.alarm();
  await hub.alarm();
  assert.equal(requests.length,1);
  assert.equal(requests[0].url, endpoint);
  assert.equal(requests[0].headers.get('content-encoding'), 'aes128gcm');
  assert.equal(requests[0].body.byteLength,4096);
  const workspace = await (await send('/state')).json();
  assert.equal(workspace.rules[0].status, 'fired');
  assert.equal(workspace.events[0].bid, 3460);
  assert.equal(workspace.events.length,1);
  assert.equal(alarmAt,null);
});
