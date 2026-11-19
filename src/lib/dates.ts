import { addDays, differenceInCalendarDays, format, getDaysInMonth, parseISO, startOfWeek } from 'date-fns';
import { es } from 'date-fns/locale';

/** 'yyyy-MM-dd' de hoy en hora local */
export const todayISO = () => format(new Date(), 'yyyy-MM-dd');
export const toISO = (d: Date) => format(d, 'yyyy-MM-dd');
export const fromISO = (s: string) => parseISO(s);
export const addDaysISO = (s: string, n: number) => toISO(addDays(parseISO(s), n));

/** Días del mes de una fecha 'yyyy-MM-dd' */
export const daysInMonthOf = (s: string) => getDaysInMonth(parseISO(s));

/** 0 = lunes … 6 = domingo */
export const weekdayMon0 = (s: string) => (parseISO(s).getDay() + 6) % 7;

export const weekStartISO = (s: string, weekStart: 0 | 1 = 1) =>
  toISO(startOfWeek(parseISO(s), { weekStartsOn: weekStart }));

export const daysUntil = (s: string) => differenceInCalendarDays(parseISO(s), new Date());

/** "en 6 días", "mañana", "hoy", "hace 2 días" */
export function relDays(s: string): string {
  const n = daysUntil(s);
  if (n === 0) return 'hoy';
  if (n === 1) return 'mañana';
  if (n === -1) return 'ayer';
  if (n > 1) return `en ${n} días`;
  return `hace ${-n} días`;
}

/** Formatos en español: fmt('2026-11-18', "EEEE d 'de' MMMM") */
export const fmt = (s: string, pattern: string) => format(parseISO(s), pattern, { locale: es });

export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "Miércoles 18 nov" */
export const longDay = (s: string) => capitalize(fmt(s, "EEEE d MMM").replace('.', ''));

export const WEEKDAYS_SHORT = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
export const WEEKDAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

/** Minutos → "1 h 30 min" */
export function fmtDuration(min?: number): string {
  if (!min) return '';
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** Fecha+hora → Date local (sin hora: 09:00) */
export function toDateTime(date: string, time?: string): Date {
  const [h, m] = (time ?? '09:00').split(':').map(Number);
  const d = parseISO(date);
  d.setHours(h, m, 0, 0);
  return d;
}
