import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
import vm from 'node:vm';

const run = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const origin = 'https://basssg.github.io';
const base = '/XAUUSDreplay/';
let fixture, worker;

before(async () => {
  fixture = await mkdtemp(path.join(tmpdir(), 'xau-replay-pwa-tests-'));
  await mkdir(path.join(fixture, 'dist/assets'), {recursive: true});
  await mkdir(path.join(fixture, 'dist/data/m1'), {recursive: true});
  await writeFile(path.join(fixture, 'dist/index.html'), '<main>offline replay shell</main>');
  await writeFile(path.join(fixture, 'dist/assets/app-abc.js'), 'console.log("replay");');
  await writeFile(path.join(fixture, 'dist/data/catalog.json'), '{"datasets":[]}');
  await writeFile(path.join(fixture, 'dist/data/m1/000.json.gz'), 'lazy market data');
  await run(process.execPath, [path.join(root, 'scripts/build-sw.mjs')], {cwd: fixture});
  worker = await readFile(path.join(fixture, 'dist/sw.js'), 'utf8');
});

after(async () => {
  if (fixture) await rm(fixture, {recursive: true, force: true});
});

function harness(network = async request => new Response('network: ' + key(request))) {
  const handlers = new Map(), stores = new Map(), calls = [], precached = [];
  const counters = {skipWaiting: 0, claim: 0};
  const cache = name => {
    if (!stores.has(name)) stores.set(name, new Map());
    const entries = stores.get(name);
    return {
      async addAll(urls) {
        for (const url of urls) {
          precached.push(url);
          entries.set(key(url), new Response(url.endsWith('index.html') ? '<main>offline replay shell</main>' : 'cached: ' + url));
        }
      },
      async match(request) { return entries.get(key(request))?.clone(); },
      async put(request, response) { entries.set(key(request), response.clone()); },
    };
  };
  const caches = {
    async open(name) { return cache(name); },
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); },
    async match(request) {
      for (const entries of stores.values()) {
        const response = entries.get(key(request));
        if (response) return response.clone();
      }
    },
  };
  const self = {
    location: {origin},
    clients: {async claim() { counters.claim++; }},
    skipWaiting() { counters.skipWaiting++; return Promise.resolve(); },
    addEventListener(type, callback) { handlers.set(type, callback); },
  };
  vm.runInNewContext(worker, {
    self, caches, URL, Response, AbortController, setTimeout, clearTimeout,
    fetch: async (...args) => { calls.push(args[0]); return network(...args); },
  });
  return {
    stores, counters, calls, precached,
    async dispatch(type, details = {}) {
      const waits = [];
      let response;
      handlers.get(type)({...details, waitUntil(value) {waits.push(value);}, respondWith(value) {response = value;}});
      await Promise.all(waits);
      return response === undefined ? undefined : await response;
    },
  };
}

function key(request) {
  return new URL(typeof request === 'string' ? request : request.url, origin).href;
}
function request(url, options = {}) {
  return {url: new URL(url, origin).href, method: 'GET', mode: 'cors', ...options};
}

test('install caches a scoped offline shell and catalog without eagerly downloading all history or activating', async () => {
  const h = harness();
  await h.dispatch('install');
  assert.equal(h.counters.skipWaiting, 0);
  assert.equal(h.counters.claim, 0);
  assert.ok(h.precached.includes(base + 'index.html'));
  assert.ok(h.precached.includes(base + 'data/catalog.json'));
  assert.ok(h.precached.includes(base + 'assets/app-abc.js'));
  assert.ok(h.precached.every(url => url.startsWith(base)));
  assert.ok(!h.precached.some(url => url.endsWith('.json.gz')));
  const response = await h.dispatch('fetch', {request: request(base + 'assets/app-abc.js')});
  assert.match(await response.text(), /cached:/);
  assert.equal(h.calls.length, 0);
});

test('updates wait until an explicit SKIP_WAITING message', async () => {
  const h = harness();
  await h.dispatch('install');
  await h.dispatch('message', {data: 'unrelated'});
  assert.equal(h.counters.skipWaiting, 0);
  await h.dispatch('message', {data: 'SKIP_WAITING'});
  assert.equal(h.counters.skipWaiting, 1);
});

