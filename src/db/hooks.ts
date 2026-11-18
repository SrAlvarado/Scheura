import { useLiveQuery } from 'dexie-react-hooks';
import { db, DEFAULT_SETTINGS } from './db';
import { buildAgenda } from './repo';
import type { AgendaItem, Attachment, Exam, Settings, Subject, Task } from './types';

/** Todas las asignaturas no archivadas (o todas con includeArchived). */
export function useSubjects(includeArchived = false): Subject[] {
  return (
    useLiveQuery(async () => {
      const all = await db.subjects.orderBy('name').toArray();
      return includeArchived ? all : all.filter((s) => !s.archived);
    }, [includeArchived]) ?? []
  );
}

/** Mapa id → asignatura (incluye archivadas para pintar tareas antiguas). */
export function useSubjectMap(): Map<string, Subject> {
  const all = useSubjects(true);
  return new Map(all.map((s) => [s.id, s]));
}

export const useTask = (id?: string) => useLiveQuery(() => (id ? db.tasks.get(id) : undefined), [id]);
export const useExam = (id?: string) => useLiveQuery(() => (id ? db.exams.get(id) : undefined), [id]);

export const useAllTasks = (): Task[] => useLiveQuery(() => db.tasks.toArray(), []) ?? [];
export const useAllExams = (): Exam[] => useLiveQuery(() => db.exams.orderBy('date').toArray(), []) ?? [];

/** Pasos de un trabajo ordenados. */
export const useSteps = (parentId?: string): Task[] =>
  useLiveQuery(
    async () => (parentId ? (await db.tasks.where('parentId').equals(parentId).toArray()).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)) : []),
    [parentId],
  ) ?? [];

/** Sesiones de estudio de un examen ordenadas por fecha. */
export const useExamSessions = (examId?: string): Task[] =>
  useLiveQuery(
    async () => (examId ? (await db.tasks.where('examId').equals(examId).toArray()).sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '')) : []),
    [examId],
  ) ?? [];

export const useAttachments = (ownerId?: string): Attachment[] =>
  useLiveQuery(async () => (ownerId ? db.attachments.where('ownerId').equals(ownerId).toArray() : []), [ownerId]) ?? [];

export const useAttachment = (id?: string) => useLiveQuery(() => (id ? db.attachments.get(id) : undefined), [id]);

export function useSettings(): Settings {
  return useLiveQuery(async () => ({ ...DEFAULT_SETTINGS, ...(await db.settings.get('app')) }), []) ?? DEFAULT_SETTINGS;
}

/** Agenda expandida para [from, to] (incluye repeticiones y exámenes). undefined mientras carga. */
export function useAgenda(from: string, to: string): AgendaItem[] | undefined {
  return useLiveQuery(async () => {
    const [tasks, exams] = await Promise.all([db.tasks.toArray(), db.exams.toArray()]);
    return buildAgenda(tasks, exams, from, to);
  }, [from, to]);
}
