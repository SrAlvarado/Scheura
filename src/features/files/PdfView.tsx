import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { useAttachment, useExam, useSubjectMap, useTask } from '../../db/hooks';
import { createTask, updateExam } from '../../db/repo';
import type { Attachment, Exam, Extracted } from '../../db/types';
import { uid } from '../../lib/id';
import { fmt, toISO } from '../../lib/dates';
import { ConfirmSheet, Empty, NavBar, Segmented } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { PdfPages } from './PdfPages';
import { downloadBlob, fileBadge, fileMeta, isImage, isPdf } from './fileUtils';
import './files.css';

function useMediaQuery(q: string) {
  const [match, setMatch] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setMatch(m.matches);
    on();
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [q]);
  return match;
}

export default function PdfView() {
  const { id } = useParams();
  const att = useAttachment(id);
  const nav = useNavigate();
  const [tab, setTab] = useState<'ext' | 'doc'>('ext');
  const [confirm, setConfirm] = useState(false);
  const wide = useMediaQuery('(min-width: 900px)');

  const exam = useExam(att?.ownerType === 'exam' ? att.ownerId : undefined);
  const task = useTask(att?.ownerType === 'task' ? att.ownerId : undefined);
  const subjects = useSubjectMap();

  if (att === undefined) {
    // Cargando, o no existe (useLiveQuery devuelve undefined en ambos casos al principio)
    return (
      <main className="page page--pushed">
        <NavBar back="Atrás" />
      </main>
    );
  }

  const pdf = isPdf(att);
  const ownerSubjectId =
    att.ownerType === 'exam' ? exam?.subjectId : att.ownerType === 'task' ? task?.subjectId : att.ownerId;
  const subject = ownerSubjectId ? subjects.get(ownerSubjectId) : undefined;

  let owner: { to: string; label: string } | null = null;
  if (att.ownerType === 'exam' && exam) owner = { to: `/examen/${exam.id}`, label: [subject?.name, exam.title].filter(Boolean).join(' · ') };
  else if (att.ownerType === 'task' && task)
    owner = { to: task.type === 'entrega' && !task.parentId ? `/trabajo/${task.id}` : `/tarea/${task.id}`, label: [subject?.name, task.title].filter(Boolean).join(' · ') };
  else if (att.ownerType === 'subject' && subject) owner = { to: '/ajustes/asignaturas', label: subject.name };

  const share = async () => {
    const file = new File([att.blob], att.name, { type: att.mime });
    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: att.name });
        return;
      }
    } catch (e) {
      if ((e as { name?: string })?.name === 'AbortError') return;
    }
    downloadBlob(att.blob, att.name);
  };

  const remove = async () => {
    await db.attachments.delete(att.id);
    if (window.history.length > 1) nav(-1);
    else nav(owner?.to ?? '/', { replace: true });
  };

  const extracted = pdf && att.extracted ? (
    <ExtractedView ex={att.extracted} exam={att.ownerType === 'exam' ? exam : undefined} subjectId={ownerSubjectId} />
  ) : null;
  const documentView = <DocumentView att={att} />;

  return (
    <main className="page page--pushed page--wide pdfview">
      <NavBar
        back="Atrás"
        title={<span className="pdfview__navtitle">{att.name}</span>}
        right={
          <button type="button" className="iconbtn" aria-label="Compartir" onClick={share}>
            <Icon name="share" size={22} />
          </button>
        }
      />

      <header className="pdfview__head">
        <span className="file-badge file-badge--lg" aria-hidden="true">{fileBadge(att)}</span>
        <div className="grow">
          <h1 className="pdfview__title">{att.name}</h1>
          <p className="muted small" style={{ margin: 0 }}>
            {fileMeta(att)} · añadido el {fmt(toISO(new Date(att.addedAt)), "d 'de' MMMM")}
          </p>
        </div>
      </header>

      {extracted && wide ? (
        <div className="cols pdfview__cols">
          <div className="col-main">{documentView}</div>
          <div className="col-side">{extracted}</div>
        </div>
      ) : extracted ? (
        <>
          <div className="pdfview__seg">
            <Segmented label="Vista" value={tab} onChange={setTab} options={[{ value: 'ext', label: 'Extraído' }, { value: 'doc', label: 'Documento' }]} />
          </div>
          {tab === 'ext' ? extracted : documentView}
        </>
      ) : (
        <div className="pdfview__doconly">{documentView}</div>
      )}

      <footer className="pdfview__foot">
        {owner && (
          <Link to={owner.to} className="pdfview__owner">
            <Icon name="paperclip" size={18} />
            <span className="grow">Vinculado a: <strong>{owner.label}</strong></span>
            <Icon name="chevron" size={16} stroke={2} />
          </Link>
        )}
        <button type="button" className="btn btn--danger pdfview__remove" onClick={() => setConfirm(true)}>Quitar adjunto</button>
      </footer>

      <ConfirmSheet
        open={confirm}
        onClose={() => setConfirm(false)}
        title="¿Quitar este adjunto?"
        message={`Se borrará «${att.name}» de este dispositivo. Las tareas y temas que hayas creado desde él se mantienen.`}
        confirmLabel="Quitar adjunto"
        onConfirm={remove}
      />
    </main>
  );
}

