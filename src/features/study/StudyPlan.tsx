import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { ConfirmSheet, Empty, NavBar, Sheet, useToast } from '../../components/ui';
import { useExamSessions, useSubjectMap } from '../../db/hooks';
import { autoPlanExam, createTask, deleteTask, setTaskDone } from '../../db/repo';
import type { Task, Topic } from '../../db/types';
import { addDaysISO, daysUntil, fmt, fmtDuration, todayISO } from '../../lib/dates';
import { SegBar, dow, shortDay, useExamOrNull } from './common';
import './study.css';

function PlanSession({ s }: { s: Task }) {
  const meta = [s.time, fmtDuration(s.durationMin)].filter(Boolean).join(' · ');
  return (
    <div className={`st-psess${s.done ? ' st-psess--done' : ''}`}>
      <button type="button" className="st-check" aria-pressed={s.done}
        aria-label={s.done ? `${s.title}: hecha. Desmarcar` : `Marcar ${s.title} como hecha`}
        onClick={() => setTaskDone(s.id, !s.done)}>
        <span>{s.done && <Icon name="check" size={12} stroke={3.2} />}</span>
      </button>
      <Link to={`/tarea/${s.id}`} className="st-psess__body">
        <span className="st-psess__title">{s.title}</span>
        {meta && <span className="st-psess__meta">{meta}</span>}
      </Link>
      <button type="button" className="st-quit" aria-label={`Quitar ${s.title}`} onClick={() => deleteTask(s.id)}>Quitar</button>
    </div>
  );
}

