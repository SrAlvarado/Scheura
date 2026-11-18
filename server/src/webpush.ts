/**
 * Web Push with WebCrypto only:
 *  - VAPID (RFC 8292): ES256 JWT, `Authorization: vapid t=<jwt>, k=<publicKey>`.
 *  - Message encryption (RFC 8291) with the `aes128gcm` content coding (RFC 8188), single record.
 */

const encoder = new TextEncoder();
const utf8 = (s: string): Uint8Array<ArrayBuffer> => new Uint8Array(encoder.encode(s));

export function b64urlEncode(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]!);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

async function hkdf(salt: Uint8Array<ArrayBuffer>, ikm: Uint8Array<ArrayBuffer>, info: Uint8Array<ArrayBuffer>, bytes: number) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8);
  return new Uint8Array(bits);
}

// ---------------------------------------------------------------- VAPID

export interface VapidKeys {
  /** base64url raw uncompressed public key (65 bytes). */
  publicKey: string;
  privateKey: CryptoKey;
  subject: string;
}

export async function importVapidKeys(privateJwk: string, publicKey: string, subject: string): Promise<VapidKeys> {
  const jwk = JSON.parse(privateJwk) as JsonWebKey;
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.d || !jwk.x || !jwk.y) {
    throw new Error('VAPID_PRIVATE_JWK must be an EC P-256 private JWK');
  }
  const pub = b64urlDecode(publicKey);
  const expected = concat(new Uint8Array([4]), b64urlDecode(jwk.x), b64urlDecode(jwk.y));
  if (pub.length !== 65 || b64urlEncode(pub) !== b64urlEncode(expected)) {
    throw new Error('VAPID_PUBLIC_KEY does not match VAPID_PRIVATE_JWK');
  }
  const privateKey = await crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, d: jwk.d, ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  return { publicKey, privateKey, subject };
}

/** Signed ES256 JWT for the push service at `audience` (origin of the endpoint). */
export async function vapidJwt(keys: VapidKeys, audience: string, nowSec = Math.floor(Date.now() / 1000)): Promise<string> {
  const header = b64urlEncode(utf8(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64urlEncode(utf8(JSON.stringify({ aud: audience, exp: nowSec + 12 * 3600, sub: keys.subject })));
  const input = `${header}.${claims}`;
  // WebCrypto returns the IEEE P1363 r||s form (64 bytes), which is exactly what JWS ES256 wants.
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, utf8(input));
  return `${input}.${b64urlEncode(sig)}`;
}

export function vapidAuthorization(jwt: string, publicKey: string): string {
  return `vapid t=${jwt}, k=${publicKey}`;
}

// ---------------------------------------------------------------- RFC 8291 encryption

export interface PushSubscriptionKeys {
  /** base64url uncompressed P-256 public key of the user agent (65 bytes). */
  p256dh: string;
  /** base64url 16-byte auth secret. */
  auth: string;
}

/** Record size written in the header. Single record: plaintext + 1 delimiter + 16 tag must fit. */
export const RECORD_SIZE = 4096;

export interface EncryptOptions {
  /** Test hooks: fixed salt / sender key pair (production uses fresh random values per message). */
  salt?: Uint8Array<ArrayBuffer>;
  senderKeys?: CryptoKeyPair;
}

/** Encrypts `plaintext` into an `aes128gcm` body (header + single record). */
export async function encryptPayload(
  sub: PushSubscriptionKeys,
  plaintext: Uint8Array<ArrayBuffer>,
  opts: EncryptOptions = {},
): Promise<Uint8Array<ArrayBuffer>> {
  if (plaintext.length + 1 + 16 > RECORD_SIZE) throw new Error('Push payload too large');
  const uaPublic = b64urlDecode(sub.p256dh);
  const authSecret = b64urlDecode(sub.auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error('Invalid p256dh');
  if (authSecret.length !== 16) throw new Error('Invalid auth secret');

  const salt = opts.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const asKeys =
    opts.senderKeys ??
    ((await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair);
  const asPublic = new Uint8Array((await crypto.subtle.exportKey('raw', asKeys.publicKey)) as ArrayBuffer);
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey } as SubtleCryptoDeriveKeyAlgorithm, asKeys.privateKey, 256),
  );

  // RFC 8291 §3.4: IKM = HKDF(auth_secret, ecdh_secret, "WebPush: info" 0x00 ua_public as_public, 32)
  const keyInfo = concat(utf8('WebPush: info\0'), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);
  // RFC 8188 §2.2 / §2.3
  const cek = await hkdf(salt, ikm, utf8('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, utf8('Content-Encoding: nonce\0'), 12);

  // Single (last) record: plaintext followed by the 0x02 padding delimiter, no extra padding.
  const record = concat(plaintext, new Uint8Array([2]));
  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, record));

  // Header: salt(16) | rs(uint32 BE) | idlen(1) | keyid(as_public, 65)
  const header = new Uint8Array(16 + 4 + 1 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE, false);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, ciphertext);
}

// ---------------------------------------------------------------- sending

export interface PushMessage {
  title: string;
  body: string;
  url: string;
  tag: string;
}

/** Max plaintext JSON bytes; push services accept 4096-byte bodies (header 86 + tag 16 + delimiter 1). */
export const MAX_PAYLOAD_BYTES = 3800;

/** Serializes the notification JSON, shortening `body` (then `title`) if it would not fit. */
export function buildPayload(msg: PushMessage): Uint8Array<ArrayBuffer> {
  let { title, body } = msg;
  for (;;) {
    const bytes = utf8(JSON.stringify({ title, body, url: msg.url, tag: msg.tag }));
    if (bytes.length <= MAX_PAYLOAD_BYTES) return bytes;
    if (body.length > 0) body = body.slice(0, Math.max(0, Math.floor(body.length * 0.8) - 1)) + (body.length > 1 ? '…' : '');
    else if (title.length > 1) title = title.slice(0, Math.floor(title.length * 0.8));
    else throw new Error('Push payload too large');
  }
}

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Builds the HTTP request for one push (exposed for tests). */
export async function buildPushRequest(
  target: PushTarget,
  msg: PushMessage,
  vapid: VapidKeys,
  jwtCache?: Map<string, string>,
): Promise<Request> {
  const audience = new URL(target.endpoint).origin;
  let jwt = jwtCache?.get(audience);
  if (!jwt) {
    jwt = await vapidJwt(vapid, audience);
    jwtCache?.set(audience, jwt);
  }
  const body = await encryptPayload({ p256dh: target.p256dh, auth: target.auth }, buildPayload(msg));
  return new Request(target.endpoint, {
    method: 'POST',
    headers: {
      Authorization: vapidAuthorization(jwt, vapid.publicKey),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '86400',
      Urgency: 'high',
    },
    body,
  });
}

/** Sends one push. Returns the HTTP status (0 on network error). */
export async function sendPush(
  target: PushTarget,
  msg: PushMessage,
  vapid: VapidKeys,
  jwtCache?: Map<string, string>,
): Promise<number> {
  try {
    const res = await fetch(await buildPushRequest(target, msg, vapid, jwtCache));
    if (res.status >= 400) console.warn('push failed', res.status, new URL(target.endpoint).host, await res.text().catch(() => ''));
    else await res.body?.cancel();
    return res.status;
  } catch (err) {
    console.warn('push network error', err);
    return 0;
  }
}
