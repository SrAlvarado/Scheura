// Independent RFC 8291 / RFC 8188 decryption (HKDF built from raw HMAC, not reusing src helpers).
import { b64urlDecode, b64urlEncode, concat } from '../src/webpush';

const utf8 = (s: string) => new Uint8Array(new TextEncoder().encode(s));

async function hmac(key: Uint8Array<ArrayBuffer>, data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}

/** RFC 5869 HKDF with a single expand block (L <= 32). */
async function hkdf(salt: Uint8Array<ArrayBuffer>, ikm: Uint8Array<ArrayBuffer>, info: Uint8Array<ArrayBuffer>, len: number) {
  const prk = await hmac(salt, ikm);
  const t1 = await hmac(prk, concat(info, new Uint8Array([1])));
  return t1.slice(0, len);
}

export interface UserAgentKeys {
  keyPair: CryptoKeyPair;
  p256dh: string;
  auth: string;
}

export async function makeUserAgent(): Promise<UserAgentKeys> {
  const keyPair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const pub = new Uint8Array((await crypto.subtle.exportKey('raw', keyPair.publicKey)) as ArrayBuffer);
  return { keyPair, p256dh: b64urlEncode(pub), auth: b64urlEncode(crypto.getRandomValues(new Uint8Array(16))) };
}

/** Decrypts an aes128gcm Web Push body as a user agent would. */
export async function decryptPushBody(body: Uint8Array<ArrayBuffer>, uaPrivate: CryptoKey, p256dh: string, auth: string) {
  const salt = body.slice(0, 16);
  const rs = new DataView(body.buffer, body.byteOffset + 16, 4).getUint32(0, false);
  const idlen = body[20]!;
  const asPublic = body.slice(21, 21 + idlen);
  const ciphertext = body.slice(21 + idlen);
  if (ciphertext.length > rs) throw new Error('more than one record');

  const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey } as SubtleCryptoDeriveKeyAlgorithm, uaPrivate, 256),
  );
  const uaPublic = b64urlDecode(p256dh);
  const prkKey = await hmac(b64urlDecode(auth), ecdh);
  const ikm = (await hmac(prkKey, concat(utf8('WebPush: info\0'), uaPublic, asPublic, new Uint8Array([1])))).slice(0, 32);
  const cek = await hkdf(salt, ikm, utf8('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, utf8('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const padded = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, ciphertext));
  // Strip padding: trailing zeros, then the delimiter, which must be 0x02 for the last record.
  let end = padded.length - 1;
  while (end >= 0 && padded[end] === 0) end--;
  if (padded[end] !== 2) throw new Error(`bad padding delimiter ${padded[end]}`);
  return { plaintext: padded.slice(0, end), rs, asPublic, salt };
}
