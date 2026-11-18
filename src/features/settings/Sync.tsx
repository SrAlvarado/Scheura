import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ConfirmSheet, NavBar, Sheet, useToast } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { serverEnabled } from '../../lib/config';
import { cleanCode, formatCode, generateSyncCode, normalizeCode } from '../../sync/crypto';
import LoginForm from './LoginForm';
import { getMeta, setMeta } from '../../db/db';
import { disableSync, enableSync, getFullSyncCode, syncNow, useSyncState } from '../../sync/engine';
import { encodeQr, qrPath } from '../../sync/qr';
import './settings.css';
import './sync.css';

const WARNING = 'Guarda el código: es la única forma de unir otro dispositivo. Quien lo tenga puede ver tus datos.';

function syncUrl(code: string) {
  return `${location.origin}${location.pathname}#/sync?code=${code}`;
}

function ago(ms: number, now: number): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 45) return 'hace un momento';
  const m = Math.round(s / 60);
  if (m < 60) return m === 1 ? 'hace 1 minuto' : `hace ${m} minutos`;
  const h = Math.round(m / 60);
  if (h < 24) return h === 1 ? 'hace 1 hora' : `hace ${h} horas`;
  const d = Math.round(h / 24);
  return d === 1 ? 'hace 1 día' : `hace ${d} días`;
}

function Qr({ text }: { text: string }) {
  const qr = useMemo(() => encodeQr(text), [text]);
  const n = qr.size + 8;
  return (
    <svg className="sync-qr" viewBox={`0 0 ${n} ${n}`} shapeRendering="crispEdges" role="img" aria-label="Código QR para unir otro dispositivo">
      <rect width={n} height={n} fill="#fff" />
      <path d={qrPath(qr)} fill="#111" />
    </svg>
  );
}

