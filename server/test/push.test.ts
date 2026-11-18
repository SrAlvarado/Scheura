import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleRequest, type Env } from '../src/index';
import { classifyStatus, runCron } from '../src/push';
import { b64urlEncode } from '../src/webpush';
import { createTestDb } from './d1';
import { decryptPushBody, makeUserAgent, type UserAgentKeys } from './helpers';

const NOW = Date.now();

async function setup() {
  const { db, raw } = createTestDb();
  const kp = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const env: Env = {
    DB: db,
    ALLOWED_ORIGINS: 'https://sralvarado.github.io',
    VAPID_PUBLIC_KEY: b64urlEncode((await crypto.subtle.exportKey('raw', kp.publicKey)) as ArrayBuffer),
    VAPID_SUBJECT: 'https://sralvarado.github.io/Scheura/',
    VAPID_PRIVATE_JWK: JSON.stringify(await crypto.subtle.exportKey('jwk', kp.privateKey)),
  };
  const call = async (method: string, path: string, body: unknown) => {
    const res = await handleRequest(new Request(`https://api.test${path}`, { method, body: JSON.stringify(body) }), env);
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  const subscribe = (deviceId: string, ua: UserAgentKeys, endpoint = `https://push.example/${deviceId}`) =>
    call('POST', '/v1/push/subscribe', { deviceId, subscription: { endpoint, keys: { p256dh: ua.p256dh, auth: ua.auth } } });
  const queue = () => raw.prepare('SELECT device_id, key, at, sent FROM push_queue ORDER BY device_id, key').all();
  return { env, raw, call, subscribe, queue };
}

const rem = (key: string, at: number, title = `T ${key}`) => ({ key, at, title, body: 'b', url: `#/x/${key}` });

afterEach(() => vi.unstubAllGlobals());

describe('push endpoints', () => {
  it('subscribe upserts, schedule replaces unsent rows, unsubscribe deletes everything', async () => {
    const { call, subscribe, queue, raw } = await setup();
    const ua = await makeUserAgent();
    expect((await subscribe('d1', ua)).status).toBe(200);
    expect((await subscribe('d1', ua, 'https://push.example/new')).status).toBe(200);
    expect(raw.prepare('SELECT endpoint FROM push_subs').all()).toEqual([{ endpoint: 'https://push.example/new' }]);

    const r = await call('PUT', '/v1/push/schedule', {
      deviceId: 'd1',
      reminders: [rem('a', NOW + 60_000), rem('b', NOW + 120_000), rem('old', NOW - 10 * 60_000)],
    });
    expect(r.body).toEqual({ ok: true, scheduled: 2 });
    expect(queue().map((q) => q.key)).toEqual(['a', 'b']);

    await call('PUT', '/v1/push/schedule', { deviceId: 'd1', reminders: [rem('c', NOW + 60_000)] });
    expect(queue().map((q) => q.key)).toEqual(['c']);

    expect((await call('DELETE', '/v1/push/subscribe', { deviceId: 'd1' })).status).toBe(200);
    expect(queue()).toEqual([]);
    expect(raw.prepare('SELECT * FROM push_subs').all()).toEqual([]);
  });

  it('rescheduling a sent key at the same time does not re-arm it; a new time does', async () => {
    const { call, queue, raw } = await setup();
    await call('PUT', '/v1/push/schedule', { deviceId: 'd1', reminders: [rem('a', NOW + 1000), rem('b', NOW + 1000)] });
    raw.exec('UPDATE push_queue SET sent = 1');
    await call('PUT', '/v1/push/schedule', { deviceId: 'd1', reminders: [rem('a', NOW + 1000), rem('b', NOW + 5000)] });
    expect(queue().map((q) => [q.key, q.sent])).toEqual([
      ['a', 1],
      ['b', 0],
    ]);
  });
});

describe('cron', () => {
  it('classifies push service responses', () => {
    expect(classifyStatus(201)).toBe('sent');
    expect(classifyStatus(410)).toBe('gone');
    expect(classifyStatus(404)).toBe('gone');
    expect(classifyStatus(429)).toBe('retry');
    expect(classifyStatus(503)).toBe('retry');
    expect(classifyStatus(0)).toBe('retry');
    expect(classifyStatus(400)).toBe('failed');
  });

  it('sends due pushes, marks sent, drops gone subscriptions, retries 5xx, cleans old rows', async () => {
    const { env, call, subscribe, queue, raw } = await setup();
    const ok = await makeUserAgent();
    const gone = await makeUserAgent();
    const flaky = await makeUserAgent();
    await subscribe('ok', ok);
    await subscribe('gone', gone);
    await subscribe('flaky', flaky);
    await call('PUT', '/v1/push/schedule', { deviceId: 'ok', reminders: [rem('due', NOW + 10_000, 'Examen'), rem('later', NOW + 3600_000)] });
    await call('PUT', '/v1/push/schedule', { deviceId: 'gone', reminders: [rem('g1', NOW), rem('g2', NOW + 3600_000)] });
    await call('PUT', '/v1/push/schedule', { deviceId: 'flaky', reminders: [rem('f1', NOW - 1000)] });
    raw.prepare("INSERT INTO push_queue VALUES ('ok','ancient',?,'t','b','u',1)").run(NOW - 8 * 86400_000);

    const requests: Request[] = [];
    vi.stubGlobal('fetch', async (req: Request) => {
      requests.push(req);
      const host = new URL(req.url).pathname;
      if (host === '/gone') return new Response('', { status: 410 });
      if (host === '/flaky') return new Response('', { status: 503 });
      return new Response(null, { status: 201 });
    });

    const stats = await runCron(env, NOW);
    expect(stats).toEqual({ sent: 1, gone: 1, failed: 0, retry: 1 });
    expect(requests).toHaveLength(3);

    const okReq = requests.find((r) => r.url.endsWith('/ok'))!;
    const out = await decryptPushBody(new Uint8Array(await okReq.arrayBuffer()), ok.keyPair.privateKey, ok.p256dh, ok.auth);
    expect(JSON.parse(new TextDecoder().decode(out.plaintext))).toEqual({ title: 'Examen', body: 'b', url: '#/x/due', tag: 'due' });
    expect(okReq.headers.get('Authorization')).toMatch(/^vapid t=.+, k=/);

    expect(queue().map((q) => [q.device_id, q.key, q.sent])).toEqual([
      ['flaky', 'f1', 0],
      ['ok', 'due', 1],
      ['ok', 'later', 0],
    ]);
    expect(raw.prepare('SELECT device_id FROM push_subs ORDER BY device_id').all().map((r) => r.device_id)).toEqual(['flaky', 'ok']);

    // Next tick: nothing new for 'ok'; flaky retried.
    requests.length = 0;
    await runCron(env, NOW + 60_000);
    expect(requests.map((r) => new URL(r.url).pathname)).toEqual(['/flaky']);
  });

  it('drops stale reminders without sending and respects PUSH_BATCH', async () => {
    const { env, call, subscribe, queue, raw } = await setup();
    await subscribe('d', await makeUserAgent());
    await call('PUT', '/v1/push/schedule', { deviceId: 'd', reminders: [rem('a', NOW), rem('b', NOW), rem('c', NOW)] });
    raw.prepare("INSERT INTO push_queue VALUES ('d','stale',?,'t','b','u',0)").run(NOW - 7 * 3600_000);
    const fetchSpy = vi.fn(async () => new Response(null, { status: 201 }));
    vi.stubGlobal('fetch', fetchSpy);
    await runCron({ ...env, PUSH_BATCH: '2' }, NOW);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(queue().filter((q) => q.sent === 0)).toHaveLength(1);
    expect(queue().find((q) => q.key === 'stale')!.sent).toBe(1);
  });

  it('does nothing (and does not throw) without the VAPID secret', async () => {
    const { env } = await setup();
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await runCron({ ...env, VAPID_PRIVATE_JWK: undefined }, NOW)).toEqual({ sent: 0, gone: 0, failed: 0, retry: 0 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
