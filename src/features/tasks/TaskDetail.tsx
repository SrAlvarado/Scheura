// Detalle de tarea. Ruta: /tarea/:id (opcional ?fecha= para la ocurrencia de una tarea repetida).
import { useEffect, useState, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { deleteTask, moveTask, setTaskDone, updateTask } from '../../db/repo';
import { useSteps, useSubjectMap } from '../../db/hooks';
import { ConfirmSheet, Empty, NavBar, Sheet, SubjectChip, useToast } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { PRIORITY_LABEL, TYPE_LABEL } from '../../lib/labels';
import { addDaysISO, fmtDuration, longDay, todayISO } from '../../lib/dates';
import { workProgress, pct } from '../../lib/progress';
import Attachments from '../files/Attachments';
import { remLabel, sortReminders } from './ReminderPicker';
import { repeatLabel } from '../../lib/events';
import './tasks.css';


export default function TaskDetail() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const toast = useToast();
  const subjects = useSubjectMap();
  // null = no existe; undefined = cargando
  const task = useLiveQuery(async () => (id ? (await db.tasks.get(id)) ?? null : null), [id]);
  const parent = useLiveQuery(async () => (task?.parentId ? (await db.tasks.get(task.parentId)) ?? null : null), [task?.parentId]);
  const siblings = useSteps(task?.parentId);

  const [notes, setNotes] = useState('');
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveDate, setMoveDate] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => { if (task) setNotes(task.notes ?? ''); }, [task?.id, task?.notes]); // eslint-disable-line react-hooks/exhaustive-deps

  if (task === undefined) return <main className="page page--pushed"><NavBar back="Atrás" /></main>;
  if (task === null) {
    return (
      <main className="page page--pushed">
        <NavBar back="Atrás" title="Tarea" />
        <Empty>
          <p>Esta tarea ya no existe.</p>
          <Link to="/" className="btn btn--sm">Ir a Hoy</Link>
        </Empty>
      </main>
    );
  }
  if (task.type === 'entrega' && !task.parentId) return <Navigate to={`/trabajo/${task.id}`} replace />;
  if (task.type === 'evento') return <Navigate to={`/evento/${task.id}${params.get('fecha') ? `?fecha=${params.get('fecha')}` : ''}`} replace />;

  const repeating = !!task.repeat && task.repeat.freq !== 'none';
  const qFecha = params.get('fecha');
  const occ = repeating ? (qFecha && /^\d{4}-\d{2}-\d{2}$/.test(qFecha) ? qFecha : todayISO()) : task.date;
  const done = repeating ? !!task.doneDates?.includes(occ!) : task.done;
  const subject = task.subjectId ? subjects.get(task.subjectId) : undefined;
  const stepIndex = task.parentId ? siblings.findIndex((s) => s.id === task.id) : -1;
  const progress = parent ? workProgress(parent, siblings) : 0;

  const toggleDone = async () => {
    const next = !done;
    await setTaskDone(task.id, next, repeating ? occ : undefined);
    if (next) toast.show({ text: 'Marcada como hecha', action: { label: 'Deshacer', run: () => setTaskDone(task.id, false, repeating ? occ : undefined) } });
  };

  const doMove = async (to: string) => {
    setMoveOpen(false);
    const from = occ;
    if (!to || to === from) return;
    const label = longDay(to).toLowerCase();
    if (repeating) {
      // Mueve solo esta ocurrencia: se crea una copia suelta y se salta la original.
      const snapshot = await db.tasks.get(task.id);
      const started = Date.now();
      await moveTask(task.id, to, from);
      const copy = (await db.tasks.where('date').equals(to).toArray())
        .filter((t) => t.title === task.title && t.createdAt >= started && !t.repeat)
        .sort((a, b) => b.createdAt - a.createdAt)[0];
      if (copy) nav(`/tarea/${copy.id}`, { replace: true });
      toast.show({
        text: `Movida al ${label}`,
        action: {
          label: 'Deshacer',
          run: async () => {
            if (snapshot) await db.tasks.put(snapshot);
            if (copy) await db.tasks.delete(copy.id);
            nav(`/tarea/${task.id}${from ? `?fecha=${from}` : ''}`, { replace: true });
          },
        },
      });
    } else {
      await moveTask(task.id, to);
      toast.show({
        text: `Movida al ${label}`,
        action: { label: 'Deshacer', run: () => (from ? moveTask(task.id, from) : updateTask(task.id, { date: undefined })) },
      });
    }
  };

  const doDelete = async () => {
    await deleteTask(task.id);
    if (window.history.length > 1) nav(-1);
    else nav('/', { replace: true, state: { toast: 'Tarea eliminada' } });
  };

  const saveNotes = () => {
    const v = notes.trim();
    if (v !== (task.notes ?? '').trim()) updateTask(task.id, { notes: v || undefined });
  };

  const today = todayISO();
  const moveOpts = [
    { label: 'Hoy', date: today },
    { label: 'Mañana', date: addDaysISO(today, 1) },
    { label: 'Pasado mañana', date: addDaysISO(today, 2) },
  ];
  const reminders = sortReminders(task.reminders ?? []);

  const rows: { k: string; v: ReactNode; pink?: boolean }[] = [
    { k: 'Fecha', v: occ ? `${longDay(occ)}${repeating ? ' (esta vez)' : ''}` : 'Sin fecha' },
    { k: 'Hora', v: task.time ?? 'Sin hora' },
    { k: 'Duración', v: fmtDuration(task.durationMin) || 'Sin estimar' },
    { k: 'Prioridad', v: PRIORITY_LABEL[task.priority], pink: task.priority === 'alta' },
    ...(task.parentId ? [] : [{ k: 'Repetición', v: repeatLabel(task) }]),
    {
      k: 'Recordatorios',
      v: reminders.length ? (
        <ul className="td-rem-list">{reminders.map((r) => <li key={r.id}>{remLabel(r)}</li>)}</ul>
      ) : 'Sin avisos',
    },
  ];

  return (
    <main className="page page--pushed">
      <NavBar back="Atrás" title={task.parentId ? 'Paso' : TYPE_LABEL[task.type]}
        right={<Link to={`/tarea/${task.id}/editar`} className="navbtn">Editar</Link>} />

      <div className="cols">
        <div className="col-main">
          <div className="td-chips">
            <SubjectChip subject={subject} />
            <span className="tag">{task.parentId && stepIndex >= 0 ? `Entrega · paso ${stepIndex + 1} de ${siblings.length}` : TYPE_LABEL[task.type]}</span>
            <span className={`tag${task.priority === 'alta' ? ' tag--pink' : ''}`}>Prioridad {PRIORITY_LABEL[task.priority].toLowerCase()}</span>
            {repeating && <span className="tag"><Icon name="repeat" size={12} stroke={2.2} />&nbsp;Se repite</span>}
          </div>
          <h1 className={`td-title${done ? ' is-done' : ''}`}>{task.title}</h1>
          {task.description && <p className="td-desc">{task.description}</p>}

          {task.parentId && parent && (
            <Link to={`/trabajo/${parent.id}`} className="td-parent">
              <span className="td-parent__top">
                <span>Trabajo: {parent.title}</span>
                <span className="pink">{pct(progress)}</span>
              </span>
              <span className="segbar" style={{ gridTemplateColumns: `repeat(${Math.max(1, siblings.length)}, 1fr)` }} aria-hidden="true">
                {siblings.map((s) => <span key={s.id} style={{ background: s.done ? 'var(--pink)' : undefined }} />)}
              </span>
              <span className="td-parent__link">
                {stepIndex >= 0 ? `Paso ${stepIndex + 1} de ${siblings.length} · ` : ''}Ver trabajo completo
                <Icon name="chevron" size={14} stroke={2.2} />
              </span>
            </Link>
          )}

          <div className="group__label">Detalles</div>
          <div className="group">
            {rows.map((r) => (
              <div key={r.k} className="cell detail-cell">
                <span className="cell__label">{r.k}</span>
                <span className={`cell__value${r.pink ? ' pink' : ''}`} style={r.pink ? { fontWeight: 700 } : undefined}>{r.v}</span>
              </div>
            ))}
          </div>

          <div className="td-actions">
            <button type="button" className={`btn btn--block${done ? '' : ' btn--primary'}`} onClick={toggleDone}>
              <Icon name={done ? 'back' : 'today'} size={20} stroke={2} />
              {done ? 'Marcar como pendiente' : 'Marcar como hecha'}
            </button>
            {repeating && <p className="td-done-note" style={{ margin: 0 }}>Solo afecta a la del {longDay(occ!).toLowerCase()}</p>}
            <div className="row" style={{ gap: 10 }}>
              <button type="button" className="btn" onClick={() => { setMoveDate(occ ?? today); setMoveOpen(true); }}>Mover a otro día</button>
              <button type="button" className="btn btn--danger" onClick={() => setDeleteOpen(true)}>Eliminar</button>
            </div>
          </div>
        </div>

        <div className="col-side">
          <section className="section">
            <h2 className="section-label"><label htmlFor="td-notes">Notas</label></h2>
            <textarea id="td-notes" className="td-notes" placeholder="Añade notas…" value={notes}
              onChange={(e) => setNotes(e.target.value)} onBlur={saveNotes} />
          </section>
          <section className="section">
            <Attachments ownerType="task" ownerId={task.id} />
          </section>
        </div>
      </div>

      <Sheet open={moveOpen} onClose={() => setMoveOpen(false)} title="Mover a otro día">
        <div className="group">
          {moveOpts.map((o) => (
            <button key={o.label} type="button" className="cell td-move-opt" onClick={() => doMove(o.date)} disabled={o.date === occ}>
              <span className="cell__label">{o.label}</span>
              <span className="cell__value">{longDay(o.date)}</span>
            </button>
          ))}
          <div className="cell">
            <label htmlFor="td-move-date" className="cell__label">Otro día</label>
            <input id="td-move-date" type="date" value={moveDate} onChange={(e) => setMoveDate(e.target.value)} />
          </div>
        </div>
        <div className="stack" style={{ marginTop: 12 }}>
          <button type="button" className="btn btn--primary btn--block" disabled={!moveDate || moveDate === occ} onClick={() => doMove(moveDate)}>Mover</button>
          <button type="button" className="btn btn--ghost btn--block" onClick={() => setMoveOpen(false)}>Cancelar</button>
        </div>
      </Sheet>

      <ConfirmSheet open={deleteOpen} onClose={() => setDeleteOpen(false)} title={`¿Eliminar «${task.title}»?`}
        message={task.parentId ? 'El trabajo conservará los demás pasos.' : repeating ? 'Se eliminarán todas las repeticiones.' : 'Esta acción no se puede deshacer.'}
        confirmLabel="Eliminar tarea" onConfirm={doDelete} />

      {toast.node}
    </main>
  );
}
