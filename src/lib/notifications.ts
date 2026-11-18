// Recordatorios.
// - Con Web Push activo (src/push/push.ts) los avisos los envía el servidor aunque la app esté cerrada; el bucle local
//   de este archivo se desactiva para no duplicarlos.
// - Sin push (servidor no configurado, permiso denegado o push desactivado) el bucle local hace de respaldo: programa
//   los avisos mientras la app está abierta o en segundo plano reciente (y al abrirla muestra los que hayan vencido en
//   la última hora). En iPhone la app debe estar añadida a la pantalla de inicio (iOS 16.4+).
import { db, getMeta, getSettings } from '../db/db';
import { buildAgenda } from '../db/repo';
import type { Exam, Reminder, Task } from '../db/types';
import { addDaysISO, toDateTime, todayISO } from './dates';
import { reminderLabel } from './labels';

export interface UpcomingReminder {
  key: string;
  at: Date;
  title: string;
  body: string;
  url: string;
}

export const notificationsSupported = () => typeof window !== 'undefined' && 'Notification' in window;
export const notificationPermission = (): NotificationPermission | 'unsupported' =>
  notificationsSupported() ? Notification.permission : 'unsupported';

export async function requestNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!notificationsSupported()) return 'unsupported';
  return Notification.requestPermission();
}

function reminderTime(r: Reminder, date: string, time?: string): Date {
  if (r.kind === 'before') return new Date(toDateTime(date, time).getTime() - r.minutes * 60000);
  return toDateTime(addDaysISO(date, -r.days), r.time);
}

/** Avisos entre ahora-1h y ahora+`days` días, ordenados. */
export async function upcomingReminders(days = 14): Promise<UpcomingReminder[]> {
  const [tasks, exams] = await Promise.all([db.tasks.toArray(), db.exams.toArray()]);
  const from = addDaysISO(todayISO(), -1);
  const to = addDaysISO(todayISO(), days + 7);
  const now = Date.now();
  const min = now - 3600_000;
  const max = now + days * 86400_000;
  const taskById = new Map<string, Task>(tasks.map((t) => [t.id, t]));
  const examById = new Map<string, Exam>(exams.map((e) => [e.id, e]));
  const out: UpcomingReminder[] = [];
  for (const item of buildAgenda(tasks, exams, from, to)) {
    if (item.done) continue;
    const src = item.kind === 'exam' ? examById.get(item.id) : taskById.get(item.id);
    if (!src) continue;
    for (const r of src.reminders ?? []) {
      const at = reminderTime(r, item.date, item.time);
      const t = at.getTime();
      if (t < min || t > max) continue;
      out.push({
        key: `${item.key}|${r.id}`,
        at,
        title: item.title,
        body: `${item.type === 'examen' ? 'Examen' : item.type === 'entrega' ? 'Entrega' : 'Recordatorio'} · ${reminderLabel(r)}${item.time ? ` · ${item.time}` : ''}`,
        url: item.kind === 'exam' ? `#/examen/${item.id}` : `#/tarea/${item.id}`,
      });
    }
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime());
}

/** Resumen diario («Hoy tienes N cosas») a la hora de los ajustes, para hoy y los `days`-1 días siguientes.
 *  Solo días con algo pendiente. `showTitles` = false → cuerpo genérico (sin títulos). */
export async function digestReminders(days = 30, showTitles = true): Promise<UpcomingReminder[]> {
  const settings = await getSettings();
  if (!settings.dailyDigest) return [];
  const [tasks, exams] = await Promise.all([db.tasks.toArray(), db.exams.toArray()]);
  const from = todayISO();
  const to = addDaysISO(from, days - 1);
  const byDay = new Map<string, string[]>();
  for (const item of buildAgenda(tasks, exams, from, to)) {
    if (item.done) continue;
    byDay.set(item.date, [...(byDay.get(item.date) ?? []), item.title]);
  }
  const min = Date.now() - 3600_000;
  const out: UpcomingReminder[] = [];
  for (let d = from; d <= to; d = addDaysISO(d, 1)) {
    const titles = byDay.get(d);
    if (!titles?.length) continue;
    const at = toDateTime(d, settings.dailyDigestTime);
    if (at.getTime() < min) continue;
    const n = titles.length;
    const rest = n > 3 ? ` y ${n - 3} más` : '';
    out.push({
      key: `digest|${d}`,
      at,
      title: `Hoy tienes ${n} ${n === 1 ? 'cosa' : 'cosas'}`,
      body: showTitles ? `${titles.slice(0, 3).join(', ')}${rest}` : 'Abre Scheura para ver tu día',
      url: '#/',
    });
  }
  return out;
}

/** true si este dispositivo recibe los avisos por Web Push (activado y con suscripción viva). */
export async function pushDelivering(): Promise<boolean> {
  try {
    if (!(await getMeta<boolean>('push.enabled'))) return false;
    if (!('serviceWorker' in navigator) || notificationPermission() !== 'granted') return false;
    const reg = await navigator.serviceWorker.getRegistration();
    return !!(await reg?.pushManager?.getSubscription());
  } catch {
    return false;
  }
}

const FIRED_KEY = 'scheura:fired';
const fired = (): Set<string> => {
  try { return new Set(JSON.parse(localStorage.getItem(FIRED_KEY) ?? '[]')); } catch { return new Set(); }
};
const markFired = (key: string) => {
  try {
    const s = [...fired(), key].slice(-500);
    localStorage.setItem(FIRED_KEY, JSON.stringify(s));
  } catch { /* almacenamiento no disponible */ }
};

async function show(r: UpcomingReminder) {
  if (notificationPermission() !== 'granted' || fired().has(r.key)) return;
  if (await pushDelivering()) return; // push se activó después de programarlo
  markFired(r.key);
  const reg = await navigator.serviceWorker?.getRegistration();
  const opts: NotificationOptions = { body: r.body, icon: 'icon-192.png', badge: 'icon-192.png', tag: r.key, data: { url: r.url } };
  if (reg) await reg.showNotification(r.title, opts);
  else new Notification(r.title, opts);
}

/** Programa los avisos de las próximas 24 h (incluido el resumen diario). Devuelve una función para pararlo.
 *  Se reprograma cada 10 min. Si los avisos llegan por Web Push no programa nada (evita duplicados). */
export function startReminderLoop(): () => void {
  let timers: ReturnType<typeof setTimeout>[] = [];
  const schedule = async () => {
    timers.forEach(clearTimeout);
    timers = [];
    if (notificationPermission() !== 'granted') return;
    if (await pushDelivering()) return;
    const done = fired();
    const list = [...(await upcomingReminders(1)), ...(await digestReminders(2))]
      .filter((r) => r.at.getTime() - Date.now() < 86400_000);
    for (const r of list) {
      if (done.has(r.key)) continue;
      const delay = r.at.getTime() - Date.now();
      if (delay <= 0) show(r);
      else if (delay < 2 ** 31 - 1) timers.push(setTimeout(() => show(r), delay));
    }
  };
  schedule();
  const interval = setInterval(schedule, 10 * 60000);
  const onVis = () => document.visibilityState === 'visible' && schedule();
  document.addEventListener('visibilitychange', onVis);
  return () => {
    timers.forEach(clearTimeout);
    clearInterval(interval);
    document.removeEventListener('visibilitychange', onVis);
  };
}
