// Detalle de evento. Ruta: /evento/:id (opcional ?fecha= para una repetición concreta).
import { useEffect, useState, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { deleteTask, updateTask } from '../../db/repo';
import { ConfirmSheet, Empty, NavBar, Sheet } from '../../components/ui';
import { SUBJECT_COLORS } from '../../lib/colors';
import { addDaysISO, daysUntil, fmtDuration, longDay, todayISO, weekdayMon0 } from '../../lib/dates';
import { categoryInfo, repeatHits, repeatLabel } from '../../lib/events';
import Attachments from '../files/Attachments';
import { remLabel, sortReminders } from '../tasks/ReminderPicker';
import '../tasks/tasks.css';
import './events.css';

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function countdown(date: string): string {
  const n = daysUntil(date);
  if (n === 0) return 'Es hoy';
  if (n === 1) return 'Mañana';
  if (n === -1) return 'Fue ayer';
  if (n < 0) return `Hace ${-n} días`;
  return `Faltan ${n} días`;
}

export default function EventDetail() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const ev = useLiveQuery(async () => (id ? (await db.tasks.get(id)) ?? null : null), [id]);
  const [notes, setNotes] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteOne, setDeleteOne] = useState(false);

  useEffect(() => { if (ev) setNotes(ev.notes ?? ''); }, [ev?.id, ev?.notes]); // eslint-disable-line react-hooks/exhaustive-deps

  if (ev === undefined) return <main className="page page--pushed"><NavBar back="Atrás" /></main>;
  if (ev === null) {
    return (
      <main className="page page--pushed">
        <NavBar back="Atrás" title="Evento" />
        <Empty>
          <p>Este evento ya no existe.</p>
          <Link to="/" className="btn btn--sm">Ir a Hoy</Link>
        </Empty>
      </main>
    );
  }
  if (ev.type !== 'evento') return <Navigate to={`/tarea/${ev.id}`} replace />;

  const cat = categoryInfo(ev.category);
  const col = SUBJECT_COLORS[cat.color];
  const repeating = !!ev.repeat && ev.repeat.freq !== 'none';

  // Ocurrencia a mostrar: la de ?fecha=, o la próxima a partir de hoy (máx. ~1 año y pico).
  let occ = ev.date ?? todayISO();
  if (repeating && ev.date) {
    const q = params.get('fecha');
    if (q && ISO.test(q)) occ = q;
    else {
      const today = todayISO();
      for (let d = today > ev.date ? today : ev.date, i = 0; i < 400; d = addDaysISO(d, 1), i++) {
        if (ev.repeat!.until && d > ev.repeat!.until) break;
        if (!ev.skipDates?.includes(d) && repeatHits(ev.repeat!, ev.date, d, weekdayMon0(d))) { occ = d; break; }
      }
    }
  }

  const time = ev.time ? `${ev.time}${ev.endTime ? `–${ev.endTime}` : ''}` : 'Todo el día';
  const reminders = sortReminders(ev.reminders ?? []);
  const rows: { k: string; v: ReactNode }[] = [
    { k: 'Fecha', v: `${longDay(occ)}${repeating ? ' (esta vez)' : ''}` },
    { k: 'Hora', v: time },
    ...(ev.durationMin ? [{ k: 'Duración', v: fmtDuration(ev.durationMin) }] : []),
    ...(ev.location ? [{ k: 'Lugar', v: ev.location }] : []),
    { k: 'Repetición', v: repeatLabel(ev) },
    {
      k: 'Recordatorios',
      v: reminders.length ? <ul className="td-rem-list">{reminders.map((r) => <li key={r.id}>{remLabel(r)}</li>)}</ul> : 'Sin avisos',
    },
  ];

  const mapsUrl = ev.location ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(ev.location)}` : '';

  const saveNotes = () => {
    const v = notes.trim();
    if (v !== (ev.notes ?? '').trim()) updateTask(ev.id, { notes: v || undefined });
  };

  const doDelete = async (onlyThis: boolean) => {
    setDeleteOpen(false);
    setDeleteOne(false);
    if (onlyThis) await updateTask(ev.id, { skipDates: [...(ev.skipDates ?? []), occ] });
    else await deleteTask(ev.id);
    if (window.history.length > 1) nav(-1);
    else nav('/', { replace: true });
  };

  return (
    <main className="page page--pushed">
      <NavBar back="Atrás" title="Evento" right={<Link to={`/evento/${ev.id}/editar`} className="navbtn">Editar</Link>} />

      <div className="cols">
        <div className="col-main">
          <div className="ev-hero">
            <span className="ev-badge" style={{ background: col.bg }} aria-hidden="true">{cat.emoji}</span>
            <div>
              <span className="tag" style={{ background: col.bg, color: col.fg }}>{cat.label}</span>
              <h1 className="td-title" style={{ marginTop: 6 }}>{ev.title}</h1>
            </div>
          </div>
          <span className="ev-count" style={{ background: col.bg, color: col.fg }}>{countdown(occ)}</span>

          <div className="group__label">Detalles</div>
          <div className="group">
            {rows.map((r) => (
              <div key={r.k} className="cell detail-cell">
                <span className="cell__label">{r.k}</span>
                <span className="cell__value">{r.v}</span>
              </div>
            ))}
          </div>

          <div className="td-actions">
            {mapsUrl && <a className="btn btn--block" href={mapsUrl} target="_blank" rel="noreferrer">Abrir en el mapa</a>}
            <button type="button" className="btn btn--danger btn--block" onClick={() => (repeating ? setDeleteOne(true) : setDeleteOpen(true))}>
              Eliminar evento
            </button>
          </div>
        </div>

        <div className="col-side">
          <section className="section">
            <h2 className="section-label"><label htmlFor="ev-notes-d">Notas</label></h2>
            <textarea id="ev-notes-d" className="td-notes" placeholder={ev.category === 'cumple' ? 'Ideas de regalo…' : 'Añade notas…'} value={notes}
              onChange={(e) => setNotes(e.target.value)} onBlur={saveNotes} />
          </section>
          <section className="section">
            <Attachments ownerType="task" ownerId={ev.id} />
          </section>
        </div>
      </div>

      <ConfirmSheet open={deleteOpen} onClose={() => setDeleteOpen(false)} title={`¿Eliminar «${ev.title}»?`}
        message="Esta acción no se puede deshacer." confirmLabel="Eliminar evento" onConfirm={() => doDelete(false)} />

      <Sheet open={deleteOne} onClose={() => setDeleteOne(false)} title={`¿Eliminar «${ev.title}»?`}>
        <p className="muted small" style={{ marginTop: 0 }}>Este evento se repite. ¿Qué quieres eliminar?</p>
        <div className="stack">
          <button type="button" className="btn btn--block" onClick={() => doDelete(true)}>Solo el del {longDay(occ).toLowerCase()}</button>
          <button type="button" className="btn btn--block btn--danger" onClick={() => doDelete(false)}>Todas las repeticiones</button>
          <button type="button" className="btn btn--block btn--ghost" onClick={() => setDeleteOne(false)}>Cancelar</button>
        </div>
      </Sheet>
    </main>
  );
}
