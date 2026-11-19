// Eventos generales del calendario (cumpleaños, citas, médico…): categorías, colores y textos.
import type { AgendaItem, ColorKey, EventCategory, Repeat, Subject, Task } from '../db/types';
import { SUBJECT_COLORS } from './colors';
import { WEEKDAYS, daysInMonthOf, fmt, longDay } from './dates';

export interface CategoryInfo { key: EventCategory; label: string; emoji: string; color: ColorKey }

export const EVENT_CATEGORIES: CategoryInfo[] = [
  { key: 'cumple', label: 'Cumpleaños', emoji: '🎂', color: 'rosa' },
  { key: 'cita', label: 'Cita', emoji: '📍', color: 'lila' },
  { key: 'medico', label: 'Médico', emoji: '🩺', color: 'turquesa' },
  { key: 'quedada', label: 'Quedada', emoji: '🎉', color: 'ambar' },
  { key: 'viaje', label: 'Viaje', emoji: '✈️', color: 'azul' },
  { key: 'deporte', label: 'Deporte', emoji: '🏃', color: 'verde' },
  { key: 'otro', label: 'Otro', emoji: '⭐', color: 'teja' },
];
const BY_KEY = new Map(EVENT_CATEGORIES.map((c) => [c.key, c]));
export const categoryInfo = (k?: EventCategory): CategoryInfo => BY_KEY.get(k ?? 'otro') ?? EVENT_CATEGORIES[EVENT_CATEGORIES.length - 1];

export const isEvent = (t: { type: string }) => t.type === 'evento';

/** Colores de un elemento de agenda: categoría para eventos, asignatura para el resto, gris si nada. */
export function itemColors(it: Pick<AgendaItem, 'type' | 'subjectId' | 'category'>, subjects: Map<string, Subject>) {
  if (it.type === 'evento') return SUBJECT_COLORS[categoryInfo(it.category).color];
  const s = it.subjectId ? subjects.get(it.subjectId) : undefined;
  return s ? SUBJECT_COLORS[s.color] : { name: '', bg: '#F0F0F0', fg: '#424242', dot: '#BDBDBD' };
}

/** "Cumpleaños · Bar Luna" */
export const eventMeta = (it: Pick<AgendaItem, 'category' | 'location'>) =>
  [categoryInfo(it.category).label, it.location].filter(Boolean).join(' · ');

/** Minutos entre dos horas 'HH:mm' (si fin ≤ inicio, se entiende que acaba al día siguiente). */
export function minutesBetween(start: string, end: string): number {
  const toM = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const d = toM(end) - toM(start);
  return d > 0 ? d : d + 1440;
}

/** ¿Ocurre una tarea/evento repetido en `date`? (no mira skipDates/until; eso lo hace repo) */
export function repeatHits(rep: Repeat, start: string, date: string, weekday: number): boolean {
  if (rep.freq === 'weekly') return rep.days.includes(weekday);
  const sd = Number(start.slice(8, 10));
  const dd = Number(date.slice(8, 10));
  // Si el día no existe ese mes (31, 29 de febrero…), cae en el último día del mes.
  const dim = daysInMonthOf(date);
  const hitsDay = dd === Math.min(sd, dim);
  if (rep.freq === 'monthly') return hitsDay;
  if (rep.freq === 'yearly') return start.slice(5, 7) === date.slice(5, 7) && hitsDay;
  return false;
}

export function repeatLabel(t: Pick<Task, 'repeat' | 'date'>): string {
  const r = t.repeat;
  if (!r || r.freq === 'none') return 'No se repite';
  const until = r.until ? ` · hasta ${longDay(r.until).toLowerCase()}` : '';
  if (r.freq === 'yearly') return `Cada año${t.date ? `, el ${fmt(t.date, "d 'de' MMMM")}` : ''}${until}`;
  if (r.freq === 'monthly') return `Cada mes${t.date ? `, el día ${Number(t.date.slice(8, 10))}` : ''}${until}`;
  if (!r.days.length) return 'No se repite';
  return `Cada semana: ${[...r.days].sort().map((d) => WEEKDAYS[d].toLowerCase()).join(', ')}${until}`;
}
