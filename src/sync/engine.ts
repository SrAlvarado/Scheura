// Motor de sincronización (last-write-wins por registro, cifrado de extremo a extremo).
// Estado persistente en `meta`: sync.code, sync.cursor, sync.pushedUpTo, sync.lastSyncAt, sync.lastError.
// Trozos de adjuntos pendientes de montar: meta `chunk:<attId>:<n>` y `chunkrec:<attId>`.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { liveQuery } from 'dexie';
import { applyRemote, db, getMeta, setMeta, SYNCED_TABLES } from '../db/db';
import type { Attachment, Settings, Tombstone } from '../db/types';
import { API_URL, serverEnabled } from '../lib/config';
import { CHUNK_SIZE, MAX_SYNC_FILE, type SyncChange, type SyncRequest, type SyncResponse, type SyncTable } from '../../shared/protocol';
import { decryptChunk, decryptJson, deriveKeys, encryptChunk, encryptJson, formatCode, normalizeCode, type SyncKeys } from './crypto';
import { emitRemoteChange, onLocalChange } from './events';

const K = {
  code: 'sync.code',
  cursor: 'sync.cursor',
  pushedUpTo: 'sync.pushedUpTo',
  lastSyncAt: 'sync.lastSyncAt',
  lastError: 'sync.lastError',
} as const;

const MAX_BATCH = 500;
/** Tope aproximado de bytes de `data` por petición (los trozos de adjuntos ocupan ~700 KB cifrados). */
const MAX_BATCH_BYTES = 4 * 1024 * 1024;
/** Las lápidas se escriben un instante después del borrado: margen para no perder ninguna. */
const TOMBSTONE_GRACE = 5000;
const REQUEST_TIMEOUT = 60_000;
const INTERVAL = 2 * 60_000;
const LOCAL_DEBOUNCE = 2000;

type SyncedTable = (typeof SYNCED_TABLES)[number];
type Row = { id: string; updatedAt?: number } & Record<string, unknown>;
/** Registro de adjunto tal como viaja (sin blob). */
type WireAttachment = Omit<Attachment, 'blob'> & { chunkCount: number; blobSkipped?: boolean };

export interface SyncState {
  enabled: boolean;
  /** Código enmascarado (XXXXX-•••••-•••••-•••••) o null. */
  code: string | null;
  lastSyncAt: number | null;
  lastError: string | null;
  syncing: boolean;
}

export interface SyncResult {
  ok: boolean;
  applied: number;
  error?: string;
}

// ---------- Estado en memoria ----------

let syncing = false;
const syncingListeners = new Set<() => void>();
function setSyncing(v: boolean) {
  syncing = v;
  syncingListeners.forEach((fn) => fn());
}

let keysCache: { code: string; keys: Promise<SyncKeys> } | null = null;
function keysFor(code: string): Promise<SyncKeys> {
  if (keysCache?.code !== code) {
    const keys = deriveKeys(code);
    keys.catch(() => { if (keysCache?.keys === keys) keysCache = null; });
    keysCache = { code, keys };
  }
  return keysCache.keys;
}

/** Valores updatedAt de registros recién llegados del servidor: no hace falta reenviarlos (evita el eco). */
const appliedFromRemote = new Map<string, number>();

const mask = (code: string) => `${code.slice(0, 5)}-•••••-•••••-•••••`;

// ---------- API pública ----------

export async function getSyncState(): Promise<SyncState> {
  const [code, lastSyncAt, lastError] = await Promise.all([
    getMeta<string>(K.code),
    getMeta<number>(K.lastSyncAt),
    getMeta<string>(K.lastError),
  ]);
  return { enabled: !!code, code: code ? mask(code) : null, lastSyncAt: lastSyncAt ?? null, lastError: lastError ?? null, syncing };
}

/** Código completo agrupado (para mostrarlo en Ajustes y en el QR), o null si la sincronización está desactivada. */
export async function getFullSyncCode(): Promise<string | null> {
  const code = await getMeta<string>(K.code);
  return code ? formatCode(code) : null;
}

const INITIAL: SyncState = { enabled: false, code: null, lastSyncAt: null, lastError: null, syncing: false };