export default function Sync() {
  const state = useSyncState();
  const toast = useToast();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const linkCode = params.get('code');

  const [fullCode, setFullCode] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [input, setInput] = useState('');
  const [confirmJoin, setConfirmJoin] = useState<string | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const handledLink = useRef(false);
  const [mode, setMode] = useState<'login' | 'code'>('login');
  const [account, setAccount] = useState<string | undefined>();

  const enabled = !!state?.enabled;

  useEffect(() => {
    let alive = true;
    getFullSyncCode().then((c) => alive && setFullCode(c));
    return () => { alive = false; };
  }, [enabled, state?.code]);

  useEffect(() => {
    getMeta<string>('sync.user').then(setAccount);
  }, [enabled]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => setNow(Date.now()), [state?.lastSyncAt]);

  // Enlace / QR: #/sync?code=… → prellenar y pedir confirmación
  useEffect(() => {
    if (!linkCode || !state || handledLink.current || !serverEnabled()) return;
    if (enabled && fullCode === null) return; // esperar a conocer el código actual
    handledLink.current = true;
    const norm = normalizeCode(linkCode);
    if (!norm) {
      toast.show({ text: 'El código del enlace no es válido' });
      return;
    }
    if (enabled && fullCode && normalizeCode(fullCode) === norm) {
      toast.show({ text: 'Este dispositivo ya está sincronizado con ese código' });
      nav('/ajustes/sincronizar', { replace: true });
      return;
    }
    setJoining(true);
    setInput(formatCode(norm));
    setConfirmJoin(norm);
  }, [linkCode, state, enabled, fullCode, nav, toast]);

  const create = async () => {
    setBusy(true);
    try {
      await enableSync(generateSyncCode());
      toast.show({ text: 'Sincronización activada' });
    } catch {
      toast.show({ text: 'No se pudo activar la sincronización' });
    } finally {
      setBusy(false);
    }
  };

  const join = async (code: string) => {
    setBusy(true);
    try {
      await enableSync(code, { join: true });
      setJoining(false);
      setInput('');
      toast.show({ text: 'Dispositivo unido. Sincronizando…' });
      if (linkCode) nav('/ajustes/sincronizar', { replace: true });
    } catch {
      toast.show({ text: 'No se pudo unir el dispositivo' });
    } finally {
      setBusy(false);
    }
  };

  const submitJoin = (e: FormEvent) => {
    e.preventDefault();
    const norm = normalizeCode(input);
    if (!norm) {
      toast.show({ text: 'El código tiene 20 caracteres (letras y números)' });
      return;
    }
    setConfirmJoin(norm);
  };

  const copy = async () => {
    if (!fullCode) return;
    try {
      await navigator.clipboard.writeText(fullCode);
      toast.show({ text: 'Código copiado' });
    } catch {
      toast.show({ text: 'No se pudo copiar' });
    }
  };

  const share = async () => {
    if (!fullCode) return;
    try {
      await navigator.share({ title: 'Sincronizar Scheura', text: `Código de sincronización de Scheura: ${fullCode}`, url: syncUrl(fullCode) });
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) void copy();
    }
  };

  const runNow = async () => {
    const r = await syncNow();
    toast.show({ text: r.ok ? (r.applied > 0 ? `Sincronizado: ${r.applied} cambios recibidos` : 'Todo al día') : r.error ?? 'No se pudo sincronizar' });
  };

  const disconnect = async () => {
    await disableSync();
    await setMeta('sync.user', undefined);
    setAccount(undefined);
    toast.show({ text: 'Este dispositivo ya no se sincroniza' });
  };

  const typed = cleanCode(input).replace(/[^0-9A-Z]/g, '').slice(0, 20);
  const canShare = typeof navigator !== 'undefined' && 'share' in navigator;

  let body: ReactNode;
  if (!serverEnabled()) {
    body = (
      <>
        <p className="sync-lead">Sincroniza tus asignaturas, tareas, exámenes y archivos entre el móvil y el ordenador.</p>
        <div className="group sync-note">
          <div className="cell cell--stack">
            <span className="cell__label"><strong>Aún no está disponible</strong></span>
            <span className="muted small">Esta versión de Scheura no tiene un servidor de sincronización configurado. Mientras tanto, puedes pasar tus datos con Exportar e Importar copia en Ajustes.</span>
          </div>
        </div>
      </>
    );
  } else if (!state) {
    body = null;
  } else if (!enabled) {
    body = (
      <>
        {mode === 'login' ? (
          <>
            <p className="sync-lead">Entra con tu usuario y contraseña para tener lo mismo en el móvil y en el ordenador.</p>
            <LoginForm onDone={({ user: u, ok }) => {
              setAccount(u);
              toast.show({ text: ok ? 'Has entrado. Tus datos están sincronizados' : 'Has entrado. La primera sincronización se reintentará sola' });
            }} />
            <button className="btn btn--block btn--ghost" onClick={() => setMode('code')}>Usar un código de sincronización</button>
          </>
        ) : (
          <>
        <p className="sync-lead">Une tus dispositivos con un código, sin usuario ni contraseña.</p>
        <ul className="sync-points">
          <li><span className="sync-points__n">1</span><span>Crea un código en este dispositivo.</span></li>
          <li><span className="sync-points__n">2</span><span>Escanea el QR o escribe el código en el otro.</span></li>
          <li><span className="sync-points__n">3</span><span>Los cambios se mezclan solos en ambos.</span></li>
        </ul>
        <p className="sync-fine">Cifrado de extremo a extremo: el servidor solo guarda datos cifrados y no puede leerlos.</p>

        {!joining ? (
          <div className="stack sync-actions">
            <button className="btn btn--primary btn--block" onClick={create} disabled={busy}>
              {busy ? 'Creando…' : 'Crear código de sincronización'}
            </button>
            <button className="btn btn--block" onClick={() => setJoining(true)} disabled={busy}>Ya tengo un código</button>
          </div>
        ) : (
          <form className="stack sync-actions" onSubmit={submitJoin}>
            <label className="sync-field">
              <span>Código de sincronización</span>
              <input
                className="field sync-input"
                value={formatCode(typed)}
                onChange={(e) => setInput(e.target.value)}
                placeholder="XXXXX-XXXXX-XXXXX-XXXXX"
                autoCapitalize="characters"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                inputMode="text"
                aria-describedby="sync-join-help"
                autoFocus
              />
            </label>
            <p id="sync-join-help" className="sync-fine" style={{ margin: 0 }}>Lo encontrarás en Ajustes › Sincronizar dispositivos del otro dispositivo. {typed.length}/20</p>
            <button className="btn btn--primary btn--block" type="submit" disabled={busy || typed.length !== 20}>Unir este dispositivo</button>
            <button className="btn btn--block btn--ghost" type="button" onClick={() => { setJoining(false); setInput(''); }}>Cancelar</button>
          </form>
        )}
        <button className="btn btn--block btn--ghost" onClick={() => setMode('login')}>Entrar con usuario y contraseña</button>
          </>
        )}
      </>
    );
  } else {
    const status = state.syncing ? 'Sincronizando…'
      : state.lastError ? state.lastError
      : state.lastSyncAt ? `Sincronizado ${ago(state.lastSyncAt, now)}`
      : 'Pendiente de la primera sincronización';
    body = (
      <>
        <div className={`sync-status${state.lastError && !state.syncing ? ' sync-status--error' : ''}`} role="status" aria-live="polite">
          <span className="sync-status__dot" data-state={state.syncing ? 'busy' : state.lastError ? 'error' : 'ok'} aria-hidden="true" />
          <span className="grow">{status}</span>
          {state.lastError && !state.syncing && <button className="btn btn--sm" onClick={runNow}>Reintentar</button>}
        </div>

        {account && (
          <div className="group">
            <div className="cell">
              <span className="cell__label">Conectado como</span>
              <span className="cell__value"><strong style={{ color: 'var(--ink)' }}>{account}</strong></span>
            </div>
          </div>
        )}
        <h2 className="group__label">{account ? 'Código de tu cuenta (alternativa a la contraseña)' : 'Tu código'}</h2>
        <div className="group sync-card">
          <p className="sync-code" aria-label={fullCode ? `Código ${fullCode.split('').join(' ')}` : undefined}>
            {fullCode?.split('-').map((g, i) => <span key={i}>{g}</span>)}
          </p>
          <div className="sync-code__btns">
            <button className="btn btn--sm" onClick={copy}><Icon name="file" size={18} />Copiar</button>
            {canShare && <button className="btn btn--sm" onClick={share}><Icon name="share" size={18} />Compartir</button>}
          </div>
          {fullCode && (
            <div className="sync-qr-wrap">
              <Qr text={syncUrl(fullCode)} />
              <p className="sync-fine">Escanéalo con la cámara del otro dispositivo.</p>
            </div>
          )}
        </div>
        <p className="group__foot sync-warning">{WARNING}</p>

        <div className="group sync-group">
          <button type="button" className="cell" onClick={runNow} disabled={state.syncing}>
            <Icon name="repeat" size={20} />
            <span className="cell__label">Sincronizar ahora</span>
          </button>
          <button type="button" className="cell" onClick={() => setJoining((v) => !v)}>
            <Icon name="move" size={20} />
            <span className="cell__label">Usar otro código</span>
          </button>
          <button type="button" className="cell cell--danger" onClick={() => setConfirmOff(true)}>
            <Icon name="close" size={20} />
            <span className="cell__label">{account ? 'Cerrar sesión en este dispositivo' : 'Desconectar este dispositivo'}</span>
          </button>
        </div>
        {joining && (
          <form className="stack sync-actions" onSubmit={submitJoin}>
            <label className="sync-field">
              <span>Código del otro espacio</span>
              <input className="field sync-input" value={formatCode(typed)} onChange={(e) => setInput(e.target.value)}
                placeholder="XXXXX-XXXXX-XXXXX-XXXXX" autoCapitalize="characters" autoComplete="off" autoCorrect="off" spellCheck={false} />
            </label>
            <button className="btn btn--primary btn--block" type="submit" disabled={busy || typed.length !== 20}>Cambiar de código</button>
          </form>
        )}
        <p className="group__foot">Se sincronizan asignaturas, tareas, exámenes, ajustes y archivos de hasta 25 MB. Los avisos se configuran en cada dispositivo.</p>
      </>
    );
  }

  return (
    <div className="settings-bg">
      <main className="page page--pushed settings-page sync-page">
        <NavBar back="Ajustes" backTo="/ajustes" />
        <h1 className="large-title sync-title">Sincronizar</h1>
        {body}
      </main>

      <Sheet open={!!confirmJoin} onClose={() => setConfirmJoin(null)} title="¿Unir este dispositivo?">
        <p className="muted small" style={{ marginTop: 0 }}>
          Se usará el código <strong className="sync-mono">{confirmJoin ? formatCode(confirmJoin) : ''}</strong>.
          Los datos de este dispositivo y los del otro se mezclarán: tendrás lo de ambos en los dos.
          {enabled ? ' Este dispositivo dejará de sincronizarse con el código actual.' : ''}
        </p>
        <p className="muted small">{WARNING}</p>
        <div className="stack">
          <button className="btn btn--primary btn--block" disabled={busy} onClick={() => { const c = confirmJoin; setConfirmJoin(null); if (c) void join(c); }}>
            Unir y sincronizar
          </button>
          <button className="btn btn--block btn--ghost" onClick={() => { setConfirmJoin(null); if (linkCode) nav('/ajustes/sincronizar', { replace: true }); }}>Cancelar</button>
        </div>
      </Sheet>
      <ConfirmSheet
        open={confirmOff}
        onClose={() => setConfirmOff(false)}
        title="¿Desconectar este dispositivo?"
        message="Dejará de sincronizarse. Tus datos se quedan en este dispositivo y en los demás. Para volver a unirlo necesitarás el código."
        confirmLabel="Desconectar"
        onConfirm={disconnect}
      />
      {toast.node}
    </div>
  );
}
