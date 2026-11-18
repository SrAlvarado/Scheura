import type { Exam, Task } from '../db/types';

/** Preparación de un examen: (estudiados + 0,5·para repasar) / total. 0..1 */
export function examProgress(exam: Pick<Exam, 'topics'>): number {
  const t = exam.topics;
  if (!t.length) return 0;
  const score = t.reduce((acc, x) => acc + (x.status === 'estudiado' ? 1 : x.status === 'repasar' ? 0.5 : 0), 0);
  return score / t.length;
}

/** Progreso de un trabajo: pasos hechos / pasos. Sin pasos: 0 ó 1 según esté hecho. */
export function workProgress(parent: Task, steps: Task[]): number {
  if (!steps.length) return parent.done ? 1 : 0;
  return steps.filter((s) => s.done).length / steps.length;
}

export const pct = (p: number) => `${Math.round(p * 100)}%`;
