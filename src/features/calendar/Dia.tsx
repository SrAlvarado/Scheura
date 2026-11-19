import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getISOWeek, isValid, parseISO } from 'date-fns';
import type { AgendaItem, Subject } from '../../db/types';
import { db } from '../../db/db';
import { useAgenda, useSettings, useSubjectMap } from '../../db/hooks';
import { moveTask, setTaskDone } from '../../db/repo';
import { addDaysISO, capitalize, fmtDuration, longDay, relDays, todayISO } from '../../lib/dates';
import { PRIORITY_LABEL, isNotTodo } from '../../lib/labels';
import { pct } from '../../lib/progress';
import { Icon } from '../../components/Icon';
import { Empty, NavBar, Progress, Segmented, Sheet, useToast } from '../../components/ui';
import { type Context, isKey, isLate, isPendingTodo, itemHref, progressLabel, type SortMode, sortItems, typeOrStep, useAgendaContext } from './agenda';
import { EventTag, MiniSubject } from './parts';
import './calendar.css';

export default function Dia() {
  const { date = '' } = useParams();
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date) && isValid(parseISO(date));
  const settings = useSettings();
  const [sortPick, setSortPick] = useState<SortMode | null>(null);
  const sort = sortPick ?? settings.daySort;
  const items = useAgenda(valid ? date : '0000-00-00', valid ? date : '0000-00-00');
  const subjects = useSubjectMap();
  const ctx = useAgendaContext();
  const toast = useToast();
  const [moving, setMoving] = useState<AgendaItem | null>(null);
  const today = todayISO();

  if (!valid) {
    return (
      <main className="page page--pushed">
        <NavBar back="Calendario" />
        <Empty>Esta fecha no es válida. <Link to="/calendario">Ir al calendario</Link></Empty>
      </main>
    );
  }

  const list = sortItems(items ?? [], sort);
  const pending = list.filter(isPendingTodo).length;
  const nExams = list.filter((i) => i.kind === 'exam').length;
  const nWorks = list.filter((i) => i.type === 'entrega' && !i.parentId).length;
  const totalMin = list.reduce((a, i) => a + (i.kind === 'task' && !isNotTodo(i.type) ? i.durationMin ?? 0 : 0), 0);
  const summary = [
    nExams ? `${nExams} ${nExams === 1 ? 'examen' : 'exámenes'}` : '',
    nWorks ? `${nWorks} ${nWorks === 1 ? 'entrega' : 'entregas'}` : '',
    totalMin ? `${fmtDuration(totalMin)} planificado` : '',
  ].filter(Boolean).join(' · ');

  const doMove = async (it: AgendaItem, to: string) => {
    setMoving(null);
    if (!to || to === it.date) return;
    const before = await db.tasks.get(it.id);
    const newId = await moveTask(it.id, to, it.repeating ? it.date : undefined);
    toast.show({
      text: `Movida a ${longDay(to).toLowerCase()}`,
      action: {
        label: 'Deshacer',
        run: async () => {
          if (it.repeating && before) {
            if (newId && newId !== it.id) await db.tasks.delete(newId);
            await db.tasks.update(it.id, { skipDates: before.skipDates ?? [] });
          } else {
            await moveTask(it.id, it.date);
          }
        },
      },
    });
  };

  return (
    <main className="page page--pushed dia">
      <NavBar back="Calendario" backTo={`/calendario?dia=${date}`} title={longDay(date)} right={
        <>
          <Link to={`/dia/${addDaysISO(date, -1)}`} replace className="iconbtn" aria-label="Día anterior" style={{ color: 'var(--pink-text)' }}>
            <Icon name="back" size={20} stroke={2.2} />
          </Link>
          <Link to={`/dia/${addDaysISO(date, 1)}`} replace className="iconbtn" aria-label="Día siguiente" style={{ color: 'var(--pink-text)' }}>
            <Icon name="chevron" size={20} stroke={2.2} />
          </Link>
        </>
      } />

      <header className="dia__head">
        <span className="eyebrow">{capitalize(relDays(date))} · Semana {getISOWeek(parseISO(date))}</span>
        <div className="dia__count">
          <span className="big-number dia__n">{pending}</span>
          <span className="muted">{pending === 1 ? 'cosa pendiente' : 'cosas pendientes'}</span>
        </div>
        {summary && <span className="small muted">{summary}</span>}
      </header>

      <Segmented label="Ordenar por" value={sort === 'hora' ? 'hora' : 'importancia'} onChange={setSortPick}
        options={[{ value: 'hora', label: 'Por hora' }, { value: 'importancia', label: 'Por importancia' }]} />

      <div className="dia__list">
        {items !== undefined && list.length === 0 && (
          <div className="dpanel__empty">
            <strong>Día libre</strong>
            <span className="small muted">No hay nada planificado para este día.</span>
          </div>
        )}
        {list.map((it) => (
          <DiaRow key={it.key} it={it} subjects={subjects} ctx={ctx} today={today} onMove={() => setMoving(it)} />
        ))}
      </div>

      <div className="dia__footer">
        <Link to={`/tarea/nueva?fecha=${date}`} className="btn btn--primary btn--block">
          <Icon name="plus" size={18} stroke={2.2} />Añadir a este día
        </Link>
      </div>

      <MoveSheet item={moving} today={today} onClose={() => setMoving(null)} onMove={doMove} />
      {toast.node}
    </main>
  );
}

