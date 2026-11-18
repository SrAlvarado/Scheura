// Web Push: avisos aunque la app esté cerrada. El servidor (Cloudflare Worker) guarda la suscripción de este
// dispositivo y la lista de avisos de los próximos 30 días, y un cron los envía a su hora.
// La lista se vuelve a subir al abrir la app, tras cada cambio (local o sincronizado) y una vez al día.
import type { PushReminder, PushScheduleRequest, PushSubscribeRequest, PushUnsubscribeRequest } from '../../shared/protocol';
import { getDeviceId, getMeta, getSettings, setMeta } from '../db/db';
import { API_URL, VAPID_PUBLIC_KEY, serverEnabled } from '../lib/config';
import { digestReminders, upcomingReminders, type UpcomingReminder } from '../lib/notifications';
import { onLocalChange, onRemoteChange } from '../sync/events';

export type PushStatus = 'unsupported' | 'needs-install' | 'denied' | 'off' | 'on' | 'server-disabled';

const ENABLED = 'push.enabled';
const ENDPOINT = 'push.endpoint';
const MAX_REMINDERS = 500;

// ---------- Detección ----------

export const isIOS = () =>
  typeof navigator !== 'undefined' &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

export const isStandalone = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);

/** En iPhone/iPad Web Push solo funciona con la app abierta desde la pantalla de inicio (iOS 16.4+). */
export const needsInstall = () => isIOS() && !isStandalone();

const apisAvailable = () =>
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/** El navegador puede recibir Web Push ahora mismo. */
export const pushSupported = () => apisAvailable() && !needsInstall();

// ---------- Utilidades ----------

