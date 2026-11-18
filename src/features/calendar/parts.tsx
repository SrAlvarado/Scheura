// Piezas de interfaz compartidas por Hoy, Calendario y Día.
import { Link } from 'react-router-dom';
import type { AgendaItem, Subject } from '../../db/types';
import { SUBJECT_COLORS } from '../../lib/colors';
import { capitalize, fmt, relDays } from '../../lib/dates';
import { pct } from '../../lib/progress';
import { Icon } from '../../components/Icon';
import { Progress } from '../../components/ui';
import { type Context, isKey, isLate, itemHref, itemMeta, keyLabel, minutesOf, progressLabel } from './agenda';
import './calendar.css';

/** Etiqueta pequeña de asignatura (estilo lista del calendario). */
export function MiniSubject({ subject }: { subject?: Subject }) {
  if (!subject) return null;
  const c = SUBJECT_COLORS[subject.color];
  return <span className="mini-subject" style={{ background: c.bg, color: c.fg }}>{subject.name}</span>;
}

/** Fila de lista del calendario: hora · título · asignatura + meta · EXAMEN/ENTREGA/ATRASADA. */
export function AgendaRow({ it, subjects, ctx, today, compact }: { it: AgendaItem; subjects: Map<string, Subject>; ctx: Context; today: string; compact?: boolean }) {
  const s = it.subjectId ? subjects.get(it.subjectId) : undefined;
  const late = isLate(it, today);
  return (
    <Link to={itemHref(it)} className={`arow${compact ? ' arow--compact' : ''}`}>
      <span className="arow__time">{it.time ?? '—'}</span>
      <span className="arow__body">
        <span className="arow__title">
          <span className={it.done ? 'strike' : undefined}>{it.title}</span>
          {it.repeating && <span className="arow__rep" aria-label="Se repite"><Icon name="repeat" size={13} stroke={2} /></span>}
        </span>
        <span className="arow__meta">
          <MiniSubject subject={s} />
          <span>{itemMeta(it, ctx, subjects, false)}</span>
        </span>
      </span>
      {isKey(it) && !it.done ? <span className="arow__tag">{keyLabel(it)}</span> : late ? <span className="arow__tag">ATRASADA</span> : null}
    </Link>
  );
}

/** Fila de "Próximas fechas": día grande + nombre + % + barra + meta. */
export function UpcomingRow({ it, subjects, ctx, big }: { it: AgendaItem; subjects: Map<string, Subject>; ctx: Context; big?: boolean }) {
  const s = it.subjectId ? subjects.get(it.subjectId) : undefined;
  const p = it.progress ?? 0;
  const extra = it.kind === 'exam' ? s?.name ?? 'Examen' : `Entrega · ${progressLabel(it, ctx)}`;
  return (
    <Link to={itemHref(it)} className={`upc${big ? ' upc--big' : ''}`}>
      <span className="upc__date">
        <span className="upc__day">{fmt(it.date, 'd')}</span>
        <span className="upc__mon">{fmt(it.date, 'MMM').replace('.', '')}</span>
      </span>
      <span className="upc__body">
        <span className="upc__top">
          <span className="upc__name">{it.title}</span>
          <span className="upc__pct">{pct(p)}</span>
        </span>
        <Progress value={p} label={`Progreso de ${it.title}`} />
        <span className="upc__meta">{extra} · {relDays(it.date)}</span>
      </span>
    </Link>
  );
}

/** Bloques de una línea de tiempo por horas: calcula carriles para solapes. */
export interface Block { it: AgendaItem; start: number; end: number; lane: number; lanes: number }

export function layoutBlocks(items: AgendaItem[], defaultMin = 30): Block[] {
  const timed = items
    .filter((i) => i.time)
    .map((it) => {
      const start = minutesOf(it.time!);
      return { it, start, end: start + Math.max(it.durationMin || defaultMin, 25), lane: 0, lanes: 1 };
    })
    .sort((a, b) => a.start - b.start);
  let cluster: Block[] = [];
  let clusterEnd = -1;
  const flush = () => {
    const n = Math.max(1, ...cluster.map((b) => b.lane + 1));
    cluster.forEach((b) => (b.lanes = n));
    cluster = [];
  };
  for (const b of timed) {
    if (b.start >= clusterEnd) flush();
    const used = new Set(cluster.filter((c) => c.end > b.start).map((c) => c.lane));
    let lane = 0;
    while (used.has(lane)) lane++;
    b.lane = lane;
    cluster.push(b);
    clusterEnd = Math.max(clusterEnd, b.end);
  }
  flush();
  return timed;
}

export const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** Botón de día para tiras de semana. */
export function DayButton({ date, today, selected, dots, onClick, label }: { date: string; today: string; selected: boolean; dots: string[]; onClick: () => void; label: string }) {
  return (
    <button type="button" className="wday" aria-pressed={selected} aria-label={label} data-today={date === today || undefined} onClick={onClick}>
      <span className="wday__dow">{capitalize(fmt(date, 'EEE').replace('.', ''))}</span>
      <span className="wday__num">{fmt(date, 'd')}</span>
      <span className="dots">{dots.map((c, i) => <span key={i} style={{ background: c }} />)}</span>
    </button>
  );
}
