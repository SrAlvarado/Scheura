import type { Env } from './env';
import { corsHeaders, errorResponse, HttpError, json, parseOrigins, readJson, withHeaders } from './http';
import { runCron, schedule, subscribe, unsubscribe } from './push';
import { runSync } from './sync';
import { LIMITS, parseSchedule, parseSubscribe, parseSyncRequest, parseUnsubscribe } from './validate';

export type { Env } from './env';

type Handler = (request: Request, env: Env) => Promise<Response>;

const routes: Record<string, Partial<Record<string, Handler>>> = {
  '/v1/health': {
    GET: async () => json({ ok: true }),
  },
  '/v1/sync': {
    POST: async (request, env) => {
      const req = parseSyncRequest(await readJson(request, LIMITS.syncBodyBytes));
      return json(await runSync(env.DB, req, Date.now()));
    },
  },
  '/v1/push/subscribe': {
    POST: async (request, env) => {
      const req = parseSubscribe(await readJson(request, LIMITS.pushBodyBytes));
      await subscribe(env.DB, req, Date.now());
      return json({ ok: true });
    },
    DELETE: async (request, env) => {
      const req = parseUnsubscribe(await readJson(request, LIMITS.pushBodyBytes));
      await unsubscribe(env.DB, req.deviceId);
      return json({ ok: true });
    },
  },
  '/v1/push/schedule': {
    PUT: async (request, env) => {
      const req = parseSchedule(await readJson(request, LIMITS.pushBodyBytes));
      const scheduled = await schedule(env.DB, req, Date.now());
      return json({ ok: true, scheduled });
    },
  },
};

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const origin = request.headers.get('Origin');
  const allowed = parseOrigins(env.ALLOWED_ORIGINS ?? '');
  const originOk = origin === null || allowed.has(origin);
  const cors = originOk ? corsHeaders(origin) : {};

  if (!originOk) {
    return json({ error: 'forbidden_origin', message: 'Origin not allowed' }, 403, { Vary: 'Origin' });
  }

  const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
  const route = routes[path];

  if (request.method === 'OPTIONS') {
    if (!route) return withHeaders(json({ error: 'not_found', message: 'Not found' }, 404), cors);
    return new Response(null, { status: 204, headers: cors });
  }

  try {
    if (!route) throw new HttpError(404, 'not_found', 'Not found');
    const handler = route[request.method];
    if (!handler) {
      const res = json({ error: 'method_not_allowed', message: 'Method not allowed' }, 405, {
        Allow: [...Object.keys(route), 'OPTIONS'].join(', '),
      });
      return withHeaders(res, cors);
    }
    return withHeaders(await handler(request, env), cors);
  } catch (err) {
    return withHeaders(errorResponse(err), cors);
  }
}

export default {
  fetch: handleRequest,
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      runCron(env).then(
        (s) => {
          if (s.sent + s.gone + s.failed + s.retry > 0) console.log('cron push', JSON.stringify(s));
        },
        (err: unknown) => console.error('cron failed', err),
      ),
    );
  },
} satisfies ExportedHandler<Env>;