function DiaRow({ it, subjects, ctx, today, onMove }: { it: AgendaItem; subjects: Map<string, Subject>; ctx: Context; today: string; onMove: () => void }) {
  const s = it.subjectId ? subjects.get(it.subjectId) : undefined;
  const exam = it.kind === 'exam' ? ctx.exams.get(it.id) : undefined;
  const note = exam?.room ? exam.room : it.type === 'entrega' && !it.parentId ? 'límite' : '';
  const late = isLate(it, today);
  return (
    <div className="drow">
      <div className="drow__time">
        <span className={it.kind === 'exam' ? 'pink' : undefined}>{it.time ?? '—'}</span>
        {note && <span className="drow__note">{note}</span>}
      </div>
      <div className="drow__body">
        <Link to={itemHref(it)} className="drow__title">
          <span className={it.done ? 'strike' : undefined}>{it.title}</span>
          {it.repeating && <span aria-label="Se repite" className="arow__rep"><Icon name="repeat" size={13} stroke={2} /></span>}
          {late && <span className="arow__tag">ATRASADA</span>}
        </Link>
        <div className="drow__meta">
          {it.type === 'evento' ? <EventTag it={it} /> : <MiniSubject subject={s} />}
          {it.type !== 'evento' && <span>{typeOrStep(it, ctx)}</span>}
          {it.location ? <span>{it.location}</span> : null}
          {it.durationMin ? <span>{fmtDuration(it.durationMin)}</span> : null}
          {it.type !== 'evento' && <span className={`drow__pri drow__pri--${it.priority}`}><i aria-hidden="true" />{PRIORITY_LABEL[it.priority]}</span>}
        </div>
        {isKey(it) && (
          <div className="drow__prog">
            <Progress value={it.progress ?? 0} label={`Progreso de ${it.title}`} />
            <span className="xsmall muted"><strong className="pink">{pct(it.progress ?? 0)}</strong> · {progressLabel(it, ctx)}</span>
          </div>
        )}
        {it.kind === 'task' && it.type !== 'evento' && (
          <div className="drow__actions">
            <button type="button" className={`btn btn--sm${it.done ? ' btn--primary' : ''}`} aria-pressed={it.done}
              onClick={() => setTaskDone(it.id, !it.done, it.repeating ? it.date : undefined)}>
              <Icon name="check" size={16} stroke={2.4} />{it.done ? 'Hecha' : 'Completar'}
            </button>
            <button type="button" className="btn btn--sm drow__move" aria-haspopup="dialog" onClick={onMove}>
              <Icon name="move" size={16} stroke={2.2} />Mover
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function MoveSheet({ item, today, onClose, onMove }: { item: AgendaItem | null; today: string; onClose: () => void; onMove: (it: AgendaItem, to: string) => void }) {
  const [custom, setCustom] = useState('');
  if (!item) return null;
  const options = [
    { label: 'Hoy', to: today },
    { label: 'Mañana', to: addDaysISO(today, 1) },
    { label: 'Pasado mañana', to: addDaysISO(today, 2) },
  ].filter((o) => o.to !== item.date);
  return (
    <Sheet open onClose={onClose} title="Mover a">
      <p className="small muted cal__sheet-sub">{item.title}{item.repeating ? ' · solo esta vez' : ''}</p>
      <div className="chips">
        {options.map((o) => (
          <button key={o.label} type="button" className="chip dia__opt" onClick={() => onMove(item, o.to)}>
            {o.label}<span className="cal__chipcount">{longDay(o.to)}</span>
          </button>
        ))}
      </div>
      <div className="dia__custom">
        <span className="section-label">Otra fecha</span>
        <div className="row">
          <input type="date" className="field grow" value={custom} onChange={(e) => setCustom(e.target.value)} aria-label="Otra fecha" />
          <button type="button" className="btn btn--primary" disabled={!custom || custom === item.date} onClick={() => onMove(item, custom)}>Mover</button>
        </div>
      </div>
      <button type="button" className="btn btn--ghost btn--block" onClick={onClose}>Cancelar</button>
    </Sheet>
  );
}
