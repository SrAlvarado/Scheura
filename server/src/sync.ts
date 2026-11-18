import type { SyncChange, SyncRequest, SyncResponse, SyncTable } from '../../shared/protocol';

/** Max changes returned per response (protocol). */
export const PAGE_SIZE = 500;
/** Soft cap on ciphertext bytes per response, to stay well within Worker memory (128 MB). */
export const RESPONSE_DATA_BUDGET = 4 * 1024 * 1024;
/** Max bytes of one JSON parameter bound to a D1 statement (D1 limit: 2 MB per string). */
export const PARAM_BUDGET = 1_800_000;

export interface StoredRecord {
  updatedAt: number;
  deleted: boolean;
  data: string | null;
}

/**
 * Last-write-wins: accept the incoming change when it is newer than what is stored, or equally new but
 * different (so ties still converge to whatever the server saw last). Identical re-pushes are no-ops, which
 * keeps them from bumping `seq` and making every other device re-download the row.
 * MUST stay in sync with the SQL guard in `mergeSql`.
 */
export function lwwAccept(incoming: SyncChange, stored: StoredRecord | null | undefined): boolean {
  if (!stored) return true;
  if (incoming.updatedAt > stored.updatedAt) return true;
  if (incoming.updatedAt < stored.updatedAt) return false;
  const data = incoming.deleted ? null : (incoming.data ?? null);
  return incoming.deleted !== stored.deleted || data !== stored.data;
}

/** Collapses repeated (table, id) pairs in one request: keeps the newest; on ties, the later one. */
export function dedupeChanges(changes: SyncChange[]): SyncChange[] {
  const map = new Map<string, SyncChange>();
  for (const c of changes) {
    const k = `${c.table}\u0000${c.id}`;
    const prev = map.get(k);
    if (!prev || c.updatedAt >= prev.updatedAt) {
      map.delete(k); // re-insert to keep "last accepted" order
      map.set(k, c);
    }
  }
  return [...map.values()];
}

/** Compact wire shape bound to SQL as JSON: [table, id, updatedAt, deleted 0/1, data|null]. */
export type PackedChange = [SyncTable, string, number, 0 | 1, string | null];

export function packChange(c: SyncChange): PackedChange {
  return [c.table, c.id, c.updatedAt, c.deleted ? 1 : 0, c.deleted ? null : (c.data ?? null)];
}

/** Splits changes into JSON arrays whose serialized size stays under `budget` bytes. */
export function chunkChanges(changes: SyncChange[], budget = PARAM_BUDGET): string[] {
  const enc = new TextEncoder();
  const out: string[] = [];
  let cur: string[] = [];
  let size = 2;
  for (const c of changes) {
    const s = JSON.stringify(packChange(c));
    const n = enc.encode(s).byteLength + 1;
    if (cur.length > 0 && size + n > budget) {
      out.push(`[${cur.join(',')}]`);
      cur = [];
      size = 2;
    }
    cur.push(s);
    size += n;
  }
  if (cur.length > 0) out.push(`[${cur.join(',')}]`);
  return out;
}

export interface RecordRow {
  tbl: string;
  id: string;
  updated_at: number;
  deleted: number;
  data: string | null;
  seq: number;
  /** Rows the window query looked at (before the byte budget cut). */
  n: number;
}

export function rowToChange(r: RecordRow): SyncChange {
  const c: SyncChange = { table: r.tbl as SyncTable, id: r.id, updatedAt: r.updated_at, deleted: r.deleted === 1 };
  if (!c.deleted && r.data !== null) c.data = r.data;
  return c;
}

/**
 * Builds the response from the page query. `spaceSeq` is the space's current sequence after merging.
 * - cursor = seq of the last returned row; if none, the space's seq (everything up to it is already known).
 * - more   = rows were held back by the page size or the byte budget.
 */
export function buildSyncResponse(rows: RecordRow[], spaceSeq: number): SyncResponse {
  const page = rows.slice(0, PAGE_SIZE);
  const last = page[page.length - 1];
  const seen = rows[0]?.n ?? 0;
  return {
    cursor: last ? last.seq : spaceSeq,
    changes: page.map(rowToChange),
    more: seen > page.length,
  };
}

/**
 * Accepted rows get seq = space.seq + ROW_NUMBER() (contiguous, in request order); then space.seq is
 * advanced to the max assigned. The NOT EXISTS guard is the SQL twin of `lwwAccept`.
 * ?1 = space, ?2 = JSON array of PackedChange.
 */
