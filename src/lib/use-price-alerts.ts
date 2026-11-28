import {useEffect, useRef, useState} from 'react';
import {blankAlerts, changeAlerts, checkAlerts, isFreshAlertQuote, type AlertCommand, type AlertEvent, type AlertState} from './price-alerts';
import type {Quote} from './live-market';
import {showLocalAlert, subscribeToAlerts} from './alert-push';

const alertKey = 'ebw-price-alerts-v1';
const connectionKey = 'ebw-alert-connection-v1';
const deviceKey = 'ebw-alert-device-v1';
const configuredServer = import.meta.env.VITE_XAU_ALERTS_URL ?? '';
const prices = new Intl.NumberFormat('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});

type Connection = {url: string; token: string};
type CloudAlertState = AlertState & {pushKey: string; devices: string[]; monitor: 'live' | 'waiting'; checkedAt: number | null};

function readLocal<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; }
  catch { return fallback; }
}

function localAlerts(): AlertState {
  const value = readLocal<AlertState>(alertKey, blankAlerts());
  return Array.isArray(value.rules) && Array.isArray(value.events) ? value : blankAlerts();
}

function deviceId() {
  const old = localStorage.getItem(deviceKey);
  if (old) return old;
  const id = crypto.randomUUID();
  localStorage.setItem(deviceKey, id);
  return id;
}

async function alertRequest<T>(connection: Connection, path: string, body?: unknown): Promise<T> {
  const response = await fetch(connection.url + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {Authorization: 'Bearer ' + connection.token, ...(body === undefined ? {} : {'Content-Type': 'application/json'})},
    ...(body === undefined ? {} : {body: JSON.stringify(body)}),
    cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(12000),
  });
  const result = await response.json();
  if (!response.ok) throw Error(result.error || 'เชื่อมต่อบริการแจ้งเตือนไม่ได้');
  return result;
}

export function alertText(event: AlertEvent) {
  return 'Bid ' + prices.format(event.bid) + ' ถึงระดับ ' + prices.format(event.level);
}

