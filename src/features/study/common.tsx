// Utilidades locales del área Estudio.
import { useLiveQuery } from 'dexie-react-hooks';
import type { ReactNode } from 'react';
import { db } from '../../db/db';
import type { Exam, Task, TopicStatus } from '../../db/types';
import { capitalize, daysUntil, fmt } from '../../lib/dates';

/** Examen por id: undefined mientras carga, null si no existe. */
export const useExamOrNull = (id?: string): Exam | null | undefined =>
  useLiveQuery(async () => (id ? (await db.exams.get(id)) ?? null : null), [id]);

/** Tarea por id: undefined mientras carga, null si no existe. */
export const useTaskOrNull = (id?: string): Task | null | undefined =>
  useLiveQuery(async () => (id ? (await db.tasks.get(id)) ?? null : null), [id]);

/** Todas las tareas / exámenes (undefined mientras carga). */
export const useTasksLive = () => useLiveQuery(() => db.tasks.toArray(), []);
export const useExamsLive = () => useLiveQuery(() => db.exams.orderBy('date').toArray(), []);

/** "Mié 18" */
export const shortDay = (d: string) => capitalize(fmt(d, 'EEE d').replace('.', ''));
/** "Mié" */
export const dow = (d: string) => capitalize(fmt(d, 'EEE').replace('.', ''));

/** Etiqueta de cuenta atrás grande: número + unidad. */
export function countdown(date: string): { n: string; unit: string } {
  const n = daysUntil(date);
  if (n === 0) return { n: 'Hoy', unit: 'es el examen' };
  if (n === 1) return { n: '1', unit: 'día' };
  if (n < 0) return { n: String(-n), unit: n === -1 ? 'día desde el examen' : 'días desde el examen' };
  return { n: String(n), unit: 'días' };
}

export const TOPIC_COLOR: Record<TopicStatus, string> = {
  estudiado: 'var(--pink)',
  repasar: 'rgba(216, 27, 96, .5)',
  pendiente: '#e6e6e6',
};

export function topicSummary(topics: { status: TopicStatus }[]): string {
  if (!topics.length) return 'Sin temas';
  const est = topics.filter((t) => t.status === 'estudiado').length;
  const rep = topics.filter((t) => t.status === 'repasar').length;
  return `${est} de ${topics.length} temas estudiados${rep ? ` · ${rep} para repasar` : ''}`;
}

export function SectionHead({ title, aside, id }: { title: ReactNode; aside?: ReactNode; id?: string }) {
  return (
    <div className="st-sechead">
      <h2 id={id}>{title}</h2>
      {aside && <div className="st-sechead__aside">{aside}</div>}
    </div>
  );
}

/** Barra segmentada (un segmento por elemento). */
export function SegBar({ colors, thick }: { colors: string[]; thick?: boolean }) {
  if (!colors.length) return null;
  return (
    <div className={`st-segbar${thick ? ' st-segbar--thick' : ''}`} aria-hidden="true">
      {colors.map((c, i) => <span key={i} style={{ background: c }} />)}
    </div>
  );
}

/** Notas que se guardan al salir del campo. */
export function NotesField({ id, value, onSave }: { id: string; value?: string; onSave: (v: string) => void }) {
  return (
    <section className="st-section">
      <label htmlFor={`notas-${id}`} className="st-sechead"><h2>Notas</h2></label>
      <textarea
        key={id}
        id={`notas-${id}`}
        className="st-notes"
        rows={4}
        placeholder="Escribe aquí lo que no quieras olvidar…"
        defaultValue={value ?? ''}
        onBlur={(e) => {
          const v = e.target.value;
          if (v !== (value ?? '')) onSave(v);
        }}
      />
    </section>
  );
}
