// Operaciones de datos compartidas por todas las pantallas.
import { db, getSettings } from './db';
import type { AgendaItem, Exam, Task, TaskType, Topic } from './types';
import { uid } from '../lib/id';
import { addDaysISO, todayISO, weekdayMon0 } from '../lib/dates';
import { examProgress, workProgress } from '../lib/progress';

// ---------- Tareas ----------

export async function createTask(data: Partial<Task> & { title: string }): Promise<string> {
  const settings = await getSettings();
  const type: TaskType = data.type ?? 'tarea';
  const task: Task = {
    id: uid(),
    type,
    priority: 'media',
    done: false,
    reminders: data.reminders ?? settings.defaultReminders[type].map((r) => ({ ...r, id: uid() })),
    createdAt: Date.now(),
    ...data,
  };
  await db.tasks.add(task);
  return task.id;
}

export const updateTask = (id: string, patch: Partial<Task>) => db.tasks.update(id, patch);

/** Elimina una tarea y sus pasos/adjuntos. */
export async function deleteTask(id: string) {
  await db.transaction('rw', db.tasks, db.attachments, async () => {
    const steps = await db.tasks.where('parentId').equals(id).primaryKeys();
    await db.tasks.bulkDelete([id, ...steps]);
    await db.attachments.where('ownerId').anyOf([id, ...steps]).delete();
  });
}

/** Completa / descompleta. Para repetidas, solo la ocurrencia `date`. */
export async function setTaskDone(id: string, done: boolean, date?: string) {
  const t = await db.tasks.get(id);
  if (!t) return;
  if (t.repeat && t.repeat.freq !== 'none' && date) {
    const set = new Set(t.doneDates ?? []);
    if (done) set.add(date);
    else set.delete(date);
    await db.tasks.update(id, { doneDates: [...set] });
  } else {
    await db.tasks.update(id, { done, doneAt: done ? Date.now() : undefined });
  }
}

/**
 * Mueve una tarea (o una ocurrencia de una repetida: crea copia suelta y salta la original).
 * Devuelve el id de la tarea en su nueva fecha (la copia, si era repetida).
 */
export async function moveTask(id: string, toDate: string, fromDate?: string): Promise<string | undefined> {
  const t = await db.tasks.get(id);
  if (!t) return undefined;
  if (t.repeat && t.repeat.freq !== 'none' && fromDate) {
    await db.tasks.update(id, { skipDates: [...(t.skipDates ?? []), fromDate] });
    const { id: _old, repeat: _r, doneDates: _d, skipDates: _s, ...rest } = t;
    const newId = uid();
    await db.tasks.add({ ...rest, id: newId, date: toDate, done: false, createdAt: Date.now() });
    return newId;
  }
  await db.tasks.update(id, { date: toDate });
  return id;
}

/** Tareas atrasadas: con fecha < hoy, no hechas, no repetidas, no clases. */
export async function overdueTasks(): Promise<Task[]> {
  const today = todayISO();
  const all = await db.tasks.where('date').below(today).toArray();
  return all.filter((t) => !t.done && (!t.repeat || t.repeat.freq === 'none') && t.type !== 'clase');
}

// ---------- Exámenes ----------

export async function createExam(data: Partial<Exam> & { title: string; date: string }): Promise<string> {
  const settings = await getSettings();
  const exam: Exam = {
    id: uid(),
    topics: [],
    reminders: settings.defaultReminders.examen.map((r) => ({ ...r, id: uid() })),
    createdAt: Date.now(),
    ...data,
  };
  await db.exams.add(exam);
  return exam.id;
}

export const updateExam = (id: string, patch: Partial<Exam>) => db.exams.update(id, patch);

export async function deleteExam(id: string) {
  await db.transaction('rw', db.exams, db.tasks, db.attachments, async () => {
    await db.exams.delete(id);
    await db.tasks.where('examId').equals(id).delete();
    await db.attachments.where('ownerId').equals(id).delete();
  });
}

export async function setTopic(examId: string, topicId: string, patch: Partial<Topic>) {
  const e = await db.exams.get(examId);
  if (!e) return;
  await db.exams.update(examId, { topics: e.topics.map((t) => (t.id === topicId ? { ...t, ...patch } : t)) });
}

/**
 * Reparte sesiones de estudio de 1 h en los días anteriores al examen:
 * un tema por día empezando `daysBefore` días antes; los últimos días, repaso general.
 * Sustituye las sesiones automáticas no hechas que existan.
 */
