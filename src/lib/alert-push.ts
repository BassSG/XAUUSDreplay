const base = import.meta.env.BASE_URL;

async function getAlertWorker() {
  if (!('serviceWorker' in navigator)) throw Error('เบราว์เซอร์นี้ยังไม่รองรับแจ้งเตือน');
  const registration = await navigator.serviceWorker.register(base + 'sw.js', {scope: base});
  if (registration.active) await registration.update().catch(() => {});
  for (let attempt = 0; attempt < 20; attempt++) {
    registration.waiting?.postMessage('SKIP_WAITING');
    if (registration.active && !registration.waiting && !registration.installing) return registration;
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  throw Error('แอปยังอัปเดตไม่เสร็จ ลองเปิดแจ้งเตือนอีกครั้ง');
}

export async function enableAlertNotifications() {
  if (!('Notification' in window)) throw Error('ใช้เบราว์เซอร์ที่รองรับแจ้งเตือน หรือเปิด EBW จากหน้าจอโฮมบน iPhone');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw Error('ให้สิทธิ์แจ้งเตือน EBW ในการตั้งค่าเบราว์เซอร์ก่อน');
}

export async function subscribeToAlerts(key: string) {
  await enableAlertNotifications();
  const registration = await getAlertWorker();
  if (!registration.pushManager) throw Error('ใช้เบราว์เซอร์ที่รองรับ Web Push');
  const publicKey = Uint8Array.from(atob(key.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
  let subscription = await registration.pushManager.getSubscription();
  const oldKey = subscription?.options.applicationServerKey;
  if (subscription && (!oldKey || new Uint8Array(oldKey).some((byte, index) => byte !== publicKey[index]))) {
    await subscription.unsubscribe();
    subscription = null;
  }
  return subscription ?? await registration.pushManager.subscribe({userVisibleOnly: true, applicationServerKey: publicKey});
}

export async function showLocalAlert(title: string, body: string, id: string) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    new Notification(title, {body, tag: id, icon: base + 'icons/icon-192.png'});
  } catch {
    const registration = await getAlertWorker();
    await registration.showNotification(title, {body, tag: id, icon: base + 'icons/icon-192.png'});
  }
}
