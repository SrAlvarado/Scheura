import { Link, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Empty, LargeHeader, Progress, SubjectChip, SubjectDot } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { useAgenda, useSettings, useSubjectMap } from '../../db/hooks';
import { byTime, overdueTasks } from '../../db/repo';
import type { AgendaItem, Subject } from '../../db/types';
import { addDaysISO, capitalize, fmt, fmtDuration, relDays, todayISO, weekdayMon0, WEEKDAYS, WEEKDAYS_SHORT } from '../../lib/dates';
import { TYPE_LABEL } from '../../lib/labels';
import { computeStats, itemHref, weekNumber, weekRange, type WeekRange } from './stats';
import './summary.css';

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const mon = (d: string) => fmt(d, 'MMM').replace('.', '');
const shortDay = (d: string) => capitalize(fmt(d, 'EEE d').replace('.', ''));
const maxISO = (a: string, b: string) => (a > b ? a : b);

function weekLabel(w: WeekRange): string {
  const a = Number(w.start.slice(8));
  const b = Number(w.end.slice(8));
  const range = w.start.slice(5, 7) === w.end.slice(5, 7) ? `${a}–${b} ${mon(w.end)}` : `${a} ${mon(w.start)} – ${b} ${mon(w.end)}`;
  return `Semana ${weekNumber(w)} · ${range}`;
}

/** "Ayer", "Hoy 16:00", "Mañana", "Vie 20" */
function whenLabel(it: AgendaItem, today: string): string {
  const t = it.time ? ` ${it.time}` : '';
  if (it.date === today) return `Hoy${t}`;
  if (it.date === addDaysISO(today, -1)) return 'Ayer';
  if (it.date === addDaysISO(today, 1)) return `Mañana${t}`;
  return shortDay(it.date);
}

function itemMeta(it: AgendaItem, subjects: Map<string, Subject>): string {
  const parts: string[] = [];
  const s = it.subjectId ? subjects.get(it.subjectId) : undefined;
  if (s) parts.push(s.name);
  if (it.parentId) parts.push('Paso de trabajo');
  else if (it.type !== 'tarea') parts.push(TYPE_LABEL[it.type]);
  if (it.durationMin) parts.push(fmtDuration(it.durationMin));
  return parts.join(' · ');
}

/** "6 h 30 min" con las unidades en pequeño */
function Duration({ min }: { min: number }) {
  const text = fmtDuration(min) || '0 h';
  return (
    <>
      {text.split(' ').map((tok, i) =>
        /^\d+$/.test(tok) ? <span key={i}>{tok}</span> : <span key={i} className="sum-unit"> {tok} </span>,
      )}
    </>
  );
}

