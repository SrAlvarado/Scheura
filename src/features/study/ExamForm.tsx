import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { Chip, Segmented, SubjectDot, Switch, useToast } from '../../components/ui';
import { db, getSettings } from '../../db/db';
import { useSubjects } from '../../db/hooks';
import { autoPlanExam, createExam, updateExam } from '../../db/repo';
import type { Extracted, Reminder, Topic } from '../../db/types';
import { addDaysISO, longDay, todayISO } from '../../lib/dates';
import { reminderLabel } from '../../lib/labels';
import { uid } from '../../lib/id';
import { extractFromPdf } from '../../lib/pdf';
import { REMINDER_PRESETS, reminderKey, withId } from './ReminderList';
import { useExamOrNull } from './common';
import './study.css';

interface PendingFile { file: File; pages?: number; extracted?: Extracted }
interface Detected { name: string; on: boolean }

const DAYS_OPTIONS = Array.from({ length: 12 }, (_, i) => i + 3); // 3..14

export default function ExamForm() {
  const { id } = useParams();
  const editing = !!id;
  const [params] = useSearchParams();
  const nav = useNavigate();
  const subjects = useSubjects();
  const exam = useExamOrNull(id);
  const toast = useToast();

  const [ready, setReady] = useState(false);
  const [subjectId, setSubjectId] = useState<string | undefined>();
  const [title, setTitle] = useState(params.get('titulo') ?? '');
  const [date, setDate] = useState(params.get('fecha') ?? '');
  const [time, setTime] = useState('');
  const [room, setRoom] = useState('');
  const [topics, setTopics] = useState<Topic[]>([]);
  const [newTopic, setNewTopic] = useState('');
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [plan, setPlan] = useState(!editing);
  const [daysBefore, setDaysBefore] = useState(6);
  const [planTime, setPlanTime] = useState('18:30');
  const [minutes, setMinutes] = useState<'30' | '60' | '90'>('60');
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [importing, setImporting] = useState<{ file: PendingFile; detected: Detected[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // Carga inicial: examen existente o valores por defecto.
  useEffect(() => {
    if (ready) return;
    if (editing) {
      if (!exam) return;
      setSubjectId(exam.subjectId);
      setTitle(exam.title);
      setDate(exam.date);
      setTime(exam.time ?? '');
      setRoom(exam.room ?? '');
      setTopics(exam.topics);
      setReminders(exam.reminders);
      setReady(true);
    } else {
      getSettings().then((s) => {
        setReminders(s.defaultReminders.examen.map(withId));
        setReady(true);
      });
    }
  }, [editing, exam, ready]);

  if (editing && exam === null) {
    return (
      <main className="page page--pushed">
        <div className="navbar"><div className="navbar__left"><button className="navbtn" onClick={() => nav('/estudio')}>Cancelar</button></div><div className="navbar__title" /><div /></div>
        <div className="empty">Este examen ya no existe.</div>
      </main>
    );
  }

  const canSave = !!title.trim() && !!date && !saving;

  // ---- Temas ----
  const addTopic = () => {
    const name = newTopic.trim();
    if (!name) return;
    setTopics((t) => [...t, { id: uid(), name, status: 'pendiente' }]);
    setNewTopic('');
  };
  const renameTopic = (tid: string, name: string) => setTopics((t) => t.map((x) => (x.id === tid ? { ...x, name } : x)));
  const removeTopic = (tid: string) => setTopics((t) => t.filter((x) => x.id !== tid));
  const moveTopic = (i: number, d: -1 | 1) =>
    setTopics((t) => {
      const j = i + d;
      if (j < 0 || j >= t.length) return t;
      const next = [...t];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  // ---- PDF ----
  const onPdf = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    try {
      const res = await extractFromPdf(file);
      const existing = new Set(topics.map((t) => t.name.trim().toLowerCase()));
      const detected = [...new Set(res.extracted.topics.map((s) => s.trim()).filter(Boolean))]
        .filter((n) => !existing.has(n.toLowerCase()))
        .map((name) => ({ name, on: true }));
      setImporting({ file: { file, pages: res.pages || undefined, extracted: res.extracted }, detected });
    } catch {
      setImporting({ file: { file }, detected: [] });
      toast.show({ text: 'No hemos podido leer este PDF' });
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };
  const acceptImport = () => {
    if (!importing) return;
    const chosen = importing.detected.filter((d) => d.on);
    setTopics((t) => [...t, ...chosen.map((d) => ({ id: uid(), name: d.name, status: 'pendiente' as const }))]);
    setFiles((f) => [...f, importing.file]);
    setImporting(null);
  };
  const chosenCount = importing?.detected.filter((d) => d.on).length ?? 0;

  // ---- Recordatorios ----
  const selectedKeys = new Set(reminders.map(reminderKey));
  const extra = reminders.filter((r) => !REMINDER_PRESETS.some((p) => reminderKey(p) === reminderKey(r)));
  const toggleReminder = (key: string) => {
    if (selectedKeys.has(key)) setReminders((r) => r.filter((x) => reminderKey(x) !== key));
    else {
      const p = REMINDER_PRESETS.find((x) => reminderKey(x) === key);
      if (p) setReminders((r) => [...r, withId(p)]);
    }
  };

  // ---- Guardar ----
  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const cleanTopics = topics.map((t) => ({ ...t, name: t.name.trim() })).filter((t) => t.name);
      const data = {
        title: title.trim(),
        date,
        time: time || undefined,
        room: room.trim() || undefined,
        subjectId,
        topics: cleanTopics,
        reminders,
      };
      let examId = id;
      if (examId) await updateExam(examId, data);
      else examId = await createExam(data);
      for (const f of files) {
        await db.attachments.add({
          id: uid(),
          ownerType: 'exam',
          ownerId: examId,
          name: f.file.name,
          mime: f.file.type || 'application/pdf',
          size: f.file.size,
          pages: f.pages,
          blob: f.file,
          extracted: f.extracted,
          addedAt: Date.now(),
        });
      }
      if (plan) await autoPlanExam(examId, { daysBefore, time: planTime, minutes: Number(minutes) });
      nav(`/examen/${examId}`, { replace: true });
    } catch {
      setSaving(false);
      toast.show({ text: 'No se ha podido guardar' });
    }
  };

  const startDay = date ? addDaysISO(date, -daysBefore) : undefined;
  const startsInPast = startDay ? startDay < todayISO() : false;

  return (
    <main className="page page--pushed">
      <div className="navbar">
        <div className="navbar__left">
          <button type="button" className="navbtn" onClick={() => (window.history.length > 1 ? nav(-1) : nav('/estudio'))}>Cancelar</button>
        </div>
        <div className="navbar__title">{editing ? 'Editar examen' : 'Nuevo examen'}</div>
        <div className="navbar__right">
          <button type="button" className="navbtn navbtn--bold" aria-disabled={!canSave} onClick={save}>Guardar</button>
        </div>
      </div>

      {!ready ? null : (
        <form onSubmit={(e) => { e.preventDefault(); save(); }}>
          <div className="st-form-label">
            <span id="asig-lbl">Asignatura</span>
            <Link to="/ajustes/asignaturas">Gestionar</Link>
          </div>
          {subjects.length === 0 ? (
            <p className="muted small" style={{ margin: 0 }}>Aún no tienes asignaturas. <Link to="/ajustes/asignaturas">Crear una</Link></p>
          ) : (
            <div className="chips" role="group" aria-labelledby="asig-lbl">
              {subjects.map((s) => (
                <Chip key={s.id} pressed={subjectId === s.id} onClick={() => setSubjectId(subjectId === s.id ? undefined : s.id)}>
                  <SubjectDot subject={s} />{s.name}
                </Chip>
              ))}
            </div>
          )}

          <div className="group" style={{ marginTop: 20 }}>
            <label className="cell">
              <span className="cell__label">Nombre</span>
              <input className="st-cell-input" type="text" value={title} placeholder="Examen parcial" onChange={(e) => setTitle(e.target.value)} required />
            </label>
            <label className="cell">
              <span className="cell__label">Fecha</span>
              <input className="st-cell-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </label>
            <label className="cell">
              <span className="cell__label">Hora</span>
              <input className="st-cell-input" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </label>
            <label className="cell">
              <span className="cell__label">Aula</span>
              <input className="st-cell-input" type="text" value={room} placeholder="Opcional" onChange={(e) => setRoom(e.target.value)} />
            </label>
          </div>

          <section className="st-section">
            <div className="st-sechead">
              <h2>Temas que entran</h2>
              <span className="st-sechead__aside">{topics.length ? `${topics.length} ${topics.length === 1 ? 'tema' : 'temas'}` : ''}</span>
            </div>

            {!importing && (
              <label className="st-import">
                <Icon name={busy ? 'clock' : 'upload'} size={22} />
                <span className="grow">
                  <span className="st-import__title">{busy ? 'Leyendo PDF…' : 'Importar temas desde PDF'}</span>
                  <span className="st-import__sub">Detectamos los temas de tus apuntes o del índice</span>
                </span>
                <input ref={fileInput} type="file" accept="application/pdf" className="sr-only" disabled={busy}
                  onChange={(e) => onPdf(e.target.files?.[0])} />
              </label>
            )}

            {importing && (
              <div className="st-extracted">
                <span className="st-eyebrow">EXTRAÍDO DEL PDF</span>
                {importing.detected.length > 0 ? (
                  <>
                    <span style={{ fontWeight: 700 }}>
                      {importing.detected.length} {importing.detected.length === 1 ? 'tema detectado' : 'temas detectados'} en {importing.file.file.name}
                    </span>
                    <span className="muted small">Elige cuáles añadir. El PDF se guardará en Material.</span>
                    {importing.detected.map((d, i) => (
                      <label key={i} className="st-check-row">
                        <input type="checkbox" checked={d.on}
                          onChange={() => setImporting({ ...importing, detected: importing.detected.map((x, j) => (j === i ? { ...x, on: !x.on } : x)) })} />
                        <span>{d.name}</span>
                      </label>
                    ))}
                    <div className="row" style={{ marginTop: 6, flexWrap: 'wrap' }}>
                      <button type="button" className="btn btn--primary btn--sm" disabled={!chosenCount} onClick={acceptImport}>
                        Añadir {chosenCount} {chosenCount === 1 ? 'tema' : 'temas'}
                      </button>
                      <button type="button" className="btn btn--ghost btn--sm" onClick={() => setImporting(null)}>Cancelar</button>
                    </div>
                  </>
                ) : (
                  <>
                    <span className="small">No hemos encontrado temas nuevos en {importing.file.file.name}.</span>
                    <div className="row" style={{ marginTop: 6, flexWrap: 'wrap' }}>
                      <button type="button" className="btn btn--sm" onClick={acceptImport}>Guardar en Material</button>
                      <button type="button" className="btn btn--ghost btn--sm" onClick={() => setImporting(null)}>Descartar</button>
                    </div>
                  </>
                )}
              </div>
            )}

            {files.map((f, i) => (
              <div key={i} className="st-pending-file">
                <Icon name="file" size={18} />
                <span className="grow">{f.file.name} · se guardará en Material</span>
                <button type="button" className="iconbtn" aria-label={`No guardar ${f.file.name}`}
                  onClick={() => setFiles((x) => x.filter((_, j) => j !== i))}>
                  <Icon name="close" size={16} stroke={2} />
                </button>
              </div>
            ))}

            {topics.map((t, i) => (
              <div key={t.id} className="st-trow">
                <span className="st-topic__n">{i + 1}</span>
                <input type="text" value={t.name} aria-label={`Tema ${i + 1}`} onChange={(e) => renameTopic(t.id, e.target.value)} />
                <button type="button" className="iconbtn" aria-label={`Subir ${t.name || 'tema'}`} disabled={i === 0} onClick={() => moveTopic(i, -1)}>
                  <Icon name="chevron" size={16} stroke={2} className="st-rot-up" />
                </button>
                <button type="button" className="iconbtn" aria-label={`Bajar ${t.name || 'tema'}`} disabled={i === topics.length - 1} onClick={() => moveTopic(i, 1)}>
                  <Icon name="chevron" size={16} stroke={2} className="st-rot-down" />
                </button>
                <button type="button" className="iconbtn" aria-label={`Quitar ${t.name || 'tema'}`} onClick={() => removeTopic(t.id)}>
                  <Icon name="close" size={16} stroke={2} />
                </button>
              </div>
            ))}

            <div className="st-newtopic">
              <label htmlFor="nuevo-tema" className="sr-only">Nuevo tema</label>
              <input id="nuevo-tema" className="field" type="text" placeholder="Añadir tema…" value={newTopic}
                onChange={(e) => setNewTopic(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTopic(); } }} />
              <button type="button" className="iconbtn" aria-label="Añadir tema" disabled={!newTopic.trim()} onClick={addTopic}>
                <Icon name="plus" size={22} stroke={2} />
              </button>
            </div>
          </section>

          <div className="st-planbox">
            <div className="cell">
              <span className="cell__label">
                <span id="plan-lbl" style={{ display: 'block', fontWeight: 600 }}>
                  {editing ? 'Replanificar sesiones automáticamente' : 'Planificar sesiones automáticamente'}
                </span>
                <span className="muted xsmall">
                  {plan && startDay
                    ? `Una sesión al día desde ${longDay(startsInPast ? todayISO() : startDay)}`
                    : 'Reparte los temas pendientes en los días previos'}
                </span>
              </span>
              <Switch checked={plan} onChange={setPlan} label={editing ? 'Replanificar sesiones automáticamente' : 'Planificar sesiones automáticamente'} />
            </div>
            {plan && (
              <>
                <label className="cell">
                  <span className="cell__label">Empezar</span>
                  <select value={daysBefore} onChange={(e) => setDaysBefore(Number(e.target.value))}>
                    {DAYS_OPTIONS.map((n) => <option key={n} value={n}>{n} días antes</option>)}
                  </select>
                </label>
                <label className="cell">
                  <span className="cell__label">Hora</span>
                  <input type="time" value={planTime} onChange={(e) => setPlanTime(e.target.value || '18:30')} />
                </label>
                <div className="cell">
                  <span className="cell__label">Duración</span>
                  <div style={{ width: 180 }}>
                    <Segmented<'30' | '60' | '90'> label="Duración de sesión" value={minutes} onChange={setMinutes}
                      options={[{ value: '30', label: '30 min' }, { value: '60', label: '1 h' }, { value: '90', label: '1 h 30' }]} />
                  </div>
                </div>
                {editing && <p className="muted xsmall" style={{ margin: '0 0 10px' }}>Las sesiones pendientes se sustituirán; las hechas se mantienen.</p>}
              </>
            )}
          </div>

          <section className="st-section">
            <div className="st-sechead"><h2 id="rec-lbl">Recordatorios</h2></div>
            <div className="chips" role="group" aria-labelledby="rec-lbl">
              {REMINDER_PRESETS.map((p) => {
                const key = reminderKey(p);
                const on = selectedKeys.has(key);
                return (
                  <Chip key={key} pressed={on} onClick={() => toggleReminder(key)}>
                    {on && <Icon name="check" size={14} stroke={2.6} />}{reminderLabel(withId(p))}
                  </Chip>
                );
              })}
              {extra.map((r) => (
                <Chip key={r.id} pressed onClick={() => setReminders((x) => x.filter((y) => y.id !== r.id))}>
                  <Icon name="check" size={14} stroke={2.6} />{reminderLabel(r)}
                </Chip>
              ))}
            </div>
          </section>

          <button type="submit" className="btn btn--primary btn--block" style={{ marginTop: 32 }} disabled={!canSave}>
            {editing ? 'Guardar cambios' : 'Crear examen'}
          </button>
        </form>
      )}
      {toast.node}
    </main>
  );
}
