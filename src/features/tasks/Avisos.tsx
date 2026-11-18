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
import { ReminderPresetSheet, remLabel, sortReminders } from './ReminderPicker';
import './tasks.css';

const PERM_TEXT: Record<NotificationPermission | 'unsupported', { label: string; color: string; help: string }> = {
  granted: { label: 'Avisos activados', color: '#1F7A4A', help: 'Scheura puede mostrarte notificaciones en este dispositivo.' },
  default: { label: 'Avisos sin activar', color: 'var(--pink)', help: 'Activa el permiso para recibir los recordatorios como notificaciones.' },
  denied: { label: 'Avisos bloqueados', color: 'var(--danger)', help: 'Has bloqueado las notificaciones. Puedes permitirlas en los ajustes del navegador para este sitio.' },
  unsupported: { label: 'No disponible aquí', color: 'var(--ink-3)', help: 'Este navegador no admite notificaciones. En iPhone, abre Scheura desde el icono de la pantalla de inicio.' },
};

function dayLabel(d: Date) {
  if (isToday(d)) return 'Hoy';
  if (isTomorrow(d)) return 'Mañana';
  return capitalize(format(d, 'EEE d', { locale: es }).replace('.', ''));
}

export default function Avisos() {
  const settings = useSettings();
  const [perm, setPerm] = useState(notificationPermission());
  const [upcoming, setUpcoming] = useState<UpcomingReminder[] | undefined>();
  const [adding, setAdding] = useState<TaskType | null>(null);

  useEffect(() => {
    let alive = true;
    upcomingReminders(14).then((list) => alive && setUpcoming(list));
    return () => { alive = false; };
  }, []);

  const activate = async () => setPerm(await requestNotificationPermission());

  const setDefaults = (type: TaskType, list: Reminder[]) =>
    updateSettings({ defaultReminders: { ...settings.defaultReminders, [type]: list } });

  const p = PERM_TEXT[perm];
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
            <div className="card av-perm">
              <span className="av-perm__state"><span className="dot" style={{ background: p.color }} aria-hidden="true" />{p.label}</span>
              <span className="muted small">{p.help}</span>
              {perm === 'default' && (
                <button type="button" className="btn btn--primary btn--block" onClick={activate}>
                  <Icon name="bell" size={18} />Activar avisos
                </button>
              )}
              <span className="muted xsmall">
                Por ahora los avisos llegan mientras la app está abierta o estuvo abierta hace poco (en segundo plano). Si la cierras del todo, los verás al volver a abrirla.
              </span>
            </div>
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
