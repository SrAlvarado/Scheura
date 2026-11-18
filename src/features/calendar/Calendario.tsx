import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { addMonths, endOfMonth, isValid, parseISO, startOfMonth } from 'date-fns';
import type { AgendaItem, Subject } from '../../db/types';
import { useAgenda, useSettings, useSubjectMap, useSubjects } from '../../db/hooks';
import { SUBJECT_COLORS } from '../../lib/colors';
import { addDaysISO, capitalize, fmt, fromISO, longDay, relDays, toISO, todayISO, weekStartISO } from '../../lib/dates';
import { TYPE_LABEL, TYPES } from '../../lib/labels';
import { Icon } from '../../components/Icon';
import { Chip, LargeHeader, Segmented, Sheet, SubjectDot } from '../../components/ui';
import {
  activeCount, type Context, dayDots, EMPTY_FILTERS, type Filters, groupByDate, isKey, itemHref, matches, PINK,
  type SortMode, sortItems, STATE_LABEL, STATES, toggleIn, useAgendaContext, useFilters, useIsDesktop, useNowMinutes,
} from './agenda';
import { AgendaRow, DayButton, hm, layoutBlocks } from './parts';
import './calendar.css';

type View = 'mes' | 'semana';
const START_H = 7;
const END_H = 23;

const isISODate = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && isValid(parseISO(s));
const countLabel = (n: number) => (n === 1 ? '1 cosa' : `${n} cosas`);

