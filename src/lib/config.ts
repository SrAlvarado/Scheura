// Configuración de build (variables VITE_* en .env.local o en GitHub Actions).
/** URL base del servidor (Cloudflare Worker), sin barra final. Vacío = sincronización y push desactivados. */
export const API_URL: string = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
/** Clave pública VAPID (base64url) para Web Push. */
export const VAPID_PUBLIC_KEY: string = import.meta.env.VITE_VAPID_PUBLIC_KEY ?? 'BFOJ_jdQYFbD2kjaBZYyoR2k6Ds86ISKE2MrGw_kTZ7sFs6nQwZuZ1pIbXGMtiPFaKL9u4o0inL4-__Uv5FoBV8';
export const serverEnabled = () => API_URL.length > 0;
