import {
  SYNC_TABLES,
  type PushReminder,
  type PushScheduleRequest,
  type PushSubscribeRequest,
  type PushUnsubscribeRequest,
  type SyncChange,
  type SyncRequest,
  type SyncTable,
} from '../../shared/protocol';
import { badRequest } from './http';

export const LIMITS = {
  syncBodyBytes: 20 * 1024 * 1024,
  pushBodyBytes: 1024 * 1024,
  maxChanges: 500,
  maxIdLength: 128,
  maxDataLength: 1.5 * 1024 * 1024,
  maxReminders: 500,
  maxTitle: 200,
  maxBody: 1000,
  maxUrl: 512,
  maxEndpoint: 2048,
  /** Reminders older than this (relative to now) are ignored on schedule. */
  scheduleGraceMs: 5 * 60 * 1000,
} as const;

const SPACE_RE = /^[0-9a-f]{64}$/;
const B64URL_RE = /^[A-Za-z0-9_-]+={0,2}$/;
const TABLES = new Set<string>(SYNC_TABLES);

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function obj(v: unknown, what: string): Obj {
  if (!isObj(v)) throw badRequest(`${what} must be an object`);
  return v;
}

function str(v: unknown, what: string, max: number, min = 1): string {
  if (typeof v !== 'string') throw badRequest(`${what} must be a string`);
  if (v.length < min) throw badRequest(`${what} is too short`);
  if (v.length > max) throw badRequest(`${what} exceeds ${max} characters`);
  return v;
}

function int(v: unknown, what: string): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) {
    throw badRequest(`${what} must be a non-negative integer`);
  }
  return v;
}

function id(v: unknown, what: string): string {
  return str(v, what, LIMITS.maxIdLength);
}

function b64url(v: unknown, what: string, max: number): string {
  const s = str(v, what, max);
  if (!B64URL_RE.test(s)) throw badRequest(`${what} must be base64url`);
  return s;
}

export function parseSpace(v: unknown): string {
  if (typeof v !== 'string' || !SPACE_RE.test(v)) throw badRequest('space must be 64 lowercase hex characters');
  return v;
}

export function parseSyncChange(v: unknown, i: number): SyncChange {
  const o = obj(v, `changes[${i}]`);
  const table = o.table;
  if (typeof table !== 'string' || !TABLES.has(table)) throw badRequest(`changes[${i}].table is not a sync table`);
  const changeId = id(o.id, `changes[${i}].id`);
  const updatedAt = int(o.updatedAt, `changes[${i}].updatedAt`);
  if (typeof o.deleted !== 'boolean') throw badRequest(`changes[${i}].deleted must be a boolean`);
  const deleted = o.deleted;
  if (deleted) return { table: table as SyncTable, id: changeId, updatedAt, deleted: true };
  const data = str(o.data, `changes[${i}].data`, LIMITS.maxDataLength, 0);
  return { table: table as SyncTable, id: changeId, updatedAt, deleted: false, data };
}

export function parseSyncRequest(v: unknown): SyncRequest {
  const o = obj(v, 'body');
  const space = parseSpace(o.space);
  const cursor = int(o.cursor, 'cursor');
  const changes = o.changes ?? [];
  if (!Array.isArray(changes)) throw badRequest('changes must be an array');
  if (changes.length > LIMITS.maxChanges) throw badRequest(`At most ${LIMITS.maxChanges} changes per request`);
  return { space, cursor, changes: changes.map(parseSyncChange) };
}

export function parseSubscribe(v: unknown): PushSubscribeRequest {
  const o = obj(v, 'body');
  const deviceId = id(o.deviceId, 'deviceId');
  const sub = obj(o.subscription, 'subscription');
  const endpoint = str(sub.endpoint, 'subscription.endpoint', LIMITS.maxEndpoint);
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw badRequest('subscription.endpoint must be a URL');
  }
  if (url.protocol !== 'https:') throw badRequest('subscription.endpoint must be https');
  const keys = obj(sub.keys, 'subscription.keys');
  // p256dh: 65-byte uncompressed point = 87 base64url chars; auth: 16 bytes = 22 chars.
  const p256dh = b64url(keys.p256dh, 'subscription.keys.p256dh', 100);
  const auth = b64url(keys.auth, 'subscription.keys.auth', 32);
  if (base64urlByteLength(p256dh) !== 65) throw badRequest('subscription.keys.p256dh must decode to 65 bytes');
  if (base64urlByteLength(auth) !== 16) throw badRequest('subscription.keys.auth must decode to 16 bytes');
  return { deviceId, subscription: { endpoint, keys: { p256dh, auth } } };
}

export function parseUnsubscribe(v: unknown): PushUnsubscribeRequest {
  const o = obj(v, 'body');
  return { deviceId: id(o.deviceId, 'deviceId') };
}

export function parseReminder(v: unknown, i: number): PushReminder {
  const o = obj(v, `reminders[${i}]`);
  return {
    key: id(o.key, `reminders[${i}].key`),
    at: int(o.at, `reminders[${i}].at`),
    title: str(o.title, `reminders[${i}].title`, LIMITS.maxTitle),
    body: str(o.body, `reminders[${i}].body`, LIMITS.maxBody, 0),
    url: str(o.url, `reminders[${i}].url`, LIMITS.maxUrl, 0),
  };
}

export function parseSchedule(v: unknown): PushScheduleRequest {
  const o = obj(v, 'body');
  const deviceId = id(o.deviceId, 'deviceId');
  if (!Array.isArray(o.reminders)) throw badRequest('reminders must be an array');
  if (o.reminders.length > LIMITS.maxReminders) throw badRequest(`At most ${LIMITS.maxReminders} reminders`);
  return { deviceId, reminders: o.reminders.map(parseReminder) };
}

/** Drops reminders in the past (beyond the grace window) and duplicate keys (last one wins). */
export function filterReminders(reminders: PushReminder[], now: number): PushReminder[] {
  const byKey = new Map<string, PushReminder>();
  for (const r of reminders) {
    if (r.at < now - LIMITS.scheduleGraceMs) continue;
    byKey.set(r.key, r);
  }
  return [...byKey.values()];
}

function base64urlByteLength(s: string): number {
  const clean = s.replace(/=+$/, '');
  return Math.floor((clean.length * 3) / 4);
}
