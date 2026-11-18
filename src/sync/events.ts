// Bus mínimo: avisa cuando cambian datos locales (lo emiten los hooks de Dexie) o cuando llegan datos remotos.
type Listener = () => void;
const local = new Set<Listener>();
const remote = new Set<Listener>();

/** Se llama tras cualquier escritura local (crear/editar/borrar) que no venga de la sincronización. */
export const onLocalChange = (fn: Listener) => { local.add(fn); return () => local.delete(fn); };
/** Se llama tras aplicar cambios descargados del servidor. */
export const onRemoteChange = (fn: Listener) => { remote.add(fn); return () => remote.delete(fn); };

let t: ReturnType<typeof setTimeout> | undefined;
/** Agrupa ráfagas de escrituras (300 ms). */
export function emitLocalChange() {
  clearTimeout(t);
  t = setTimeout(() => local.forEach((fn) => fn()), 300);
}
export const emitRemoteChange = () => remote.forEach((fn) => fn());