export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function api(method: string, path: string, body: unknown) {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Servidor ${res.status}`);
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const reg = (await navigator.serviceWorker.getRegistration()) ??
    (await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<undefined>((r) => setTimeout(() => r(undefined), 5000)),
    ]));
  if (!reg) throw new Error('El service worker no está disponible (¿modo desarrollo?).');
  return reg;
}

async function currentSubscription(): Promise<PushSubscription | null> {
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    return (await reg?.pushManager.getSubscription()) ?? null;
  } catch {
    return null;
  }
}

function sameKey(sub: PushSubscription): boolean {
  const k = sub.options?.applicationServerKey;
  if (!k) return true; // el navegador no lo expone: asumir que es la misma
  const a = new Uint8Array(k);
  const b = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

async function sendSubscription(sub: PushSubscription) {
  const json = sub.toJSON();
  const req: PushSubscribeRequest = {
    deviceId: await getDeviceId(),
    subscription: { endpoint: sub.endpoint, keys: { p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' } },
  };
  await api('POST', '/v1/push/subscribe', req);
  await setMeta(ENDPOINT, sub.endpoint);
}

/** Crea (o reutiliza) la suscripción y la registra en el servidor si cambió. */
async function ensureSubscription(force = false): Promise<PushSubscription> {
  const reg = await registration();
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub)) { await sub.unsubscribe().catch(() => undefined); sub = null; }
  if (!sub) {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) });
  }
  if (force || (await getMeta<string>(ENDPOINT)) !== sub.endpoint) await sendSubscription(sub);
  return sub;
}

// ---------- Estado ----------

export async function getPushStatus(): Promise<PushStatus> {
  if (needsInstall()) return 'needs-install';
  if (!apisAvailable()) return 'unsupported';
  if (!serverEnabled()) return 'server-disabled';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission !== 'granted' || !(await getMeta<boolean>(ENABLED))) return 'off';
  return (await currentSubscription()) ? 'on' : 'off';
}

/** Pide permiso, suscribe este dispositivo y sube los avisos. Devuelve el estado resultante. */
export async function enablePush(): Promise<PushStatus> {
  const status = await getPushStatus();
  if (status !== 'off' && status !== 'on') return status;
  const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (perm === 'denied') return 'denied';
  if (perm !== 'granted') return 'off';
  await ensureSubscription(true);
  await setMeta(ENABLED, true);
  await uploadSchedule();
  return 'on';
}

/** Da de baja la suscripción aquí y en el servidor. Los avisos locales (con la app abierta) siguen funcionando. */
export async function disablePush(): Promise<PushStatus> {
  await setMeta(ENABLED, false);
  const sub = await currentSubscription();
  if (serverEnabled()) {
    const req: PushUnsubscribeRequest = { deviceId: await getDeviceId() };
    await api('DELETE', '/v1/push/subscribe', req).catch(() => undefined);
  }
  await sub?.unsubscribe().catch(() => undefined);
  await setMeta(ENDPOINT, undefined);
  return getPushStatus();
}

// ---------- Avisos programados ----------

/** Avisos extra (p. ej. el de prueba) que se incluyen en cada subida hasta que pasa su hora. */
let extras: PushReminder[] = [];

const GENERIC_TITLE = 'Scheura';
const GENERIC_BODY = 'Tienes un aviso pendiente';

function toPush(r: UpcomingReminder, showTitles: boolean, keepText = false): PushReminder {
  return {
    key: r.key,
    at: r.at.getTime(),
    title: showTitles || keepText ? r.title : GENERIC_TITLE,
    body: showTitles || keepText ? r.body : GENERIC_BODY,
    url: r.url,
  };
}

/** Construye la lista de avisos (recordatorios + resumen diario, próximos 30 días). */
export async function buildSchedule(): Promise<PushReminder[]> {
  const settings = await getSettings();
  const showTitles = settings.pushShowTitles ?? true;
  const now = Date.now();
  const [rem, digest] = await Promise.all([upcomingReminders(30), digestReminders(30, showTitles)]);
  extras = extras.filter((e) => e.at > now - 60_000);
  const list = [
    ...rem.filter((r) => r.at.getTime() > now).map((r) => toPush(r, showTitles)),
    // el resumen ya respeta showTitles en el cuerpo; su título no incluye datos personales
    ...digest.filter((r) => r.at.getTime() > now).map((r) => toPush(r, showTitles, true)),
  ].sort((a, b) => a.at - b.at);
  return [...extras, ...list].slice(0, MAX_REMINDERS);
}

/** Sustituye en el servidor los avisos pendientes de este dispositivo. `extra` se añade (y se recuerda). */
export async function uploadSchedule(extra: PushReminder[] = []): Promise<void> {
  if (!serverEnabled()) return;
  extras = [...extras.filter((e) => !extra.some((x) => x.key === e.key)), ...extra];
  const req: PushScheduleRequest = { deviceId: await getDeviceId(), reminders: await buildSchedule() };
  await api('PUT', '/v1/push/schedule', req);
}

/** Programa un aviso de prueba dentro de `delayMs` (el cron del servidor lo envía en el minuto siguiente). */
export async function sendTestPush(delayMs = 5000): Promise<void> {
  await uploadSchedule([{
    key: `test|${Date.now()}`,
    at: Date.now() + delayMs,
    title: 'Aviso de prueba',
    body: 'Así te llegarán los avisos de Scheura.',
    url: '#/ajustes/avisos',
  }]);
}

// ---------- Bucle ----------

/**
 * Mantiene la suscripción y la lista de avisos al día mientras la app está abierta. Llamar una vez al arrancar.
 * Si push está desactivado no hace nada (vuelve a comprobarlo en cada disparo). Devuelve una función para pararlo.
 */
export function startPushLoop(): () => void {
  if (!serverEnabled() || !apisAvailable()) return () => undefined;
  let running = false;
  let again = false;
  let resubscribe = false;

  const sync = async () => {
    if (running) { again = true; return; }
    running = true;
    try {
      if (!(await getMeta<boolean>(ENABLED)) || Notification.permission !== 'granted') return;
      // Renueva la suscripción si caducó o cambió (el SW avisa con 'pushsubscriptionchange').
      await ensureSubscription(resubscribe);
      resubscribe = false;
      await uploadSchedule();
    } catch {
      /* sin conexión o servidor caído: se reintenta en el siguiente disparo */
    } finally {
      running = false;
      if (again) { again = false; void sync(); }
    }
  };

  let debounce: ReturnType<typeof setTimeout> | undefined;
  const soon = () => { clearTimeout(debounce); debounce = setTimeout(sync, 5000); };

  const offLocal = onLocalChange(soon);
  const offRemote = onRemoteChange(soon);
  const daily = setInterval(sync, 24 * 3600_000);
  const onMessage = (e: MessageEvent) => {
    if (e.data?.type === 'scheura:pushsubscriptionchange') { resubscribe = true; void sync(); }
  };
  navigator.serviceWorker.addEventListener('message', onMessage);
  void sync();

  return () => {
    clearTimeout(debounce);
    clearInterval(daily);
    offLocal();
    offRemote();
    navigator.serviceWorker.removeEventListener('message', onMessage);
  };
}
