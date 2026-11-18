import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { ConfirmSheet, Empty, NavBar, SubjectChip } from '../../components/ui';
import { useSteps, useSubjectMap } from '../../db/hooks';
import { deleteTask, setTaskDone, updateTask } from '../../db/repo';
import { fmt, fmtDuration, longDay, relDays } from '../../lib/dates';
import { workProgress } from '../../lib/progress';
import Attachments from '../files/Attachments';
import { NotesField, SectionHead, SegBar, dow, useTaskOrNull } from './common';
import { ReminderList } from './ReminderList';
import './study.css';

export default function WorkDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const task = useTaskOrNull(id);
  const steps = useSteps(id);
  const subjects = useSubjectMap();
  const [confirmDel, setConfirmDel] = useState(false);

  if (task === undefined) return <main className="page page--pushed" />;
  if (task === null) {
    return (
      <main className="page page--pushed">
        <NavBar back="Estudio" backTo="/estudio?tab=trabajos" />
        <Empty><p>Este trabajo ya no existe.</p><Link to="/estudio?tab=trabajos" className="btn">Volver a Estudio</Link></Empty>
      </main>
    );
  }

  const subject = task.subjectId ? subjects.get(task.subjectId) : undefined;
  const p = workProgress(task, steps);
  const pctN = Math.round(p * 100);
  const doneSteps = steps.filter((s) => s.done).length;
  const current = task.done ? undefined : steps.find((s) => !s.done);

  return (
    <main className="page page--pushed page--wide">
      <NavBar back="Estudio" backTo="/estudio?tab=trabajos" title="Trabajo"
        right={<Link to={`/tarea/${task.id}/editar`} className="navbtn navbtn--bold">Editar</Link>} />

      <div className="cols">
        <div className="col-main">
          <div className="st-head">
            <SubjectChip subject={subject} />
            <h1>{task.title}</h1>
          </div>

          <div className="st-hero">
            <div className="st-hero__pct">
              <span className={`big-number st-hero__num${pctN === 0 ? ' st-hero__num--zero' : ''}`} aria-label={`${pctN} por ciento hecho`}>
                {pctN}<small>%</small>
              </span>
              <span className="st-hero__label">
                {task.done
                  ? 'Entregado'
                  : task.date
                    ? `Entrega ${relDays(task.date)} · ${longDay(task.date)}${task.time ? ` · ${task.time}` : ''}`
                    : 'Sin fecha de entrega'}
              </span>
              <span className="muted small" style={{ paddingTop: 2 }}>
                {steps.length ? `${doneSteps} de ${steps.length} pasos hechos` : 'Aún sin pasos'}
              </span>
            </div>
          </div>
          {steps.length > 0 && (
            <div style={{ paddingTop: 18 }}>
              <SegBar thick colors={steps.map((s) => (s.done ? 'var(--pink)' : '#e6e6e6'))} />
            </div>
          )}

          <section className="st-section">
            <SectionHead title="Pasos" aside={steps.length ? 'Toca el punto para marcar' : undefined} />
            <div className="st-steps" style={{ paddingTop: 10 }}>
              {steps.length === 0 && <p className="muted small" style={{ marginTop: 0 }}>Divide el trabajo en pasos para ver tu progreso.</p>}
              {steps.map((s) => {
                const isCurrent = current?.id === s.id;
                const state = s.done ? 'Hecho' : isCurrent ? 'Siguiente' : s.date ? relDays(s.date) : 'Sin fecha';
                return (
                  <div key={s.id} className="timeline-row">
                    <div className={`timeline-row__time${isCurrent ? ' timeline-row__time--current' : ''}`}>
                      {s.date ? (<><b>{fmt(s.date, 'd MMM').replace('.', '')}</b><span className="xsmall">{dow(s.date)}</span></>) : <span className="xsmall">—</span>}
                    </div>
                    <div className="timeline-row__rail">
                      <button type="button"
                        className={`tdot${s.done ? ' tdot--done' : isCurrent ? ' tdot--high' : ''}`}
                        aria-pressed={s.done}
                        aria-label={s.done ? `${s.title}: hecho. Desmarcar` : `Marcar ${s.title} como hecho`}
                        onClick={() => setTaskDone(s.id, !s.done)} />
                    </div>
                    <Link to={`/tarea/${s.id}`} className={`timeline-row__body${s.done ? ' timeline-row__body--done' : ''}`}>
                      <span className="timeline-row__title">{s.title}</span>
                      <span className="timeline-row__meta">
                        {[s.time, fmtDuration(s.durationMin)].filter(Boolean).join(' · ')}
                        {s.time || s.durationMin ? ' · ' : ''}
                        <span className={isCurrent ? 'pink' : undefined} style={isCurrent ? { fontWeight: 700 } : undefined}>{state}</span>
                      </span>
                    </Link>
                  </div>
                );
              })}
            </div>
            <Link to={`/tarea/nueva?padre=${task.id}`} className="st-addbtn">
              <Icon name="plus" size={18} stroke={2} />Añadir paso
            </Link>
          </section>
        </div>

        <aside className="col-side">
          <ReminderList title="Avisos de entrega" reminders={task.reminders} date={task.date} time={task.time}
            onChange={(r) => updateTask(task.id, { reminders: r })} />
          <div style={{ marginTop: 32 }}>
            <Attachments ownerType="task" ownerId={task.id} title="Archivos" />
          </div>
          <NotesField id={task.id} value={task.notes} onSave={(v) => updateTask(task.id, { notes: v })} />
          <div className="st-actions">
            <button type="button" className={`btn btn--block${task.done ? '' : ' btn--primary'}`} onClick={() => setTaskDone(task.id, !task.done)}>
              <Icon name="check" size={18} stroke={2.4} />{task.done ? 'Marcar como no entregado' : 'Marcar como entregado'}
            </button>
            <button type="button" className="btn btn--danger btn--block" onClick={() => setConfirmDel(true)}>
              <Icon name="trash" size={18} />Eliminar trabajo
            </button>
          </div>
        </aside>
      </div>

      <ConfirmSheet open={confirmDel} onClose={() => setConfirmDel(false)} title="¿Eliminar este trabajo?"
        message="Se borrarán también sus pasos y archivos."
        confirmLabel="Eliminar trabajo"
        onConfirm={async () => { await deleteTask(task.id); nav('/estudio?tab=trabajos', { replace: true }); }} />
    </main>
  );
}