export function usePriceAlerts(quote: Quote | null | undefined, enabled = true) {
  const [local, setLocal] = useState(localAlerts);
  const [connection, setConnection] = useState(() => readLocal<Connection | null>(connectionKey, null));
  const [remote, setRemote] = useState<CloudAlertState | null>(null);
  const [remoteError, setRemoteError] = useState('');
  const [notice, setNotice] = useState<AlertEvent | null>(null);
  const [device, setDevice] = useState(() => {
    try { return localStorage.getItem(deviceKey); } catch { return null; }
  });
  const latest = useRef(quote);
  latest.current = quote;
  const remoteEvents = useRef<Set<string> | null>(null);
  // Responses started before a mutation must not overwrite its newer state.
  const revision = useRef(0);
  function acceptRemote(state: CloudAlertState) {
    const known = remoteEvents.current;
    const next = known && state.events.find(event => !known.has(event.id));
    remoteEvents.current = new Set(state.events.map(event => event.id));
    if (next) setNotice(next);
    setRemote(state);
    setRemoteError('');
  }

  useEffect(() => {
    if (!enabled || connection) return;
    const sync = (event: StorageEvent) => {
      if (event.key === alertKey) setLocal(localAlerts());
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, [connection, enabled]);

  useEffect(() => {
    if (!enabled || connection || !local.rules.some(rule => rule.status === 'armed') || !isFreshAlertQuote(quote) || !quote) return;
    const processQuote = () => {
      const state = localAlerts();
      const result = checkAlerts(state, quote.bid, quote.time);
      if (result.state === state) return;
      try { localStorage.setItem(alertKey, JSON.stringify(result.state)); }
      catch { setRemoteError('บันทึกแจ้งเตือนในเครื่องไม่ได้'); return; }
      setLocal(result.state);
      if (!result.fired.length) return;
      for (const event of result.fired) {
        setNotice(event);
        void showLocalAlert(event.label || 'EBW · XAUUSD', alertText(event), event.id).catch(() => {});
      }
    };
    if (navigator.locks) void navigator.locks.request(alertKey, processQuote);
    else processQuote();
  }, [connection, quote, local.rules.length, enabled]);

  useEffect(() => {
    if (!enabled || !connection) return;
    let timer: ReturnType<typeof setTimeout>;
    let active = true;
    let inFlight = false;
    async function refresh() {
      if (!connection || !active || inFlight) return;
      inFlight = true;
      const version = revision.current;
      try {
        const state = await alertRequest<CloudAlertState>(connection, '/state');
        if (active && version === revision.current) acceptRemote(state);
      } catch (error) {
        if (active && version === revision.current) setRemoteError(error instanceof Error ? error.message : 'เชื่อมต่อไม่ได้');
      } finally {
        inFlight = false;
        if (active) timer = setTimeout(refresh, document.hidden ? 30000 : 7000);
      }
    }
    const onVisible = () => { if (!document.hidden) { clearTimeout(timer); void refresh(); } };
    void refresh();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      active = false;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [connection, enabled]);

  useEffect(() => {
    if (!notice) return;
    const expiry = setTimeout(() => setNotice(null), 15000);
    return () => clearTimeout(expiry);
  }, [notice]);

  async function connect(url: string, token: string) {
    const target = new URL(url.trim());
    if ((target.protocol !== 'https:' && !(target.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(target.hostname))) ||
        target.username || target.password || target.search || target.hash ||
        !/^[A-Za-z0-9_-]{43}$/.test(token.trim())) throw Error('ตรวจสอบลิงก์บริการ HTTPS และรหัสเชื่อมอุปกรณ์');
    const value = {url: target.href.replace(/\/+$/, ''), token: token.trim()};
    const state = await alertRequest<CloudAlertState>(value, '/state');
    if (!state.pushKey || !Array.isArray(state.rules) || !Array.isArray(state.devices)) throw Error('ลิงก์นี้ไม่ใช่บริการ EBW Alerts');
    localStorage.setItem(connectionKey, JSON.stringify(value));
    remoteEvents.current = null;
    acceptRemote(state);
    setConnection(value);
  }

  function disconnect() {
    localStorage.removeItem(connectionKey);
    revision.current++;
    remoteEvents.current = null;
    setConnection(null);
    setRemote(null);
    setRemoteError('');
    setLocal(localAlerts());
  }

  async function command(body: AlertCommand) {
    if (connection) {
      revision.current++;
      const state = await alertRequest<CloudAlertState>(connection, '/rules', body);
      revision.current++;
      acceptRemote(state);
      return;
    }
    const update = () => {
      const state = localAlerts();
      const current = latest.current;
      let atCreation = state;
      if (isFreshAlertQuote(current) && current && (!state.last || current.time >= state.last.time)) {
        // Capture the price at the moment a rule is created or re-armed.
        atCreation = {...state, last: {bid: current.bid, time: current.time}};
      }
      const updated = {...changeAlerts(atCreation, body, Date.now()), last: state.last};
      localStorage.setItem(alertKey, JSON.stringify(updated));
      setLocal(updated);
    };
    if (navigator.locks) await navigator.locks.request(alertKey, update);
    else update();
  }

  async function enablePush() {
    if (!connection || !remote?.pushKey) throw Error('เชื่อมบริการแจ้งเตือนก่อน');
    const subscription = await subscribeToAlerts(remote.pushKey);
    const id = deviceId();
    revision.current++;
    const result = await alertRequest<CloudAlertState>(connection, '/devices', {id, subscription: subscription.toJSON()});
    revision.current++;
    setDevice(id);
    acceptRemote(result);
  }

  async function disablePush() {
    if (!connection || !device) return;
    revision.current++;
    const result = await alertRequest<CloudAlertState>(connection, '/devices/remove', {id: device});
    revision.current++;
    acceptRemote(result);
    const registration = await navigator.serviceWorker?.getRegistration(import.meta.env.BASE_URL);
    const subscription = await registration?.pushManager?.getSubscription();
    await subscription?.unsubscribe();
  }

  async function testPush() {
    if (!connection || !device) throw Error('เปิดรับแจ้งเตือนในเครื่องนี้ก่อน');
    await alertRequest(connection, '/devices/test', {id: device});
  }

  return {state: connection ? remote ?? blankAlerts() : local, remote, remoteError, notice, setNotice, connection,
    defaultServer: configuredServer, deviceEnabled: !!device && !!remote?.devices.includes(device),
    connect, disconnect, command, enablePush, disablePush, testPush};
}
