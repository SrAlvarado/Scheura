import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { openPdf, PdfError } from '../../lib/pdf';
import { Icon } from '../../components/Icon';

/** Visor de PDF: una página en <canvas> ajustada al ancho, con navegación anterior/siguiente. */
export function PdfPages({ blob, name }: { blob: Blob; name: string }) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [width, setWidth] = useState(0);
  const [rendering, setRendering] = useState(true);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let alive = true;
    let opened: PDFDocumentProxy | null = null;
    setDoc(null);
    setError(null);
    setPage(1);
    openPdf(blob)
      .then((d) => {
        opened = d;
        if (alive) setDoc(d);
        else d.destroy();
      })
      .catch((e) => alive && setError(e instanceof PdfError ? e.message : 'No se ha podido abrir el PDF.'));
    return () => {
      alive = false;
      opened?.destroy();
    };
  }, [blob]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => setWidth(Math.floor(entries[0].contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!doc || !width || !canvasRef.current) return;
    let task: RenderTask | null = null;
    let cancelled = false;
    setRendering(true);
    (async () => {
      try {
        const p = await doc.getPage(page);
        if (cancelled) return;
        const base = p.getViewport({ scale: 1 });
        const scale = width / base.width;
        const dpr = Math.min(window.devicePixelRatio || 1, 3);
        const vp = p.getViewport({ scale: scale * dpr });
        const canvas = canvasRef.current!;
        canvas.width = Math.floor(vp.width);
        canvas.height = Math.floor(vp.height);
        canvas.style.width = `${Math.floor(vp.width / dpr)}px`;
        canvas.style.height = `${Math.floor(vp.height / dpr)}px`;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        task = p.render({ canvasContext: ctx, viewport: vp });
        await task.promise;
        if (!cancelled) setRendering(false);
      } catch (e) {
        if ((e as { name?: string })?.name !== 'RenderingCancelledException' && !cancelled) setError('No se ha podido mostrar esta página.');
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, page, width]);

  const total = doc?.numPages ?? 0;

  return (
    <div className="pdf-viewer">
      <div ref={wrapRef} className="pdf-viewer__wrap">
        {error ? (
          <p className="att-error" role="alert">{error}</p>
        ) : (
          <canvas
            ref={canvasRef}
            className={`pdf-canvas${rendering ? ' pdf-canvas--loading' : ''}`}
            role="img"
            aria-label={total ? `Página ${page} de ${total} de ${name}` : 'Cargando PDF'}
          />
        )}
      </div>
      {total > 0 && !error && (
        <div className="pdf-pager">
          <button type="button" className="pager-btn" aria-label="Página anterior" disabled={page <= 1} onClick={() => setPage((n) => Math.max(1, n - 1))}>
            <Icon name="back" size={18} stroke={2.2} />
          </button>
          <span aria-live="polite" className="pdf-pager__label"><strong>{page}</strong> / {total}</span>
          <button type="button" className="pager-btn" aria-label="Página siguiente" disabled={page >= total} onClick={() => setPage((n) => Math.min(total, n + 1))}>
            <Icon name="chevron" size={18} stroke={2.2} />
          </button>
        </div>
      )}
    </div>
  );
}
