// Nuevo evento / Editar evento (cumpleaños, citas, médico…). Rutas: /evento/nuevo?fecha&titulo y /evento/:id/editar.
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { db, getSettings } from '../../db/db';
import { createTask, updateTask } from '../../db/repo';
import type { EventCategory, Reminder, Repeat, Task } from '../../db/types';
import { NavBar, Switch } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { NewKindSwitch } from '../../components/NewKind';
import { SUBJECT_COLORS } from '../../lib/colors';
import { WEEKDAYS, WEEKDAYS_SHORT, fmt, todayISO, weekdayMon0 } from '../../lib/dates';
import { uid } from '../../lib/id';
import { EVENT_CATEGORIES, minutesBetween } from '../../lib/events';
import { ReminderChips, withId } from '../tasks/ReminderPicker';
import '../tasks/tasks.css';
import './events.css';

type Freq = Repeat['freq'];

/** Avisos iniciales por categoría (si el usuario no los ha tocado). */
function initialReminders(cat: EventCategory, defaults: Reminder[]): Reminder[] {
  if (cat === 'cumple') {
    return [
      { id: uid(), kind: 'dayAt', days: 1, time: '20:00' },
      { id: uid(), kind: 'dayAt', days: 0, time: '08:00' },
    ];
  }
  return defaults.map(withId);
}