test('activation removes only stale caches owned by this app on the shared GitHub Pages origin', async () => {
  const h = harness();
  await h.dispatch('install');
  const [activeCache] = h.stores.keys();
  h.stores.set('xau-replay-old-build', new Map());
  h.stores.set('another-app-assets', new Map());
  h.stores.set('workbox-precache-v2', new Map());
  await h.dispatch('activate');
  assert.ok(h.stores.has(activeCache));
  assert.ok(!h.stores.has('xau-replay-old-build'));
  assert.ok(h.stores.has('another-app-assets'));
  assert.ok(h.stores.has('workbox-precache-v2'));
  assert.equal(h.counters.claim, 1);
});

test('offline and failed navigations open the cached application shell at nested app URLs', async () => {
  for (const network of [async () => {throw new TypeError('offline');}, async () => new Response('unavailable', {status: 503})]) {
    const h = harness(network);
    await h.dispatch('install');
    const response = await h.dispatch('fetch', {request: request(base + 'rounds/example', {mode: 'navigate'})});
    assert.equal(response.status, 200);
    assert.equal(await response.text(), '<main>offline replay shell</main>');
  }
});

test('online navigation uses the fresh response instead of hiding a new deployment behind the old shell', async () => {
  const h = harness(async () => new Response('<main>new replay shell</main>'));
  await h.dispatch('install');
  const response = await h.dispatch('fetch', {request: request(base, {mode: 'navigate'})});
  assert.equal(await response.text(), '<main>new replay shell</main>');
});

test('the worker ignores external requests, other apps on the same origin, and writes', async () => {
  const h = harness();
  for (const r of [
    request('https://example.com' + base + 'data/catalog.json'),
    request('/another-app/index.html', {mode: 'navigate'}),
    request('/XAUUSDreplay-other/index.html', {mode: 'navigate'}),
    request(base + 'anything', {method: 'POST'}),
  ]) {
    assert.equal(await h.dispatch('fetch', {request: r}), undefined);
  }
  assert.equal(h.calls.length, 0);
  assert.equal(h.stores.size, 0);
});

test('history chunks are cached only when requested and successful, then remain usable offline', async () => {
  let offline = false;
  const h = harness(async () => {
    if (offline) throw new TypeError('offline');
    return new Response('market bars');
  });
  const dataRequest = request(base + 'data/m1/000.json.gz');
  assert.equal(await (await h.dispatch('fetch', {request: dataRequest})).text(), 'market bars');
  offline = true;
  assert.equal(await (await h.dispatch('fetch', {request: dataRequest})).text(), 'market bars');
  assert.equal(h.calls.length, 1);

  const broken = harness(async () => new Response('not found', {status: 404}));
  await broken.dispatch('fetch', {request: dataRequest});
  await broken.dispatch('fetch', {request: dataRequest});
  assert.equal(broken.calls.length, 2);
});

test('install identity and icons resolve within the GitHub Pages app scope', async () => {
  const manifest = JSON.parse(await readFile(path.join(root, 'public/manifest.webmanifest'), 'utf8'));
  const manifestUrl = new URL(base + 'manifest.webmanifest', origin);
  for (const field of ['id', 'start_url', 'scope']) {
    assert.equal(new URL(manifest[field], manifestUrl).href, origin + base);
  }
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.icons.some(icon => icon.sizes === '192x192' && icon.purpose === 'any'));
  assert.ok(manifest.icons.some(icon => icon.sizes === '512x512' && icon.purpose === 'any'));
  assert.ok(manifest.icons.some(icon => icon.sizes === '512x512' && icon.purpose === 'maskable'));
  for (const icon of manifest.icons) {
    assert.ok(new URL(icon.src, manifestUrl).pathname.startsWith(base + 'icons/'));
    assert.equal(icon.type, 'image/png');
  }
  const html = await readFile(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /rel="manifest" href="%BASE_URL%manifest\.webmanifest"/);
  assert.match(html, /rel="apple-touch-icon" href="%BASE_URL%icons\/apple-touch-icon\.png"/);
});
