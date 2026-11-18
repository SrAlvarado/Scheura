import { useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { Empty, LargeHeader, Progress, Segmented, SubjectChip } from '../../components/ui';
import { useSubjectMap } from '../../db/hooks';
import type { Exam, Subject, Task } from '../../db/types';
import { daysUntil, fmtDuration, longDay, relDays, todayISO } from '../../lib/dates';
import { examProgress, workProgress } from '../../lib/progress';
import { SegBar, topicSummary, useExamsLive, useTasksLive } from './common';
import './study.css';

type Tab = 'examenes' | 'trabajos';

function PctNumber({ value, urgent }: { value: number; urgent?: boolean }) {
  const n = Math.round(value * 100);
  const cls = n === 0 ? ' st-pct--zero' : urgent ? ' st-pct--pink' : '';
  return (
    <span className={`st-pct${cls}`} aria-label={`${n} por ciento`}>
      {n}<small>%</small>
    </span>
  );
}

function ExamRow({ exam, subject }: { exam: Exam; subject?: Subject }) {
  const p = examProgress(exam);
  const n = daysUntil(exam.date);
  const urgent = n >= 0 && n <= 7;
  const past = n < 0;
  return (
    <Link to={`/examen/${exam.id}`} className={`st-item${past ? ' st-item--done' : ''}`}>
      <div className="st-item__top">
        <div className="st-item__info">
          <SubjectChip subject={subject} />
          <span className="st-item__title">{exam.title}</span>
          <span className="st-item__meta">
            {longDay(exam.date)}{exam.time ? ` · ${exam.time}` : ''} · <b className={urgent ? 'pink' : ''}>{relDays(exam.date)}</b>
          </span>
        </div>
        <PctNumber value={p} urgent={urgent} />
      </div>
      <Progress value={p} label={`Preparación de ${exam.title}`} />
      <span className="st-item__foot">{topicSummary(exam.topics)}</span>
    </Link>
  );
}

function WorkRow({ work, steps, subject }: { work: Task; steps: Task[]; subject?: Subject }) {
  const p = workProgress(work, steps);
  const done = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done);
  const n = work.date ? daysUntil(work.date) : undefined;
  const urgent = n !== undefined && n >= 0 && n <= 3 && !work.done;
  return (
    <Link to={`/trabajo/${work.id}`} className={`st-item${work.done ? ' st-item--done' : ''}`}>
      <div className="st-item__top">
        <div className="st-item__info">
          <SubjectChip subject={subject} />
          <span className="st-item__title">{work.title}</span>
          <span className="st-item__meta">
            {work.date ? (
              <>Entrega {longDay(work.date)}{work.time ? ` · ${work.time}` : ''} · <b className={urgent ? 'pink' : ''}>{work.done ? 'entregado' : relDays(work.date)}</b></>
            ) : 'Sin fecha de entrega'}
          </span>
        </div>
        <PctNumber value={p} urgent />
      </div>
      {steps.length > 0
        ? <SegBar colors={steps.map((s) => (s.done ? 'var(--pink)' : '#e6e6e6'))} />
        : <Progress value={p} label={`Progreso de ${work.title}`} />}
      <span className="st-item__foot">
        {steps.length ? `${done} de ${steps.length} pasos` : 'Sin pasos'}
        {next && !work.done ? ` · Siguiente: ${next.title}${next.date ? ` · ${relDays(next.date)}` : ''}` : ''}
      </span>
    </Link>
  );
}

function Collapsible({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" className="st-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        {label}<Icon name="chevron" size={16} stroke={2} />
      </button>
      {open && <div className="st-list">{children}</div>}
    </div>
  );
}

