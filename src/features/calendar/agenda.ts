// Utilidades compartidas por Hoy, Calendario y Día.
import { useEffect, useMemo, useState } from 'react';
import type { AgendaItem, Exam, Subject, Task, TaskType } from '../../db/types';
import { byImportance, byTime } from '../../db/repo';
import { useAllExams, useAllTasks } from '../../db/hooks';
import { fmtDuration } from '../../lib/dates';
import { PRIORITY_LABEL, TYPE_LABEL, isNotTodo } from '../../lib/labels';
import { categoryInfo, eventMeta, itemColors } from '../../lib/events';

export const PINK = '#D81B60';

/** Ruta de detalle de un elemento de agenda. */
export function itemHref(it: AgendaItem): string {
  if (it.kind === 'exam') return `/examen/${it.id}`;
  if (it.type === 'evento') return `/evento/${it.id}${it.repeating ? `?fecha=${it.date}` : ''}`;
  if (it.type === 'entrega' && !it.parentId) return `/trabajo/${it.id}`;
  return `/tarea/${it.id}`;
}

/** Examen o trabajo (entrega sin padre). */
export const isKey = (it: AgendaItem) => it.kind === 'exam' || (it.type === 'entrega' && !it.parentId);
export const keyLabel = (it: AgendaItem) => (it.kind === 'exam' ? 'EXAMEN' : 'ENTREGA');

/** Abierto e importante: alta prioridad, examen o entrega. */
export const isHigh = (it: AgendaItem) => !it.done && (it.priority === 'alta' || it.kind === 'exam' || it.type === 'entrega');

/** Atrasada: tarea no hecha de un día pasado (clases y eventos no cuentan). */
export const isLate = (it: AgendaItem, today: string) =>
  it.kind === 'task' && !it.done && it.date < today && !isNotTodo(it.type);

/** Cosa por hacer pendiente (no exámenes, clases ni eventos). */
export const isPendingTodo = (it: AgendaItem) => it.kind === 'task' && !it.done && !isNotTodo(it.type);

export type SortMode = 'hora' | 'importancia';
export const sortItems = (items: AgendaItem[], mode: SortMode) => [...items].sort(mode === 'hora' ? byTime : byImportance);

export const minutesOf = (time: string) => {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
};

/** Colores de puntos para un día: rosa para exámenes/entregas, color de asignatura para el resto. Máx. 3. */
export function dayDots(items: AgendaItem[], subjects: Map<string, Subject>, max = 3): string[] {
  const out: string[] = [];
  const sorted = [...items].sort((a, b) => Number(b.type === 'examen' || b.type === 'entrega') - Number(a.type === 'examen' || a.type === 'entrega'));
  for (const it of sorted) {
    const c = it.type === 'examen' || it.type === 'entrega' ? PINK : itemColors(it, subjects).dot;
    if (!out.includes(c)) out.push(c);
    if (out.length >= max) break;
  }
  return out;
}

export function groupByDate(items: AgendaItem[]): Map<string, AgendaItem[]> {
  const m = new Map<string, AgendaItem[]>();
  for (const it of items) m.set(it.date, [...(m.get(it.date) ?? []), it]);
  return m;
}

/** Información de pasos (para "Paso 2 de 4") y de temas de exámenes. */
export interface Context {
  steps: Map<string, { done: number; total: number }>;
  stepIndex: Map<string, number>;
  exams: Map<string, Exam>;
  tasks: Map<string, Task>;
}

export function useAgendaContext(): Context {
  const tasks = useAllTasks();
  const exams = useAllExams();
  return useMemo(() => {
    const byParent = new Map<string, Task[]>();
    for (const t of tasks) if (t.parentId) byParent.set(t.parentId, [...(byParent.get(t.parentId) ?? []), t]);
    const steps = new Map<string, { done: number; total: number }>();
    const stepIndex = new Map<string, number>();
    for (const [pid, list] of byParent) {
      list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      steps.set(pid, { done: list.filter((s) => s.done).length, total: list.length });
      list.forEach((s, i) => stepIndex.set(s.id, i + 1));
    }
    return { steps, stepIndex, exams: new Map(exams.map((e) => [e.id, e])), tasks: new Map(tasks.map((t) => [t.id, t])) };
  }, [tasks, exams]);
}