export default function Resumen() {
  const settings = useSettings();
  const subjects = useSubjectMap();
  const [params, setParams] = useSearchParams();
  const today = todayISO();
  const anchorParam = params.get('semana');
  const anchor = anchorParam && ISO_RE.test(anchorParam) ? anchorParam : today;

  const week = weekRange(anchor, settings.weekStart);
  const current = weekRange(today, settings.weekStart);
  const isCurrent = week.start === current.start;
  const isPast = week.end < today;

  const goTo = (date: string | null) => {
    const next = new URLSearchParams(params);
    if (!date || weekRange(date, settings.weekStart).start === current.start) next.delete('semana');
    else next.set('semana', date);
    setParams(next, { replace: true });
  };

  const items = useAgenda(week.start, week.end);
  const upFrom = maxISO(today, week.start);
  const upTo = addDaysISO(maxISO(today, week.end), 14);
  const upcomingRaw = useAgenda(upFrom, upTo);
  const overdueCount = useLiveQuery(() => overdueTasks().then((l) => l.length), []) ?? 0;

  const header = (
    <LargeHeader
      eyebrow={weekLabel(week)}
      title="Resumen"
      right={
        <>
          <button type="button" className="iconbtn" aria-label="Semana anterior" onClick={() => goTo(addDaysISO(week.start, -7))}>
            <Icon name="back" size={20} stroke={2} />
          </button>
          <button type="button" className="iconbtn" aria-label="Semana siguiente" onClick={() => goTo(addDaysISO(week.start, 7))}>
            <Icon name="chevron" size={20} stroke={2} />
          </button>
        </>
      }
      aside={
        !isCurrent && (
          <button type="button" className="sum-now" onClick={() => goTo(null)}>
            Esta semana
          </button>
        )
      }
    />
  );

  if (!items || !upcomingRaw) return <main className="page page--wide sum">{header}</main>;

  const stats = computeStats(items, today);
  const upcoming = upcomingRaw.filter((it) => (it.kind === 'exam' || (it.type === 'entrega' && !it.parentId)) && !it.done);
  const open = stats.countable
    .filter((it) => !it.done)
    .sort((a, b) => Number(b.date < today) - Number(a.date < today) || byTime(a, b));
  const doneList = stats.countable.filter((it) => it.done);
  const subjectName = (id?: string) => (id ? subjects.get(id)?.name ?? 'Asignatura' : 'Sin asignatura');

  const pendTitle = isPast ? 'Quedó sin hacer' : isCurrent ? 'Pendiente de esta semana' : 'Pendiente de la semana';
  const notDone = stats.pending + stats.overdue;
  const maxDay = Math.max(1, ...week.days.map((d) => stats.perDay[d] ?? 0));
  const chartAria =
    'Completadas por día. ' +
    week.days
      .map((d) => `${WEEKDAYS[weekdayMon0(d)].toLowerCase()} ${Number(d.slice(8))}: ${d > today ? 'aún no' : stats.perDay[d] ?? 0}`)
      .join(', ') +
    '.';

  const upcomingSection = (
    <section className="section" aria-labelledby="sum-up">
      <h2 id="sum-up" className="section-label sum-h2">Fechas importantes que se acercan</h2>
      {upcoming.length === 0 ? (
        <p className="muted small">Nada en las próximas dos semanas.</p>
      ) : (
        upcoming.map((it) => {
          const p = it.progress ?? 0;
          return (
            <Link key={it.key} to={itemHref(it)} className="sum-date">
              <div className="sum-date__day">
                <span className="big-number">{Number(it.date.slice(8))}</span>
                <span className="xsmall muted">{mon(it.date)}</span>
              </div>
              <div className="grow sum-date__body">
                <div className="sum-date__top">
                  <span className="list-row__title">{it.title}</span>
                  <span className="sum-pct">{Math.round(p * 100)}%</span>
                </div>
                <Progress value={p} label={`Progreso de ${it.title}`} />
                <span className="xsmall muted">
                  {[it.kind === 'exam' ? 'Examen' : 'Trabajo', it.subjectId && subjectName(it.subjectId), relDays(it.date)].filter(Boolean).join(' · ')}
                </span>
              </div>
              <Icon name="chevron" size={16} stroke={2} />
            </Link>
          );
        })
      )}
    </section>
  );

  if (items.length === 0) {
    return (
      <main className="page page--wide sum">
        {header}
        <Empty>
          <p className="sum-empty__title">Semana sin tareas</p>
          <p>No hay nada planificado para estos días.</p>
          <Link className="btn btn--sm" to={`/tarea/nueva?fecha=${isCurrent ? today : week.start}`}>
            Añadir tarea
          </Link>
        </Empty>
        {upcomingSection}
      </main>
    );
  }

  return (
    <main className="page page--wide sum">
      {header}

      <div className="sum-numbers">
        <div className="sum-num">
          <span className="big-number sum-num__value sum-num__value--pink">{stats.done}</span>
          <span className="sum-num__label">completadas</span>
        </div>
        <div className="sum-num">
          <span className="big-number sum-num__value">{notDone}</span>
          <span className="sum-num__label">
            {isPast ? 'sin hacer' : 'pendientes'}
            {!isPast && stats.overdue > 0 && <span className="pink"> · {stats.overdue} {stats.overdue === 1 ? 'atrasada' : 'atrasadas'}</span>}
          </span>
        </div>
        <div className="sum-num sum-num--desk">
          <span className="big-number sum-num__value">{upcoming.length}</span>
          <span className="sum-num__label">fechas importantes</span>
        </div>
        <div className="sum-num sum-num--wide">
          <span className="big-number sum-num__value">
            <Duration min={stats.studyMin} />
          </span>
          <span className="sum-num__label">de estudio</span>
        </div>
      </div>

      <section className="section" aria-labelledby="sum-chart">
        <h2 id="sum-chart" className="section-label sum-h2">Completadas por día</h2>
        <div className="sum-chart" role="img" aria-label={chartAria}>
          {week.days.map((d) => {
            const n = stats.perDay[d] ?? 0;
            const future = d > today;
            const cls = future ? ' sum-bar--future' : d === today ? ' sum-bar--today' : '';
            return (
              <div key={d} className={`sum-bar${cls}`} aria-hidden="true">
                <span className="sum-bar__num">{future ? '' : n}</span>
                <div className="sum-bar__fill" style={future ? undefined : { height: n ? `calc((100% - 30px) * ${(n / maxDay).toFixed(3)})` : '2px' }} />
              </div>
            );
          })}
        </div>
        <div className="sum-chart__axis" aria-hidden="true">
          {week.days.map((d) => (
            <span key={d} className={d === today ? 'is-today' : undefined}>
              {WEEKDAYS_SHORT[weekdayMon0(d)]}
              <small>{Number(d.slice(8))}</small>
            </span>
          ))}
        </div>
      </section>

      <div className="cols sum-cols">
        <div className="col-main">
          <section className="section" aria-labelledby="sum-subj">
            <h2 id="sum-subj" className="section-label sum-h2">Por asignatura</h2>
            {stats.bySubject.map((s) => {
              const name = subjectName(s.subjectId);
              return (
                <div key={s.subjectId ?? 'none'} className="sum-subj">
                  <div className="row sum-subj__top">
                    <SubjectDot subject={s.subjectId ? subjects.get(s.subjectId) : undefined} size={10} />
                    <span className="grow sum-subj__name">{name}</span>
                    {s.studyMin > 0 && <span className="xsmall muted sum-desk-only">{fmtDuration(s.studyMin)} de estudio</span>}
                    <span className="small muted tnum">
                      <strong className="sum-strong">{s.done}</strong> de {s.total}
                    </span>
                  </div>
                  <div className="sum-subj__bar">
                    <Progress value={s.total ? s.done / s.total : 0} label={`${name}: ${s.done} de ${s.total}`} />
                  </div>
                </div>
              );
            })}
          </section>

          <section className="section sum-desk-only" aria-labelledby="sum-done">
            <div className="sum-listhead">
              <h2 id="sum-done" className="section-label sum-h2">Completadas</h2>
              <span className="small muted">{doneList.length}</span>
            </div>
            {doneList.length === 0 ? (
              <p className="muted small">Todavía nada completado esta semana.</p>
            ) : (
              doneList.map((it) => (
                <Link key={it.key} to={itemHref(it)} className="list-row sum-row">
                  <span className="sum-ring sum-ring--done" aria-hidden="true" />
                  <span className="grow sum-row__title sum-row__title--done">{it.title}</span>
                  <SubjectChip subject={it.subjectId ? subjects.get(it.subjectId) : undefined} />
                  <span className="xsmall muted sum-row__when">{shortDay(it.date)}</span>
                </Link>
              ))
            )}
          </section>
        </div>

        <div className="col-side">
          {upcomingSection}

          <section className="section" aria-labelledby="sum-pend">
            <div className="sum-listhead">
              <h2 id="sum-pend" className="section-label sum-h2">{pendTitle}</h2>
              <span className="small muted">{open.length}</span>
            </div>
            {open.length === 0 ? (
              <p className="muted small">Todo hecho. Buen trabajo.</p>
            ) : (
              open.slice(0, 6).map((it) => {
                const late = it.date < today;
                return (
                  <Link key={it.key} to={itemHref(it)} className="list-row sum-row">
                    <span className={`sum-ring${late ? ' sum-ring--late' : ''}`} aria-hidden="true" />
                    <span className="grow sum-row__text">
                      <span className="list-row__title">{it.title}</span>
                      <span className="list-row__meta">{itemMeta(it, subjects) || TYPE_LABEL[it.type]}</span>
                    </span>
                    <span className={`sum-row__when${late || it.date === today ? ' pink' : ' muted'}`}>
                      {late && <span className="sr-only">Atrasada: </span>}
                      {whenLabel(it, today)}
                    </span>
                  </Link>
                );
              })
            )}
            {open.length > 6 && <p className="xsmall muted">Y {open.length - 6} más.</p>}
            {overdueCount > 0 && (
              <Link to="/atrasadas" className="sum-more">
                <span className="grow">Ver atrasadas y recolocar</span>
                <span className="sum-more__count">{overdueCount}</span>
                <Icon name="chevron" size={16} stroke={2} />
              </Link>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
