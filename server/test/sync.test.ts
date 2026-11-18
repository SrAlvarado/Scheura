import { describe, expect, it } from 'vitest';
import type { SyncChange, SyncResponse } from '../../shared/protocol';
import { handleRequest, type Env } from '../src/index';
import { buildSyncResponse, chunkChanges, dedupeChanges, lwwAccept, PAGE_SIZE, type RecordRow } from '../src/sync';
import { createTestDb } from './d1';

const SPACE = 'f'.repeat(64);
const ch = (id: string, updatedAt: number, data: string | null = `d-${id}-${updatedAt}`, table = 'tasks'): SyncChange =>
  data === null
    ? { table: table as SyncChange['table'], id, updatedAt, deleted: true }
    : { table: table as SyncChange['table'], id, updatedAt, deleted: false, data };

describe('lwwAccept', () => {
  it('implements last-write-wins with no-op detection', () => {
    expect(lwwAccept(ch('a', 1), null)).toBe(true);
    expect(lwwAccept(ch('a', 2), { updatedAt: 1, deleted: false, data: 'x' })).toBe(true);
    expect(lwwAccept(ch('a', 1), { updatedAt: 2, deleted: false, data: 'x' })).toBe(false);
    expect(lwwAccept(ch('a', 2, 'x'), { updatedAt: 2, deleted: false, data: 'x' })).toBe(false); // identical
    expect(lwwAccept(ch('a', 2, 'y'), { updatedAt: 2, deleted: false, data: 'x' })).toBe(true); // tie, different
    expect(lwwAccept(ch('a', 2, null), { updatedAt: 2, deleted: false, data: 'x' })).toBe(true); // tie, delete
    expect(lwwAccept(ch('a', 2, null), { updatedAt: 2, deleted: true, data: null })).toBe(false);
  });
});

describe('pure helpers', () => {
  it('dedupes by (table,id), newest wins, later wins ties', () => {
    const out = dedupeChanges([ch('a', 2, 'A2'), ch('a', 1, 'A1'), ch('a', 2, 'A2b'), ch('a', 1, 'x', 'exams')]);
    expect(out).toHaveLength(2);
    expect(out.find((c) => c.table === 'tasks')!.data).toBe('A2b');
  });

  it('chunks under the byte budget without splitting a change', () => {
    const changes = Array.from({ length: 10 }, (_, i) => ch(`c${i}`, 1, 'x'.repeat(100)));
    const chunks = chunkChanges(changes, 400);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(400);
    expect(chunks.flatMap((c) => JSON.parse(c) as unknown[])).toHaveLength(10);
    expect(chunkChanges([])).toEqual([]);
  });

  it('builds cursor/more from page rows', () => {
    const row = (seq: number, n: number): RecordRow => ({ tbl: 'tasks', id: `i${seq}`, updated_at: 1, deleted: 0, data: 'x', seq, n });
    expect(buildSyncResponse([], 7)).toEqual({ cursor: 7, changes: [], more: false });
    expect(buildSyncResponse([row(3, 2), row(4, 2)], 9)).toMatchObject({ cursor: 4, more: false });
    expect(buildSyncResponse([row(3, 3), row(4, 3)], 9)).toMatchObject({ cursor: 4, more: true }); // byte budget cut
    const full = Array.from({ length: PAGE_SIZE + 1 }, (_, i) => row(i + 1, PAGE_SIZE + 1));
    const r = buildSyncResponse(full, 999);
    expect(r.changes).toHaveLength(PAGE_SIZE);
    expect(r).toMatchObject({ cursor: PAGE_SIZE, more: true });
  });
});

