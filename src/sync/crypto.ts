// Criptografía de la sincronización (cifrado de extremo a extremo). Solo Web Crypto: funciona en navegador y en Node ≥ 20.
// El código de sincronización (100 bits aleatorios) es el único secreto. De él se derivan, con PBKDF2:
//  - la clave AES-GCM con la que se cifra cada registro (nunca sale del dispositivo), y
//  - el identificador del espacio (`space`) que ve el servidor, que no permite recuperar la clave.

/** Alfabeto Crockford base32 (sin I, L, O, U). */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const CODE_LENGTH = 20;
const SALT = 'scheura-sync-v1';
const ITERATIONS = 200_000;

const subtle = () => globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();

// ---------- Código ----------

/** Código nuevo: 20 caracteres Crockford base32 (100 bits), agrupado XXXXX-XXXXX-XXXXX-XXXXX. */
export function generateSyncCode(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(13)); // 104 bits, se usan 100
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5 && out.length < CODE_LENGTH) {
      bits -= 5;
      out += ALPHABET[(value >>> bits) & 31];
    }
    value &= (1 << bits) - 1;
  }
  return formatCode(out);
}

/** Normaliza el nombre de usuario: sin espacios a los lados, minúsculas. */
export const normalizeUser = (user: string) => user.trim().toLowerCase();

/**
 * Inicio de sesión sin cuentas en el servidor: de usuario + contraseña se deriva (PBKDF2-SHA256, 600 000 iteraciones,
 * sal = 'scheura-login-v1|' + usuario) un código de sincronización determinista. El resto funciona igual que con código.
 * El servidor nunca recibe ni el usuario ni la contraseña. Si se olvida la contraseña no hay recuperación.
 */
export async function codeFromCredentials(user: string, password: string): Promise<string> {
  const u = normalizeUser(user);
  if (!u) throw new Error('Escribe un usuario');
  if (password.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres');
  const base = await subtle().importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(
    await subtle().deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(`scheura-login-v1|${u}`), iterations: 600_000 }, base, 104),
  );
  let value = 0;
  let n = 0;
  let out = '';
  for (const b of bits) {
    value = (value << 8) | b;
    n += 8;
    while (n >= 5 && out.length < CODE_LENGTH) {
      n -= 5;
      out += ALPHABET[(value >>> n) & 31];
    }
    value &= (1 << n) - 1;
  }
  return out;
}

/** Agrupa un código normalizado (o parcial) en bloques de 5 separados por guiones. */
export function formatCode(code: string): string {
  return (code.match(/.{1,5}/g) ?? []).join('-');
}

/** Limpia lo que escribe el usuario (mayúsculas, sin espacios/guiones, O→0, I/L→1) sin validar. Útil al teclear. */
export function cleanCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[\s\-_.]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
}

/** Devuelve el código normalizado (20 caracteres, sin guiones) o null si no es válido. */
export function normalizeCode(input: string): string | null {
  const c = cleanCode(input);
  if (c.length !== CODE_LENGTH) return null;
  for (const ch of c) if (!ALPHABET.includes(ch)) return null;
  return c;
}

// ---------- Claves ----------

export interface SyncKeys {
  /** Clave AES-GCM 256 no extraíble. */
  key: CryptoKey;
  /** Identificador del espacio en el servidor: hex(SHA-256(32 bytes derivados)), 64 caracteres. */
  space: string;
}

/** PBKDF2-SHA256 (200 000 iteraciones, sal fija de la app) → 64 bytes: 32 para AES-GCM y 32 para el espacio. */
export async function deriveKeys(code: string): Promise<SyncKeys> {
  const norm = normalizeCode(code);
  if (!norm) throw new Error('Código de sincronización no válido');
  const base = await subtle().importKey('raw', enc.encode(norm), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(
    await subtle().deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(SALT), iterations: ITERATIONS }, base, 512),
  );
  const key = await subtle().importKey('raw', bits.slice(0, 32), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  const digest = new Uint8Array(await subtle().digest('SHA-256', bits.slice(32)));
  bits.fill(0);
  return { key, space: toHex(digest) };
}

// ---------- Cifrado ----------

/** Cifra bytes → iv(12)‖ciphertext+tag. `aad` (opcional) liga el texto cifrado a su contexto (tabla/id). */
export async function encryptBytes(key: CryptoKey, data: Uint8Array, aad?: string): Promise<Uint8Array> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const params: AesGcmParams = aad ? { name: 'AES-GCM', iv, additionalData: enc.encode(aad) } : { name: 'AES-GCM', iv };
  const ct = new Uint8Array(await subtle().encrypt(params, key, data));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return out;
}

/** Inverso de encryptBytes. Lanza si la clave o el `aad` no coinciden o el contenido está manipulado. */
export async function decryptBytes(key: CryptoKey, data: Uint8Array, aad?: string): Promise<Uint8Array> {
  if (data.length < 12 + 16) throw new Error('Datos cifrados demasiado cortos');
  const iv = data.slice(0, 12);
  const params: AesGcmParams = aad ? { name: 'AES-GCM', iv, additionalData: enc.encode(aad) } : { name: 'AES-GCM', iv };
  return new Uint8Array(await subtle().decrypt(params, key, data.slice(12)));
}

/** Cifra un objeto JSON → base64url(iv‖ciphertext). */
export async function encryptJson(key: CryptoKey, obj: unknown, aad?: string): Promise<string> {
  return toBase64Url(await encryptBytes(key, enc.encode(JSON.stringify(obj)), aad));
}

export async function decryptJson<T = unknown>(key: CryptoKey, str: string, aad?: string): Promise<T> {
  return JSON.parse(dec.decode(await decryptBytes(key, fromBase64Url(str), aad))) as T;
}

/** Cifra bytes → base64url (para los trozos de adjuntos). */
export async function encryptChunk(key: CryptoKey, data: Uint8Array, aad?: string): Promise<string> {
  return toBase64Url(await encryptBytes(key, data, aad));
}
export async function decryptChunk(key: CryptoKey, str: string, aad?: string): Promise<Uint8Array> {
  return decryptBytes(key, fromBase64Url(str), aad);
}

// ---------- Codificaciones ----------

export function toHex(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

export function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000) as unknown as number[]);
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(str: string): Uint8Array {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
