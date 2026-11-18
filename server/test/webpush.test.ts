import { describe, expect, it } from 'vitest';
import {
  b64urlDecode,
  b64urlEncode,
  buildPayload,
  buildPushRequest,
  encryptPayload,
  importVapidKeys,
  MAX_PAYLOAD_BYTES,
  vapidAuthorization,
  vapidJwt,
} from '../src/webpush';
import { decryptPushBody, makeUserAgent } from './helpers';

const utf8 = (s: string) => new Uint8Array(new TextEncoder().encode(s));
const text = (b: Uint8Array) => new TextDecoder().decode(b);

async function makeVapid() {
  const kp = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey('jwk', kp.privateKey)) as JsonWebKey;
  const pub = b64urlEncode((await crypto.subtle.exportKey('raw', kp.publicKey)) as ArrayBuffer);
  return { kp, jwk: JSON.stringify(jwk), pub };
}

describe('RFC 8291 encryption', () => {
  it('round-trips: a user agent can decrypt what we encrypt', async () => {
    const ua = await makeUserAgent();
    const msg = JSON.stringify({ title: 'Examen', body: 'Mañana: Cálculo', url: '#/examen/1', tag: 'k' });
    const body = await encryptPayload(ua, utf8(msg));
    const out = await decryptPushBody(body, ua.keyPair.privateKey, ua.p256dh, ua.auth);
    expect(text(out.plaintext)).toBe(msg);
    expect(out.rs).toBe(4096);
    expect(out.asPublic.length).toBe(65);
    expect(out.asPublic[0]).toBe(4);
    // 16 salt + 4 rs + 1 idlen + 65 keyid + plaintext + 1 delimiter + 16 tag
    expect(body.length).toBe(86 + utf8(msg).length + 1 + 16);
  });

  it('uses a fresh salt and sender key per message', async () => {
    const ua = await makeUserAgent();
    const a = await encryptPayload(ua, utf8('x'));
    const b = await encryptPayload(ua, utf8('x'));
    expect(b64urlEncode(a.slice(0, 86))).not.toBe(b64urlEncode(b.slice(0, 86)));
  });

  it('matches the RFC 8291 Appendix A test vector', async () => {
    const asPub = b64urlDecode('BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8');
    const jwkFor = (pub: Uint8Array, d: string): JsonWebKey => ({
      kty: 'EC',
      crv: 'P-256',
      x: b64urlEncode(pub.slice(1, 33)),
      y: b64urlEncode(pub.slice(33, 65)),
      d,
      ext: true,
    });
    const asPrivate = await crypto.subtle.importKey(
      'jwk',
      jwkFor(asPub, 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw'),
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveBits'],
    );
    const asPublic = await crypto.subtle.importKey('raw', asPub, { name: 'ECDH', namedCurve: 'P-256' }, true, []);
    const body = await encryptPayload(
      {
        p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
        auth: 'BTBZMqHH6r4Tts7J_aSIgg',
      },
      utf8('When I grow up, I want to be a watermelon'),
      { salt: b64urlDecode('DGv6ra1nlYgDCS1FRnbzlw'), senderKeys: { privateKey: asPrivate, publicKey: asPublic } },
    );
    expect(b64urlEncode(body)).toBe(
      'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
    );
  });

  it('rejects oversized payloads and shortens long notification bodies', async () => {
    const ua = await makeUserAgent();
    await expect(encryptPayload(ua, new Uint8Array(5000))).rejects.toThrow(/too large/);
    const p = buildPayload({ title: 'T', body: 'ñ'.repeat(3000), url: '#/', tag: 'k' });
    expect(p.length).toBeLessThanOrEqual(MAX_PAYLOAD_BYTES);
    const parsed = JSON.parse(text(p));
    expect(parsed.title).toBe('T');
    expect(parsed.body.endsWith('…')).toBe(true);
  });
});

describe('VAPID', () => {
  it('signs an ES256 JWT that verifies with the public key', async () => {
    const v = await makeVapid();
    const keys = await importVapidKeys(v.jwk, v.pub, 'https://sralvarado.github.io/Scheura/');
    const now = 1_700_000_000;
    const jwt = await vapidJwt(keys, 'https://fcm.googleapis.com', now);
    const [h, c, s] = jwt.split('.') as [string, string, string];
    expect(JSON.parse(text(b64urlDecode(h)))).toEqual({ typ: 'JWT', alg: 'ES256' });
    expect(JSON.parse(text(b64urlDecode(c)))).toEqual({
      aud: 'https://fcm.googleapis.com',
      exp: now + 12 * 3600,
      sub: 'https://sralvarado.github.io/Scheura/',
    });
    const sig = b64urlDecode(s);
    expect(sig.length).toBe(64);
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, v.kp.publicKey, sig, utf8(`${h}.${c}`));
    expect(ok).toBe(true);
    const tampered = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, v.kp.publicKey, sig, utf8(`${h}.${c}x`));
    expect(tampered).toBe(false);
    expect(vapidAuthorization(jwt, v.pub)).toBe(`vapid t=${jwt}, k=${v.pub}`);
  });

  it('refuses a public key that does not match the private JWK', async () => {
    const a = await makeVapid();
    const b = await makeVapid();
    await expect(importVapidKeys(a.jwk, b.pub, 'mailto:x@example.com')).rejects.toThrow(/does not match/);
  });

  it('the configured VAPID public key is a valid uncompressed P-256 point', async () => {
    const pub = b64urlDecode('BFOJ_jdQYFbD2kjaBZYyoR2k6Ds86ISKE2MrGw_kTZ7sFs6nQwZuZ1pIbXGMtiPFaKL9u4o0inL4-__Uv5FoBV8');
    expect(pub.length).toBe(65);
    await expect(crypto.subtle.importKey('raw', pub, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify'])).resolves.toBeTruthy();
  });

  it('builds a complete push request (headers + decryptable body)', async () => {
    const v = await makeVapid();
    const keys = await importVapidKeys(v.jwk, v.pub, 'mailto:x@example.com');
    const ua = await makeUserAgent();
    const cache = new Map<string, string>();
    const req = await buildPushRequest(
      { endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/abc', p256dh: ua.p256dh, auth: ua.auth },
      { title: 'Hola', body: 'Cuerpo', url: '#/tarea/1', tag: 'r1' },
      keys,
      cache,
    );
    expect(req.method).toBe('POST');
    expect(req.headers.get('Content-Encoding')).toBe('aes128gcm');
    expect(req.headers.get('TTL')).toBe('86400');
    expect(req.headers.get('Urgency')).toBe('high');
    const auth = req.headers.get('Authorization')!;
    expect(auth).toMatch(new RegExp(`^vapid t=[\\w-]+\\.[\\w-]+\\.[\\w-]+, k=${v.pub}$`));
    expect(cache.has('https://updates.push.services.mozilla.com')).toBe(true);
    const claims = JSON.parse(text(b64urlDecode(auth.slice(8).split('.')[1]!)));
    expect(claims.aud).toBe('https://updates.push.services.mozilla.com');
    const body = new Uint8Array(await req.arrayBuffer());
    const out = await decryptPushBody(body, ua.keyPair.privateKey, ua.p256dh, ua.auth);
    expect(JSON.parse(text(out.plaintext))).toEqual({ title: 'Hola', body: 'Cuerpo', url: '#/tarea/1', tag: 'r1' });
  });
});
