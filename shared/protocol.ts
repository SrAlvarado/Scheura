// Protocolo entre la app (src/) y el servidor (server/). Lo importan ambos: mantener sin dependencias.

/** Tablas que se sincronizan. 'chunks' = trozos cifrados del contenido de los adjuntos. */
export type SyncTable = 'subjects' | 'tasks' | 'exams' | 'attachments' | 'settings' | 'chunks';
export const SYNC_TABLES: SyncTable[] = ['subjects', 'tasks', 'exams', 'attachments', 'settings', 'chunks'];

/**
 * Un cambio de un registro. `data` es el registro cifrado en el cliente (AES-GCM, base64url de iv‖ciphertext);
 * el servidor nunca ve el contenido. Borrados = `deleted: true` sin `data` (lápida).
 */
export interface SyncChange {
  table: SyncTable;
  id: string;
  updatedAt: number; // ms, reloj del cliente que lo modificó (gana el mayor: last-write-wins)
  deleted: boolean;
  data?: string;
}

/** POST /v1/sync */
export interface SyncRequest {
  /** Identificador del espacio: hex SHA-256 derivado del código de sincronización (no es la clave de cifrado). */
  space: string;
  /** Último `cursor` recibido del servidor (0 la primera vez). */
  cursor: number;
  /** Cambios locales pendientes de subir (máx. 500 por petición). */
  changes: SyncChange[];
}
export interface SyncResponse {
  /** Nuevo cursor: guardar y enviar en la siguiente petición. */
  cursor: number;
  /** Cambios del servidor con seq > cursor de la petición (máx. 500). */
  changes: SyncChange[];
  /** true si quedan más cambios: repetir con el nuevo cursor. */
  more: boolean;
}

/** Aviso programado que el servidor enviará por Web Push. */
export interface PushReminder {
  key: string; // único (item|recordatorio) para no duplicar
  at: number; // ms epoch
  title: string;
  body: string;
  url: string; // ruta hash, p. ej. '#/examen/abc'
}

/** POST /v1/push/subscribe — registra (o actualiza) la suscripción Web Push de un dispositivo. */
export interface PushSubscribeRequest {
  deviceId: string;
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } };
}

/** PUT /v1/push/schedule — sustituye todos los avisos futuros no enviados de ese dispositivo. */
export interface PushScheduleRequest {
  deviceId: string;
  reminders: PushReminder[]; // máx. 500, próximos 30 días
}

/** DELETE /v1/push/subscribe — body { deviceId } */
export interface PushUnsubscribeRequest {
  deviceId: string;
}

/** Tamaño máximo de un trozo de adjunto antes de cifrar (bytes). */
export const CHUNK_SIZE = 512 * 1024;
/** Tamaño máximo de un adjunto que se sincroniza (bytes). */
export const MAX_SYNC_FILE = 25 * 1024 * 1024;
