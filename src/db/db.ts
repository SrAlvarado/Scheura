import Dexie, { type EntityTable } from 'dexie';
import type { Attachment, Exam, Settings, Subject, Task } from './types';
import { uid } from '../lib/id';

export const db = new Dexie('scheura') as Dexie & {
  subjects: EntityTable<Subject, 'id'>;
  tasks: EntityTable<Task, 'id'>;
  exams: EntityTable<Exam, 'id'>;
  attachments: EntityTable<Attachment, 'id'>;
  settings: EntityTable<Settings, 'id'>;
};

db.version(1).stores({
  subjects: 'id, name, archived',
  tasks: 'id, date, subjectId, type, done, parentId, examId',
  exams: 'id, date, subjectId',
  attachments: 'id, [ownerType+ownerId], ownerId',
  settings: 'id',
});

export const DEFAULT_SETTINGS: Settings = {
  id: 'app',
  weekStart: 1,
  calendarView: 'mes',
  daySort: 'hora',
  defaultDuration: 30,
  hideDone: false,
  dailyDigest: true,
  dailyDigestTime: '08:00',
  weeklySummary: true,
  onboarded: false,
  defaultReminders: {
    examen: [
      { id: uid(), kind: 'dayAt', days: 3, time: '10:00' },
      { id: uid(), kind: 'dayAt', days: 1, time: '20:00' },
      { id: uid(), kind: 'before', minutes: 60 },
    ],
    entrega: [
      { id: uid(), kind: 'dayAt', days: 2, time: '10:00' },
      { id: uid(), kind: 'dayAt', days: 0, time: '09:00' },
    ],
    tarea: [{ id: uid(), kind: 'before', minutes: 60 }],
    estudio: [{ id: uid(), kind: 'before', minutes: 15 }],
    clase: [{ id: uid(), kind: 'before', minutes: 10 }],
  },
};

export async function getSettings(): Promise<Settings> {
  const s = await db.settings.get('app');
  if (s) return { ...DEFAULT_SETTINGS, ...s };
  await db.settings.put(DEFAULT_SETTINGS);
  return DEFAULT_SETTINGS;
}

export async function updateSettings(patch: Partial<Settings>) {
  const s = await getSettings();
  await db.settings.put({ ...s, ...patch, id: 'app' });
}