export default function Estudio() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('tab') === 'trabajos' ? 'trabajos' : 'examenes';
  const exams = useExamsLive();
  const tasks = useTasksLive();
  const subjects = useSubjectMap();
  const today = todayISO();

  const { upcoming, past } = useMemo(() => {
    const list = exams ?? [];
    return {
      upcoming: list.filter((e) => e.date >= today).sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? '')),
      past: list.filter((e) => e.date < today).sort((a, b) => b.date.localeCompare(a.date)),
    };
  }, [exams, today]);

  const { active, delivered, stepsOf, todayStudy } = useMemo(() => {
    const all = tasks ?? [];
    const steps = new Map<string, Task[]>();
    for (const t of all) if (t.parentId) steps.set(t.parentId, [...(steps.get(t.parentId) ?? []), t]);
    for (const list of steps.values()) list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const works = all.filter((t) => t.type === 'entrega' && !t.parentId);
    const byDate = (a: Task, b: Task) => (a.date ?? '9999').localeCompare(b.date ?? '9999');
    return {
      active: works.filter((w) => !w.done).sort(byDate),
      delivered: works.filter((w) => w.done).sort((a, b) => byDate(b, a)),
      stepsOf: (id: string) => steps.get(id) ?? [],
      todayStudy: all.filter((t) => t.type === 'estudio' && t.date === today).sort((a, b) => (a.time ?? '99').localeCompare(b.time ?? '99')),
    };
  }, [tasks, today]);

  const examById = useMemo(() => new Map((exams ?? []).map((e) => [e.id, e])), [exams]);
  const loading = exams === undefined || tasks === undefined;
  const addTo = tab === 'examenes' ? '/examen/nuevo' : '/tarea/nueva?tipo=entrega';

  return (
    <main className="page page--wide">
      <LargeHeader
        eyebrow={longDay(today)}
        title="Estudio"
        right={
          <Link to={addTo} className="iconbtn" aria-label={tab === 'examenes' ? 'Nuevo examen' : 'Nuevo trabajo'}>
            <Icon name="plus" size={24} stroke={2} />
          </Link>
        }
      />
      <div className="cols">
        <div className="col-main">
          <div className="st-tabs">
            <Segmented<Tab>
              label="Tipo"
              value={tab}
              onChange={(v) => setParams({ tab: v }, { replace: true })}
              options={[{ value: 'examenes', label: 'Exámenes' }, { value: 'trabajos', label: 'Trabajos' }]}
            />
          </div>

          {loading ? null : tab === 'examenes' ? (
            <section className="section" style={{ marginTop: 22 }}>
              <h2 className="section-label" style={{ marginBottom: 4 }}>Próximos exámenes</h2>
              {upcoming.length === 0 ? (
                <Empty>
                  <p style={{ margin: '0 0 16px' }}>{past.length ? 'No tienes exámenes a la vista.' : 'Aún no hay exámenes.'}</p>
                  <Link to="/examen/nuevo" className="btn btn--primary">Añadir examen</Link>
                </Empty>
              ) : (
                <div className="st-list">
                  {upcoming.map((e) => <ExamRow key={e.id} exam={e} subject={e.subjectId ? subjects.get(e.subjectId) : undefined} />)}
                </div>
              )}
              {past.length > 0 && (
                <Collapsible label={`Pasados (${past.length})`}>
                  {past.map((e) => <ExamRow key={e.id} exam={e} subject={e.subjectId ? subjects.get(e.subjectId) : undefined} />)}
                </Collapsible>
              )}
            </section>
          ) : (
            <section className="section" style={{ marginTop: 22 }}>
              <h2 className="section-label" style={{ marginBottom: 4 }}>Trabajos en curso</h2>
              {active.length === 0 ? (
                <Empty>
                  <p style={{ margin: '0 0 16px' }}>{delivered.length ? 'Todo entregado. Buen trabajo.' : 'Aún no hay trabajos.'}</p>
                  <Link to="/tarea/nueva?tipo=entrega" className="btn btn--primary">Añadir trabajo</Link>
                </Empty>
              ) : (
                <div className="st-list">
                  {active.map((w) => <WorkRow key={w.id} work={w} steps={stepsOf(w.id)} subject={w.subjectId ? subjects.get(w.subjectId) : undefined} />)}
                </div>
              )}
              {delivered.length > 0 && (
                <Collapsible label={`Entregados (${delivered.length})`}>
                  {delivered.map((w) => <WorkRow key={w.id} work={w} steps={stepsOf(w.id)} subject={w.subjectId ? subjects.get(w.subjectId) : undefined} />)}
                </Collapsible>
              )}
            </section>
          )}
        </div>

        {!loading && todayStudy.length > 0 && (
          <aside className="col-side st-side">
            <section className="st-today" aria-labelledby="hoy-toca">
              <h2 id="hoy-toca" className="section-label" style={{ margin: 0 }}>Hoy toca estudiar</h2>
              {todayStudy.map((t) => {
                const exam = t.examId ? examById.get(t.examId) : undefined;
                const topic = exam && t.topicId ? exam.topics.find((x) => x.id === t.topicId) : undefined;
                const subject = t.subjectId ? subjects.get(t.subjectId) : undefined;
                const meta = [subject?.name, topic?.name ?? exam?.title].filter(Boolean).join(' · ');
                return (
                  <Link key={t.id} to={exam ? `/examen/${exam.id}` : `/tarea/${t.id}`} className={`st-today__row${t.done ? ' st-today__row--done' : ''}`}>
                    <span className="st-today__time">
                      <b>{t.time ?? '—'}</b>
                      <span>{fmtDuration(t.durationMin) || (t.done ? 'Hecho' : '')}</span>
                    </span>
                    <span className="grow">
                      <span className="st-today__title">{t.title}</span>
                      {meta && <span className="st-today__meta">{meta}</span>}
                    </span>
                    <Icon name="chevron" size={16} stroke={2} className="muted" />
                  </Link>
                );
              })}
            </section>
          </aside>
        )}
      </div>
    </main>
  );
}
