import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { ConfirmSheet, Empty, NavBar, SubjectChip, useToast } from '../../components/ui';
import { useExamSessions, useSubjectMap } from '../../db/hooks';
import { autoPlanExam, deleteExam, setTaskDone, setTopic, updateExam } from '../../db/repo';
import type { Task } from '../../db/types';
import { daysUntil, fmtDuration, longDay, todayISO } from '../../lib/dates';
import { TOPIC_LABEL, nextTopicStatus } from '../../lib/labels';
import { examProgress } from '../../lib/progress';
import Attachments from '../files/Attachments';
import { NotesField, SectionHead, SegBar, TOPIC_COLOR, countdown, shortDay, useExamOrNull } from './common';
import { ReminderList } from './ReminderList';
import './study.css';

function SessionRow({ s, label }: { s: Task; label?: string }) {
  const today = s.date === todayISO();
  return (
    <div className="st-sess">
      <button type="button" className="st-check" aria-pressed={s.done}
        aria-label={s.done ? `${s.title}: hecha. Desmarcar` : `Marcar ${s.title} como hecha`}
        onClick={() => setTaskDone(s.id, !s.done)}>
        <span>{s.done && <Icon name="check" size={12} stroke={3.2} />}</span>
      </button>
      <span className={`st-sess__day${today ? ' st-sess__day--today' : ''}`}>{s.date ? shortDay(s.date) : '—'}</span>
      <Link to={`/tarea/${s.id}`} className={`st-sess__what${s.done ? ' st-sess__what--done' : ''}`}>{label ?? s.title}</Link>
      <span className="st-sess__time">{s.time ?? ''}</span>
      {today && !s.done && <span className="st-badge">HOY</span>}
    </div>
  );
}

