import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import type { AgendaItem, Subject } from '../../db/types';
import { useAgenda, useSettings, useSubjectMap } from '../../db/hooks';
import { overdueTasks, setTaskDone } from '../../db/repo';
import { addDaysISO, longDay, todayISO, weekStartISO, fmt, capitalize } from '../../lib/dates';
import { Icon } from '../../components/Icon';
import { LargeHeader } from '../../components/ui';
import { dayDots, groupByDate, isHigh, isKey, itemHref, itemMeta, sortItems, useAgendaContext, type Context } from '../calendar/agenda';
import { DayButton, UpcomingRow } from '../calendar/parts';
import './home.css';

export default function Hoy() {
  const today = todayISO();
  const settings = useSettings();
  const subjects = useSubjectMap();
  const ctx = useAgendaContext();
  const weekStart = weekStartISO(today, settings.weekStart);
  const horizon = addDaysISO(today, 30);
  const range = useAgenda(weekStart, horizon);
  const overdue = useLiveQuery(() => overdueTasks().then((t) => t.length), []);
  const nav = useNavigate();

  const byDate = useMemo(() => groupByDate(range ?? []), [range]);
  const todayAll = byDate.get(today) ?? [];
  const tasksToday = todayAll.filter((i) => i.kind === 'task');
  const doneCount = tasksToday.filter((i) => i.done).length;
  const visible = settings.hideDone ? todayAll.filter((i) => !i.done) : todayAll;
  const timed = sortItems(visible.filter((i) => i.time), settings.daySort);
  const untimed = sortItems(visible.filter((i) => !i.time), settings.daySort);

  const upcoming = (range ?? []).filter((i) => i.date >= today && isKey(i) && !i.done).sort((a, b) => a.date.localeCompare(b.date));
  const week = Array.from({ length: 7 }, (_, i) => addDaysISO(weekStart, i));

  const loading = range === undefined;

  return (
    <main className="page page--wide hoy">
      <LargeHeader
        eyebrow={longDay(today)}
        title="Hoy"
        aside={tasksToday.length > 0 && (
          <span className="small muted"><strong className="hoy__count">{doneCount}</strong> de {tasksToday.length} hechas</span>
        )}
        right={<Link to="/ajustes" className="iconbtn hoy__gear" aria-label="Ajustes"><Icon name="gear" /></Link>}
      />

      <div className="cols">
        <section className="col-main" aria-label="Agenda de hoy">
          <h2 className="section-label">Agenda</h2>
          {!loading && todayAll.length === 0 && (
            <div className="hoy__free">
              <p className="hoy__free-title">Día libre</p>
              <p className="muted small">No hay nada planificado para hoy.</p>
              <Link to={`/tarea/nueva?fecha=${today}`} className="btn btn--sm">
                <Icon name="plus" size={18} stroke={2.2} /> Añadir algo
              </Link>
            </div>
          )}
          {!loading && todayAll.length > 0 && visible.length === 0 && (
            <p className="muted small hoy__alldone">Todo hecho por hoy. Las tareas completadas están ocultas.</p>
          )}

          <div>
            {timed.map((it) => <TimelineRow key={it.key} it={it} ctx={ctx} subjects={subjects} />)}
          </div>
          {untimed.length > 0 && (
            <>
              <h3 className="hoy__subhead">Sin hora</h3>
              <div>
                {untimed.map((it) => <TimelineRow key={it.key} it={it} ctx={ctx} subjects={subjects} />)}
              </div>
            </>
          )}

          {!!overdue && overdue > 0 && (
            <Link to="/atrasadas" className="hoy__late">
              <span className="hoy__late-tag">ATRASADAS</span>
              <span className="hoy__late-text">{overdue === 1 ? '1 tarea por recolocar' : `${overdue} tareas por recolocar`}</span>
              <Icon name="chevron" size={16} stroke={2} />
            </Link>
          )}
        </section>

        <aside className="col-side hoy__side">
          <section className="section hoy__upcoming" aria-label="Próximas fechas">
            <div className="hoy__sidehead">
              <h2 className="section-label">Próximas fechas</h2>
              {upcoming.length > 0 && <span className="xsmall muted hoy__sidecount">{upcoming.length} en 30 días</span>}
            </div>
            {!loading && upcoming.length === 0 && (
              <p className="muted small">Sin exámenes ni entregas en los próximos 30 días.</p>
            )}
            <div className="stack">
              {upcoming.slice(0, 6).map((it) => <UpcomingRow key={it.key} it={it} subjects={subjects} ctx={ctx} />)}
            </div>
          </section>

          <section className="section hoy__week" aria-label="Esta semana">
            <div className="hoy__sidehead">
              <h2 className="section-label">Esta semana</h2>
              <Link to={`/calendario?vista=semana&dia=${today}`} className="small hoy__weeklink">Ver semana</Link>
            </div>
            <div className="wstrip">
              {week.map((d) => {
                const items = byDate.get(d) ?? [];
                const n = items.length;
                return (
                  <DayButton key={d} date={d} today={today} selected={false} dots={dayDots(items, subjects)}
                    label={`${capitalize(fmt(d, "EEEE d 'de' MMMM"))}, ${n === 1 ? '1 cosa' : `${n} cosas`}`}
                    onClick={() => nav(`/dia/${d}`)} />
                );
              })}
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}

function TimelineRow({ it, ctx, subjects }: { it: AgendaItem; ctx: Context; subjects: Map<string, Subject> }) {
  const high = isHigh(it);
  const cls = `tdot${it.done ? ' tdot--done' : high ? ' tdot--high' : ''}`;
  return (
    <div className="timeline-row">
      <span className="timeline-row__time">{it.time ?? ''}</span>
      <div className="timeline-row__rail">
        {it.kind === 'exam' ? (
          <span className={cls} aria-hidden="true" />
        ) : (
          <button type="button" className={`${cls} hoy__dot`} aria-pressed={it.done}
            aria-label={`${it.done ? 'Marcar como pendiente' : 'Marcar como hecha'}: ${it.title}`}
            onClick={() => setTaskDone(it.id, !it.done, it.repeating ? it.date : undefined)} />
        )}
      </div>
      <Link to={itemHref(it)} className="timeline-row__body">
        <span className={`timeline-row__title${it.done ? ' strike' : ''}`}>{it.title}</span>
        <span className="timeline-row__meta">{itemMeta(it, ctx, subjects)}</span>
      </Link>
    </div>
  );
}
