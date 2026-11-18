import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { db } from '../../db/db';
import { useAttachments } from '../../db/hooks';
import type { Attachment, OwnerType } from '../../db/types';
import { uid } from '../../lib/id';
import { extractFromPdf, PdfError } from '../../lib/pdf';
import { fmt } from '../../lib/dates';
import { Icon } from '../../components/Icon';
import { fileBadge, fileMeta, isPdf, MAX_FILE_BYTES } from './fileUtils';
import './files.css';

/** Sección "Material / Archivos": lista de adjuntos del dueño, con lo extraído de cada PDF y botón "+ Adjuntar PDF". */
export default function Attachments(props: { ownerType: OwnerType; ownerId: string; title?: string }) {
  const { ownerType, ownerId, title = 'Archivos' } = props;
  const list = useAttachments(ownerId);
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (file.size > MAX_FILE_BYTES) {
      setError(`«${file.name}» pesa demasiado. El máximo es 25 MB.`);
      return;
    }
    const att: Attachment = {
      id: uid(), ownerType, ownerId, name: file.name, mime: file.type || 'application/octet-stream',
      size: file.size, blob: file, addedAt: Date.now(),
    };
    try {
      if (isPdf(att)) {
        att.mime = 'application/pdf';
        setBusy(file.name);
        const res = await extractFromPdf(file);
        if (res.pages) att.pages = res.pages;
        att.extracted = res.extracted;
      }
      await db.attachments.add(att);
      if (att.extracted && hasContent(att)) setOpen(att.id);
    } catch (e) {
      setError(e instanceof PdfError ? e.message : 'No se pudo guardar el archivo. Inténtalo de nuevo.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="section attachments" aria-label={title}>
      <h2 className="section-label">{title}</h2>
      {list.length > 0 && (
        <ul className="att-list">
          {[...list].sort((a, b) => a.addedAt - b.addedAt).map((a) => (
            <AttachmentRow key={a.id} a={a} expanded={open === a.id} onToggle={() => setOpen(open === a.id ? null : a.id)} />
          ))}
        </ul>
      )}
      {busy && (
        <p className="att-busy" role="status">
          <span className="att-spinner" aria-hidden="true" />Leyendo PDF…
        </p>
      )}
      {error && <p className="att-error" role="alert">{error}</p>}
      <button type="button" className="att-add" onClick={() => inputRef.current?.click()} disabled={!!busy}>
        <Icon name="plus" size={18} stroke={2.2} />
        Adjuntar PDF o archivo
      </button>
      <input
        ref={inputRef}
        type="file"
        hidden
        accept="application/pdf,image/*,.doc,.docx,.txt"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          void onFile(f);
        }}
      />
    </section>
  );
}

const hasContent = (a: Attachment) =>
  !!a.extracted && (a.extracted.topics.length > 0 || a.extracted.concepts.length > 0 || a.extracted.dates.length > 0);

function AttachmentRow({ a, expanded, onToggle }: { a: Attachment; expanded: boolean; onToggle: () => void }) {
  const ex = a.extracted;
  const panelId = `att-ex-${a.id}`;
  return (
    <li className="att-item">
      <div className="att-row">
        <span className="file-badge" aria-hidden="true">{fileBadge(a)}</span>
        <div className="grow att-row__text">
          <span className="att-row__name">{a.name}</span>
          <span className="att-row__meta">{fileMeta(a)}</span>
        </div>
        <Link to={`/adjunto/${a.id}`} className="btn btn--sm" aria-label={`Abrir ${a.name}`}>Abrir</Link>
      </div>
      {ex && isPdf(a) && (
        <>
          <button type="button" className="att-toggle" aria-expanded={expanded} aria-controls={panelId} onClick={onToggle}>
            <Icon name="chevron" size={14} stroke={2.2} className={expanded ? 'att-chev att-chev--open' : 'att-chev'} />
            Extraído del PDF
            {!hasContent(a) && <span className="muted"> · sin resultados</span>}
          </button>
          {expanded && (
            <div id={panelId} className="att-extract">
              {!hasContent(a) && (
                <p className="muted small">No hemos encontrado temas, conceptos ni fechas. Puede que el PDF sea un escaneo sin texto.</p>
              )}
              {ex.topics.length > 0 && (
                <div>
                  <h3 className="att-extract__h">Temas detectados</h3>
                  <div className="chips">
                    {ex.topics.map((t) => <span key={t} className="topic-chip">{t}</span>)}
                  </div>
                </div>
              )}
              {ex.concepts.length > 0 && (
                <div>
                  <h3 className="att-extract__h">Conceptos clave</h3>
                  <ul className="att-concepts">
                    {ex.concepts.slice(0, 5).map((c) => (
                      <li key={c.term}><strong>{c.term}</strong> <span className="muted">{c.def}</span></li>
                    ))}
                  </ul>
                  {ex.concepts.length > 5 && <Link to={`/adjunto/${a.id}`} className="small">Ver los {ex.concepts.length}</Link>}
                </div>
              )}
              {ex.dates.length > 0 && (
                <div>
                  <h3 className="att-extract__h">Fechas</h3>
                  <ul className="att-dates">
                    {ex.dates.slice(0, 5).map((d) => (
                      <li key={d.date}><span className="att-dates__d">{fmt(d.date, 'd MMM')}</span> {d.text}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </li>
  );
}