/** Estado en vivo (meta vía liveQuery + indicador en memoria). `undefined` mientras carga. */
export function useSyncState(): SyncState | undefined {
  const [persisted, setPersisted] = useState<Omit<SyncState, 'syncing'> | undefined>(undefined);
  useEffect(() => {
    const sub = liveQuery(async () => {
      const { syncing: _s, ...rest } = await getSyncState();
      return rest;
    }).subscribe({ next: setPersisted, error: () => setPersisted({ ...INITIAL }) });
    return () => sub.unsubscribe();
  }, []);
  const live = useSyncExternalStore(
    (fn) => { syncingListeners.add(fn); return () => { syncingListeners.delete(fn); }; },
    () => syncing,
  );
  return persisted ? { ...persisted, syncing: live } : undefined;
}

/**
 * Activa la sincronización con `code`. `join` = el código viene de otro dispositivo: los ajustes locales
 * pierden frente a los del espacio (para que un dispositivo recién instalado no imponga sus valores por defecto).
 */
export async function enableSync(code: string, opts: { join?: boolean } = {}): Promise<void> {
  const norm = normalizeCode(code);
  if (!norm) throw new Error('Código de sincronización no válido');
  await keysFor(norm); // deriva ya (y falla aquí si Web Crypto no está disponible)
  await disableSync();
  if (opts.join) {
    await applyRemote(['settings'], async () => {
      const s = await db.settings.get('app');
      if (s) await db.settings.put({ ...s, updatedAt: 1 });
    });
  }
  await db.meta.bulkPut([
    { key: K.code, value: norm },
    { key: K.cursor, value: 0 },
    { key: K.pushedUpTo, value: 0 },
  ]);
  void requestSync();
}

/** Desactiva la sincronización en este dispositivo. Los datos locales se conservan. */
export async function disableSync(): Promise<void> {
  appliedFromRemote.clear();
  failures = 0;
  nextAllowedAt = 0;
  await db.transaction('rw', db.meta, async () => {
    await db.meta.bulkDelete(Object.values(K));
    await db.meta.where('key').startsWith('chunk:').delete();
    await db.meta.where('key').startsWith('chunkrec:').delete();
  });
}

/** Sincroniza ya (ignora la espera por errores). Nunca lanza: devuelve el resultado. */
export function syncNow(): Promise<SyncResult> {
  failures = 0;
  nextAllowedAt = 0;
  return requestSync();
}

// ---------- Bucle ----------

let running: Promise<SyncResult> | null = null;
let queued: Promise<SyncResult> | null = null;
let failures = 0;
let nextAllowedAt = 0;

/** Nunca hay dos sincronizaciones a la vez: si hay una en marcha, se encola (como mucho) una más. */
function requestSync(): Promise<SyncResult> {
  if (queued) return queued;
  if (running) {
    queued = running.then(() => {
      queued = null;
      return start();
    });
    return queued;
  }
  return start();
}
function start(): Promise<SyncResult> {
  running = runSync().finally(() => { running = null; });
  return running;
}

/**
 * Arranca la sincronización automática. Devuelve la función para pararla.
 * Disparadores: al arrancar, tras cambios locales (2 s), cada 2 min con la app visible, al volver a la app y al recuperar conexión.
 */
export function startSyncLoop(): () => void {
  if (!serverEnabled()) return () => undefined;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const auto = async () => {
    if (stopped) return;
    if (Date.now() < nextAllowedAt) return;
    const res = await requestSync();
    if (stopped || res.ok || !(await getMeta<string>(K.code))) return;
    // Reintento con espera exponencial: 5 s, 10 s, 20 s… hasta 10 min
    clearTimeout(retry);
    retry = setTimeout(() => void auto(), Math.max(0, nextAllowedAt - Date.now()) + 50);
  };

  const offLocal = onLocalChange(() => {
    clearTimeout(debounce);
    debounce = setTimeout(() => void auto(), LOCAL_DEBOUNCE);
  });
  const interval = setInterval(() => {
    if (document.visibilityState === 'visible') void auto();
  }, INTERVAL);
  const onVisible = () => { if (document.visibilityState === 'visible') void auto(); };
  const onOnline = () => { failures = 0; nextAllowedAt = 0; void auto(); };
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('online', onOnline);
  void auto();

  return () => {
    stopped = true;
    offLocal();
    clearTimeout(debounce);
    clearTimeout(retry);
    clearInterval(interval);
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('online', onOnline);
  };
}