export default function StudyPlan() {
  const { id } = useParams();
  const exam = useExamOrNull(id);
  const sessions = useExamSessions(id);
  const subjects = useSubjectMap();
  const toast = useToast();
  const [assign, setAssign] = useState<Topic | null>(null);
  const [confirm, setConfirm] = useState(false);

  if (exam === undefined) return <main className="page page--pushed" />;
  if (exam === null) {
    return (
      <main className="page page--pushed">
        <NavBar back="Estudio" backTo="/estudio" title="Plan de estudio" />
        <Empty><p>Este examen ya no existe.</p><Link to="/estudio" className="btn">Volver a Estudio</Link></Empty>
      </main>
    );
  }

  const today = todayISO();
  const days: string[] = [];
  for (let d = today; d < exam.date; d = addDaysISO(d, 1)) days.push(d);
  const future = sessions.filter((s) => (s.date ?? '') >= today);
  const planned = new Set(future.map((s) => s.topicId).filter(Boolean));
  const unplanned = exam.topics.filter((t) => t.status !== 'estudiado' && !planned.has(t.id));
  const totalMin = future.reduce((a, s) => a + (s.durationMin ?? 0), 0);
  const doneCount = future.filter((s) => s.done).length;
  const subject = exam.subjectId ? subjects.get(exam.subjectId) : undefined;
  const n = daysUntil(exam.date);

  const place = async (topic: Topic, date: string) => {
    await createTask({
      title: `Estudiar: ${topic.name}`,
      type: 'estudio',
      date,
      time: '18:30',
      durationMin: 60,
      examId: exam.id,
      topicId: topic.id,
      subjectId: exam.subjectId,
    });
    setAssign(null);
    toast.show({ text: `${topic.name} · ${shortDay(date)}` });
  };

  return (
    <main className="page page--pushed">
      <NavBar back="Examen" backTo={`/examen/${exam.id}`} title="Plan de estudio" />

      <h1 className="st-plan-title">{subject ? `${subject.name} · ` : ''}{exam.title}</h1>
      <p className="muted small" style={{ margin: '6px 0 14px' }}>
        {future.length
          ? `${future.length} ${future.length === 1 ? 'sesión' : 'sesiones'}${totalMin ? ` · ${fmtDuration(totalMin)}` : ''} · ${doneCount} hechas`
          : 'Aún no hay sesiones'}
        {n > 0 ? ` · faltan ${n} ${n === 1 ? 'día' : 'días'}` : ''}
      </p>
      <SegBar thick colors={future.map((s) => (s.done ? 'var(--pink)' : '#e6e6e6'))} />

      {n <= 0 ? (
        <Empty>{n === 0 ? 'El examen es hoy. Mucha suerte.' : 'Este examen ya ha pasado.'}</Empty>
      ) : (
        <>
          <section className="st-tray" aria-labelledby="sin-plan">
            <h2 id="sin-plan" className="section-label" style={{ margin: 0 }}>Sin planificar</h2>
            {unplanned.length === 0 ? (
              <span className="small muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Icon name="check" size={16} stroke={2.4} />Todos los temas están planificados
              </span>
            ) : (
              unplanned.map((t) => (
                <div key={t.id} className="st-tray__item">
                  <span>{t.name}</span>
                  <button type="button" className="btn btn--sm" onClick={() => setAssign(t)}>Asignar a…</button>
                </div>
              ))
            )}
          </section>

          <section className="st-days" aria-label="Días hasta el examen">
            {days.map((d) => {
              const list = sessions.filter((s) => s.date === d).sort((a, b) => (a.time ?? '99').localeCompare(b.time ?? '99'));
              const isToday = d === today;
              return (
                <div key={d} className={`st-day${isToday ? ' st-day--today' : ''}`}>
                  <div className="st-day__date">
                    <span className="st-day__dow">{dow(d)}</span>
                    <span className="st-day__n">{fmt(d, 'd')}</span>
                  </div>
                  <div className="st-day__body">
                    {list.map((s) => <PlanSession key={s.id} s={s} />)}
                    {list.length === 0 && <span className="st-day__free">Día libre</span>}
                    {isToday && <span className="st-day__today">HOY</span>}
                  </div>
                </div>
              );
            })}
            <div className="st-day st-day--exam">
              <div className="st-day__date">
                <span className="st-day__dow">{dow(exam.date)}</span>
                <span className="st-day__n">{fmt(exam.date, 'd')}</span>
              </div>
              <Link to={`/examen/${exam.id}`} className="st-examday grow" style={{ textDecoration: 'none' }}>
                <Icon name="book" size={20} />
                <span>
                  <b>{exam.title}</b>
                  <span>{[exam.time, exam.room].filter(Boolean).join(' · ') || 'Día del examen'}</span>
                </span>
              </Link>
            </div>
          </section>

          <button type="button" className="btn btn--block" style={{ marginTop: 24 }} onClick={() => setConfirm(true)}>
            <Icon name="repeat" size={18} />Redistribuir automáticamente
          </button>
        </>
      )}

      <Sheet open={!!assign} onClose={() => setAssign(null)} title="Asignar a un día">
        {assign && (
          <>
            <p className="muted small" style={{ marginTop: 0 }}>{assign.name} · 1 h a las 18:30. Elige un día:</p>
            <div className="st-daygrid">
              {days.map((d) => (
                <button key={d} type="button" className="btn btn--sm" onClick={() => place(assign, d)}>
                  {d === today ? 'Hoy' : shortDay(d)}
                </button>
              ))}
            </div>
            <button type="button" className="btn btn--block btn--ghost" style={{ marginTop: 16 }} onClick={() => setAssign(null)}>Cancelar</button>
          </>
        )}
      </Sheet>

      <ConfirmSheet open={confirm} onClose={() => setConfirm(false)} title="¿Redistribuir el plan?"
        message="Se sustituirán las sesiones pendientes por un plan nuevo: un tema por día en los días previos al examen. Las sesiones hechas se mantienen."
        confirmLabel="Redistribuir"
        onConfirm={async () => { await autoPlanExam(exam.id); toast.show({ text: 'Plan redistribuido' }); }} />
      {toast.node}
    </main>
  );
}