export const MERGE_SQL = `
INSERT INTO records (space, tbl, id, updated_at, deleted, data, seq)
SELECT ?1, c.tbl, c.id, c.updated_at, c.deleted, c.data,
       (SELECT seq FROM spaces WHERE space = ?1) + ROW_NUMBER() OVER (ORDER BY c.k)
FROM (
  SELECT CAST(j.key AS INTEGER) AS k,
         json_extract(j.value, '$[0]') AS tbl,
         json_extract(j.value, '$[1]') AS id,
         json_extract(j.value, '$[2]') AS updated_at,
         json_extract(j.value, '$[3]') AS deleted,
         json_extract(j.value, '$[4]') AS data
  FROM json_each(?2) AS j
) AS c
WHERE NOT EXISTS (
  SELECT 1 FROM records r
  WHERE r.space = ?1 AND r.tbl = c.tbl AND r.id = c.id
    AND (r.updated_at > c.updated_at
         OR (r.updated_at = c.updated_at AND r.deleted = c.deleted AND r.data IS c.data))
)
ON CONFLICT (space, tbl, id) DO UPDATE SET
  updated_at = excluded.updated_at,
  deleted    = excluded.deleted,
  data       = excluded.data,
  seq        = excluded.seq
WHERE excluded.updated_at >= records.updated_at`;

export const BUMP_SQL = `
UPDATE spaces SET seq = MAX(seq, COALESCE((SELECT MAX(seq) FROM records WHERE space = ?1), 0))
WHERE space = ?1`;

export const ENSURE_SPACE_SQL = `
INSERT INTO spaces (space, seq, created_at, last_seen) VALUES (?1, 0, ?2, ?2)
ON CONFLICT (space) DO UPDATE SET last_seen = excluded.last_seen`;

/**
 * Page of rows with seq > cursor, cut at PAGE_SIZE + 1 rows and at RESPONSE_DATA_BUDGET bytes (the first row
 * is always included). If the client's cursor is ahead of the space (server data was reset), start from 0.
 * ?1 = space, ?2 = cursor, ?3 = byte budget, ?4 = PAGE_SIZE + 1.
 */
export const PAGE_SQL = `
SELECT tbl, id, updated_at, deleted, data, seq, n FROM (
  SELECT p.*,
         SUM(COALESCE(LENGTH(p.data), 0)) OVER (ORDER BY p.seq ROWS UNBOUNDED PRECEDING) AS acc,
         COUNT(*) OVER () AS n
  FROM (
    SELECT tbl, id, updated_at, deleted, data, seq FROM records
    WHERE space = ?1
      AND seq > (CASE WHEN ?2 > (SELECT seq FROM spaces WHERE space = ?1) THEN 0 ELSE ?2 END)
    ORDER BY seq
    LIMIT ?4
  ) AS p
)
WHERE acc - COALESCE(LENGTH(data), 0) < ?3
ORDER BY seq`;

/**
 * When an attachment tombstone is (or already was) the stored state, drop its content chunks (ids "<attId>:<n>").
 * Range on the primary key: ":" is 0x3A and ";" is 0x3B. ?1 = space, ?2 = JSON array of attachment ids.
 */
export const PURGE_CHUNKS_SQL = `
DELETE FROM records
WHERE space = ?1 AND tbl = 'chunks' AND EXISTS (
  SELECT 1 FROM records a
  WHERE a.space = ?1 AND a.tbl = 'attachments' AND a.deleted = 1
    AND a.id IN (SELECT value FROM json_each(?2))
    AND records.id > a.id || ':' AND records.id < a.id || ';'
)`;

/** Ids of attachments deleted in this request. */
export function deletedAttachmentIds(changes: SyncChange[]): string[] {
  return changes.filter((c) => c.table === 'attachments' && c.deleted).map((c) => c.id);
}

export const SPACE_SEQ_SQL = `SELECT seq FROM spaces WHERE space = ?1`;

/** Runs the whole sync (merge + page read) in one D1 batch, i.e. one transaction. */
export async function runSync(db: D1Database, req: SyncRequest, now: number): Promise<SyncResponse> {
  const changes = dedupeChanges(req.changes);
  const stmts: D1PreparedStatement[] = [db.prepare(ENSURE_SPACE_SQL).bind(req.space, now)];
  for (const chunk of chunkChanges(changes)) {
    stmts.push(db.prepare(MERGE_SQL).bind(req.space, chunk));
    stmts.push(db.prepare(BUMP_SQL).bind(req.space));
  }
  const deletedAtts = deletedAttachmentIds(changes);
  if (deletedAtts.length > 0) stmts.push(db.prepare(PURGE_CHUNKS_SQL).bind(req.space, JSON.stringify(deletedAtts)));
  stmts.push(db.prepare(PAGE_SQL).bind(req.space, req.cursor, RESPONSE_DATA_BUDGET, PAGE_SIZE + 1));
  stmts.push(db.prepare(SPACE_SEQ_SQL).bind(req.space));
  const results = await db.batch(stmts);
  const rows = (results[results.length - 2]?.results ?? []) as unknown as RecordRow[];
  const seqRow = (results[results.length - 1]?.results ?? [])[0] as { seq: number } | undefined;
  return buildSyncResponse(rows, seqRow?.seq ?? 0);
}
