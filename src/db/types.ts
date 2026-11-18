// Modelo de datos de Scheura. Todo se guarda en IndexedDB (solo en este dispositivo).
// Fechas como 'yyyy-MM-dd' y horas como 'HH:mm' (hora local).

export type ColorKey = 'azul' | 'ambar' | 'verde' | 'lila' | 'rosa' | 'turquesa' | 'teja' | 'grafito';

export interface Subject {
  id: string;
  /** ms de la última modificación local (lo pone db.ts; se usa para sincronizar) */
  updatedAt?: number;
  name: string;
  color: ColorKey;
  teacher?: string;
  room?: string;
  archived?: boolean;
  createdAt: number;
}

export type TaskType = 'tarea' | 'examen' | 'entrega' | 'estudio' | 'clase';
export type Priority = 'baja' | 'media' | 'alta';

/**
 * Recordatorio relativo al momento de la tarea/examen.
 * - kind 'before': `minutes` antes de la fecha+hora (si no hay hora se usa 09:00).
 * - kind 'dayAt': `days` días antes, a la hora `time` (days=0 → el mismo día).
 */
export type Reminder =
  | { id: string; kind: 'before'; minutes: number }
  | { id: string; kind: 'dayAt'; days: number; time: string };

export interface Repeat {
  freq: 'none' | 'weekly';
  /** 0 = lunes … 6 = domingo */
  days: number[];
  /** Fecha límite opcional 'yyyy-MM-dd' */
  until?: string;
}

export interface Task {
  id: string;
  /** ms de la última modificación local (lo pone db.ts; se usa para sincronizar) */
  updatedAt?: number;
  title: string;
  description?: string;
  date?: string; // yyyy-MM-dd (sin fecha = bandeja)
  time?: string; // HH:mm
  subjectId?: string;
  type: TaskType;
  priority: Priority;
  durationMin?: number;
  done: boolean;
  doneAt?: number;
  /** Para tareas repetidas: ocurrencias completadas ('yyyy-MM-dd') */
  doneDates?: string[];
  /** Ocurrencias de una repetición que se han saltado/eliminado */
  skipDates?: string[];
  reminders: Reminder[];
  repeat?: Repeat;
  /** Paso de un trabajo (entrega) → id de la tarea padre */
  parentId?: string;
  /** Orden del paso dentro del trabajo */
  order?: number;
  /** Sesión de estudio vinculada a un examen / tema */
  examId?: string;
  topicId?: string;
  notes?: string;
  createdAt: number;
}

export type TopicStatus = 'pendiente' | 'repasar' | 'estudiado';

export interface Topic {
  id: string;
  name: string;
  status: TopicStatus;
}

export interface Exam {
  id: string;
  /** ms de la última modificación local (lo pone db.ts; se usa para sincronizar) */
  updatedAt?: number;
  subjectId?: string;
  title: string;
  date: string;
  time?: string;
  room?: string;
  topics: Topic[];
  reminders: Reminder[];
  notes?: string;
  createdAt: number;
}

export interface Extracted {
  topics: string[];
  concepts: { term: string; def: string }[];
  dates: { date: string; text: string; page?: number }[];
  summary: string;
}

export type OwnerType = 'task' | 'exam' | 'subject';

export interface Attachment {
  id: string;
  /** ms de la última modificación local (lo pone db.ts; se usa para sincronizar) */
  updatedAt?: number;
  ownerType: OwnerType;
  ownerId: string;
  name: string;
  mime: string;
  size: number;
  pages?: number;
  blob: Blob;
  extracted?: Extracted;
  addedAt: number;
}

export interface Settings {
  id: 'app';
  updatedAt?: number;
  /** Mostrar el título de la tarea en los avisos push (si no, texto genérico) */
  pushShowTitles?: boolean;
  weekStart: 0 | 1; // 1 = lunes
  calendarView: 'mes' | 'semana';
  daySort: 'hora' | 'importancia';
  defaultDuration: number;
  hideDone: boolean;
  dailyDigest: boolean;
  dailyDigestTime: string;
  weeklySummary: boolean;
  onboarded: boolean;
  /** Recordatorios por defecto por tipo */
  defaultReminders: Record<TaskType, Reminder[]>;
}

/** Elemento de agenda ya expandido (incluye ocurrencias de repeticiones y exámenes). */
export interface AgendaItem {
  key: string; // único por ocurrencia
  kind: 'task' | 'exam';
  id: string; // id de Task o Exam
  title: string;
  date: string;
  time?: string;
  type: TaskType;
  priority: Priority;
  durationMin?: number;
  subjectId?: string;
  done: boolean;
  repeating: boolean;
  parentId?: string;
  /** progreso 0..1 para exámenes y trabajos */
  progress?: number;
}

/** Registro de borrado para propagar eliminaciones al sincronizar. key = `${table}:${id}` */
export interface Tombstone {
  key: string;
  table: string;
  id: string;
  deletedAt: number;
}

/** Valores internos (estado de sincronización, id de dispositivo…). */
export interface Meta {
  key: string;
  value: unknown;
}
