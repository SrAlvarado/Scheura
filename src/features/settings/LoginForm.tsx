// Inicio de sesión con usuario y contraseña (sin cuentas en el servidor): se deriva el código de sincronización
// en el dispositivo y se activa la sincronización. Lo usan Bienvenida y Ajustes › Sincronizar.
import { useState, type FormEvent } from 'react';
import { setMeta } from '../../db/db';
import { serverEnabled } from '../../lib/config';
import { codeFromCredentials, normalizeUser } from '../../sync/crypto';
import { enableSync, syncNow } from '../../sync/engine';
import './sync.css';

export default function LoginForm({ onDone, submitLabel = 'Entrar' }: { onDone: (r: { user: string; ok: boolean }) => void; submitLabel?: string }) {
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (!serverEnabled()) {
    return <p className="sync-fine">El inicio de sesión no está disponible en esta versión.</p>;
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const u = normalizeUser(user);
    if (!u) return setError('Escribe tu usuario');
    if (pass.length < 8) return setError('La contraseña debe tener al menos 8 caracteres');
    setBusy(true);
    try {
      const code = await codeFromCredentials(u, pass);
      await enableSync(code, { join: true });
      await setMeta('sync.user', u);
      setPass('');
      const r = await syncNow();
      onDone({ user: u, ok: r.ok });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo entrar');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <form className="stack sync-actions" onSubmit={submit} noValidate>
        <label className="sync-field">
          <span>Usuario</span>
          <input className="field" value={user} onChange={(e) => setUser(e.target.value)} autoComplete="username"
            autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="p. ej. markel" />
        </label>
        <label className="sync-field">
          <span>Contraseña</span>
          <input className="field" type="password" value={pass} onChange={(e) => setPass(e.target.value)}
            autoComplete="current-password" placeholder="Mínimo 8 caracteres" />
        </label>
        {error && <p className="sync-fine" role="alert" style={{ margin: 0, color: 'var(--danger)' }}>{error}</p>}
        <button className="btn btn--primary btn--block" type="submit" disabled={busy}>{busy ? 'Entrando…' : submitLabel}</button>
      </form>
      <p className="sync-fine">
        ¿Primera vez? Elige un usuario y una contraseña y se creará tu espacio. En tus otros dispositivos, entra con los mismos.
        Cada persona tiene el suyo y nadie ve los datos de otro.
      </p>
      <p className="sync-fine">
        Tus datos viajan cifrados y el servidor no recibe tu contraseña. Por eso, <strong>si la olvidas no se puede recuperar</strong>.
      </p>
    </>
  );
}
