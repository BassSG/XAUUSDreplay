import runtimeUrl from './pine.worker.ts?worker&url';

let bundle: Promise<string> | undefined;
function runtimeSource() {
  const url = import.meta.env.DEV ? import.meta.env.BASE_URL + 'live-pine-worker.js' : runtimeUrl;
  return bundle ??= fetch(url, {credentials: 'omit'}).then(response => {
    if (!response.ok) throw Error('โหลดตัวประมวลผล Pine ไม่สำเร็จ');
    return response.text();
  }).catch(error => { bundle = undefined; throw error; });
}

// Imported source executes in a worker owned by an opaque-origin frame.
// The runtime receives candles over a private port and needs no network or site storage.
export function createLivePineWorker() {
  const frame = document.createElement('iframe');
  frame.hidden = true;
  frame.title = 'Pine runtime';
  frame.sandbox.add('allow-scripts');
  const channel = new MessageChannel();
  let closed = false;
  const client = {
    onmessage: null as ((event: MessageEvent) => void) | null,
    onerror: null as ((event: {message: string}) => void) | null,
    postMessage: (message: unknown) => channel.port1.postMessage(message),
    terminate() {
      closed = true;
      channel.port1.close();
      channel.port2.close();
      frame.remove();
    },
  };
  channel.port1.onmessage = event => {
    if (closed) return;
    if (event.data.fatal) client.onerror?.({message: String(event.data.fatal)});
    else client.onmessage?.(event);
  };
  frame.onload = async () => {
    try {
      const source = await runtimeSource();
      if (!closed) frame.contentWindow?.postMessage(source, '*', [channel.port2]);
    } catch (e) {
      if (!closed) client.onerror?.({message: e instanceof Error ? e.message : 'เปิด Pine runtime ไม่สำเร็จ'});
    }
  };
  const nonce = crypto.randomUUID().replaceAll('-', '');
  const bootstrap = `addEventListener('message', e => {
    if (e.source !== parent || !e.ports.length) return;
    const port = e.ports[0];
    try {
      const url = URL.createObjectURL(new Blob([e.data], {type:'text/javascript'}));
      const worker = new Worker(url);
      worker.onmessage = event => port.postMessage(event.data);
      worker.onerror = event => port.postMessage({fatal:event.message || 'เปิด Pine runtime ไม่สำเร็จ'});
      port.onmessage = event => worker.postMessage(event.data);
      addEventListener('pagehide', () => {worker.terminate(); URL.revokeObjectURL(url);}, {once:true});
    } catch (error) {port.postMessage({fatal:String(error)});}
  }, {once:true});`;
  frame.srcdoc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}' 'unsafe-eval' blob:; worker-src blob:; connect-src 'none'"><script nonce="${nonce}">${bootstrap}</script>`;
  document.body.append(frame);
  return client;
}
