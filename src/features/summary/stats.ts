// Cálculos puros del Resumen semanal (sin React ni Dexie, fáciles de testear).
import { addDays, format, getISOWeek, parseISO, startOfWeek } from 'date-fns';
import type { AgendaItem } from '../../db/types';

const toISO = (d: Date) => format(d, 'yyyy-MM-dd');

export interface WeekRange {
  /** Primer día de la semana 'yyyy-MM-dd' */
  start: string;
  /** Último día de la semana 'yyyy-MM-dd' */
  end: string;
  /** Los 7 días en orden */
  days: string[];
}

/** Semana que contiene `dateISO`. weekStart: 1 = lunes, 0 = domingo. */
export function weekRange(dateISO: string, weekStart: 0 | 1 = 1): WeekRange {
  const first = startOfWeek(parseISO(dateISO), { weekStartsOn: weekStart });
  const days = Array.from({ length: 7 }, (_, i) => toISO(addDays(first, i)));
  return { start: days[0], end: days[6], days };
}

/** Número de semana ISO 8601 (1..53) de una fecha 'yyyy-MM-dd'. */
export function isoWeek(dateISO: string): number {
  return getISOWeek(parseISO(dateISO));
}

/** Número de semana ISO para una semana que puede empezar en domingo (se usa su lunes). */
export function weekNumber(range: WeekRange): number {
  const monday = range.days.find((d) => parseISO(d).getDay() === 1) ?? range.start;
  return isoWeek(monday);
}

/** Cuenta en las estadísticas: todo menos exámenes y clases. */
export const isCountable = (it: AgendaItem) => it.kind !== 'exam' && it.type !== 'examen' && it.type !== 'clase';

export interface SubjectStat {
  /** undefined = sin asignatura */
  subjectId?: string;
  done: number;
  total: number;
  studyMin: number;
}

export interface WeekStats {
  /** Hechas (sin exámenes ni clases) */
  done: number;
  /** No hechas de hoy en adelante */
  pending: number;
  /** No hechas de días ya pasados */
  overdue: number;
  /** Minutos de 'estudio' completados */
  studyMin: number;
  /** Completadas por día ('yyyy-MM-dd' → n) */
  perDay: Record<string, number>;
  /** Por asignatura; las que tienen asignatura primero, "sin asignatura" al final */
  bySubject: SubjectStat[];
  /** Elementos contables (para listas) */
  countable: AgendaItem[];
}

export function computeStats(items: AgendaItem[], today: string = toISO(new Date())): WeekStats {
  const countable = items.filter(isCountable);
  const perDay: Record<string, number> = {};
  const subj = new Map<string, SubjectStat>();
  let done = 0;
  let pending = 0;
  let overdue = 0;
  let studyMin = 0;

  for (const it of countable) {
    const key = it.subjectId ?? '';
    const s = subj.get(key) ?? { subjectId: it.subjectId, done: 0, total: 0, studyMin: 0 };
    s.total++;
    if (it.done) {
      done++;
      s.done++;
      perDay[it.date] = (perDay[it.date] ?? 0) + 1;
      if (it.type === 'estudio') {
        studyMin += it.durationMin ?? 0;
        s.studyMin += it.durationMin ?? 0;
      }
    } else if (it.date < today) {
      overdue++;
    } else {
      pending++;
    }
    subj.set(key, s);
  }

  const bySubject = [...subj.values()].sort((a, b) => Number(!a.subjectId) - Number(!b.subjectId));
  return { done, pending, overdue, studyMin, perDay, bySubject, countable };
}

/** Ruta de detalle de un elemento de agenda. */
export function itemHref(it: Pick<AgendaItem, 'kind' | 'id' | 'type' | 'parentId'>): string {
  if (it.kind === 'exam') return `/examen/${it.id}`;
  if (it.type === 'entrega' && !it.parentId) return `/trabajo/${it.id}`;
  return `/tarea/${it.id}`;
}