export default function EventForm() {
  const { id } = useParams();
  const editing = !!id;
  const [params] = useSearchParams();
  const nav = useNavigate();
  const qFecha = params.get('fecha');

  const [loaded, setLoaded] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [original, setOriginal] = useState<Task | null>(null);

  const [title, setTitle] = useState(params.get('titulo') ?? '');
  const [category, setCategory] = useState<EventCategory>('cita');
  const [date, setDate] = useState(qFecha && /^\d{4}-\d{2}-\d{2}$/.test(qFecha) ? qFecha : todayISO());
  const [allDay, setAllDay] = useState(false);
  const [time, setTime] = useState('18:00');
  const [endTime, setEndTime] = useState('19:00');
  const [location, setLocation] = useState('');
  const [freq, setFreq] = useState<Freq>('none');
  const [repDays, setRepDays] = useState<number[]>([]);
  const [until, setUntil] = useState('');
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [remTouched, setRemTouched] = useState(false);
  const [freqTouched, setFreqTouched] = useState(false);
  const [defaults, setDefaults] = useState<Reminder[]>([]);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const settings = await getSettings();
      if (!alive) return;
      const defs = settings.defaultReminders.evento ?? [];
      setDefaults(defs);
      if (editing && id) {
        const t = await db.tasks.get(id);
        if (!alive) return;
        if (!t) { setNotFound(true); setLoaded(true); return; }
        setOriginal(t);
        setTitle(t.title);
        setCategory(t.category ?? 'otro');
        setDate(t.date ?? todayISO());
        setAllDay(!t.time);
        setTime(t.time ?? '18:00');
        setEndTime(t.endTime ?? '');
        setLocation(t.location ?? '');
        setFreq(t.repeat?.freq ?? 'none');
        setRepDays(t.repeat?.freq === 'weekly' ? t.repeat.days : []);
        setUntil(t.repeat?.until ?? '');
        setReminders(t.reminders ?? []);
        setRemTouched(true);
        setFreqTouched(true);
        setNotes(t.notes ?? t.description ?? '');
      } else {
        setReminders(initialReminders('cita', defs));
      }
      setLoaded(true);
    })();
    return () => { alive = false; };
  }, [editing, id]);

  const pickCategory = (c: EventCategory) => {
    setCategory(c);
    if (!editing) {
      // Un cumpleaños suele ser todo el día y repetirse cada año.
      if (c === 'cumple') { setAllDay(true); if (!freqTouched) setFreq('yearly'); }
      else if (!freqTouched && freq === 'yearly') setFreq('none');
      if (!remTouched) setReminders(initialReminders(c, defaults));
    }
  };

  const changeFreq = (f: Freq) => {
    setFreq(f);
    setFreqTouched(true);
    if (f === 'weekly' && !repDays.length) setRepDays([weekdayMon0(date)]);
  };
  const toggleDay = (d: number) => setRepDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort()));

  const freqHint = useMemo(() => {
    if (!date) return '';
    if (freq === 'yearly') return `Cada ${fmt(date, "d 'de' MMMM")}`;
    if (freq === 'monthly') return `El día ${Number(date.slice(8, 10))} de cada mes`;
    if (freq === 'weekly') return repDays.length ? 'Cada semana: ' + repDays.map((d) => WEEKDAYS[d].toLowerCase()).join(', ') : 'Elige al menos un día';
    return '';
  }, [freq, date, repDays]);

  const canSave = title.trim().length > 0 && !!date && !saving && loaded && !notFound && !(freq === 'weekly' && !repDays.length);

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const t = allDay ? undefined : time || undefined;
      const end = t && endTime ? endTime : undefined;
      const repeat: Repeat | undefined = freq === 'none' ? undefined : {
        freq, days: freq === 'weekly' ? repDays : [], ...(until ? { until } : {}),
      };
      const data: Partial<Task> = {
        title: title.trim(),
        type: 'evento',
        category,
        date,
        time: t,
        endTime: end,
        durationMin: t && end ? minutesBetween(t, end) : undefined,
        location: location.trim() || undefined,
        repeat,
        reminders,
        notes: notes.trim() || undefined,
        priority: 'media',
        subjectId: undefined,
      };
      let savedId: string;
      if (editing && original) {
        savedId = original.id;
        await updateTask(original.id, data);
      } else {
        savedId = await createTask({ ...data, title: data.title! });
      }
      if (editing && window.history.length > 1) nav(-1);
      else nav(`/evento/${savedId}`, { replace: true });
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => (window.history.length > 1 ? nav(-1) : nav('/'));

  if (notFound) {
    return (
      <main className="page page--pushed tf-page">
        <NavBar back="Atrás" title="Editar evento" />
        <div className="empty">
          <p>No encontramos este evento.</p>
          <Link to="/" className="btn btn--sm">Ir a Hoy</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="page page--pushed tf-page">
      <div className="navbar">
        <div className="navbar__left"><button type="button" className="navbtn" onClick={cancel}>Cancelar</button></div>
        <div className="navbar__title">{editing ? 'Editar evento' : 'Nuevo evento'}</div>
        <div className="navbar__right">
          <button type="button" className="navbtn navbtn--bold" onClick={save} disabled={!canSave} aria-disabled={!canSave}>Guardar</button>
        </div>
      </div>

      {!loaded ? null : (
        <form onSubmit={(e) => { e.preventDefault(); save(); }}>
          {!editing && <NewKindSwitch current="evento" date={date} title={title} />}

          <div className="tf-head">
            <label htmlFor="ev-title" className="sr-only">Nombre del evento</label>
            <input id="ev-title" className="title-input" value={title} onChange={(e) => setTitle(e.target.value)} autoComplete="off"
              autoFocus={!editing} placeholder={category === 'cumple' ? 'Cumple de…' : 'Nombre del evento'} />
          </div>

          <div className="ev-cats" role="group" aria-label="Categoría">
            {EVENT_CATEGORIES.map((c) => {
              const col = SUBJECT_COLORS[c.color];
              const on = c.key === category;
              return (
                <button key={c.key} type="button" className="ev-cat" aria-pressed={on} onClick={() => pickCategory(c.key)}
                  style={on ? { background: col.bg, borderColor: col.dot, color: col.fg } : undefined}>
                  <span aria-hidden="true">{c.emoji}</span>{c.label}
                </button>
              );
            })}
          </div>

          <div className="cols tf-cols">
            <div className="tf-col">
              <div className="group__label">Cuándo</div>
              <div className="group">
                <label className="cell">
                  <span className="cell__label">Fecha</span>
                  <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
                </label>
                <div className="cell">
                  <span className="cell__label">Todo el día</span>
                  <Switch label="Todo el día" checked={allDay} onChange={setAllDay} />
                </div>
                {!allDay && (
                  <>
                    <label className="cell">
                      <span className="cell__label">Empieza</span>
                      <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
                    </label>
                    <div className="cell">
                      <label htmlFor="ev-end" className="cell__label">Termina</label>
                      <input id="ev-end" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
                      {endTime ? (
                        <button type="button" className="iconbtn tf-clear" onClick={() => setEndTime('')} aria-label="Quitar hora de fin">
                          <Icon name="close" size={16} stroke={2.2} />
                        </button>
                      ) : <span className="muted small">Opcional</span>}
                    </div>
                  </>
                )}
              </div>

              <div className="group__label"><label htmlFor="ev-loc">Dónde</label></div>
              <div className="group">
                <div className="cell">
                  <input id="ev-loc" className="ev-input" value={location} onChange={(e) => setLocation(e.target.value)}
                    placeholder="Lugar o dirección (opcional)" autoComplete="off" />
                </div>
              </div>

              <div className="group__label">Repetir</div>
              <div className="group">
                <label className="cell">
                  <span className="cell__label">Repetir</span>
                  <select value={freq} onChange={(e) => changeFreq(e.target.value as Freq)} aria-label="Repetir">
                    <option value="none">Nunca</option>
                    <option value="weekly">Cada semana</option>
                    <option value="monthly">Cada mes</option>
                    <option value="yearly">Cada año</option>
                  </select>
                </label>
                {freq === 'weekly' && (
                  <div className="cell cell--stack">
                    <div className="tf-pills" role="group" aria-label="Días de la semana">
                      {WEEKDAYS_SHORT.map((l, i) => (
                        <button key={l} type="button" className="tf-pill" aria-pressed={repDays.includes(i)} aria-label={WEEKDAYS[i]} onClick={() => toggleDay(i)}>{l}</button>
                      ))}
                    </div>
                  </div>
                )}
                {freq !== 'none' && (
                  <div className="cell">
                    <label htmlFor="ev-until" className="cell__label">Hasta</label>
                    <input id="ev-until" type="date" value={until} min={date} onChange={(e) => setUntil(e.target.value)} />
                    {until ? (
                      <button type="button" className="iconbtn tf-clear" onClick={() => setUntil('')} aria-label="Quitar fecha límite">
                        <Icon name="close" size={16} stroke={2.2} />
                      </button>
                    ) : <span className="muted small">Sin fin</span>}
                  </div>
                )}
              </div>
              {freqHint && <p className="group__foot">{freqHint}</p>}
            </div>

            <div className="tf-col">
              <div className="group__label">Recordatorios</div>
              <div className="group">
                <div className="cell cell--stack">
                  <ReminderChips value={reminders} onChange={(r) => { setReminders(r); setRemTouched(true); }}
                    date={date || undefined} time={allDay ? undefined : time || undefined} />
                </div>
              </div>
              <p className="group__foot">{reminders.length ? `${reminders.length} ${reminders.length === 1 ? 'aviso' : 'avisos'}` : 'Sin avisos'}</p>

              <div className="group__label"><label htmlFor="ev-notes">Notas</label></div>
              <div className="group">
                <div className="cell">
                  <textarea id="ev-notes" className="tf-notes" value={notes} onChange={(e) => setNotes(e.target.value)}
                    placeholder={category === 'cumple' ? 'Ideas de regalo, qué le gusta…' : 'Qué llevar, con quién, enlaces…'} />
                </div>
              </div>
            </div>
          </div>

          <button type="submit" className="btn btn--primary btn--block tf-save" disabled={!canSave}>
            {editing ? 'Guardar cambios' : 'Guardar evento'}
          </button>
        </form>
      )}
    </main>
  );
}