/** "Paso 2 de 4" o el tipo. */
export function typeOrStep(it: AgendaItem, ctx: Context): string {
  if (it.parentId) {
    const info = ctx.steps.get(it.parentId);
    const idx = ctx.stepIndex.get(it.id);
    if (info && idx) return `Paso ${idx} de ${info.total}`;
    return 'Paso';
  }
  if (it.type === 'evento') return categoryInfo(it.category).label;
  return TYPE_LABEL[it.type];
}

/** asignatura · tipo/paso · duración (· Alta) */
export function itemMeta(it: AgendaItem, ctx: Context, subjects: Map<string, Subject>, withSubject = true): string {
  if (it.type === 'evento') return [eventMeta(it), fmtDuration(it.durationMin) || undefined].filter(Boolean).join(' · ');
  const s = it.subjectId ? subjects.get(it.subjectId) : undefined;
  const parts = [withSubject ? s?.name : undefined, typeOrStep(it, ctx), fmtDuration(it.durationMin) || undefined];
  if (it.priority === 'alta' && it.kind === 'task' && it.type !== 'entrega') parts.push(PRIORITY_LABEL.alta);
  return parts.filter(Boolean).join(' · ');
}

/** Texto del progreso de un examen o trabajo. */
export function progressLabel(it: AgendaItem, ctx: Context): string {
  if (it.kind === 'exam') {
    const e = ctx.exams.get(it.id);
    if (!e || !e.topics.length) return 'sin temas aún';
    const n = e.topics.filter((t) => t.status === 'estudiado').length;
    return `preparado · ${n} de ${e.topics.length} temas estudiados`;
  }
  const info = ctx.steps.get(it.id);
  if (!info) return it.done ? 'entregado' : 'sin pasos';
  return `${info.done} de ${info.total} pasos`;
}

// ---------- Filtros ----------

export type StateFilter = 'pendiente' | 'hecha' | 'atrasada';
export interface Filters {
  subjects: string[];
  types: TaskType[];
  states: StateFilter[];
}
export const EMPTY_FILTERS: Filters = { subjects: [], types: [], states: [] };
export const STATE_LABEL: Record<StateFilter, string> = { pendiente: 'Pendiente', hecha: 'Hecha', atrasada: 'Atrasada' };
export const STATES: StateFilter[] = ['pendiente', 'hecha', 'atrasada'];

export const activeCount = (f: Filters) => f.subjects.length + f.types.length + f.states.length;

export function stateOf(it: AgendaItem, today: string): StateFilter {
  if (it.kind === 'exam') return it.date < today ? 'hecha' : 'pendiente';
  if (it.done) return 'hecha';
  return isLate(it, today) ? 'atrasada' : 'pendiente';
}

export function matches(it: AgendaItem, f: Filters, today: string): boolean {
  if (f.subjects.length && !(it.subjectId && f.subjects.includes(it.subjectId))) return false;
  if (f.types.length && !f.types.includes(it.type)) return false;
  if (f.states.length && !f.states.includes(stateOf(it, today))) return false;
  return true;
}

const FILTER_KEY = 'scheura.calendar.filters';

function readFilters(): Filters {
  try {
    const raw = sessionStorage.getItem(FILTER_KEY);
    if (!raw) return EMPTY_FILTERS;
    const p = JSON.parse(raw) as Partial<Filters>;
    return {
      subjects: Array.isArray(p.subjects) ? p.subjects : [],
      types: Array.isArray(p.types) ? p.types : [],
      states: Array.isArray(p.states) ? p.states : [],
    };
  } catch {
    return EMPTY_FILTERS;
  }
}

/** Filtros del calendario en estado + sessionStorage (se conservan durante la sesión). */
export function useFilters() {
  const [filters, setFilters] = useState<Filters>(readFilters);
  useEffect(() => {
    try {
      sessionStorage.setItem(FILTER_KEY, JSON.stringify(filters));
    } catch {
      /* sin almacenamiento: solo en memoria */
    }
  }, [filters]);
  return [filters, setFilters] as const;
}

export function toggleIn<T>(list: T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

// ---------- Medios ----------

export function useMediaQuery(q: string): boolean {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [q]);
  return m;
}

export const useIsDesktop = () => useMediaQuery('(min-width: 900px)');

/** Minutos desde medianoche, actualizado cada minuto. */
export function useNowMinutes(): number {
  const get = () => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  };
  const [n, setN] = useState(get);
  useEffect(() => {
    const t = setInterval(() => setN(get()), 60_000);
    return () => clearInterval(t);
  }, []);
  return n;
}
