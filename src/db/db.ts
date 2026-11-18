import Dexie, { type EntityTable, type Transaction } from 'dexie';
import type { Attachment, Exam, Meta, Settings, Subject, Task, Tombstone } from './types';
import { uid } from '../lib/id';
import { emitLocalChange } from '../sync/events';

export const db = new Dexie('scheura') as Dexie & {
  subjects: EntityTable<Subject, 'id'>;
  tasks: EntityTable<Task, 'id'>;
  exams: EntityTable<Exam, 'id'>;
  attachments: EntityTable<Attachment, 'id'>;
  settings: EntityTable<Settings, 'id'>;
  tombstones: EntityTable<Tombstone, 'key'>;
  meta: EntityTable<Meta, 'key'>;
};

db.version(1).stores({
  subjects: 'id, name, archived',
  tasks: 'id, date, subjectId, type, done, parentId, examId',
  exams: 'id, date, subjectId',
  attachments: 'id, [ownerType+ownerId], ownerId',
  settings: 'id',
});

// v2 (sprint 2): sincronización. updatedAt indexado para subir solo lo cambiado; lápidas de borrados; meta interna.
db.version(2)
  .stores({
    subjects: 'id, name, archived, updatedAt',
    tasks: 'id, date, subjectId, type, done, parentId, examId, updatedAt',
    exams: 'id, date, subjectId, updatedAt',
    attachments: 'id, [ownerType+ownerId], ownerId, updatedAt',
    settings: 'id, updatedAt',
    tombstones: 'key, deletedAt',
    meta: 'key',
  })
  .upgrade(async (tx) => {
    const now = Date.now();
    for (const name of ['subjects', 'tasks', 'exams', 'attachments', 'settings']) {
      await tx.table(name).toCollection().modify((o: { updatedAt?: number }) => { o.updatedAt ??= now; });
    }
  });

// ---------- Seguimiento de cambios para la sincronización ----------
// Toda escritura local pone updatedAt y los borrados dejan lápida. Las escrituras que vienen del servidor
// se hacen dentro de `applyRemote()` y no se marcan (si no, rebotarían).

export const SYNCED_TABLES = ['subjects', 'tasks', 'exams', 'attachments', 'settings'] as const;
const REMOTE = Symbol('remote');
type Tx = Transaction & { [REMOTE]?: boolean; parent?: Tx };
const isRemote = (tx?: Tx): boolean => !!tx && (!!tx[REMOTE] || isRemote(tx.parent));

/** Ejecuta escrituras procedentes del servidor sin marcarlas como cambios locales. */
export function applyRemote<T>(tables: string[], fn: () => Promise<T>): Promise<T> {
  return db.transaction('rw', tables, async (tx) => {
    (tx as Tx)[REMOTE] = true;
    return fn();
  });
}

let pendingTombstones: Tombstone[] = [];
let flushTimer: ReturnType<typeof setTimeout> | undefined;
function queueTombstone(t: Tombstone) {
  pendingTombstones.push(t);
  clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    const batch = pendingTombstones;
    pendingTombstones = [];
    db.tombstones.bulkPut(batch).then(emitLocalChange).catch(() => undefined);
  }, 0);
}

for (const name of SYNCED_TABLES) {
  const table = db.table(name);
  table.hook('creating', function (_pk, obj: { updatedAt?: number }, tx) {
    if (isRemote(tx as Tx)) return;
    obj.updatedAt = Date.now();
    this.onsuccess = () => emitLocalChange();
  });
  table.hook('updating', function (mods, _pk, _obj, tx) {
    if (isRemote(tx as Tx) || 'updatedAt' in (mods as object)) return undefined;
    this.onsuccess = () => emitLocalChange();
    return { updatedAt: Date.now() };
  });
  table.hook('deleting', function (pk, _obj, tx) {
    if (isRemote(tx as Tx)) return;
    const id = String(pk);
    queueTombstone({ key: `${name}:${id}`, table: name, id, deletedAt: Date.now() });
  });
}

/** Valor interno persistente (estado de sync, id de dispositivo…). */
export async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await db.meta.get(key))?.value as T | undefined;
}
export const setMeta = (key: string, value: unknown) => db.meta.put({ key, value });

/** Id estable de este dispositivo (para push). */
export async function getDeviceId(): Promise<string> {
  let id = await getMeta<string>('deviceId');
  if (!id) { id = uid(); await setMeta('deviceId', id); }
  return id;
}

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
