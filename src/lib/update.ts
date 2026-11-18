// Actualización de la app (service worker de vite-plugin-pwa, modo autoUpdate).
// - Al volver a la app (visibilitychange) se comprueba si hay versión nueva; si la hay, se instala y la página se recarga sola.
// - checkForUpdate() lo usa el botón «Buscar actualizaciones» de Ajustes.
import { registerSW } from 'virtual:pwa-register';

let registration: ServiceWorkerRegistration | undefined;
let updateSW: ((reload?: boolean) => Promise<void>) | undefined;

export const APP_VERSION = '0.3.0';

export function initUpdates() {
  updateSW = registerSW({
    immediate: true,
    onRegisteredSW(_url, reg) {
      registration = reg;
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg?.update().catch(() => undefined);
      });
      setInterval(() => reg?.update().catch(() => undefined), 30 * 60_000);
    },
  });
}

/** Busca una versión nueva. Si la hay, la activa y recarga (devuelve 'updating'); si no, 'latest'. */
export async function checkForUpdate(): Promise<'updating' | 'latest' | 'unsupported'> {
  if (!('serviceWorker' in navigator)) return 'unsupported';
  const reg = registration ?? (await navigator.serviceWorker.getRegistration());
  if (!reg) return 'unsupported';
  await reg.update();
  const waiting = reg.waiting ?? reg.installing;
  if (waiting) {
    if (updateSW) await updateSW(true);
    else { waiting.postMessage({ type: 'SKIP_WAITING' }); location.reload(); }
    return 'updating';
  }
  return 'latest';
}

/** Recarga forzada (por si algo se queda en caché). */
export function hardReload() {
  location.reload();
}
