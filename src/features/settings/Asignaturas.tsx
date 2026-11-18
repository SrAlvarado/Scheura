import { useEffect, useRef, useState, type Ref } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { useSubjects } from '../../db/hooks';
import type { ColorKey, Subject } from '../../db/types';
import { COLOR_KEYS, SUBJECT_COLORS } from '../../lib/colors';
import { uid } from '../../lib/id';
import { fmt, todayISO } from '../../lib/dates';
import { ConfirmSheet, NavBar, Sheet } from '../../components/ui';
import { Icon } from '../../components/Icon';
import './settings.css';

interface Stats { pending: number; nextExam?: string; refs: number }

/** Recuento por asignatura: tareas pendientes, próximo examen y nº de elementos que la usan. */
function useSubjectStats(): Map<string, Stats> | undefined {
  return useLiveQuery(async () => {
    const [tasks, exams] = await Promise.all([db.tasks.toArray(), db.exams.toArray()]);
    const today = todayISO();
    const m = new Map<string, Stats>();
    const get = (id: string) => {
      let s = m.get(id);
      if (!s) { s = { pending: 0, refs: 0 }; m.set(id, s); }
      return s;
    };
    for (const t of tasks) {
      if (!t.subjectId) continue;
      const s = get(t.subjectId);
      s.refs++;
      if (!t.done && t.type !== 'clase' && !(t.repeat && t.repeat.freq !== 'none')) s.pending++;
    }
    for (const e of exams) {
      if (!e.subjectId) continue;
      const s = get(e.subjectId);
      s.refs++;
      if (e.date >= today && (!s.nextExam || e.date < s.nextExam)) s.nextExam = e.date;
    }
    return m;
  }, []);
}

function metaFor(s?: Stats): string {
  if (!s) return 'Sin tareas';
  const parts: string[] = [];
  parts.push(s.pending ? `${s.pending} ${s.pending === 1 ? 'pendiente' : 'pendientes'}` : 'Nada pendiente');
  if (s.nextExam) parts.push(`examen ${fmt(s.nextExam, 'd MMM').replace('.', '')}`);
  return parts.join(' · ');
}

export default function Asignaturas() {
  const all = useSubjects(true);
  const stats = useSubjectStats();
  const [open, setOpen] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Subject | null>(null);
  const [blocked, setBlocked] = useState<Subject | null>(null);

  const sorted = [...all].sort((a, b) => a.name.localeCompare(b.name, 'es'));
  const active = sorted.filter((s) => !s.archived);
  const archived = sorted.filter((s) => s.archived);

  const addNew = async () => {
    const used = new Set(all.filter((s) => !s.archived).map((s) => s.color));
    const color = COLOR_KEYS.find((c) => !used.has(c)) ?? COLOR_KEYS[all.length % COLOR_KEYS.length];
    const subject: Subject = { id: uid(), name: 'Nueva asignatura', color, createdAt: Date.now() };
    await db.subjects.add(subject);
    setOpen(subject.id);
    setFocusId(subject.id);
  };

  const askDelete = (s: Subject) => {
    if ((stats?.get(s.id)?.refs ?? 0) > 0) setBlocked(s);
    else setConfirmDelete(s);
  };

  const doDelete = async (s: Subject) => {
    await db.transaction('rw', db.subjects, db.attachments, async () => {
      await db.subjects.delete(s.id);
      await db.attachments.where('ownerId').equals(s.id).delete();
    });
    setOpen(null);
  };

  const row = (s: Subject) => (
    <SubjectRow
      key={s.id}
      s={s}
      meta={metaFor(stats?.get(s.id))}
      open={open === s.id}
      autoFocus={focusId === s.id}
      onToggle={() => { setOpen(open === s.id ? null : s.id); setFocusId(null); }}
      onDelete={() => askDelete(s)}
    />
  );

  return (
    <main className="page page--pushed subj-page">
      <NavBar
        back="Ajustes"
        backTo="/ajustes"
        title="Asignaturas"
        right={
          <button type="button" className="iconbtn" style={{ color: 'var(--pink-text)' }} aria-label="Nueva asignatura" onClick={addNew}>
            <Icon name="plus" size={24} stroke={2.2} />
          </button>
        }
      />

      <p className="subj-count">
        {active.length ? `${active.length} ${active.length === 1 ? 'asignatura' : 'asignaturas'}` : 'Aún no hay asignaturas'}
      </p>
      <ul className="subj-list">{active.map(row)}</ul>

      <button type="button" className="subj-head subj-new" onClick={addNew}>
        <span className="subj-swatch subj-swatch--new" aria-hidden="true"><Icon name="plus" size={18} stroke={2.2} /></span>
        <span className="subj-head__name">Nueva asignatura</span>
      </button>

      {archived.length > 0 && (
        <>
          <button type="button" className="subj-archived-toggle" aria-expanded={showArchived} onClick={() => setShowArchived((v) => !v)}>
            <Icon name="chevron" size={14} stroke={2.4} className={showArchived ? 'subj-chev subj-chev--open' : 'subj-chev'} />
            Archivadas ({archived.length})
          </button>
          {showArchived && <ul className="subj-list">{archived.map(row)}</ul>}
        </>
      )}

      <p className="subj-note">El color se usa en chips y puntos del calendario. Archivar oculta la asignatura sin borrar sus tareas.</p>

      <ConfirmSheet
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        title={`¿Eliminar ${confirmDelete?.name ?? 'la asignatura'}?`}
        message="No tiene tareas ni exámenes. Se borrará de este dispositivo."
        confirmLabel="Eliminar asignatura"
        onConfirm={() => confirmDelete && doDelete(confirmDelete)}
      />
      <Sheet open={!!blocked} onClose={() => setBlocked(null)} title="No se puede eliminar">
        <p className="muted small" style={{ marginTop: 0 }}>
          «{blocked?.name}» tiene {stats?.get(blocked?.id ?? '')?.refs ?? 0} tareas o exámenes. Puedes archivarla: dejará de aparecer al crear tareas, pero se conservará todo lo que ya tienes.
        </p>
        <div className="stack">
          {blocked && !blocked.archived && (
            <button className="btn btn--block btn--primary" onClick={async () => { await db.subjects.update(blocked.id, { archived: true }); setOpen(null); setBlocked(null); }}>
              Archivar
            </button>
          )}
          <button className="btn btn--block btn--ghost" onClick={() => setBlocked(null)}>Cerrar</button>
        </div>
      </Sheet>
    </main>
  );
}