function DocumentView({ att }: { att: Attachment }) {
  const imgUrl = useMemo(() => (isImage(att) ? URL.createObjectURL(att.blob) : null), [att]);
  useEffect(() => () => { if (imgUrl) URL.revokeObjectURL(imgUrl); }, [imgUrl]);
  if (isPdf(att)) return <PdfPages blob={att.blob} name={att.name} />;
  if (imgUrl) return <img className="pdfview__img" src={imgUrl} alt={att.name} />;
  return (
    <div className="card pdfview__other">
      <p className="muted small" style={{ marginTop: 0 }}>Este tipo de archivo no se puede previsualizar aquí.</p>
      <button type="button" className="btn btn--primary" onClick={() => downloadBlob(att.blob, att.name)}>
        <Icon name="download" size={18} /> Descargar
      </button>
    </div>
  );
}

function ExtractedView({ ex, exam, subjectId }: { ex: Extracted; exam?: Exam; subjectId?: string }) {
  const [busy, setBusy] = useState<string | null>(null);
  const dates = ex.dates.map((d) => d.date);
  // Tareas ya creadas desde una fecha (mismo título y fecha) → "Creada"
  const existing = useLiveQuery(async () => {
    if (!dates.length) return new Set<string>();
    const tasks = await db.tasks.where('date').anyOf(dates).toArray();
    return new Set(tasks.map((t) => `${t.date}|${t.title.trim().toLowerCase()}`));
  }, [dates.join(',')]);

  const examTopics = new Set((exam?.topics ?? []).map((t) => t.name.trim().toLowerCase()));
  const addedCount = ex.topics.filter((t) => examTopics.has(t.trim().toLowerCase())).length;

  const addTopic = async (name: string) => {
    if (!exam || examTopics.has(name.trim().toLowerCase())) return;
    setBusy(`t:${name}`);
    const fresh = await db.exams.get(exam.id);
    if (fresh && !fresh.topics.some((t) => t.name.trim().toLowerCase() === name.trim().toLowerCase())) {
      await updateExam(exam.id, { topics: [...fresh.topics, { id: uid(), name, status: 'pendiente' }] });
    }
    setBusy(null);
  };

  const makeTask = async (d: Extracted['dates'][number]) => {
    setBusy(`d:${d.date}`);
    await createTask({ title: d.text, date: d.date, ...(subjectId ? { subjectId } : {}) });
    setBusy(null);
  };

  const nothing = !ex.topics.length && !ex.concepts.length && !ex.dates.length && !ex.summary;

  return (
    <div className="extracted">
      {nothing && <Empty>No hemos encontrado texto que analizar. Puede que el PDF sea un escaneo.</Empty>}

      {ex.topics.length > 0 && (
        <section className="ex-section">
          <div className="ex-section__head">
            <h2 className="ex-section__title">Temas detectados</h2>
            <span className="muted xsmall">
              {addedCount ? `${addedCount} ${addedCount === 1 ? 'añadido' : 'añadidos'}` : `${ex.topics.length} ${ex.topics.length === 1 ? 'encontrado' : 'encontrados'}`}
            </span>
          </div>
          {ex.topics.map((t) => {
            const added = examTopics.has(t.trim().toLowerCase());
            return (
              <div key={t} className="ex-topic">
                <span className="topic-chip">{t}</span>
                {exam && (
                  added ? (
                    <span className="ex-topic__done"><Icon name="check" size={15} stroke={2.4} />Añadido</span>
                  ) : (
                    <button type="button" className="ex-topic__add" disabled={busy === `t:${t}`} onClick={() => addTopic(t)}>
                      + Añadir al examen
                    </button>
                  )
                )}
              </div>
            );
          })}
        </section>
      )}

      {ex.concepts.length > 0 && (
        <section className="ex-section">
          <h2 className="ex-section__title">Conceptos clave</h2>
          {ex.concepts.map((c) => (
            <div key={c.term} className="ex-concept">
              <span className="ex-concept__term">{c.term}</span>
              <span className="ex-concept__def">{c.def}</span>
            </div>
          ))}
        </section>
      )}

      {ex.dates.length > 0 && (
        <section className="ex-section">
          <h2 className="ex-section__title">Fechas encontradas</h2>
          {ex.dates.map((d) => {
            const created = existing?.has(`${d.date}|${d.text.trim().toLowerCase()}`);
            return (
              <div key={d.date} className="ex-date">
                <div className="ex-date__cal">
                  <span className="ex-date__day">{fmt(d.date, 'd')}</span>
                  <span className="ex-date__month">{fmt(d.date, 'MMM yyyy').replace('.', '')}</span>
                </div>
                <div className="grow ex-date__text">
                  <span className="ex-date__what">{d.text}</span>
                  {d.page ? <span className="muted xsmall">Página {d.page}</span> : null}
                </div>
                <button
                  type="button"
                  className={`btn btn--sm ex-date__btn${created ? ' ex-date__btn--done' : ''}`}
                  aria-pressed={!!created}
                  disabled={created || busy === `d:${d.date}`}
                  onClick={() => makeTask(d)}
                >
                  {created ? <><Icon name="check" size={15} stroke={2.4} />Creada</> : 'Crear tarea'}
                </button>
              </div>
            );
          })}
        </section>
      )}

      {ex.summary && (
        <section className="ex-section">
          <h2 className="ex-section__title">Resumen</h2>
          <p className="ex-summary">{ex.summary}</p>
        </section>
      )}
    </div>
  );
}
