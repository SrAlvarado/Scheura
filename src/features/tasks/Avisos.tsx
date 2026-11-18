// Recordatorios: permiso, próximos avisos, avisos por defecto por tipo y resumen diario. Ruta: /ajustes/avisos
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { format, isToday, isTomorrow } from 'date-fns';
import { es } from 'date-fns/locale';
import { updateSettings } from '../../db/db';
import { useSettings } from '../../db/hooks';
import type { Reminder, TaskType } from '../../db/types';
import { NavBar, Switch } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { TYPES, TYPE_LABEL } from '../../lib/labels';
import { capitalize } from '../../lib/dates';
import {
  notificationPermission, requestNotificationPermission, upcomingReminders, type UpcomingReminder,
} from '../../lib/notifications';
import { disablePush, enablePush, getPushStatus, sendTestPush, uploadSchedule, type PushStatus } from '../../push/push';
import { ReminderPresetSheet, remLabel, sortReminders } from './ReminderPicker';
import './tasks.css';
import './avisos.css';

type Tone = 'ok' | 'pending' | 'bad' | 'neutral';
const TONE_COLOR: Record<Tone, string> = { ok: '#1F7A4A', pending: 'var(--pink)', bad: 'var(--danger)', neutral: 'var(--ink-3)' };

const STATUS_TEXT: Record<PushStatus, { label: string; tone: Tone; help: string }> = {
  on: { label: 'Avisos activados', tone: 'ok', help: 'Recibirás avisos aunque la app esté cerrada.' },
  off: { label: 'Avisos sin activar', tone: 'pending', help: 'Actívalos para recibir los recordatorios en este dispositivo, aunque la app esté cerrada.' },
  denied: {
    label: 'Avisos bloqueados', tone: 'bad',
    help: 'Has bloqueado las notificaciones de Scheura. Para volver a permitirlas: en iPhone, Ajustes, Notificaciones, Scheura; en Android, mantén pulsado el icono de Scheura, Información de la app, Notificaciones; en el ordenador, pulsa el candado junto a la dirección web y permite las notificaciones. Después vuelve a esta pantalla.',
  },
  'needs-install': { label: 'Falta un paso', tone: 'pending', help: 'En iPhone, añade Scheura a la pantalla de inicio y ábrela desde ahí. Solo así puede enviarte avisos.' },
  'server-disabled': {
    label: 'Avisos solo con la app abierta', tone: 'neutral',
    help: 'Esta versión de Scheura no tiene servidor de avisos: los recordatorios llegan mientras la app está abierta o estuvo abierta hace poco. Si la cierras del todo, los verás al volver a abrirla.',
  },
  unsupported: { label: 'No disponible aquí', tone: 'neutral', help: 'Este navegador no admite notificaciones. Prueba con Chrome, Edge, Firefox o Safari actualizados.' },
};

function dayLabel(d: Date) {
  if (isToday(d)) return 'Hoy';
  if (isTomorrow(d)) return 'Mañana';
  return capitalize(format(d, 'EEE d', { locale: es }).replace('.', ''));
}