function SubjectRow({ s, meta, open, autoFocus, onToggle, onDelete }: {
  s: Subject; meta: string; open: boolean; autoFocus: boolean; onToggle: () => void; onDelete: () => void;
}) {
  const c = SUBJECT_COLORS[s.color];
  const editorId = `subj-ed-${s.id}`;
  return (
    <li className={`subj-item${s.archived ? ' subj-item--archived' : ''}`}>
      <button type="button" className="subj-head" aria-expanded={open} aria-controls={editorId} onClick={onToggle}>
        <span className="subj-swatch" style={{ background: c.bg, color: c.fg }} aria-hidden="true">
          {s.name.trim().charAt(0).toUpperCase() || '?'}
        </span>
        <span className="subj-head__text">
          <span className="subj-head__name">{s.name}</span>
          <span className="subj-head__meta">{meta}</span>
        </span>
        <Icon name="chevron" size={16} stroke={2} className={open ? 'subj-chev subj-chev--open' : 'subj-chev'} />
      </button>
      {open && <SubjectEditor id={editorId} s={s} autoFocus={autoFocus} onDelete={onDelete} />}
    </li>
  );
}

function TextField({ label, optional, value, placeholder, onSave, inputRef }: {
  label: string; optional?: boolean; value: string; placeholder?: string; onSave: (v: string) => void;
  inputRef?: Ref<HTMLInputElement>;
}) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <label className="subj-field">
      <span>{label}{optional && <small> (opcional)</small>}</span>
      <input
        ref={inputRef}
        type="text"
        value={v}
        placeholder={placeholder}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => { if (v.trim() !== value) onSave(v.trim()); }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      />
    </label>
  );
}

function SubjectEditor({ id, s, autoFocus, onDelete }: { id: string; s: Subject; autoFocus: boolean; onDelete: () => void }) {
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autoFocus && nameRef.current) {
      nameRef.current.focus();
      nameRef.current.select();
    }
  }, [autoFocus]);
  const save = (patch: Partial<Subject>) => db.subjects.update(s.id, patch);
  const palId = `${id}-pal`;
  return (
    <div id={id} className="subj-editor">
      <TextField label="Nombre" value={s.name} inputRef={nameRef} onSave={(v) => v && save({ name: v })} />
      <div className="subj-field">
        <span id={palId}>Color</span>
        <div className="subj-palette" role="radiogroup" aria-labelledby={palId}>
          {COLOR_KEYS.map((k: ColorKey) => {
            const col = SUBJECT_COLORS[k];
            return (
              <button key={k} type="button" role="radio" aria-checked={s.color === k} aria-label={col.name} className="subj-color" onClick={() => save({ color: k })}>
                <span style={{ background: col.bg }}><span style={{ background: col.fg }} /></span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="subj-row2">
        <TextField label="Profesor" optional value={s.teacher ?? ''} placeholder="Nombre" onSave={(v) => save({ teacher: v || undefined })} />
        <TextField label="Aula" optional value={s.room ?? ''} placeholder="Ej. 2.3" onSave={(v) => save({ room: v || undefined })} />
      </div>
      <div className="subj-actions">
        <button type="button" className="subj-action" onClick={() => save({ archived: !s.archived })}>
          <Icon name={s.archived ? 'upload' : 'download'} size={18} />
          {s.archived ? 'Restaurar' : 'Archivar'}
        </button>
        <button type="button" className="subj-action subj-action--danger" onClick={onDelete}>
          <Icon name="trash" size={18} />
          Eliminar
        </button>
      </div>
    </div>
  );
}
