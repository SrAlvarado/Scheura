// Atrasadas: tareas con fecha pasada sin hacer, para recolocarlas. Ruta: /atrasadas
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { moveTask, overdueTasks } from '../../db/repo';
import { useSubjectMap } from '../../db/hooks';
import type { Task } from '../../db/types';
import { NavBar, Sheet, SubjectDot, useToast } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { TYPE_LABEL } from '../../lib/labels';
import { addDaysISO, fmtDuration, longDay, relDays, todayISO } from '../../lib/dates';
import { MiniCalendar } from './MiniCalendar';
import './tasks.css';

export default function Atrasadas() {
  const tasks = useLiveQuery(async () => (await overdueTasks()).sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '') || (a.time ?? '99').localeCompare(b.time ?? '99')), []);
  const subjects = useSubjectMap();
  const toast = useToast();
  const [picking, setPicking] = useState<Task | null>(null);
  const [picked, setPicked] = useState<string | undefined>();
  const today = todayISO();

  const move = async (list: Task[], to: string) => {
    const originals = list.map((t) => ({ id: t.id, date: t.date! }));
    await Promise.all(list.map((t) => moveTask(t.id, to)));
    const when = to === today ? 'hoy' : to === addDaysISO(today, 1) ? 'mañana' : `el ${longDay(to).toLowerCase()}`;
    toast.show({
      text: list.length === 1 ? `Movida a ${when}` : `${list.length} tareas movidas a ${when}`,
      action: { label: 'Deshacer', run: () => { Promise.all(originals.map((o) => moveTask(o.id, o.date))); } },
    });
  };

  const openPicker = (t: Task) => { setPicking(t); setPicked(undefined); };
  const confirmPick = async () => {
    if (!picking || !picked) return;
    const t = picking;
    setPicking(null);
    await move([t], picked);
  };

  const meta = (t: Task) => {
    const s = t.subjectId ? subjects.get(t.subjectId) : undefined;
    return [s?.name, t.parentId ? 'Paso de trabajo' : TYPE_LABEL[t.type], fmtDuration(t.durationMin)].filter(Boolean).join(' · ');
  };

  return (
    <main className="page page--pushed">
      <NavBar back="Hoy" backTo="/" />
      <header>
        <div className="ov-head">
          <h1 className="large-title">Atrasadas</h1>
          {tasks && tasks.length > 0 && <span className="ov-count" aria-label={`${tasks.length} tareas`}>{tasks.length}</span>}
        </div>
        <p className="ov-sub">Lo que no dio tiempo a hacer. Elige un día nuevo para cada una y desaparecerán de aquí.</p>
      </header>

      {tasks === undefined ? null : tasks.length === 0 ? (
        <div className="ov-empty">
          <span className="ov-empty__icon"><Icon name="check" size={26} stroke={2.4} /></span>
          <span className="ov-empty__title">Todo al día</span>
          <span className="muted">No te queda nada atrasado.</span>
          <Link to="/" className="btn btn--sm" style={{ marginTop: 8 }}>Volver a Hoy</Link>
        </div>
      ) : (
        <>
          {tasks.length >= 2 && (
            <button type="button" className="btn btn--primary btn--block" style={{ marginTop: 20 }} onClick={() => move(tasks, today)}>
              Mover todas a hoy
            </button>
          )}
          <section className="section">
            <h2 className="section-label" style={{ marginBottom: 0 }}>Por recolocar</h2>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {tasks.map((t) => (
                <li key={t.id} className="ov-item">
                  <div className="ov-item__top">
                    <span className="ov-item__dot"><SubjectDot subject={t.subjectId ? subjects.get(t.subjectId) : undefined} size={10} /></span>
                    <div className="grow" style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <Link to={`/tarea/${t.id}`} className="ov-item__name">{t.title}</Link>
                      <span className="ov-item__meta">{meta(t)}</span>
                    </div>
                    <span className="ov-item__when" title={`Era para el ${longDay(t.date!).toLowerCase()}`}>
                      <span className="sr-only">Era para </span>{relDays(t.date!)}
                    </span>
                  </div>
                  <div className="ov-item__btns">
                    <button type="button" className="btn" onClick={() => move([t], today)} aria-label={`Mover «${t.title}» a hoy`}>Hoy</button>
                    <button type="button" className="btn" onClick={() => move([t], addDaysISO(today, 1))} aria-label={`Mover «${t.title}» a mañana`}>Mañana</button>
                    <button type="button" className="btn btn--soft" onClick={() => openPicker(t)} aria-label={`Elegir día para «${t.title}»`}>
                      <Icon name="calendar" size={16} />Elegir día
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      <Sheet open={!!picking} onClose={() => setPicking(null)} title="Elegir día">
        {picking && <p className="muted small" style={{ marginTop: -6 }}>Mover «{picking.title}»</p>}
        <MiniCalendar value={picked} min={today} onChange={setPicked} />
        <div className="stack" style={{ marginTop: 16 }}>
          <button type="button" className="btn btn--primary btn--block" disabled={!picked} onClick={confirmPick}>
            {picked ? `Mover al ${longDay(picked).toLowerCase()}` : 'Elige un día'}
          </button>
          <button type="button" className="btn btn--ghost btn--block" onClick={() => setPicking(null)}>Cancelar</button>
        </div>
      </Sheet>

      {toast.node}
    </main>
  );
}
