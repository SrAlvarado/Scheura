// Datos de ejemplo relativos a hoy (para probar la app o enseñarla). Se cargan desde Bienvenida/Ajustes.
import { db } from './db';
import type { Exam, Subject, Task } from './types';
import { uid } from '../lib/id';
import { addDaysISO, todayISO, weekdayMon0 } from '../lib/dates';

export async function loadDemoData() {
  const today = todayISO();
  const d = (n: number) => addDaysISO(today, n);
  const now = Date.now();
  const s = (name: string, color: Subject['color']): Subject => ({ id: uid(), name, color, createdAt: now });
  const mat = s('Matemáticas', 'azul');
  const his = s('Historia', 'ambar');
  const bio = s('Biología', 'verde');
  const ing = s('Inglés', 'lila');

  const base = (t: Partial<Task> & { title: string }): Task => ({
    id: uid(), type: 'tarea', priority: 'media', done: false, reminders: [{ id: uid(), kind: 'before', minutes: 60 }], createdAt: now, ...t,
  });

  const exam: Exam = {
    id: uid(), subjectId: bio.id, title: 'Examen parcial 2', date: d(6), time: '10:00', room: 'Aula 2.3', createdAt: now,
    topics: [
      { id: uid(), name: 'Tema 4 · La célula eucariota', status: 'estudiado' },
      { id: uid(), name: 'Tema 5 · Mitosis y meiosis', status: 'repasar' },
      { id: uid(), name: 'Tema 6 · Genética mendeliana', status: 'estudiado' },
      { id: uid(), name: 'Tema 7 · ADN y síntesis de proteínas', status: 'pendiente' },
    ],
    reminders: [
      { id: uid(), kind: 'dayAt', days: 3, time: '10:00' },
      { id: uid(), kind: 'dayAt', days: 1, time: '20:00' },
      { id: uid(), kind: 'before', minutes: 60 },
    ],
    notes: 'Entra todo lo visto en clase hasta el tema 7. Llevar calculadora.',
  };
  const exam2: Exam = {
    id: uid(), subjectId: mat.id, title: 'Examen tema 3', date: d(14), time: '09:00', createdAt: now,
    topics: [
      { id: uid(), name: '3.1 · Límites', status: 'repasar' },
      { id: uid(), name: '3.2 · Derivadas', status: 'pendiente' },
      { id: uid(), name: '3.3 · Aplicaciones', status: 'pendiente' },
    ],
    reminders: [{ id: uid(), kind: 'dayAt', days: 1, time: '20:00' }],
  };

  const work = base({ title: 'Trabajo: la Revolución francesa', type: 'entrega', priority: 'alta', subjectId: his.id, date: d(6), time: '23:59',
    reminders: [{ id: uid(), kind: 'dayAt', days: 2, time: '10:00' }, { id: uid(), kind: 'dayAt', days: 0, time: '09:00' }] });
  const steps = [
    ['Buscar información', -1, true, 90], ['Hacer esquema', 0, false, 60], ['Redactar', 2, false, 120], ['Revisar', 5, false, 45],
  ].map(([title, off, done, min], i) => base({
    title: title as string, type: 'entrega', priority: i === 1 ? 'alta' : 'media', subjectId: his.id, parentId: work.id, order: i,
    date: d(off as number), time: i === 1 ? '16:00' : undefined, done: done as boolean, durationMin: min as number,
  }));

  // Clases semanales empezando el lunes de esta semana
  const monday = addDaysISO(today, -weekdayMon0(today));
  const tasks: Task[] = [
    work, ...steps,
    base({ title: 'Clase de Matemáticas', type: 'clase', subjectId: mat.id, date: monday, time: '09:00', durationMin: 60, repeat: { freq: 'weekly', days: [0, 2] }, reminders: [{ id: uid(), kind: 'before', minutes: 10 }] }),
    base({ title: 'Clase de Inglés', type: 'clase', subjectId: ing.id, date: monday, time: '12:00', durationMin: 60, repeat: { freq: 'weekly', days: [1, 3] }, reminders: [{ id: uid(), kind: 'before', minutes: 10 }] }),
    base({ title: 'Leer artículo', subjectId: ing.id, date: today, time: '11:30', durationMin: 30, done: true }),
    base({ title: 'Repasar tema 5', type: 'estudio', subjectId: bio.id, examId: exam.id, topicId: exam.topics[1].id, date: today, time: '18:30', durationMin: 60 }),
    base({ title: 'Preparar mochila', date: today, time: '21:00', durationMin: 10, priority: 'baja' }),
    base({ title: 'Ficha de vocabulario', subjectId: ing.id, date: d(-1), durationMin: 20 }),
    base({ title: 'Ejercicios 3.1–3.8', subjectId: mat.id, date: d(1), time: '17:00', durationMin: 40 }),
    base({ title: 'Estudiar tema 7', type: 'estudio', subjectId: bio.id, examId: exam.id, topicId: exam.topics[3].id, date: d(1), time: '18:30', durationMin: 60 }),
    base({ title: 'Estudiar tema 7', type: 'estudio', subjectId: bio.id, examId: exam.id, topicId: exam.topics[3].id, date: d(2), time: '18:30', durationMin: 60 }),
    base({ title: 'Repaso general', type: 'estudio', subjectId: bio.id, examId: exam.id, date: d(5), time: '18:00', durationMin: 90 }),
  ];
  await db.transaction('rw', db.subjects, db.tasks, db.exams, async () => {
    await db.subjects.bulkAdd([mat, his, bio, ing]);
    await db.exams.bulkAdd([exam, exam2]);
    await db.tasks.bulkAdd(tasks);
  });
}

export async function clearAllData() {
  await db.transaction('rw', [db.subjects, db.tasks, db.exams, db.attachments], async () => {
    await Promise.all([db.subjects.clear(), db.tasks.clear(), db.exams.clear(), db.attachments.clear()]);
  });
}