export default function ExamDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const exam = useExamOrNull(id);
  const sessions = useExamSessions(id);
  const subjects = useSubjectMap();
  const toast = useToast();
  const [confirmDel, setConfirmDel] = useState(false);

  if (exam === undefined) return <main className="page page--pushed" />;
  if (exam === null) {
    return (
      <main className="page page--pushed">
        <NavBar back="Estudio" backTo="/estudio" />
        <Empty>
          <p>Este examen ya no existe.</p>
          <Link to="/estudio" className="btn">Volver a Estudio</Link>
        </Empty>
      </main>
    );
  }

  const subject = exam.subjectId ? subjects.get(exam.subjectId) : undefined;
  const p = examProgress(exam);
  const pctN = Math.round(p * 100);
  const cd = countdown(exam.date);
  const nDays = daysUntil(exam.date);
  const count = (s: string) => exam.topics.filter((t) => t.status === s).length;
  const today = todayISO();
  const upcoming = sessions.filter((s) => s.type === 'estudio' && (s.date ?? '') >= today);
  const shown = upcoming.slice(0, 4);
  const plannedTopics = new Set(upcoming.map((s) => s.topicId).filter(Boolean));
  const unplanned = exam.topics.filter((t) => t.status !== 'estudiado' && !plannedTopics.has(t.id)).length;
  const totalMin = upcoming.reduce((a, s) => a + (s.durationMin ?? 0), 0);
  const meta = [longDay(exam.date), exam.time, exam.room].filter(Boolean).join(' · ');

  const planNow = async () => {
    await autoPlanExam(exam.id);
    toast.show({ text: 'Sesiones planificadas' });
  };

  return (
    <main className="page page--pushed page--wide">
      <NavBar back="Estudio" backTo="/estudio" title="Examen"
        right={<Link to={`/examen/${exam.id}/editar`} className="navbtn navbtn--bold">Editar</Link>} />

      <div className="cols">
        <div className="col-main">
          <div className="st-head">
            <SubjectChip subject={subject} />
            <h1>{exam.title}</h1>
            <span className="st-head__meta">{meta}</span>
          </div>

          <div className="st-hero">
            <div className="st-hero__pct">
              <span className={`big-number st-hero__num${pctN === 0 ? ' st-hero__num--zero' : ''}`} aria-label={`${pctN} por ciento preparado`}>
                {pctN}<small>%</small>
              </span>
              <span className="st-hero__label">preparado</span>
            </div>
            <div className={`st-hero__count${nDays >= 0 && nDays <= 3 ? ' st-hero__count--urgent' : ''}`}>
              <b>{cd.n}</b>
              <span>{cd.unit}</span>
            </div>
          </div>

          {exam.topics.length > 0 && (
            <>
              <div style={{ paddingTop: 18 }}>
                <SegBar thick colors={exam.topics.map((t) => TOPIC_COLOR[t.status])} />
              </div>
              <div className="st-legend">
                <span><i style={{ background: TOPIC_COLOR.estudiado }} />{count('estudiado')} {count('estudiado') === 1 ? 'estudiado' : 'estudiados'}</span>
                <span><i style={{ background: TOPIC_COLOR.repasar }} />{count('repasar')} para repasar</span>
                <span><i style={{ background: TOPIC_COLOR.pendiente }} />{count('pendiente')} {count('pendiente') === 1 ? 'pendiente' : 'pendientes'}</span>
              </div>
            </>
          )}

          <section className="st-section">
            <SectionHead title="Temas" aside={exam.topics.length ? 'Toca para cambiar' : undefined} />
            {exam.topics.length === 0 ? (
              <p className="muted small">
                Aún no hay temas. <Link to={`/examen/${exam.id}/editar`}>Añadir temas</Link>
              </p>
            ) : (
              exam.topics.map((t, i) => {
                const next = nextTopicStatus(t.status);
                return (
                  <button key={t.id} type="button" className="st-topic"
                    aria-label={`Tema ${i + 1}, ${t.name}: ${TOPIC_LABEL[t.status]}. Cambiar a ${TOPIC_LABEL[next]}`}
                    onClick={() => setTopic(exam.id, t.id, { status: next })}>
                    <span className="st-topic__n">{i + 1}</span>
                    <span className="st-topic__name">{t.name}</span>
                    <span className={`st-topic__state st-topic__state--${t.status}`}><i />{TOPIC_LABEL[t.status]}</span>
                  </button>
                );
              })
            )}
          </section>

          <section className="st-section">
            <SectionHead title="Plan de estudio"
              aside={<Link to={`/examen/${exam.id}/plan`} className="st-link">Ver plan<Icon name="chevron" size={14} stroke={2.4} /></Link>} />
            {upcoming.length > 0 ? (
              <>
                <span className="muted small" style={{ paddingBottom: 4 }}>
                  {upcoming.length} {upcoming.length === 1 ? 'sesión' : 'sesiones'}{totalMin ? ` · ${fmtDuration(totalMin)}` : ''}
                  {unplanned ? ` · ${unplanned} ${unplanned === 1 ? 'tema' : 'temas'} sin planificar` : ''}
                </span>
                {shown.map((s) => <SessionRow key={s.id} s={s} />)}
                {upcoming.length > shown.length && (
                  <Link to={`/examen/${exam.id}/plan`} className="st-link">Ver {upcoming.length - shown.length} más</Link>
                )}
              </>
            ) : nDays > 0 ? (
              <div className="stack" style={{ alignItems: 'flex-start' }}>
                <span className="muted small">Aún no hay sesiones. {nDays === 1 ? 'Falta 1 día.' : `Faltan ${nDays} días.`}</span>
                <button type="button" className="btn btn--sm" onClick={planNow}>Planificar automáticamente</button>
              </div>
            ) : (
              <span className="muted small">No quedan sesiones pendientes.</span>
            )}
          </section>
        </div>

        <aside className="col-side">
          <div className="st-section" style={{ borderTop: 0, paddingTop: 0, marginTop: 32 }}>
            <Attachments ownerType="exam" ownerId={exam.id} title="Material" />
          </div>
          <NotesField id={exam.id} value={exam.notes} onSave={(v) => updateExam(exam.id, { notes: v })} />
          <ReminderList title="Avisos" reminders={exam.reminders} date={exam.date} time={exam.time}
            onChange={(r) => updateExam(exam.id, { reminders: r })} />
          <div className="st-actions">
            <button type="button" className="btn btn--danger btn--block" onClick={() => setConfirmDel(true)}>
              <Icon name="trash" size={18} />Eliminar examen
            </button>
          </div>
        </aside>
      </div>

      <ConfirmSheet open={confirmDel} onClose={() => setConfirmDel(false)} title="¿Eliminar este examen?"
        message="Se borrarán también sus sesiones de estudio y el material adjunto."
        confirmLabel="Eliminar examen"
        onConfirm={async () => { await deleteExam(exam.id); nav('/estudio', { replace: true }); }} />
      {toast.node}
    </main>
  );
}
