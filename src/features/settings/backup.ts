// Copia de seguridad: exportar/importar todas las tablas en un .json (los archivos van en base64).
import { db } from '../../db/db';
import type { Attachment, Exam, Settings, Subject, Task } from '../../db/types';

interface BackupAttachment extends Omit<Attachment, 'blob'> { blob: string }
export interface Backup {
  app: 'scheura';
  version: 1;
  exportedAt: string;
  data: { subjects: Subject[]; tasks: Task[]; exams: Exam[]; attachments: BackupAttachment[]; settings: Settings[] };
}

const blobToDataUrl = (b: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(b);
  });

function dataUrlToBlob(url: string, fallbackMime: string): Blob {
  const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(url);
  if (!m) return new Blob([], { type: fallbackMime });
  const mime = m[1] || fallbackMime;
  if (!m[2]) return new Blob([decodeURIComponent(m[3])], { type: mime });
  const bin = atob(m[3]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export async function exportBackup(): Promise<Blob> {
  const [subjects, tasks, exams, attachments, settings] = await Promise.all([
    db.subjects.toArray(), db.tasks.toArray(), db.exams.toArray(), db.attachments.toArray(), db.settings.toArray(),
  ]);
  const atts: BackupAttachment[] = [];
  for (const a of attachments) atts.push({ ...a, blob: await blobToDataUrl(a.blob) });
  const backup: Backup = { app: 'scheura', version: 1, exportedAt: new Date().toISOString(), data: { subjects, tasks, exams, attachments: atts, settings } };
  return new Blob([JSON.stringify(backup)], { type: 'application/json' });
}

/** Lee y valida un archivo de copia. Lanza Error con mensaje para el usuario si no es válido. */
export async function readBackup(file: File): Promise<Backup> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new Error('El archivo no es una copia válida de Scheura.');
  }
  const b = parsed as Partial<Backup> | null;
  const d = b?.data;
  if (!b || b.app !== 'scheura' || !d || !Array.isArray(d.subjects) || !Array.isArray(d.tasks) || !Array.isArray(d.exams)) {
    throw new Error('El archivo no es una copia válida de Scheura.');
  }
  return {
    app: 'scheura', version: 1, exportedAt: String(b.exportedAt ?? ''),
    data: { subjects: d.subjects, tasks: d.tasks, exams: d.exams, attachments: Array.isArray(d.attachments) ? d.attachments : [], settings: Array.isArray(d.settings) ? d.settings : [] },
  };
}

/** Sustituye todos los datos por los de la copia (incluidos los archivos). */
export async function restoreBackup(b: Backup) {
  const attachments: Attachment[] = b.data.attachments.map((a) => ({ ...a, blob: dataUrlToBlob(a.blob, a.mime) }));
  await db.transaction('rw', [db.subjects, db.tasks, db.exams, db.attachments, db.settings], async () => {
    await Promise.all([db.subjects.clear(), db.tasks.clear(), db.exams.clear(), db.attachments.clear()]);
    await db.subjects.bulkPut(b.data.subjects);
    await db.tasks.bulkPut(b.data.tasks);
    await db.exams.bulkPut(b.data.exams);
    await db.attachments.bulkPut(attachments);
    const s = b.data.settings.find((x) => x.id === 'app');
    if (s) await db.settings.put({ ...s, onboarded: true });
  });
}

export const countsOf = (b: Backup) => ({
  subjects: b.data.subjects.length, tasks: b.data.tasks.length, exams: b.data.exams.length, attachments: b.data.attachments.length,
});