export default function Avisos() {
  const settings = useSettings();
  const [perm, setPerm] = useState(notificationPermission());
  const [status, setStatus] = useState<PushStatus | undefined>();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [upcoming, setUpcoming] = useState<UpcomingReminder[] | undefined>();
  const [adding, setAdding] = useState<TaskType | null>(null);

  useEffect(() => {
    let alive = true;
    upcomingReminders(14).then((list) => alive && setUpcoming(list));
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    const refresh = () => getPushStatus().then((st) => {
      if (!alive) return;
      setStatus(st);
      setPerm(notificationPermission());
    });
    refresh();
    // Al volver de los ajustes del sistema (p. ej. tras desbloquear el permiso), recalcular.
    const onVis = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onVis);
    return () => { alive = false; document.removeEventListener('visibilitychange', onVis); };
  }, []);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMsg(null);
    try { await fn(); } catch {
      setMsg({ text: 'No se ha podido conectar con el servidor de avisos. Comprueba la conexión e inténtalo de nuevo.', error: true });
    } finally { setBusy(false); }
  };

  const activatePush = () => run(async () => {
    const st = await enablePush();
    setStatus(st);
    setPerm(notificationPermission());
    if (st === 'on') setMsg({ text: 'Listo. Prueba a enviarte un aviso.' });
  });
  const deactivatePush = () => run(async () => { setStatus(await disablePush()); });
  const testPush = () => run(async () => {
    await sendTestPush(5000);
    setMsg({ text: 'Aviso de prueba programado. Bloquea el móvil o cierra la app: llegará en menos de un minuto.' });
  });
  const activateLocal = async () => setPerm(await requestNotificationPermission());

  const setShowTitles = async (v: boolean) => {
    await updateSettings({ pushShowTitles: v });
    if (status === 'on') uploadSchedule().catch(() => undefined);
  };

  const setDefaults = (type: TaskType, list: Reminder[]) =>
    updateSettings({ defaultReminders: { ...settings.defaultReminders, [type]: list } });

  const st = status ? STATUS_TEXT[status] : undefined;
  const now = Date.now();
  const shown = (upcoming ?? []).filter((u) => u.at.getTime() >= now - 3600_000).slice(0, 12);

  return (
    <main className="page page--pushed page--wide" style={{ maxWidth: 1040 }}>
      <NavBar back="Ajustes" backTo="/ajustes" title="Recordatorios" />
      <header style={{ marginBottom: 8 }}>
        <h1 className="large-title">Avisos</h1>
        <p className="ov-sub">Cuándo te avisa Scheura antes de cada cosa.</p>
      </header>

      <div className="cols av-cols">
        <div className="col-main">
          <section className="section">
            <h2 className="section-label">Avisos en este dispositivo</h2>
            {st && (
              <div className="card av-perm" aria-live="polite">
                <span className="av-perm__state"><span className="dot" style={{ background: TONE_COLOR[st.tone] }} aria-hidden="true" />{st.label}</span>
                <span className="muted small">{st.help}</span>

                {status === 'off' && (
                  <button type="button" className="btn btn--primary btn--block" onClick={activatePush} disabled={busy}>
                    <Icon name="bell" size={18} />{busy ? 'Activando…' : 'Activar avisos'}
                  </button>
                )}
                {status === 'on' && (
                  <div className="av-perm__actions">
                    <button type="button" className="btn btn--primary" onClick={testPush} disabled={busy}>
                      <Icon name="bell" size={18} />Enviar aviso de prueba
                    </button>
                    <button type="button" className="btn btn--danger" onClick={deactivatePush} disabled={busy}>Desactivar</button>
                  </div>
                )}
                {status === 'needs-install' && (
                  <Link to="/bienvenida" className="btn btn--block">Ver cómo añadirla</Link>
                )}
                {status === 'server-disabled' && perm === 'default' && (
                  <button type="button" className="btn btn--primary btn--block" onClick={activateLocal}>
                    <Icon name="bell" size={18} />Permitir notificaciones
                  </button>
                )}
                {status === 'server-disabled' && perm === 'granted' && (
                  <span className="muted xsmall">Notificaciones permitidas en este dispositivo.</span>
                )}
                {msg && <span className={`small${msg.error ? ' av-perm__error' : ''}`} role={msg.error ? 'alert' : 'status'}>{msg.text}</span>}
              </div>
            )}
            {(status === 'on' || status === 'off') && (
              <div className="group av-titles">
                <div className="cell">
                  <span className="cell__label">
                    Mostrar el título en los avisos
                    <span className="muted small" style={{ display: 'block' }}>
                      Para mostrarlo, el título se envía al servidor de avisos. Si lo desactivas verás «Tienes un aviso pendiente».
                    </span>
                  </span>
                  <Switch label="Mostrar el título en los avisos" checked={settings.pushShowTitles ?? true} onChange={setShowTitles} />
                </div>
              </div>
            )}
          </section>

          <section className="section">
            <h2 className="section-label">Próximos avisos</h2>
            {upcoming === undefined ? null : shown.length === 0 ? (
              <p className="muted small">No hay avisos en los próximos 14 días.</p>
            ) : (
              <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {shown.map((u) => (
                  <li key={u.key} className="av-tl">
                    <div className="av-tl__when">
                      <b>{dayLabel(u.at)}</b>
                      <span>{format(u.at, 'HH:mm')}</span>
                    </div>
                    <div className="av-tl__rail" aria-hidden="true" />
                    <Link to={u.url.replace(/^#/, '')} className="av-tl__body">
                      <span className="av-tl__title">{u.title}</span>
                      <span className="av-tl__sub">{u.body}</span>
                    </Link>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        <div className="col-side">
          <section className="section">
            <h2 className="section-label" style={{ marginBottom: 4 }}>Avisos por defecto</h2>
            <p className="muted small" style={{ margin: 0 }}>Se aplican al crear algo nuevo. Puedes cambiarlos en cada tarea.</p>
            {TYPES.map((type) => {
              const list = sortReminders(settings.defaultReminders[type] ?? []);
              return (
                <div key={type}>
                  <div className="av-type__head">
                    <h3>{TYPE_LABEL[type]}</h3>
                    <span className="muted small">{list.length === 0 ? 'Sin avisos' : `${list.length} ${list.length === 1 ? 'aviso' : 'avisos'}`}</span>
                  </div>
                  <div className="group">
                    {list.map((r) => (
                      <div key={r.id} className="cell">
                        <span className="cell__label">{remLabel(r)}</span>
                        <button type="button" className="iconbtn" style={{ marginRight: -10, color: 'var(--ink-2)' }}
                          aria-label={`Quitar «${remLabel(r)}» de ${TYPE_LABEL[type]}`}
                          onClick={() => setDefaults(type, list.filter((x) => x.id !== r.id))}>
                          <Icon name="close" size={16} stroke={2.2} />
                        </button>
                      </div>
                    ))}
                    <button type="button" className="cell" style={{ color: 'var(--pink-text)', fontWeight: 600 }} onClick={() => setAdding(type)}>
                      + Añadir
                    </button>
                  </div>
                </div>
              );
            })}
          </section>

          <section className="section">
            <h2 className="section-label">Resumen diario</h2>
            <div className="group">
              <div className="cell">
                <span className="cell__label">
                  Resumen de la mañana
                  <span className="muted small" style={{ display: 'block' }}>Qué toca hoy y qué se acerca</span>
                </span>
                <Switch label="Resumen diario" checked={settings.dailyDigest} onChange={(v) => updateSettings({ dailyDigest: v })} />
              </div>
              {settings.dailyDigest && (
                <label className="cell">
                  <span className="cell__label">Hora</span>
                  <input type="time" value={settings.dailyDigestTime}
                    onChange={(e) => e.target.value && updateSettings({ dailyDigestTime: e.target.value })} />
                </label>
              )}
            </div>
          </section>

          <div className="av-note">
            <Icon name="bell" size={20} />
            <div>
              <b>En iPhone</b>
              Los avisos solo llegan si añades Scheura a la pantalla de inicio: en Safari, Compartir y luego «Añadir a pantalla de inicio». Ábrela desde ese icono y acepta el permiso.
              <div style={{ marginTop: 6 }}><Link to="/bienvenida" style={{ fontWeight: 600 }}>Ver cómo hacerlo</Link></div>
            </div>
          </div>
        </div>
      </div>

      <ReminderPresetSheet open={!!adding} onClose={() => setAdding(null)}
        title={adding ? `Añadir aviso · ${TYPE_LABEL[adding]}` : undefined}
        exclude={adding ? settings.defaultReminders[adding] ?? [] : []}
        onPick={(r) => adding && setDefaults(adding, [...(settings.defaultReminders[adding] ?? []), r])} />
    </main>
  );
}
