// Utilidades del área de archivos.
import type { Attachment } from '../../db/types';

export const MAX_FILE_BYTES = 25 * 1024 * 1024;

export function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

export const isPdf = (a: Pick<Attachment, 'mime' | 'name'>) => a.mime === 'application/pdf' || /\.pdf$/i.test(a.name);
export const isImage = (a: Pick<Attachment, 'mime'>) => a.mime.startsWith('image/');

/** Etiqueta corta del tipo de archivo para el icono (PDF, JPG, DOCX…). */
export function fileBadge(a: Pick<Attachment, 'mime' | 'name'>): string {
  if (isPdf(a)) return 'PDF';
  const ext = /\.([a-z0-9]{1,5})$/i.exec(a.name)?.[1];
  return (ext ?? a.mime.split('/')[1] ?? 'FILE').toUpperCase().slice(0, 4);
}

/** «12 págs · 1,2 MB» */
export function fileMeta(a: Pick<Attachment, 'pages' | 'size'>): string {
  const parts: string[] = [];
  if (a.pages) parts.push(`${a.pages} ${a.pages === 1 ? 'pág' : 'págs'}`);
  parts.push(fmtSize(a.size));
  return parts.join(' · ');
}

/** Descarga un blob con un nombre de archivo. */
export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