// ---------- Una sincronización ----------

class SyncError extends Error {}

async function runSync(): Promise<SyncResult> {
  if (!serverEnabled()) return { ok: false, applied: 0, error: 'Servidor no configurado' };
  const code = await getMeta<string>(K.code);
  if (!code) return { ok: false, applied: 0, error: 'Sincronización desactivada' };
  setSyncing(true);
  try {
    const applied = await syncOnce(code);
    failures = 0;
    nextAllowedAt = 0;
    if (applied > 0) emitRemoteChange();
    return { ok: true, applied };
  } catch (e) {
    const message = e instanceof SyncError ? e.message
      : e instanceof DOMException && e.name === 'AbortError' ? 'El servidor no responde'
      : e instanceof TypeError ? 'Sin conexión con el servidor'
      : 'No se pudo sincronizar';
    if (!(e instanceof SyncError) && !(e instanceof TypeError)) console.warn('[sync]', e);
    failures++;
    nextAllowedAt = Date.now() + Math.min(5000 * 2 ** (failures - 1), 10 * 60_000);
    // Si se desactivó (o cambió de código) mientras tanto, no dejar rastro
    if ((await getMeta<string>(K.code)) === code) await setMeta(K.lastError, message);
    return { ok: false, applied: 0, error: message };
  } finally {
    setSyncing(false);
  }
}

/** Productor perezoso de un cambio (los trozos se leen y cifran solo cuando toca enviarlos). */
interface Pending {
  bytes: number;
  make: () => Promise<SyncChange>;
}

async function syncOnce(code: string): Promise<number> {
  const { key, space } = await keysFor(code);
  const startedAt = Date.now();
  const pushedUpTo = (await getMeta<number>(K.pushedUpTo)) ?? 0;
  let cursor = (await getMeta<number>(K.cursor)) ?? 0;

  const pending = await collect(key, pushedUpTo);
  let applied = 0;
  let i = 0;
  for (;;) {
    // Lote: ≤ 500 cambios y ≈ ≤ 4 MB
    const changes: SyncChange[] = [];
    let bytes = 0;
    while (i < pending.length && changes.length < MAX_BATCH && (changes.length === 0 || bytes + pending[i].bytes <= MAX_BATCH_BYTES)) {
      bytes += pending[i].bytes;
      changes.push(await pending[i].make());
      i++;
    }
    const res = await post({ space, cursor, changes });
    applied += await applyIncoming(key, res.changes);
    if (await getMeta<string>(K.code) !== code) throw new SyncError('Sincronización desactivada');
    cursor = res.cursor;
    await setMeta(K.cursor, cursor);
    if (i >= pending.length && !res.more) break;
  }
  await db.meta.bulkPut([
    { key: K.pushedUpTo, value: startedAt },
    { key: K.lastSyncAt, value: Date.now() },
  ]);
  await db.meta.delete(K.lastError);
  for (const [k, at] of appliedFromRemote) if (at <= startedAt) appliedFromRemote.delete(k);
  return applied;
}

