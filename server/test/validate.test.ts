import { describe, expect, it } from 'vitest';
import { HttpError } from '../src/http';
import { filterReminders, LIMITS, parseSchedule, parseSubscribe, parseSyncRequest } from '../src/validate';

const SPACE = 'a'.repeat(64);
const bad = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(HttpError);
    expect((e as HttpError).status).toBe(400);
    return;
  }
  throw new Error('expected a 400');
};

describe('parseSyncRequest', () => {
  it('accepts a valid request and drops data from tombstones', () => {
    const r = parseSyncRequest({
      space: SPACE,
      cursor: 0,
      changes: [
        { table: 'tasks', id: 't1', updatedAt: 5, deleted: false, data: 'abc' },
        { table: 'chunks', id: 'c1', updatedAt: 6, deleted: true, data: 'ignored' },
      ],
    });
    expect(r.changes[1]).toEqual({ table: 'chunks', id: 'c1', updatedAt: 6, deleted: true });
  });

  it('defaults missing changes to []', () => {
    expect(parseSyncRequest({ space: SPACE, cursor: 3 }).changes).toEqual([]);
  });

  it.each([
    ['not an object', []],
    ['short space', { space: 'abc', cursor: 0, changes: [] }],
    ['uppercase space', { space: 'A'.repeat(64), cursor: 0, changes: [] }],
    ['negative cursor', { space: SPACE, cursor: -1, changes: [] }],
    ['float cursor', { space: SPACE, cursor: 1.5, changes: [] }],
    ['changes not array', { space: SPACE, cursor: 0, changes: {} }],
    ['unknown table', { space: SPACE, cursor: 0, changes: [{ table: 'users', id: 'x', updatedAt: 1, deleted: true }] }],
    ['long id', { space: SPACE, cursor: 0, changes: [{ table: 'tasks', id: 'x'.repeat(129), updatedAt: 1, deleted: true }] }],
    ['empty id', { space: SPACE, cursor: 0, changes: [{ table: 'tasks', id: '', updatedAt: 1, deleted: true }] }],
    ['string updatedAt', { space: SPACE, cursor: 0, changes: [{ table: 'tasks', id: 'x', updatedAt: '1', deleted: true }] }],
    ['missing deleted', { space: SPACE, cursor: 0, changes: [{ table: 'tasks', id: 'x', updatedAt: 1 }] }],
    ['missing data', { space: SPACE, cursor: 0, changes: [{ table: 'tasks', id: 'x', updatedAt: 1, deleted: false }] }],
  ])('rejects %s', (_name, body) => bad(() => parseSyncRequest(body)));

  it('enforces data size and change count limits', () => {
    const big = 'x'.repeat(LIMITS.maxDataLength + 1);
    bad(() => parseSyncRequest({ space: SPACE, cursor: 0, changes: [{ table: 'chunks', id: 'c', updatedAt: 1, deleted: false, data: big }] }));
    const ok = 'x'.repeat(LIMITS.maxDataLength);
    expect(parseSyncRequest({ space: SPACE, cursor: 0, changes: [{ table: 'chunks', id: 'c', updatedAt: 1, deleted: false, data: ok }] }).changes).toHaveLength(1);
    const many = Array.from({ length: 501 }, (_, i) => ({ table: 'tasks', id: `t${i}`, updatedAt: 1, deleted: true }));
    bad(() => parseSyncRequest({ space: SPACE, cursor: 0, changes: many }));
    expect(parseSyncRequest({ space: SPACE, cursor: 0, changes: many.slice(0, 500) }).changes).toHaveLength(500);
  });
});

describe('push validation', () => {
  const p256dh = 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4';
  const auth = 'BTBZMqHH6r4Tts7J_aSIgg';
  const sub = (o: Record<string, unknown> = {}) => ({
    deviceId: 'dev-1',
    subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/x', keys: { p256dh, auth } },
    ...o,
  });

  it('accepts a valid subscription', () => {
    expect(parseSubscribe(sub()).subscription.keys.auth).toBe(auth);
  });

  it('rejects bad subscriptions', () => {
    bad(() => parseSubscribe(sub({ deviceId: '' })));
    bad(() => parseSubscribe(sub({ subscription: { endpoint: 'http://x.com/a', keys: { p256dh, auth } } })));
    bad(() => parseSubscribe(sub({ subscription: { endpoint: 'nope', keys: { p256dh, auth } } })));
    bad(() => parseSubscribe(sub({ subscription: { endpoint: 'https://x.com', keys: { p256dh: 'AAAA', auth } } })));
    bad(() => parseSubscribe(sub({ subscription: { endpoint: 'https://x.com', keys: { p256dh, auth: 'a+b/' } } })));
  });

  it('validates schedules', () => {
    const r = { key: 'k', at: 10, title: 't', body: '', url: '#/' };
    expect(parseSchedule({ deviceId: 'd', reminders: [r] }).reminders).toHaveLength(1);
    bad(() => parseSchedule({ deviceId: 'd', reminders: [{ ...r, title: '' }] }));
    bad(() => parseSchedule({ deviceId: 'd', reminders: [{ ...r, at: 'soon' }] }));
    bad(() => parseSchedule({ deviceId: 'd', reminders: [{ ...r, body: 'x'.repeat(1001) }] }));
    bad(() => parseSchedule({ deviceId: 'd', reminders: Array.from({ length: 501 }, () => r) }));
    bad(() => parseSchedule({ deviceId: 'd' }));
  });

  it('filters past reminders (5 min grace) and duplicate keys', () => {
    const now = 1_000_000_000;
    const out = filterReminders(
      [
        { key: 'old', at: now - 5 * 60_000 - 1, title: 't', body: '', url: '' },
        { key: 'grace', at: now - 60_000, title: 't', body: '', url: '' },
        { key: 'dup', at: now + 1, title: 'first', body: '', url: '' },
        { key: 'dup', at: now + 2, title: 'second', body: '', url: '' },
      ],
      now,
    );
    expect(out.map((r) => r.key)).toEqual(['grace', 'dup']);
    expect(out[1]!.title).toBe('second');
  });
});
