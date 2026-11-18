// Nueva tarea / Editar tarea. Rutas: /tarea/nueva?fecha&tipo&padre y /tarea/:id/editar.
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { db, getSettings } from '../../db/db';
import { createTask, deleteTask, updateTask } from '../../db/repo';
import { useSubjects } from '../../db/hooks';
import type { Priority, Reminder, Task, TaskType } from '../../db/types';
import { NavBar, Segmented, Sheet, SubjectDot, Chip } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { TYPES, TYPE_LABEL } from '../../lib/labels';
import { WEEKDAYS, WEEKDAYS_SHORT, addDaysISO, todayISO, weekdayMon0 } from '../../lib/dates';
import { uid } from '../../lib/id';
import { ReminderChips, withId } from './ReminderPicker';
import './tasks.css';

interface StepDraft { key: string; id?: string; title: string; date: string }

const DURATIONS: { value: number; label: string }[] = [
  { value: 15, label: '15 min' },
  { value: 30, label: '30 min' },
  { value: 45, label: '45 min' },
  { value: 60, label: '1 h' },
  { value: 120, label: '2 h' },
];
const isTaskType = (v: string | null): v is TaskType => !!v && (TYPES as string[]).includes(v);

export default function TaskForm() {
  const { id } = useParams();
  const editing = !!id;
  const [params] = useSearchParams();
  const nav = useNavigate();
  const subjects = useSubjects();

  const qFecha = params.get('fecha');
  const qTipo = params.get('tipo');
  const qPadre = params.get('padre');
  const fromFab = !editing && !qFecha && !qTipo && !qPadre;

  const [loaded, setLoaded] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [original, setOriginal] = useState<Task | null>(null);
  const [parentId, setParentId] = useState<string | undefined>(qPadre ?? undefined);
  const [parentTitle, setParentTitle] = useState<string>('');
  const isStep = !!parentId;

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(qFecha && /^\d{4}-\d{2}-\d{2}$/.test(qFecha) ? qFecha : todayISO());
  const [time, setTime] = useState('');
  const [subjectId, setSubjectId] = useState<string | undefined>();
  const [type, setType] = useState<TaskType>(qPadre ? 'entrega' : isTaskType(qTipo) ? qTipo : 'tarea');
  const [priority, setPriority] = useState<Priority>('media');
  const [duration, setDuration] = useState<number | undefined>();
  const [durOther, setDurOther] = useState(false);
  const [weekly, setWeekly] = useState(false);
  const [repDays, setRepDays] = useState<number[]>([]);
  const [until, setUntil] = useState('');
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [remTouched, setRemTouched] = useState(false);
  const [defaults, setDefaults] = useState<Record<TaskType, Reminder[]> | null>(null);
  const [notes, setNotes] = useState('');
  const [steps, setSteps] = useState<StepDraft[]>([]);
  const [subjectOpen, setSubjectOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Carga inicial: ajustes (avisos por defecto), tarea en edición y/o padre.
  useEffect(() => {
    let alive = true;
    (async () => {
      const settings = await getSettings();
      if (!alive) return;
      setDefaults(settings.defaultReminders);
      if (editing && id) {
        const t = await db.tasks.get(id);
        if (!alive) return;
        if (!t) { setNotFound(true); setLoaded(true); return; }
        setOriginal(t);
        setTitle(t.title);
        setDescription(t.description ?? '');
        setDate(t.date ?? todayISO());
        setTime(t.time ?? '');
        setSubjectId(t.subjectId);
        setType(t.type);
        setPriority(t.priority);
        setDuration(t.durationMin);
        setDurOther(!!t.durationMin && !DURATIONS.some((d) => d.value === t.durationMin));
        const rep = t.repeat && t.repeat.freq === 'weekly';
        setWeekly(!!rep);
        setRepDays(rep ? t.repeat!.days : []);
        setUntil(rep ? t.repeat!.until ?? '' : '');
        setReminders(t.reminders ?? []);
        setRemTouched(true);
        setNotes(t.notes ?? '');
        setParentId(t.parentId);
        if (t.parentId) {
          const p = await db.tasks.get(t.parentId);
          if (alive && p) setParentTitle(p.title);
        } else if (t.type === 'entrega') {
          const st = (await db.tasks.where('parentId').equals(t.id).toArray()).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
          if (alive) setSteps(st.map((s) => ({ key: s.id, id: s.id, title: s.title, date: s.date ?? '' })));
        }
      } else {
        const initialType: TaskType = qPadre ? 'entrega' : isTaskType(qTipo) ? qTipo : 'tarea';
        setReminders(settings.defaultReminders[initialType].map(withId));
        if (qPadre) {
          const p = await db.tasks.get(qPadre);
          if (alive && p) {
            setParentTitle(p.title);
            setSubjectId(p.subjectId);
            setPriority(p.priority);
          }
        }
      }
      if (alive) setLoaded(true);
    })();
    return () => { alive = false; };
  }, [editing, id, qPadre, qTipo]);

  const changeType = (t: TaskType) => {
    setType(t);
    if (!remTouched && defaults) setReminders(defaults[t].map(withId));
  };
  const changeReminders = (r: Reminder[]) => { setReminders(r); setRemTouched(true); };

  const toggleWeekly = (on: boolean) => {
    setWeekly(on);
    if (on && repDays.length === 0) setRepDays([weekdayMon0(date)]);
  };
  const toggleDay = (d: number) => setRepDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort()));

  const showSteps = type === 'entrega' && !isStep;
  const showExamHint = type === 'examen' && !editing && !isStep;
  const canSave = title.trim().length > 0 && !saving && loaded && !notFound;

  // ---------- Pasos ----------
  const addStep = () => {
    // Por defecto: el día siguiente al último paso (o hoy), sin pasar de la fecha de entrega.
    const last = steps[steps.length - 1]?.date;
    let next = last ? addDaysISO(last, 1) : todayISO();
    if (date && next > date) next = date;
    setSteps([...steps, { key: uid(), title: '', date: next }]);
  };
  const updateStep = (key: string, patch: Partial<StepDraft>) => setSteps((s) => s.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const removeStep = (key: string) => setSteps((s) => s.filter((x) => x.key !== key));
  const moveStep = (i: number, dir: -1 | 1) => setSteps((s) => {
    const j = i + dir;
    if (j < 0 || j >= s.length) return s;
    const c = [...s];
    [c[i], c[j]] = [c[j], c[i]];
    return c;
  });

  const daysSummary = useMemo(() => {
    if (!repDays.length) return 'Elige al menos un día';
    return 'Cada semana: ' + repDays.map((d) => WEEKDAYS[d].toLowerCase()).join(', ');
  }, [repDays]);

  // ---------- Guardar ----------
  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const repeat = !isStep && weekly && repDays.length ? { freq: 'weekly' as const, days: repDays, ...(until ? { until } : {}) } : undefined;
      const data: Partial<Task> = {
        title: title.trim(),
        description: description.trim() || undefined,
        date: date || undefined,
        time: time || undefined,
        subjectId,
        type,
        priority,
        durationMin: duration || undefined,
        repeat,
        reminders,
        notes: notes.trim() || undefined,
      };
      const validSteps = steps.filter((s) => s.title.trim());
      let savedId: string;

      if (editing && original) {
        savedId = original.id;
        await updateTask(original.id, data);
        if (showSteps) {
          const keepIds = new Set(validSteps.filter((s) => s.id).map((s) => s.id));
          const existing = await db.tasks.where('parentId').equals(original.id).toArray();
          for (const ex of existing) if (!keepIds.has(ex.id)) await deleteTask(ex.id);
          for (const [i, s] of validSteps.entries()) {
            if (s.id) await updateTask(s.id, { title: s.title.trim(), date: s.date || undefined, order: i, subjectId });
            else await createTask({ title: s.title.trim(), date: s.date || undefined, type: 'entrega', parentId: original.id, order: i, subjectId, priority });
          }
        }
      } else if (isStep && parentId) {
        const siblings = await db.tasks.where('parentId').equals(parentId).toArray();
        const order = siblings.reduce((m, s) => Math.max(m, s.order ?? 0), -1) + 1;
        savedId = await createTask({ ...data, title: data.title!, type: 'entrega', parentId, order, repeat: undefined });
      } else {
        savedId = await createTask({ ...data, title: data.title! });
        if (showSteps) {
          for (const [i, s] of validSteps.entries()) {
            await createTask({ title: s.title.trim(), date: s.date || undefined, type: 'entrega', parentId: savedId, order: i, subjectId, priority });
          }
        }
      }

      if (fromFab) {
        const isWork = type === 'entrega' && !isStep;
        nav(isWork ? `/trabajo/${savedId}` : `/tarea/${savedId}`, { replace: true });
      } else if (window.history.length > 1) nav(-1);
      else nav('/', { replace: true });
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => (window.history.length > 1 ? nav(-1) : nav('/'));
  const subject = subjects.find((s) => s.id === subjectId);
  const examQuery = new URLSearchParams();
  if (title.trim()) examQuery.set('titulo', title.trim());
  if (date) examQuery.set('fecha', date);

  const navTitle = editing ? (isStep ? 'Editar paso' : 'Editar tarea') : isStep ? 'Nuevo paso' : 'Nueva tarea';
  const saveBtn = (
    <button type="button" className="navbtn navbtn--bold" onClick={save} disabled={!canSave} aria-disabled={!canSave}>Guardar</button>
  );

  if (notFound) {
    return (
      <main className="page page--pushed tf-page">
        <NavBar back="Atrás" title="Editar tarea" />
        <div className="empty">
          <p>No encontramos esta tarea.</p>
          <Link to="/" className="btn btn--sm">Ir a Hoy</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="page page--pushed tf-page">
      <div className="navbar">
        <div className="navbar__left"><button type="button" className="navbtn" onClick={cancel}>Cancelar</button></div>
        <div className="navbar__title">{navTitle}</div>
        <div className="navbar__right">{saveBtn}</div>
      </div>

      {!loaded ? null : (
        <form onSubmit={(e) => { e.preventDefault(); save(); }}>
          {isStep && parentTitle && <p className="muted small" style={{ margin: '0 0 4px' }}>Paso de «{parentTitle}»</p>}
          <div className="tf-head">
            <label htmlFor="tf-title" className="sr-only">Nombre de la tarea</label>
            <input id="tf-title" className="title-input" placeholder={isStep ? 'Nombre del paso' : 'Nombre de la tarea'} value={title}
              onChange={(e) => setTitle(e.target.value)} autoFocus={!editing} autoComplete="off" />
            <label htmlFor="tf-desc" className="sr-only">Descripción</label>
            <textarea id="tf-desc" className="tf-desc" rows={2} placeholder="Descripción (opcional)" value={description}
              onChange={(e) => setDescription(e.target.value)} />
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
                  <label htmlFor="tf-time" className="cell__label">Hora</label>
                  <input id="tf-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
                  {time ? (
                    <button type="button" className="iconbtn tf-clear" onClick={() => setTime('')} aria-label="Quitar hora">
                      <Icon name="close" size={16} stroke={2.2} />
                    </button>
                  ) : <span className="muted small">Opcional</span>}
                </div>
              </div>

              <div className="group__label">Detalles</div>
              <div className="group">
                <button type="button" className="cell" onClick={() => setSubjectOpen(true)} aria-haspopup="dialog">
                  <span className="cell__label">Asignatura</span>
                  <span className="tf-subject">
                    {subject && <SubjectDot subject={subject} size={10} />}
                    {subject?.name ?? 'Sin asignatura'}
                  </span>
                  <Icon name="chevron" size={16} stroke={2} />
                </button>

                {!isStep && (
                  <div className="cell cell--stack">
                    <span className="cell__label" id="tf-type-label">Tipo</span>
                    <div className="tf-segmented-wrap">
                      <Segmented label="Tipo" value={type} onChange={changeType}
                        options={TYPES.map((t) => ({ value: t, label: TYPE_LABEL[t] }))} />
                    </div>

                    {showExamHint && (
                      <div className="tf-hint">
                        <span className="tf-hint__title">Los exámenes tienen temas y progreso</span>
                        <span className="muted small">Créalo como examen para apuntar los temas que entran, marcar lo estudiado y planificar sesiones.</span>
                        <Link to={`/examen/nuevo?${examQuery.toString()}`} replace className="btn btn--primary btn--sm" style={{ alignSelf: 'flex-start' }}>Crear examen</Link>
                      </div>
                    )}

                    {showSteps && (
                      <div className="tf-hint">
                        <div className="cell__row">
                          <span className="tf-hint__title">Dividir en pasos</span>
                          <span className="muted small">{steps.length} {steps.length === 1 ? 'paso' : 'pasos'}</span>
                        </div>
                        {steps.length > 0 && (
                          <ol className="tf-steps" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                            {steps.map((s, i) => (
                              <li key={s.key} className="tf-step">
                                <span className="tf-step__n" aria-hidden="true">{i + 1}</span>
                                <input className="tf-step__title" value={s.title} placeholder={`Paso ${i + 1}`} aria-label={`Nombre del paso ${i + 1}`}
                                  onChange={(e) => updateStep(s.key, { title: e.target.value })} />
                                <input type="date" className="tf-step__date" value={s.date} aria-label={`Fecha del paso ${i + 1}`}
                                  onChange={(e) => updateStep(s.key, { date: e.target.value })} />
                                <span className="tf-step__btns">
                                  <button type="button" className="iconbtn tf-rot-up" onClick={() => moveStep(i, -1)} disabled={i === 0} aria-label={`Subir paso ${i + 1}`}>
                                    <Icon name="back" size={16} stroke={2.2} />
                                  </button>
                                  <button type="button" className="iconbtn tf-rot-down" onClick={() => moveStep(i, 1)} disabled={i === steps.length - 1} aria-label={`Bajar paso ${i + 1}`}>
                                    <Icon name="back" size={16} stroke={2.2} />
                                  </button>
                                  <button type="button" className="iconbtn" onClick={() => removeStep(s.key)} aria-label={`Quitar paso ${i + 1}`}>
                                    <Icon name="close" size={16} stroke={2.2} />
                                  </button>
                                </span>
                              </li>
                            ))}
                          </ol>
                        )}
                        <button type="button" className="tf-add" onClick={addStep}>+ Añadir paso</button>
                      </div>
                    )}
                  </div>
                )}

                <div className="cell">
                  <span className="cell__label">Prioridad</span>
                  <Segmented label="Prioridad" value={priority} onChange={setPriority}
                    options={[{ value: 'baja', label: 'Baja' }, { value: 'media', label: 'Media' }, { value: 'alta', label: 'Alta' }]} />
                </div>

                <div className="cell cell--stack">
                  <span className="cell__label">Tiempo aprox.</span>
                  <div className="chips" role="group" aria-label="Tiempo aproximado">
                    {DURATIONS.map((d) => (
                      <Chip key={d.value} pressed={!durOther && duration === d.value}
                        onClick={() => { setDurOther(false); setDuration(duration === d.value && !durOther ? undefined : d.value); }}>
                        {d.label}
                      </Chip>
                    ))}
                    <Chip pressed={durOther} onClick={() => setDurOther(!durOther)}>Otro</Chip>
                  </div>
                  {durOther && (
                    <label className="row small">
                      <input type="number" className="tf-number" min={5} max={1440} step={5} inputMode="numeric" value={duration ?? ''}
                        onChange={(e) => setDuration(e.target.value ? Math.max(0, Number(e.target.value)) : undefined)} aria-label="Minutos" />
                      minutos
                    </label>
                  )}
                </div>
              </div>
            </div>

            <div className="tf-col">
              {!isStep && (
                <>
                  <div className="group__label">Repetir</div>
                  <div className="group">
                    <div className="cell">
                      <span className="cell__label">Repetir</span>
                      <Segmented label="Repetir" value={weekly ? 'weekly' : 'none'} onChange={(v) => toggleWeekly(v === 'weekly')}
                        options={[{ value: 'none', label: 'Nunca' }, { value: 'weekly', label: 'Cada semana' }]} />
                    </div>
                    {weekly && (
                      <>
                        <div className="cell cell--stack">
                          <div className="tf-pills" role="group" aria-label="Días de la semana">
                            {WEEKDAYS_SHORT.map((l, i) => (
                              <button key={l} type="button" className="tf-pill" aria-pressed={repDays.includes(i)} aria-label={WEEKDAYS[i]} onClick={() => toggleDay(i)}>{l}</button>
                            ))}
                          </div>
                          <span className="muted small">{daysSummary}</span>
                        </div>
                        <div className="cell">
                          <label htmlFor="tf-until" className="cell__label">Hasta</label>
                          <input id="tf-until" type="date" value={until} min={date} onChange={(e) => setUntil(e.target.value)} />
                          {until ? (
                            <button type="button" className="iconbtn tf-clear" onClick={() => setUntil('')} aria-label="Quitar fecha límite">
                              <Icon name="close" size={16} stroke={2.2} />
                            </button>
                          ) : <span className="muted small">Sin fin</span>}
                        </div>
                      </>
                    )}
                  </div>
                </>
              )}

              <div className="group__label">Recordatorios</div>
              <div className="group">
                <div className="cell cell--stack">
                  <ReminderChips value={reminders} onChange={changeReminders} />
                </div>
              </div>
              <p className="group__foot">{reminders.length ? `${reminders.length} ${reminders.length === 1 ? 'aviso' : 'avisos'}` : 'Sin avisos'}. <Link to="/ajustes/avisos">Avisos por defecto</Link></p>

              <div className="group__label"><label htmlFor="tf-notes">Notas</label></div>
              <div className="group">
                <div className="cell">
                  <textarea id="tf-notes" className="tf-notes" placeholder="Apuntes, enlaces, material…" value={notes} onChange={(e) => setNotes(e.target.value)} />
                </div>
              </div>
            </div>
          </div>

          <button type="submit" className="btn btn--primary btn--block tf-save" disabled={!canSave}>
            {editing ? 'Guardar cambios' : isStep ? 'Guardar paso' : 'Guardar tarea'}
          </button>
        </form>
      )}

      <Sheet open={subjectOpen} onClose={() => setSubjectOpen(false)} title="Asignatura">
        <div className="group">
          <button type="button" className="pick-row" aria-pressed={!subjectId} onClick={() => { setSubjectId(undefined); setSubjectOpen(false); }}>
            <SubjectDot size={10} />
            <span className="grow">Sin asignatura</span>
            {!subjectId && <Icon name="check" size={18} stroke={2.2} />}
          </button>
          {subjects.map((s) => (
            <button key={s.id} type="button" className="pick-row" aria-pressed={s.id === subjectId} onClick={() => { setSubjectId(s.id); setSubjectOpen(false); }}>
              <SubjectDot subject={s} size={10} />
              <span className="grow">{s.name}</span>
              {s.id === subjectId && <Icon name="check" size={18} stroke={2.2} />}
            </button>
          ))}
        </div>
        <Link to="/ajustes/asignaturas" className="btn btn--ghost btn--block" style={{ marginTop: 8 }}>Gestionar asignaturas</Link>
      </Sheet>
    </main>
  );
}