async function post(body: SyncRequest): Promise<SyncResponse> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT);
  try {
    const r = await fetch(`${API_URL}/v1/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!r.ok) {
      let detail = '';
      try { detail = ((await r.json()) as { error?: string }).error ?? ''; } catch { /* sin cuerpo */ }
      throw new SyncError(r.status === 413 ? 'Demasiados datos en una petición' : `Error del servidor (${r.status})${detail ? `: ${detail}` : ''}`);
    }
    const res = (await r.json()) as SyncResponse;
    if (typeof res?.cursor !== 'number' || !Array.isArray(res.changes)) throw new SyncError('Respuesta del servidor no válida');
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// ---------- Subida ----------

const aadOf = (table: SyncTable, id: string) => `${table}|${id}`;

async function collect(key: CryptoKey, since: number): Promise<Pending[]> {
  const out: Pending[] = [];
  // Una sola transacción de lectura: espera a que terminen las escrituras ya empezadas.
  const { rows, tombstones } = await db.transaction('r', [...SYNCED_TABLES, 'tombstones'], async () => {
    const rows: { table: SyncedTable; row: Row }[] = [];
    for (const table of SYNCED_TABLES) {
      const list = (await db.table(table).where('updatedAt').above(since).toArray()) as Row[];
      for (const row of list) rows.push({ table, row });
    }
    const tombstones = await db.tombstones.where('deletedAt').above(Math.max(0, since - TOMBSTONE_GRACE)).toArray();
    return { rows, tombstones: tombstones as Tombstone[] };
  });

  for (const { table, row } of rows) {
    const updatedAt = row.updatedAt ?? 0;
    if (appliedFromRemote.get(`${table}:${row.id}`) === updatedAt) continue;
    if (table === 'attachments') {
      const { blob, ...meta } = row as unknown as Attachment;
      const size = blob?.size ?? 0;
      const skip = size > MAX_SYNC_FILE;
      const chunkCount = skip ? 0 : Math.ceil(size / CHUNK_SIZE);
      const wire: WireAttachment = { ...meta, chunkCount, ...(skip ? { blobSkipped: true } : {}) };
      out.push({ bytes: 2048, make: async () => ({ table, id: row.id, updatedAt, deleted: false, data: await encryptJson(key, wire, aadOf(table, row.id)) }) });
      for (let n = 0; n < chunkCount; n++) {
        const id = `${row.id}:${n}`;
        const slice = blob.slice(n * CHUNK_SIZE, (n + 1) * CHUNK_SIZE);
        out.push({
          bytes: Math.ceil((slice.size + 28) * 4 / 3) + 200,
          make: async () => ({
            table: 'chunks', id, updatedAt, deleted: false,
            data: await encryptChunk(key, new Uint8Array(await slice.arrayBuffer()), aadOf('chunks', id)),
          }),
        });
      }
    } else {
      out.push({ bytes: 1024, make: async () => ({ table, id: row.id, updatedAt, deleted: false, data: await encryptJson(key, row, aadOf(table, row.id)) }) });
    }
  }
  for (const t of tombstones) {
    if (!(SYNCED_TABLES as readonly string[]).includes(t.table)) continue;
    const change: SyncChange = { table: t.table as SyncTable, id: t.id, updatedAt: t.deletedAt, deleted: true };
    out.push({ bytes: 100, make: async () => change });
  }
  return out;
}

// ---------- Bajada ----------

type Incoming =
  | { kind: 'delete'; table: SyncTable; id: string; updatedAt: number }
  | { kind: 'row'; table: SyncedTable; id: string; updatedAt: number; row: Row }
  | { kind: 'chunk'; attId: string; n: number; updatedAt: number; bytes: Uint8Array };

interface ChunkMeta { updatedAt: number; bytes: Uint8Array }
interface ChunkRec { updatedAt: number; rec: WireAttachment }

async function applyIncoming(key: CryptoKey, changes: SyncChange[]): Promise<number> {
  if (changes.length === 0) return 0;
  // Descifrar fuera de la transacción (Web Crypto no es compatible con las transacciones de IndexedDB)
  const items: Incoming[] = [];
  for (const c of changes) {
    try {
      if (c.deleted) {
        items.push({ kind: 'delete', table: c.table, id: c.id, updatedAt: c.updatedAt });
      } else if (!c.data) {
        continue;
      } else if (c.table === 'chunks') {
        const sep = c.id.lastIndexOf(':');
        const n = Number(c.id.slice(sep + 1));
        if (sep <= 0 || !Number.isInteger(n) || n < 0) continue;
        items.push({ kind: 'chunk', attId: c.id.slice(0, sep), n, updatedAt: c.updatedAt, bytes: await decryptChunk(key, c.data, aadOf('chunks', c.id)) });
      } else if ((SYNCED_TABLES as readonly string[]).includes(c.table)) {
        const row = await decryptJson<Row>(key, c.data, aadOf(c.table, c.id));
        items.push({ kind: 'row', table: c.table as SyncedTable, id: c.id, updatedAt: c.updatedAt, row: { ...row, id: c.id, updatedAt: c.updatedAt } });
      }
    } catch (e) {
      console.warn('[sync] cambio ignorado (no se pudo descifrar)', c.table, c.id, e);
    }
  }

  return applyRemote([...SYNCED_TABLES, 'tombstones', 'meta'], async () => {
    let applied = 0;
    const touched = new Set<string>();
    for (const it of items) {
      if (it.kind === 'chunk') {
        const local = await db.attachments.get(it.attId);
        if (local && (local.updatedAt ?? 0) >= it.updatedAt) continue;
        const mkey = `chunk:${it.attId}:${it.n}`;
        const prev = (await db.meta.get(mkey))?.value as ChunkMeta | undefined;
        if (prev && prev.updatedAt > it.updatedAt) continue;
        await db.meta.put({ key: mkey, value: { updatedAt: it.updatedAt, bytes: it.bytes } satisfies ChunkMeta });
        touched.add(it.attId);
        continue;
      }
      if (it.table === 'chunks') continue; // borrado de un trozo: nada que hacer
      const table = db.table(it.table);
      const local = (await table.get(it.id)) as Row | undefined;
      if (local && (local.updatedAt ?? 0) >= it.updatedAt) continue;
      const tkey = `${it.table}:${it.id}`;

      if (it.kind === 'delete') {
        if (local) { await table.delete(it.id); applied++; }
        if (it.table === 'attachments') await dropPendingChunks(it.id);
        appliedFromRemote.delete(tkey);
        continue;
      }

      const tomb = await db.tombstones.get(tkey);
      if (tomb && tomb.deletedAt >= it.updatedAt) continue; // borrado aquí después: gana el borrado
      if (tomb) await db.tombstones.delete(tkey);

      if (it.kind === 'row' && it.table === 'attachments') {
        const rec = it.row as unknown as WireAttachment;
        if (rec.chunkCount > 0) {
          const pkey = `chunkrec:${it.id}`;
          const prev = (await db.meta.get(pkey))?.value as ChunkRec | undefined;
          if (!prev || prev.updatedAt <= it.updatedAt) await db.meta.put({ key: pkey, value: { updatedAt: it.updatedAt, rec } satisfies ChunkRec });
          touched.add(it.id);
          continue;
        }
        // Sin contenido que descargar: vacío, o demasiado grande (se conserva el contenido local si lo hay)
        const { chunkCount: _c, blobSkipped, ...meta } = rec;
        const blob = blobSkipped && local?.blob instanceof Blob ? local.blob : new Blob([], { type: rec.mime });
        await db.attachments.put({ ...meta, blob, ...(blobSkipped && !(local?.blob instanceof Blob) ? { remoteOnly: true } : {}) } as Attachment);
        appliedFromRemote.set(tkey, it.updatedAt);
        applied++;
        continue;
      }

      if (it.table === 'settings') {
        const s = it.row as unknown as Settings;
        if (local && (local as unknown as Settings).onboarded && !s.onboarded) s.onboarded = true;
        await table.put(s);
      } else {
        await table.put(it.row);
      }
      appliedFromRemote.set(tkey, it.updatedAt);
      applied++;
    }
    for (const attId of touched) if (await assemble(attId)) applied++;
    return applied;
  });
}

/** Monta el adjunto cuando ya están su registro y todos sus trozos con la misma versión. */
async function assemble(attId: string): Promise<boolean> {
  const pending = (await db.meta.get(`chunkrec:${attId}`))?.value as ChunkRec | undefined;
  if (!pending) return false;
  const local = await db.attachments.get(attId);
  if (local && (local.updatedAt ?? 0) >= pending.updatedAt) {
    await dropPendingChunks(attId);
    return false;
  }
  const { chunkCount, blobSkipped: _b, ...meta } = pending.rec;
  const parts: Uint8Array[] = [];
  for (let n = 0; n < chunkCount; n++) {
    const c = (await db.meta.get(`chunk:${attId}:${n}`))?.value as ChunkMeta | undefined;
    if (!c || c.updatedAt !== pending.updatedAt) return false;
    parts.push(c.bytes);
  }
  await db.attachments.put({ ...meta, id: attId, updatedAt: pending.updatedAt, blob: new Blob(parts as BlobPart[], { type: meta.mime }) });
  appliedFromRemote.set(`attachments:${attId}`, pending.updatedAt);
  await dropPendingChunks(attId);
  return true;
}

async function dropPendingChunks(attId: string) {
  await db.meta.where('key').startsWith(`chunk:${attId}:`).delete();
  await db.meta.delete(`chunkrec:${attId}`);
}
