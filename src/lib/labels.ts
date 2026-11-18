import type { Priority, Reminder, TaskType, TopicStatus } from '../db/types';

export const TYPE_LABEL: Record<TaskType, string> = {
  tarea: 'Tarea',
  examen: 'Examen',
  entrega: 'Entrega',
  estudio: 'Estudio',
  clase: 'Clase',
};
export const TYPES: TaskType[] = ['tarea', 'examen', 'entrega', 'estudio', 'clase'];

export const PRIORITY_LABEL: Record<Priority, string> = { baja: 'Baja', media: 'Media', alta: 'Alta' };
export const PRIORITY_RANK: Record<Priority, number> = { alta: 0, media: 1, baja: 2 };

export const TOPIC_LABEL: Record<TopicStatus, string> = {
  pendiente: 'Pendiente',
  repasar: 'Para repasar',
  estudiado: 'Estudiado',
};
export const nextTopicStatus = (s: TopicStatus): TopicStatus =>
  s === 'pendiente' ? 'repasar' : s === 'repasar' ? 'estudiado' : 'pendiente';

export function reminderLabel(r: Reminder): string {
  if (r.kind === 'before') {
    if (r.minutes < 60) return `${r.minutes} min antes`;
    if (r.minutes % 10080 === 0) {
      const w = r.minutes / 10080;
      return w === 1 ? '1 semana antes' : `${w} semanas antes`;
    }
    if (r.minutes % 1440 === 0) {
      const d = r.minutes / 1440;
      return d === 1 ? '1 día antes' : `${d} días antes`;
    }
    const h = r.minutes / 60;
    return h === 1 ? '1 h antes' : `${h} h antes`;
  }
  if (r.days === 0) return `El mismo día ${r.time}`;
  if (r.days === 1) return `El día anterior ${r.time}`;
  return `${r.days} días antes ${r.time}`;
}
