// Recordatorios locales.
// Limitación de una PWA sin servidor: los avisos se programan mientras la app está abierta o en segundo plano reciente
// (y al abrirla se muestran los que hayan vencido en la última hora). Para avisos con la app cerrada hace falta
// Web Push con un servidor (sprint futuro). En iPhone, además, la app debe estar añadida a la pantalla de inicio (iOS 16.4+).
import { db } from '../db/db';
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
  if (notificationPermission() !== 'granted') return;
  markFired(r.key);
  const reg = await navigator.serviceWorker?.getRegistration();
  const opts: NotificationOptions = { body: r.body, icon: 'icon-192.png', badge: 'icon-192.png', tag: r.key, data: { url: r.url } };
  if (reg) await reg.showNotification(r.title, opts);
  else new Notification(r.title, opts);
}

/** Programa los avisos de las próximas 24 h. Devuelve una función para pararlo. Se reprograma cada 10 min. */
export function startReminderLoop(): () => void {
  let timers: ReturnType<typeof setTimeout>[] = [];
  const schedule = async () => {
    timers.forEach(clearTimeout);
    timers = [];
    if (notificationPermission() !== 'granted') return;
    const done = fired();
    const list = await upcomingReminders(1);
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