export async function autoPlanExam(examId: string, opts: { daysBefore?: number; time?: string; minutes?: number } = {}) {
  const e = await db.exams.get(examId);
  if (!e) return;
  const daysBefore = opts.daysBefore ?? 6;
  const time = opts.time ?? '18:30';
  const minutes = opts.minutes ?? 60;
  const today = todayISO();
  const old = await db.tasks.where('examId').equals(examId).toArray();
  await db.tasks.bulkDelete(old.filter((t) => !t.done && t.type === 'estudio').map((t) => t.id));
  const pending = e.topics.filter((t) => t.status !== 'estudiado');
  const days: string[] = [];
  for (let i = daysBefore; i >= 1; i--) {
    const d = addDaysISO(e.date, -i);
    if (d >= today) days.push(d);
  }
  const sessions: Task[] = days.map((d, i) => {
    const topic = pending[i];
    return {
      id: uid(),
      title: topic ? `${topic.status === 'repasar' ? 'Repasar' : 'Estudiar'}: ${topic.name}` : 'Repaso general',
      type: 'estudio',
      priority: 'media',
      date: d,
      time,
      durationMin: minutes,
      subjectId: e.subjectId,
      examId,
      topicId: topic?.id,
      done: false,
      reminders: [{ id: uid(), kind: 'before', minutes: 15 }],
      createdAt: Date.now(),
    };
  });
  await db.tasks.bulkAdd(sessions);
}

// ---------- Agenda ----------

function occursOn(t: Task, date: string): boolean {
  if (!t.repeat || t.repeat.freq === 'none') return t.date === date;
  if (!t.date || date < t.date) return false;
  if (t.repeat.until && date > t.repeat.until) return false;
  if (t.skipDates?.includes(date)) return false;
  return t.repeat.days.includes(weekdayMon0(date));
}

/**
 * Expande tareas (incluidas repeticiones) y exámenes en elementos de agenda para un rango [from, to].
 * Los pasos de trabajos aparecen como tareas normales; los trabajos llevan su progreso.
 */
export function buildAgenda(tasks: Task[], exams: Exam[], from: string, to: string): AgendaItem[] {
  const items: AgendaItem[] = [];
  const stepsByParent = new Map<string, Task[]>();
  for (const t of tasks) if (t.parentId) stepsByParent.set(t.parentId, [...(stepsByParent.get(t.parentId) ?? []), t]);

  for (const t of tasks) {
    const repeating = !!t.repeat && t.repeat.freq !== 'none';
    if (!repeating) {
      if (!t.date || t.date < from || t.date > to) continue;
      items.push(toItem(t, t.date, false, stepsByParent));
    } else {
      for (let d = from; d <= to; d = addDaysISO(d, 1)) if (occursOn(t, d)) items.push(toItem(t, d, true, stepsByParent));
    }
  }
  for (const e of exams) {
    if (e.date < from || e.date > to) continue;
    items.push({
      key: `exam:${e.id}`,
      kind: 'exam',
      id: e.id,
      title: e.title,
      date: e.date,
      time: e.time,
      type: 'examen',
      priority: 'alta',
      subjectId: e.subjectId,
      done: false,
      repeating: false,
      progress: examProgress(e),
    });
  }
  return items.sort(byTime);
}

function toItem(t: Task, date: string, repeating: boolean, steps: Map<string, Task[]>): AgendaItem {
  const done = repeating ? !!t.doneDates?.includes(date) : t.done;
  return {
    key: repeating ? `${t.id}@${date}` : t.id,
    kind: 'task',
    id: t.id,
    title: t.title,
    date,
    time: t.time,
    type: t.type,
    priority: t.priority,
    durationMin: t.durationMin,
    subjectId: t.subjectId,
    done,
    repeating,
    parentId: t.parentId,
    progress: t.type === 'entrega' && !t.parentId ? workProgress(t, steps.get(t.id) ?? []) : undefined,
  };
}

export function byTime(a: AgendaItem, b: AgendaItem) {
  return a.date.localeCompare(b.date) || (a.time ?? '99').localeCompare(b.time ?? '99');
}

const RANK = { alta: 0, media: 1, baja: 2 } as const;
export function byImportance(a: AgendaItem, b: AgendaItem) {
  const ta = a.type === 'examen' || a.type === 'entrega' ? -1 : 0;
  const tb = b.type === 'examen' || b.type === 'entrega' ? -1 : 0;
  return ta - tb || RANK[a.priority] - RANK[b.priority] || byTime(a, b);
}
