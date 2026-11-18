export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (message: string): HttpError => new HttpError(400, 'bad_request', message);

export function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  const h = new Headers(headers);
  h.set('Content-Type', 'application/json; charset=utf-8');
  h.set('Cache-Control', 'no-store');
  return new Response(JSON.stringify(body), { status, headers: h });
}

export function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) return json({ error: err.code, message: err.message }, err.status);
  console.error('Unhandled error', err);
  return json({ error: 'internal', message: 'Internal server error' }, 500);
}

export function parseOrigins(list: string): Set<string> {
  return new Set(
    list
      .split(',')
      .map((s) => s.trim().replace(/\/+$/, ''))
      .filter(Boolean),
  );
}

/** CORS headers for an allowed origin (or none when the request has no Origin header). */
export function corsHeaders(origin: string | null): Record<string, string> {
  if (!origin) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export function withHeaders(res: Response, headers: Record<string, string>): Response {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(headers)) out.headers.set(k, v);
  return out;
}

/** Reads and parses a JSON body, enforcing a byte limit. */
export async function readJson(request: Request, maxBytes: number): Promise<unknown> {
  const declared = request.headers.get('Content-Length');
  if (declared !== null && Number(declared) > maxBytes) {
    throw new HttpError(413, 'payload_too_large', `Body exceeds ${maxBytes} bytes`);
  }
  const buf = await request.arrayBuffer();
  if (buf.byteLength > maxBytes) throw new HttpError(413, 'payload_too_large', `Body exceeds ${maxBytes} bytes`);
  if (buf.byteLength === 0) throw badRequest('Empty body');
  try {
    return JSON.parse(new TextDecoder().decode(buf));
  } catch {
    throw badRequest('Invalid JSON');
  }
}