describe('POST /v1/sync (real SQL on SQLite)', () => {
  const setup = () => {
    const { db, raw } = createTestDb();
    const env = { DB: db, ALLOWED_ORIGINS: 'https://sralvarado.github.io,http://localhost:5173' } as Env;
    const sync = async (cursor: number, changes: SyncChange[], space = SPACE): Promise<SyncResponse> => {
      const res = await handleRequest(
        new Request('https://api.test/v1/sync', { method: 'POST', body: JSON.stringify({ space, cursor, changes }) }),
        env,
      );
      expect(res.status).toBe(200);
      return res.json();
    };
    return { env, raw, sync };
  };

  it('stores changes, assigns increasing seq and returns them to other devices', async () => {
    const { sync } = setup();
    const a = await sync(0, [ch('t1', 100), ch('t2', 100)]);
    expect(a.changes.map((c) => c.id)).toEqual(['t1', 't2']);
    expect(a.cursor).toBe(2);
    expect(a.more).toBe(false);
    const b = await sync(0, []);
    expect(b.changes).toEqual([ch('t1', 100), ch('t2', 100)]);
    const c = await sync(2, []);
    expect(c).toEqual({ cursor: 2, changes: [], more: false });
  });

  it('last write wins; older and identical writes do not bump seq', async () => {
    const { sync } = setup();
    await sync(0, [ch('t1', 200, 'new')]);
    let r = await sync(1, [ch('t1', 100, 'old')]);
    expect(r).toEqual({ cursor: 1, changes: [], more: false });
    r = await sync(1, [ch('t1', 200, 'new')]); // re-push of the same version
    expect(r).toEqual({ cursor: 1, changes: [], more: false });
    r = await sync(1, [ch('t1', 300, null)]); // newer delete wins, tombstone has no data
    expect(r.changes).toEqual([{ table: 'tasks', id: 't1', updatedAt: 300, deleted: true }]);
    expect(r.cursor).toBe(2);
    r = await sync(0, []);
    expect(r.changes).toEqual([{ table: 'tasks', id: 't1', updatedAt: 300, deleted: true }]);
  });

  it('dedupes within a request and isolates spaces', async () => {
    const { sync, raw } = setup();
    const r = await sync(0, [ch('t1', 5, 'v5'), ch('t1', 9, 'v9'), ch('t1', 7, 'v7')]);
    expect(r.changes).toEqual([ch('t1', 9, 'v9')]);
    const other = await sync(0, [], 'e'.repeat(64));
    expect(other).toEqual({ cursor: 0, changes: [], more: false });
    expect(raw.prepare('SELECT seq FROM spaces WHERE space = ?').all(SPACE)[0]).toEqual({ seq: 1 });
  });

  it('pages at 500 rows with more=true', async () => {
    const { sync } = setup();
    const changes = Array.from({ length: 500 }, (_, i) => ch(`t${i}`, 1, 'x'));
    await sync(0, changes);
    await sync(0, [ch('extra', 1, 'x')]);
    const p1 = await sync(0, []);
    expect(p1.changes).toHaveLength(500);
    expect(p1).toMatchObject({ cursor: 500, more: true });
    const p2 = await sync(p1.cursor, []);
    expect(p2.changes.map((c) => c.id)).toEqual(['extra']);
    expect(p2).toMatchObject({ cursor: 501, more: false });
  });

  it('cuts pages at the response byte budget and splits big uploads into several statements', async () => {
    const { sync } = setup();
    const big = 'x'.repeat(1_500_000);
    const changes = Array.from({ length: 8 }, (_, i) => ch(`c${i}`, 1, big, 'chunks'));
    const up = await sync(0, changes); // ~12 MB body: 7+ merge statements in one batch
    expect(up.more).toBe(true);
    expect(up.changes.length).toBeLessThan(8);
    expect(up.changes.length).toBeGreaterThan(0);
    let cursor = up.cursor;
    let total = up.changes.length;
    for (let more = up.more; more; ) {
      const r = await sync(cursor, []);
      total += r.changes.length;
      cursor = r.cursor;
      more = r.more;
    }
    expect(total).toBe(8);
    expect(cursor).toBe(8);
  });

  it('an attachment tombstone purges only its own chunks', async () => {
    const { sync, raw } = setup();
    await sync(0, [ch('att1', 1, 'm', 'attachments'), ch('att1:0', 1, 'c', 'chunks'), ch('att1:1', 1, 'c', 'chunks'), ch('att10:0', 1, 'c', 'chunks')]);
    await sync(0, [ch('att1', 0, null, 'attachments')]); // older tombstone: rejected, chunks stay
    expect(raw.prepare("SELECT COUNT(*) AS n FROM records WHERE tbl = 'chunks'").all()[0]).toEqual({ n: 3 });
    const r = await sync(0, [ch('att1', 2, null, 'attachments')]);
    expect(raw.prepare("SELECT id FROM records WHERE tbl = 'chunks'").all()).toEqual([{ id: 'att10:0' }]);
    expect(r.changes.find((c) => c.id === 'att1')).toEqual({ table: 'attachments', id: 'att1', updatedAt: 2, deleted: true });
  });

  it('restarts from 0 when the client cursor is ahead of the server (data reset)', async () => {
    const { sync } = setup();
    await sync(0, [ch('t1', 1)]);
    const r = await sync(999, []);
    expect(r.changes.map((c) => c.id)).toEqual(['t1']);
    expect(r.cursor).toBe(1);
  });
});

describe('HTTP layer', () => {
  const { db } = createTestDb();
  const env = { DB: db, ALLOWED_ORIGINS: 'https://sralvarado.github.io, http://localhost:5173' } as Env;
  const call = (path: string, init: RequestInit = {}) => handleRequest(new Request(`https://api.test${path}`, init), env);

  it('health', async () => {
    const res = await call('/v1/health');
    expect(await res.json()).toEqual({ ok: true });
  });

  it('CORS preflight for allowed origins, 403 for others', async () => {
    const ok = await call('/v1/sync', { method: 'OPTIONS', headers: { Origin: 'https://sralvarado.github.io' } });
    expect(ok.status).toBe(204);
    expect(ok.headers.get('Access-Control-Allow-Origin')).toBe('https://sralvarado.github.io');
    expect(ok.headers.get('Access-Control-Allow-Methods')).toContain('PUT');
    const no = await call('/v1/sync', { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } });
    expect(no.status).toBe(403);
    expect(no.headers.get('Access-Control-Allow-Origin')).toBeNull();
    const get = await call('/v1/health', { headers: { Origin: 'http://localhost:5173' } });
    expect(get.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
  });

  it('JSON errors: 400, 404, 405, 413', async () => {
    const r400 = await call('/v1/sync', { method: 'POST', body: '{nope' });
    expect(r400.status).toBe(400);
    expect(await r400.json()).toMatchObject({ error: 'bad_request' });
    const shape = await call('/v1/sync', { method: 'POST', body: JSON.stringify({ space: 'x', cursor: 0 }), headers: { Origin: 'https://sralvarado.github.io' } });
    expect(shape.status).toBe(400);
    expect(shape.headers.get('Access-Control-Allow-Origin')).toBe('https://sralvarado.github.io');
    expect((await call('/v1/nothing')).status).toBe(404);
    const r405 = await call('/v1/sync');
    expect(r405.status).toBe(405);
    expect(await r405.json()).toMatchObject({ error: 'method_not_allowed' });
    const r413 = await call('/v1/push/schedule', { method: 'PUT', body: 'x'.repeat(1024 * 1024 + 1) });
    expect(r413.status).toBe(413);
  });
});
