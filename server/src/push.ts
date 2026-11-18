import type { PushReminder, PushScheduleRequest, PushSubscribeRequest } from '../../shared/protocol';
import type { Env } from './env';
import { filterReminders } from './validate';
import { importVapidKeys, sendPush, type VapidKeys } from './webpush';

const DAY = 24 * 3600 * 1000;
/** Look-ahead so a notification due a few seconds after the cron tick is not a full minute late. */
export const LOOKAHEAD_MS = 30_000;
/** Notifications this overdue (e.g. after an outage) are dropped instead of sent. */
export const STALE_MS = 6 * 3600 * 1000;
export const RETENTION_MS = 7 * DAY;
const CONCURRENCY = 6;

export async function subscribe(db: D1Database, req: PushSubscribeRequest, now: number): Promise<void> {
  const { endpoint, keys } = req.subscription;
  await db
    .prepare(
      `INSERT INTO push_subs (device_id, endpoint, p256dh, auth, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?5)
       ON CONFLICT (device_id) DO UPDATE SET
         endpoint = excluded.endpoint, p256dh = excluded.p256dh, auth = excluded.auth, updated_at = excluded.updated_at`,
    )
    .bind(req.deviceId, endpoint, keys.p256dh, keys.auth, now)
    .run();
}

export async function unsubscribe(db: D1Database, deviceId: string): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM push_subs WHERE device_id = ?1').bind(deviceId),
    db.prepare('DELETE FROM push_queue WHERE device_id = ?1').bind(deviceId),
  ]);
}

/**
 * Replaces the device's unsent reminders. Already-sent rows are kept (so re-sending the same key/time does not
 * notify twice); a key whose time changed is re-armed.
 */
export async function schedule(db: D1Database, req: PushScheduleRequest, now: number): Promise<number> {
  const reminders: PushReminder[] = filterReminders(req.reminders, now);
  const packed = JSON.stringify(reminders.map((r) => [r.key, r.at, r.title, r.body, r.url]));
  await db.batch([
    db.prepare('DELETE FROM push_queue WHERE device_id = ?1 AND sent = 0').bind(req.deviceId),
    db
      .prepare(
        `INSERT INTO push_queue (device_id, key, at, title, body, url, sent)
         SELECT ?1, json_extract(value, '$[0]'), json_extract(value, '$[1]'), json_extract(value, '$[2]'),
                json_extract(value, '$[3]'), json_extract(value, '$[4]'), 0
         FROM json_each(?2) WHERE true
         ON CONFLICT (device_id, key) DO UPDATE SET
           title = excluded.title, body = excluded.body, url = excluded.url,
           sent = CASE WHEN push_queue.at = excluded.at THEN push_queue.sent ELSE 0 END,
           at = excluded.at`,
      )
      .bind(req.deviceId, packed),
  ]);
  return reminders.length;
}

interface DueRow {
  device_id: string;
  key: string;
  at: number;
  title: string;
  body: string;
  url: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export type PushOutcome = 'sent' | 'gone' | 'failed' | 'retry';

/** Maps a push service status to what we do with the queue row / subscription. */
export function classifyStatus(status: number): PushOutcome {
  if (status >= 200 && status < 300) return 'sent';
  if (status === 404 || status === 410) return 'gone';
  if (status === 0 || status === 429 || status >= 500) return 'retry';
  return 'failed'; // other 4xx: permanent (bad payload, auth mismatch...) — do not retry forever
}

async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]!);
  });
  await Promise.all(workers);
}

let cachedVapid: { jwk: string; keys: VapidKeys } | null = null;

async function getVapid(env: Env): Promise<VapidKeys | null> {
  if (!env.VAPID_PRIVATE_JWK) {
    console.error('VAPID_PRIVATE_JWK secret is not set; push disabled');
    return null;
  }
  if (cachedVapid?.jwk !== env.VAPID_PRIVATE_JWK) {
    cachedVapid = {
      jwk: env.VAPID_PRIVATE_JWK,
      keys: await importVapidKeys(env.VAPID_PRIVATE_JWK, env.VAPID_PUBLIC_KEY, env.VAPID_SUBJECT),
    };
  }
  return cachedVapid.keys;
}

/** Cron: send due notifications, clean up dead subscriptions and old rows. */
export async function runCron(env: Env, now = Date.now()): Promise<{ sent: number; gone: number; failed: number; retry: number }> {
  const db = env.DB;
  const stats = { sent: 0, gone: 0, failed: 0, retry: 0 };
  const batchSize = Math.max(1, Math.min(300, Number(env.PUSH_BATCH) || 40));

  // Drop stale unsent rows (beyond STALE_MS) without sending, and old rows of any kind.
  await db.batch([
    db.prepare('UPDATE push_queue SET sent = 1 WHERE sent = 0 AND at < ?1').bind(now - STALE_MS),
    db.prepare('DELETE FROM push_queue WHERE sent IN (0, 1) AND at < ?1').bind(now - RETENTION_MS),
  ]);

  const vapid = await getVapid(env);
  if (!vapid) return stats;

  const due = await db
    .prepare(
      `SELECT q.device_id, q.key, q.at, q.title, q.body, q.url, s.endpoint, s.p256dh, s.auth
       FROM push_queue q JOIN push_subs s ON s.device_id = q.device_id
       WHERE q.sent = 0 AND q.at <= ?1
       ORDER BY q.at LIMIT ?2`,
    )
    .bind(now + LOOKAHEAD_MS, batchSize)
    .all<DueRow>();
  const rows = due.results ?? [];
  if (rows.length === 0) return stats;

  const done: [string, string][] = [];
  const goneDevices = new Set<string>();
  const jwtCache = new Map<string, string>();

  await pool(rows, CONCURRENCY, async (r) => {
    if (goneDevices.has(r.device_id)) return;
    const status = await sendPush(
      { endpoint: r.endpoint, p256dh: r.p256dh, auth: r.auth },
      { title: r.title, body: r.body, url: r.url, tag: r.key },
      vapid,
      jwtCache,
    ).catch((err: unknown) => {
      console.error('push encrypt error', err);
      return 400; // malformed subscription keys: permanent
    });
    const outcome = classifyStatus(status);
    stats[outcome]++;
    if (outcome === 'gone') goneDevices.add(r.device_id);
    else if (outcome !== 'retry') done.push([r.device_id, r.key]);
  });

  const stmts: D1PreparedStatement[] = [];
  if (done.length > 0) {
    stmts.push(
      db
        .prepare(
          `UPDATE push_queue SET sent = 1
           WHERE (device_id, key) IN (SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]') FROM json_each(?1))`,
        )
        .bind(JSON.stringify(done)),
    );
  }
  for (const d of goneDevices) {
    stmts.push(db.prepare('DELETE FROM push_subs WHERE device_id = ?1').bind(d));
    stmts.push(db.prepare('DELETE FROM push_queue WHERE device_id = ?1').bind(d));
  }
  if (stmts.length > 0) await db.batch(stmts);
  return stats;
}