export default function Calendario() {
  const today = todayISO();
  const settings = useSettings();
  const subjectList = useSubjects();
  const subjects = useSubjectMap();
  const ctx = useAgendaContext();
  const desktop = useIsDesktop();
  const [params, setParams] = useSearchParams();
  const [filters, setFilters] = useFilters();
  const [sortPick, setSortPick] = useState<SortMode | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);

  const qv = params.get('vista');
  const view: View = qv === 'mes' || qv === 'semana' ? qv : settings.calendarView;
  const qd = params.get('dia');
  const dia = isISODate(qd) ? qd : today;
  const sort = sortPick ?? settings.daySort;
  const ws = settings.weekStart;

  const setQuery = (patch: Partial<{ vista: View; dia: string }>) => {
    const p = new URLSearchParams(params);
    p.set('vista', patch.vista ?? view);
    p.set('dia', patch.dia ?? dia);
    setParams(p, { replace: true });
  };

  const monthStart = toISO(startOfMonth(fromISO(dia)));
  const monthEnd = toISO(endOfMonth(fromISO(dia)));
  const gridStart = weekStartISO(monthStart, ws);
  const gridEnd = addDaysISO(weekStartISO(monthEnd, ws), 6);
  const weekStart = weekStartISO(dia, ws);
  const week = Array.from({ length: 7 }, (_, i) => addDaysISO(weekStart, i));
  const from = gridStart < weekStart ? gridStart : weekStart;
  const to = gridEnd > week[6] ? gridEnd : week[6];

  const all = useAgenda(from, to);
  const filtered = useMemo(() => (all ?? []).filter((i) => matches(i, filters, today)), [all, filters, today]);
  const byDate = useMemo(() => groupByDate(filtered), [filtered]);

  const inRange = (i: AgendaItem) => (view === 'mes' ? i.date >= monthStart && i.date <= monthEnd : i.date >= week[0] && i.date <= week[6]);
  const rangeAll = (all ?? []).filter(inRange);
  const resultCount = filtered.filter(inRange).length;
  const nActive = activeCount(filters);

  const grid: string[] = [];
  for (let d = gridStart; d <= gridEnd; d = addDaysISO(d, 1)) grid.push(d);
  const dowLabels = Array.from({ length: 7 }, (_, i) => capitalize(fmt(addDaysISO(gridStart, i), desktop ? 'EEE' : 'EEEEE').replace('.', '')));
  const todayCol = today >= gridStart && today <= gridEnd ? grid.indexOf(today) % 7 : -1;

  const step = (dir: 1 | -1) =>
    setQuery({ dia: view === 'mes' ? toISO(addMonths(fromISO(dia), dir)) : addDaysISO(dia, 7 * dir) });

  const dayItems = byDate.get(dia) ?? [];
  const unit = view === 'mes' ? 'Mes' : 'Semana';

  const panel = (
    <DayPanel date={dia} today={today} items={dayItems} sort={sort} onSort={setSortPick} subjects={subjects} ctx={ctx} side={desktop} />
  );

  return (
    <main className="page page--wide cal">
      <LargeHeader
        eyebrow={`Hoy, ${longDay(today).toLowerCase()}`}
        title={<>{capitalize(fmt(dia, 'MMMM'))} <span className="cal__year">{fmt(dia, 'yyyy')}</span></>}
        right={
          <>
            <button type="button" className="iconbtn" aria-label={`${unit} anterior`} onClick={() => step(-1)}><Icon name="back" size={20} stroke={2.2} /></button>
            <button type="button" className="cal__today" onClick={() => setQuery({ dia: today })} disabled={dia === today}>Hoy</button>
            <button type="button" className="iconbtn" aria-label={`${unit} siguiente`} onClick={() => step(1)}><Icon name="chevron" size={20} stroke={2.2} /></button>
          </>
        }
      />

      <div className="cols cal__cols">
        <div className="col-main">
          <div className="cal__toolbar">
            <div className="cal__seg">
              <Segmented label="Vista" value={view} onChange={(v) => setQuery({ vista: v })}
                options={[{ value: 'mes', label: 'Mes' }, { value: 'semana', label: 'Semana' }]} />
            </div>
            <button type="button" className="cal__filterbtn" onClick={() => setFilterOpen(true)} aria-haspopup="dialog"
              aria-label={nActive ? `Filtros, ${nActive} activos` : 'Filtros'}>
              <Icon name="filter" size={18} stroke={2} />
              Filtros
              {nActive > 0 && <span className="cal__badge" aria-hidden="true">{nActive}</span>}
            </button>
          </div>

          {view === 'mes' && !desktop && (
            <section aria-label={capitalize(fmt(dia, "MMMM yyyy"))} className="mgrid-m">
              <div className="mgrid-m__dows" aria-hidden="true">
                {dowLabels.map((l, i) => <span key={i} data-today={i === todayCol || undefined}>{l}</span>)}
              </div>
              <div className="mgrid-m__cells">
                {grid.map((d) => {
                  const inMonth = d >= monthStart && d <= monthEnd;
                  if (!inMonth) return <span key={d} className="mcell mcell--out" aria-hidden="true"><span className="mcell__num">{fmt(d, 'd')}</span></span>;
                  const items = byDate.get(d) ?? [];
                  return (
                    <button key={d} type="button" className="mcell" aria-pressed={d === dia} data-today={d === today || undefined}
                      aria-label={`${capitalize(fmt(d, "EEEE d 'de' MMMM"))}, ${countLabel(items.length)}`}
                      onClick={() => setQuery({ dia: d })}>
                      <span className="mcell__num">{fmt(d, 'd')}</span>
                      <span className="dots">{dayDots(items, subjects).map((c, i) => <span key={i} style={{ background: c }} />)}</span>
                    </button>
                  );
                })}
              </div>
              <div className="cal__legend">
                <span><span className="dot" style={{ background: PINK, width: 6, height: 6 }} />Examen o entrega</span>
                <span><span className="dot" style={{ background: SUBJECT_COLORS.azul.fg, width: 6, height: 6 }} />Color de asignatura</span>
              </div>
            </section>
          )}

          {view === 'mes' && desktop && (
            <div className="hscroll">
              <div className="mgrid-d">
                <div className="mgrid-d__dows" aria-hidden="true">
                  {dowLabels.map((l, i) => <span key={i} data-today={i === todayCol || undefined}>{l}</span>)}
                </div>
                <div className="mgrid-d__cells">
                  {grid.map((d) => {
                    const inMonth = d >= monthStart && d <= monthEnd;
                    if (!inMonth) return <div key={d} className="dcell dcell--out" aria-hidden="true"><span className="dcell__num">{fmt(d, 'd')}</span></div>;
                    const items = sortItems(byDate.get(d) ?? [], 'hora');
                    const more = items.length - 2;
                    return (
                      <div key={d} className="dcell">
                        <button type="button" className="dcell__btn" aria-pressed={d === dia} data-today={d === today || undefined}
                          aria-label={`${capitalize(fmt(d, "EEEE d 'de' MMMM"))}, ${countLabel(items.length)}`}
                          onClick={() => setQuery({ dia: d })}>
                          <span className="dcell__num">{fmt(d, 'd')}</span>
                          {items.slice(0, 2).map((it) => <Pill key={it.key} it={it} subjects={subjects} />)}
                          {more > 0 && <span className="dcell__more">+{more} más</span>}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {view === 'semana' && !desktop && (
            <>
              <div className="wstrip wstrip--cal" role="group" aria-label="Días de la semana">
                {week.map((d) => {
                  const items = byDate.get(d) ?? [];
                  return (
                    <DayButton key={d} date={d} today={today} selected={d === dia} dots={dayDots(items, subjects)}
                      label={`${capitalize(fmt(d, "EEEE d 'de' MMMM"))}, ${countLabel(items.length)}`}
                      onClick={() => setQuery({ dia: d })} />
                  );
                })}
              </div>
              <WeekDay date={dia} today={today} items={dayItems} subjects={subjects} ctx={ctx} />
            </>
          )}

          {view === 'semana' && desktop && (
            <WeekGrid week={week} dia={dia} today={today} byDate={byDate} subjects={subjects} onPick={(d) => setQuery({ dia: d })} />
          )}

          {view === 'mes' && !desktop && panel}
        </div>

        {desktop && <aside className="col-side cal__side" aria-label="Día seleccionado">{panel}</aside>}
      </div>

      <FilterSheet open={filterOpen} onClose={() => setFilterOpen(false)} filters={filters} setFilters={setFilters}
        subjects={subjectList} items={rangeAll} today={today} resultCount={resultCount}
        rangeLabel={view === 'mes' ? capitalize(fmt(dia, 'MMMM yyyy')) : `Del ${fmt(week[0], 'd MMM').replace('.', '')} al ${fmt(week[6], 'd MMM').replace('.', '')}`} />
    </main>
  );
}

function Pill({ it, subjects }: { it: AgendaItem; subjects: Map<string, Subject> }) {
  const s = it.subjectId ? subjects.get(it.subjectId) : undefined;
  const c = s ? SUBJECT_COLORS[s.color] : { bg: '#F0F0F0', fg: '#424242' };
  return (
    <span className="pill" style={{ background: c.bg }}>
      {isKey(it) && <span className="pill__key" aria-hidden="true" />}
      <span className={`pill__name${it.done ? ' strike' : ''}`} style={{ color: it.done ? undefined : c.fg }}>{it.title}</span>
    </span>
  );
}

/** Lista del día seleccionado (debajo del mes en móvil, columna lateral en ordenador). */
function DayPanel({ date, today, items, sort, onSort, subjects, ctx, side }: {
  date: string; today: string; items: AgendaItem[]; sort: SortMode; onSort: (s: SortMode) => void;
  subjects: Map<string, Subject>; ctx: Context; side: boolean;
}) {
  const list = sortItems(items, sort);
  const pending = items.filter((i) => !i.done && i.kind === 'task').length;
  const summary = `${countLabel(items.length)}${items.length ? ` · ${pending} pendientes` : ''}`;
  const seg = (
    <Segmented label="Ordenar por" value={sort} onChange={onSort}
      options={[{ value: 'hora', label: 'Hora' }, { value: 'importancia', label: 'Importancia' }]} />
  );
  return (
    <section className={`dpanel${side ? ' dpanel--side' : ''}`}>
      {side ? (
        <>
          <span className="section-label">Día seleccionado</span>
          <div className="dpanel__big">
            <span className="dpanel__n" data-today={date === today || undefined}>{fmt(date, 'd')}</span>
            <span className="dpanel__dow">
              <strong>{capitalize(fmt(date, 'EEEE'))}</strong>
              <span className="small muted">{capitalize(relDays(date))}</span>
            </span>
          </div>
          <div className="dpanel__row">
            <span className="small muted">{summary}</span>
            <div className="dpanel__seg">{seg}</div>
          </div>
        </>
      ) : (
        <div className="dpanel__head">
          <div className="grow">
            <h2 className="dpanel__title">{longDay(date)}</h2>
            <span className="small muted">{capitalize(relDays(date))} · {summary}</span>
          </div>
          <div className="dpanel__seg">{seg}</div>
        </div>
      )}
      <div className="dpanel__list">
        {list.map((it) => <AgendaRow key={it.key} it={it} subjects={subjects} ctx={ctx} today={today} compact={side} />)}
        {items.length === 0 && (
          <div className="dpanel__empty">
            <strong>Día libre</strong>
            <span className="small muted">No hay nada planificado.</span>
          </div>
        )}
      </div>
      <div className="dpanel__actions">
        <Link to={`/dia/${date}`} className="dpanel__link">Ver día <Icon name="chevron" size={14} stroke={2.2} /></Link>
        <Link to={`/tarea/nueva?fecha=${date}`} className={side ? 'btn btn--sm' : 'dpanel__add'}><Icon name="plus" size={16} stroke={2.2} />Añadir</Link>
      </div>
    </section>
  );
}

/** Semana en móvil: día seleccionado con elementos sin hora arriba y línea de tiempo por horas. */
function WeekDay({ date, today, items, subjects, ctx }: { date: string; today: string; items: AgendaItem[]; subjects: Map<string, Subject>; ctx: Context }) {
  const HH = 52;
  const untimed = sortItems(items.filter((i) => !i.time), 'importancia');
  const blocks = layoutBlocks(items);
  const now = useNowMinutes();
  const pending = items.filter((i) => !i.done && i.kind === 'task').length;
  const hours: number[] = [];
  for (let h = START_H; h <= END_H; h++) hours.push(h);
  const y = (m: number) => ((Math.min(Math.max(m, START_H * 60), END_H * 60) - START_H * 60) / 60) * HH;
  return (
    <section className="wday-view" aria-label={longDay(date)}>
      <div className="wday-view__head">
        <h2 className="dpanel__title">{longDay(date)}</h2>
        <span className="small muted">{countLabel(items.length)}{items.length ? ` · ${pending} pendientes` : ''}</span>
      </div>
      {items.length === 0 && (
        <div className="wday-view__empty">
          <span className="muted">Día libre, nada planificado.</span>
          <Link to={`/tarea/nueva?fecha=${date}`} className="dpanel__link">Añadir</Link>
        </div>
      )}
      {untimed.length > 0 && (
        <div className="wday-view__untimed">
          <span className="section-label">Sin hora</span>
          {untimed.map((it) => <AgendaRow key={it.key} it={it} subjects={subjects} ctx={ctx} today={today} compact />)}
        </div>
      )}
      <div className="tl" style={{ height: (END_H - START_H) * HH + 12 }}>
        {hours.map((h) => (
          <div key={h} className="tl__hour" style={{ top: (h - START_H) * HH }} aria-hidden="true">
            <span>{String(h).padStart(2, '0')}:00</span><i />
          </div>
        ))}
        {blocks.map((b) => {
          const s = b.it.subjectId ? subjects.get(b.it.subjectId) : undefined;
          const c = s ? SUBJECT_COLORS[s.color] : { bg: '#F0F0F0', fg: '#424242' };
          const top = y(b.start) + 1;
          const h = Math.max(y(b.end) - y(b.start) - 2, 24);
          const tall = h >= 40;
          const range = `${hm(b.start)}–${hm(Math.min(b.end, 24 * 60 - 1))}`;
          return (
            <Link key={b.it.key} to={itemHref(b.it)} className={`tl__block${tall ? '' : ' tl__block--short'}`}
              aria-label={`${b.it.title}, ${range}${s ? `, ${s.name}` : ''}`}
              style={{
                top, height: h, background: c.bg,
                left: `calc(50px + (100% - 50px) * ${b.lane / b.lanes})`, width: `calc((100% - 50px) / ${b.lanes} - 4px)`,
              }}>
              <span className="tl__line">
                {isKey(b.it) && <span className="tl__key">{b.it.kind === 'exam' ? 'EXAMEN' : 'ENTREGA'}</span>}
                <span className={`tl__name${b.it.done ? ' strike' : ''}`}>{b.it.title}</span>
                {b.it.repeating && <Icon name="repeat" size={12} stroke={2} />}
                {!tall && <span className="tl__range">{range}</span>}
              </span>
              {tall && <span className="tl__range">{range}{s && <> · <span style={{ color: c.fg, fontWeight: 600 }}>{s.name}</span></>}</span>}
            </Link>
          );
        })}
        {date === today && now >= START_H * 60 && now <= END_H * 60 && (
          <div className="tl__now" style={{ top: y(now) }} aria-label={`Ahora, ${hm(now)}`} role="img"><span /><i /></div>
        )}
      </div>
      <div className="dpanel__actions">
        <Link to={`/dia/${date}`} className="dpanel__link">Ver día <Icon name="chevron" size={14} stroke={2.2} /></Link>
        <Link to={`/tarea/nueva?fecha=${date}`} className="dpanel__add"><Icon name="plus" size={16} stroke={2.2} />Añadir</Link>
      </div>
    </section>
  );
}

/** Semana en ordenador: 7 columnas × horas. */
function WeekGrid({ week, dia, today, byDate, subjects, onPick }: {
  week: string[]; dia: string; today: string; byDate: Map<string, AgendaItem[]>; subjects: Map<string, Subject>; onPick: (d: string) => void;
}) {
  const HH = 46;
  const now = useNowMinutes();
  const hours: number[] = [];
  for (let h = START_H; h <= END_H; h++) hours.push(h);
  const y = (m: number) => ((Math.min(Math.max(m, START_H * 60), END_H * 60) - START_H * 60) / 60) * HH;
  const gridH = (END_H - START_H) * HH + 8;
  const anyUntimed = week.some((d) => (byDate.get(d) ?? []).some((i) => !i.time));
  return (
    <div className="hscroll">
      <div className="wgrid">
        <div className="wgrid__head">
          <span />
          {week.map((d) => (
            <button key={d} type="button" className="wgrid__day" aria-pressed={d === dia} data-today={d === today || undefined}
              aria-label={`${capitalize(fmt(d, "EEEE d 'de' MMMM"))}, ${countLabel((byDate.get(d) ?? []).length)}`} onClick={() => onPick(d)}>
              <span className="wgrid__dow">{capitalize(fmt(d, 'EEE').replace('.', ''))}</span>
              <span className="wgrid__n">{fmt(d, 'd')}</span>
            </button>
          ))}
        </div>
        {anyUntimed && (
          <div className="wgrid__allday">
            <span className="wgrid__allday-label">Sin hora</span>
            {week.map((d) => (
              <div key={d} className="wgrid__allday-cell">
                {sortItems((byDate.get(d) ?? []).filter((i) => !i.time), 'importancia').map((it) => (
                  <Link key={it.key} to={itemHref(it)} className="wgrid__allday-link"><Pill it={it} subjects={subjects} /></Link>
                ))}
              </div>
            ))}
          </div>
        )}
        <div className="wgrid__body">
          <div className="wgrid__hours" style={{ height: gridH }} aria-hidden="true">
            {hours.map((h) => <span key={h} style={{ top: (h - START_H) * HH }}>{String(h).padStart(2, '0')}:00</span>)}
          </div>
          {week.map((d) => (
            <div key={d} className="wgrid__col" style={{ height: gridH }} data-selected={d === dia || undefined}>
              {hours.map((h) => <i key={h} style={{ top: (h - START_H) * HH }} aria-hidden="true" />)}
              {layoutBlocks(byDate.get(d) ?? []).map((b) => {
                const s = b.it.subjectId ? subjects.get(b.it.subjectId) : undefined;
                const c = s ? SUBJECT_COLORS[s.color] : { bg: '#F0F0F0', fg: '#424242' };
                const top = y(b.start) + 1;
                const h = Math.max(y(b.end) - y(b.start) - 2, 22);
                const range = `${hm(b.start)}–${hm(Math.min(b.end, 24 * 60 - 1))}`;
                return (
                  <Link key={b.it.key} to={itemHref(b.it)} className="wgrid__block" aria-label={`${b.it.title}, ${range}${s ? `, ${s.name}` : ''}`}
                    style={{ top, height: h, background: c.bg, left: `calc(3px + (100% - 6px) * ${b.lane / b.lanes})`, width: `calc((100% - 6px) / ${b.lanes} - 2px)` }}>
                    <span className="wgrid__bname" style={{ color: b.it.done ? undefined : c.fg }}>
                      {isKey(b.it) && <span className="pill__key" aria-hidden="true" />}
                      <span className={b.it.done ? 'strike' : undefined}>{b.it.title}</span>
                    </span>
                    {h >= 36 && <span className="wgrid__brange">{range}</span>}
                  </Link>
                );
              })}
              {d === today && now >= START_H * 60 && now <= END_H * 60 && (
                <div className="tl__now tl__now--grid" style={{ top: y(now) }} aria-label={`Ahora, ${hm(now)}`} role="img"><span /><i /></div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function FilterSheet({ open, onClose, filters, setFilters, subjects, items, today, resultCount, rangeLabel }: {
  open: boolean; onClose: () => void; filters: Filters; setFilters: (f: Filters) => void; subjects: Subject[];
  items: AgendaItem[]; today: string; resultCount: number; rangeLabel: string;
}) {
  const n = activeCount(filters);
  const countWith = (f: Partial<Filters>) => items.filter((i) => matches(i, { ...EMPTY_FILTERS, ...f }, today)).length;
  return (
    <Sheet open={open} onClose={onClose} title="Filtros">
      <p className="small muted cal__sheet-sub">{rangeLabel} · {n ? `${n} ${n === 1 ? 'filtro activo' : 'filtros activos'}` : 'Sin filtros'}</p>
      <div className="stack cal__groups">
        {subjects.length > 0 && (
          <fieldset className="cal__fieldset">
            <legend className="section-label">Asignatura</legend>
            <div className="chips">
              {subjects.map((s) => (
                <Chip key={s.id} pressed={filters.subjects.includes(s.id)} onClick={() => setFilters({ ...filters, subjects: toggleIn(filters.subjects, s.id) })}>
                  <SubjectDot subject={s} size={10} />{s.name}<span className="cal__chipcount">{countWith({ subjects: [s.id] })}</span>
                </Chip>
              ))}
            </div>
          </fieldset>
        )}
        <fieldset className="cal__fieldset">
          <legend className="section-label">Tipo</legend>
          <div className="chips">
            {TYPES.map((t) => (
              <Chip key={t} pressed={filters.types.includes(t)} onClick={() => setFilters({ ...filters, types: toggleIn(filters.types, t) })}>
                {TYPE_LABEL[t]}<span className="cal__chipcount">{countWith({ types: [t] })}</span>
              </Chip>
            ))}
          </div>
        </fieldset>
        <fieldset className="cal__fieldset">
          <legend className="section-label">Estado</legend>
          <div className="chips">
            {STATES.map((st) => (
              <Chip key={st} pressed={filters.states.includes(st)} onClick={() => setFilters({ ...filters, states: toggleIn(filters.states, st) })}>
                {STATE_LABEL[st]}<span className="cal__chipcount">{countWith({ states: [st] })}</span>
              </Chip>
            ))}
          </div>
        </fieldset>
      </div>
      <div className="cal__sheet-actions">
        <button type="button" className="btn" onClick={() => setFilters(EMPTY_FILTERS)} disabled={!n}>Restablecer</button>
        <button type="button" className="btn btn--primary grow" onClick={onClose}>
          {resultCount === 1 ? 'Mostrar 1 resultado' : `Mostrar ${resultCount} resultados`}
        </button>
      </div>
    </Sheet>
  );
}

