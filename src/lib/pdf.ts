// Lectura de PDF en el navegador con pdfjs-dist (sin servidor) + heurísticas en español para extraer
// temas, fechas, conceptos clave y un resumen.
//
// Errores: `extractFromPdf` NUNCA lanza por PDFs "raros" (sin texto, escaneados, páginas rotas…): en ese caso
// devuelve una extracción vacía con `pages: 0`. SOLO lanza un `PdfError` (subclase de Error, con `code`) cuando el
// PDF está protegido con contraseña (`code: 'password'`) o no es un PDF válido (`code: 'invalid'`), para que la UI
// pueda mostrar un mensaje claro. El mensaje (`error.message`) ya está redactado en español para el usuario.
import type { PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { Extracted } from '../db/types';

export interface PdfResult { pages: number; text: string; extracted: Extracted }

export class PdfError extends Error {
  code: 'password' | 'invalid';
  constructor(code: 'password' | 'invalid', message: string) {
    super(message);
    this.name = 'PdfError';
    this.code = code;
  }
}

const EMPTY: Extracted = { topics: [], concepts: [], dates: [], summary: '' };
const emptyResult = (): PdfResult => ({ pages: 0, text: '', extracted: { ...EMPTY, topics: [], concepts: [], dates: [] } });

type PdfJs = typeof import('pdfjs-dist');
let pdfjsPromise: Promise<PdfJs> | null = null;

/** Carga pdfjs bajo demanda (solo cuando hace falta leer un PDF) y configura su worker. */
export function getPdfjs(): Promise<PdfJs> {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist').then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      return pdfjs;
    });
    pdfjsPromise.catch(() => { pdfjsPromise = null; });
  }
  return pdfjsPromise;
}

/** Abre un PDF (para renderizarlo). Lanza PdfError si tiene contraseña o no es válido. Llama a `destroy()` al terminar. */
export async function openPdf(file: Blob): Promise<PDFDocumentProxy> {
  const pdfjs = await getPdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  try {
    return await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
  } catch (e) {
    throw toPdfError(e);
  }
}

function toPdfError(e: unknown): unknown {
  const name = (e as { name?: string } | null)?.name;
  if (name === 'PasswordException') return new PdfError('password', 'Este PDF está protegido con contraseña. Quítasela y vuelve a adjuntarlo.');
  if (name === 'InvalidPDFException' || name === 'FormatError') return new PdfError('invalid', 'El archivo no parece un PDF válido o está dañado.');
  return e;
}

/** Lee un PDF en el navegador y extrae temas, conceptos clave, fechas y un resumen (heurísticas, sin servidor). */
export async function extractFromPdf(file: Blob): Promise<PdfResult> {
  let doc: PDFDocumentProxy | null = null;
  try {
    doc = await openPdf(file);
  } catch (e) {
    if (e instanceof PdfError) throw e;
    return emptyResult();
  }
  try {
    const pageTexts: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      try {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        pageTexts.push(itemsToText(content.items as unknown[]));
        page.cleanup();
      } catch {
        pageTexts.push('');
      }
    }
    const text = pageTexts.join('\n\n');
    return { pages: doc.numPages, text, extracted: analyzeText(pageTexts) };
  } catch {
    return emptyResult();
  } finally {
    doc.destroy().catch(() => undefined);
  }
}

/** Une los fragmentos de texto de una página respetando saltos de línea por posición vertical. */
function itemsToText(items: unknown[]): string {
  let out = '';
  let lastY: number | null = null;
  let lastH = 10;
  for (const raw of items) {
    if (!raw || typeof raw !== 'object' || !('str' in raw)) continue;
    const it = raw as { str: string; transform: number[]; height: number; hasEOL?: boolean };
    const y = it.transform?.[5] ?? 0;
    const h = it.height || lastH;
    if (lastY !== null && Math.abs(y - lastY) > Math.max(2, Math.min(h, lastH) * 0.5)) {
      if (!out.endsWith('\n')) out += '\n';
    } else if (out && !out.endsWith('\n') && !out.endsWith(' ') && it.str && !it.str.startsWith(' ')) {
      out += ' ';
    }
    out += it.str;
    if (it.hasEOL) out += '\n';
    if (it.str.trim()) { lastY = y; lastH = h; }
  }
  return out
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}

/** Aplica todas las heurísticas a los textos por página. */
export function analyzeText(pageTexts: string[]): Extracted {
  const allLines = pageTexts.flatMap((t) => t.split('\n')).map((l) => l.trim()).filter(Boolean);
  return {
    topics: detectTopics(allLines),
    dates: detectDates(pageTexts),
    concepts: detectConcepts(allLines),
    summary: buildSummary(allLines),
  };
}

// ---------- utilidades de texto ----------

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
const capFirst = (s: string) => (s ? s.charAt(0).toLocaleUpperCase('es') + s.slice(1) : s);
const isAllCaps = (s: string) => /\p{L}/u.test(s) && s === s.toLocaleUpperCase('es') && s !== s.toLocaleLowerCase('es');
const sentenceCase = (s: string) => (isAllCaps(s) ? capFirst(s.toLocaleLowerCase('es')) : capFirst(s));

/** Recorta a `max` caracteres por límite de palabra, añadiendo «…». */
export function clip(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:.\-–]+$/, '')}…`;
}

/** Limpia el título de un tema: puntos de índice, número de página final, puntuación sobrante. */
function cleanTitle(s: string): string {
  return s
    .replace(/[.·_…\s]{3,}\d{1,3}$/, '')
    .replace(/\s+\d{1,3}$/, '')
    .replace(/^[\s.:\-–—)]+|[\s.:\-–—,;]+$/g, '')
    .trim();
}

// ---------- temas ----------

const TOPIC_RE = /^(tema|unidad|bloque|cap[ií]tulo|lecci[oó]n)\s*(\d{1,3})[\s.:\-–—]*(.+)/i;
const NUM_HEADING_RE = /^(\d{1,2})(?:\.(\d{1,2}))?[.)]?\s+(\p{Lu}.{2,})$/u;

/** Temas: «Tema 4: La célula», «Unidad 2 – …» o encabezados numerados cortos («4. La célula»). Máx. 20. */
export function detectTopics(lines: string[]): string[] {
  const primary: { key: string; label: string }[] = [];
  const top: { key: string; label: string }[] = [];
  const sub: { key: string; label: string }[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (line.length >= 80) continue;
    const m = TOPIC_RE.exec(line);
    if (m) {
      const title = cleanTitle(m[3]);
      if (title.length >= 3 && /\p{L}/u.test(title)) primary.push({ key: m[2], label: `Tema ${m[2]} · ${sentenceCase(title)}` });
      continue;
    }
    const n = NUM_HEADING_RE.exec(line);
    if (n) {
      const title = cleanTitle(n[3]);
      const words = title.split(/\s+/).length;
      if (title.length < 3 || words > 10 || /[.:;,]$/.test(n[3].trim()) || /\d{1,2}[/-]\d{1,2}/.test(title)) continue;
      const key = n[2] ? `${n[1]}.${n[2]}` : n[1];
      (n[2] ? sub : top).push({ key, label: `Tema ${key} · ${sentenceCase(title)}` });
    }
  }
  // Prioridad: «Tema N …»; si no hay, encabezados «N. Título»; si hay muy pocos, también subapartados «N.M Título».
  const list = primary.length ? primary : top.length >= 2 ? top : [...top, ...sub];
  const seenKey = new Set<string>();
  const seenLabel = new Set<string>();
  const out: string[] = [];
  for (const t of list) {
    const nl = norm(t.label);
    if (seenKey.has(t.key) || seenLabel.has(nl)) continue;
    seenKey.add(t.key);
    seenLabel.add(nl);
    out.push(t.label);
    if (out.length >= 20) break;
  }
  return out;
}

// ---------- fechas ----------

const MONTHS: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8,
  septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
};
const TEXT_DATE_RE = /\b(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)(?:\s+(?:de|del)\s+(\d{4}))?\b/gi;
const NUM_DATE_RE = /(?<![\d.,/-])(\d{1,2})([/-])(\d{1,2})(?:\2(\d{4}|\d{2}))?(?![\d/-])/g;
const DOT_DATE_RE = /(?<![\d.,])(\d{1,2})\.(\d{1,2})\.(\d{4})(?![\d.])/g;

/** Año para una fecha sin año: se asume el curso académico actual (sept–ago). */
export function academicYearFor(month: number, today = new Date()): number {
  const y = today.getFullYear();
  const start = today.getMonth() >= 7 ? y : y - 1; // desde agosto, el curso empieza este año
  return month >= 9 ? start : start + 1;
}

function toISODate(d: number, m: number, y: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, m - 1, d);
  if (dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const STRIP_WORDS = new Set(['el', 'la', 'los', 'las', 'de', 'del', 'para', 'hasta', 'antes', 'día', 'dia', 'a', 'al', 'en', 'y', 'se', 'es', 'será', 'sera', 'serán', 'son', 'tendrá', 'tendra', 'lugar', 'realizará', 'realizara', 'hará', 'hara', 'desde', 'entre', 'o', 'lunes', 'martes', 'miércoles', 'miercoles', 'jueves', 'viernes', 'sábado', 'sabado', 'domingo']);

function stripEdges(s: string): string {
  const words = s.replace(/[«»"“”()[\]]/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const clean = (w: string) => norm(w.replace(/[.,;:\-–—]+$/g, '').replace(/^[.,;:\-–—]+/g, ''));
  while (words.length && (STRIP_WORDS.has(clean(words[0])) || !clean(words[0]))) words.shift();
  while (words.length && (STRIP_WORDS.has(clean(words[words.length - 1])) || !clean(words[words.length - 1]))) words.pop();
  return words.join(' ').replace(/^[\s.,;:\-–—]+|[\s.,;:\-–—]+$/g, '');
}

/** Texto de contexto alrededor de una fecha (~60 caracteres). */
function dateContext(line: string, start: number, end: number): string {
  let before = line.slice(Math.max(0, start - 70), start);
  if (start > 70) before = before.slice(before.indexOf(' ') + 1);
  // Si hay un separador de frase antes, quedarse con la última frase
  const lastStop = Math.max(before.lastIndexOf('. '), before.lastIndexOf('; '));
  if (lastStop >= 0) before = before.slice(lastStop + 2);
  let after = line.slice(end, end + 70);
  const stop = after.search(/[.;](\s|$)/);
  if (stop >= 0) after = after.slice(0, stop);
  const b = stripEdges(before);
  const a = stripEdges(after);
  const pick = b.replace(/\d/g, '').trim().length >= 4 ? b : a.replace(/\d/g, '').trim().length >= 4 ? a : b || a;
  return clip(capFirst(pick), 60);
}

/** Fechas: dd/mm(/yyyy), d-m-yyyy, dd.mm.yyyy y «24 de noviembre (de 2026)» → ISO. Deduplicadas por fecha. */
export function detectDates(pageTexts: string[], today = new Date()): { date: string; text: string; page?: number }[] {
  const out: { date: string; text: string; page?: number }[] = [];
  const seen = new Set<string>();
  const add = (iso: string | null, line: string, start: number, end: number, page: number) => {
    if (!iso || seen.has(iso)) return;
    seen.add(iso);
    out.push({ date: iso, text: dateContext(line, start, end) || 'Fecha del documento', page });
  };
  pageTexts.forEach((pageText, pi) => {
    const page = pi + 1;
    for (const line of pageText.split('\n')) {
      if (!/\d/.test(line)) continue;
      for (const m of line.matchAll(TEXT_DATE_RE)) {
        const month = MONTHS[m[2].toLowerCase()];
        const year = m[3] ? Number(m[3]) : academicYearFor(month, today);
        add(toISODate(Number(m[1]), month, year), line, m.index ?? 0, (m.index ?? 0) + m[0].length, page);
      }
      for (const m of line.matchAll(DOT_DATE_RE)) {
        add(toISODate(Number(m[1]), Number(m[2]), Number(m[3])), line, m.index ?? 0, (m.index ?? 0) + m[0].length, page);
      }
      for (const m of line.matchAll(NUM_DATE_RE)) {
        const month = Number(m[3]);
        let year = m[4] ? Number(m[4]) : academicYearFor(month, today);
        if (m[4] && m[4].length === 2) year += 2000;
        if (year < 1990 || year > 2100) continue;
        add(toISODate(Number(m[1]), month, year), line, m.index ?? 0, (m.index ?? 0) + m[0].length, page);
      }
    }
  });
  return out.slice(0, 30);
}

// ---------- conceptos ----------

const TERM_STOP = new Set([
  'tema', 'unidad', 'bloque', 'capitulo', 'leccion', 'fecha', 'fechas', 'pagina', 'nota', 'notas', 'ejemplo', 'ejemplos',
  'ejercicio', 'ejercicios', 'profesor', 'profesora', 'email', 'correo', 'hora', 'horario', 'aula', 'curso', 'asignatura',
  'nombre', 'apellidos', 'grupo', 'tel', 'telefono', 'web', 'http', 'https', 'url', 'fuente', 'observacion', 'observaciones',
  'importante', 'recuerda', 'atencion', 'solucion', 'respuesta', 'pregunta', 'objetivo', 'objetivos', 'indice', 'resumen',
  'introduccion', 'conclusion', 'conclusiones', 'bibliografia', 'evaluacion', 'criterios', 'nota final', 'total', 'paso',
]);
const ARTICLE_RE = /^(el|la|los|las|un|una|unos|unas|lo)\s+/i;

function cleanTerm(t: string): string | null {
  let term = t.replace(/^[\s\-–—•·*\d.)]+/, '').replace(/[\s:,.;]+$/, '').trim();
  term = term.replace(ARTICLE_RE, '');
  if (term.length < 3 || term.length > 40) return null;
  const words = term.split(/\s+/);
  if (words.length > 5) return null;
  if (!/^\p{L}/u.test(term) || /\d{2,}/.test(term)) return null;
  if (TERM_STOP.has(norm(term)) || TERM_STOP.has(norm(words[0]))) return null;
  return sentenceCase(term);
}

function cleanDef(d: string): string | null {
  const def = d.replace(/^[\s:\-–—]+/, '').trim();
  if (def.length < 15 || !/\p{L}{3,}/u.test(def)) return null;
  return clip(capFirst(def), 140);
}

/** Conceptos: «X: …», «X es/son …», «Se denomina/llama X …» y encabezados cortos en mayúsculas. Máx. 12. */
export function detectConcepts(lines: string[]): { term: string; def: string }[] {
  const out: { term: string; def: string }[] = [];
  const seen = new Set<string>();
  const push = (t: string | null, d: string | null) => {
    if (!t || !d) return;
    const k = norm(t);
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ term: t, def: d });
  };

  // 1) «Término: definición» (por línea)
  for (const line of lines) {
    if (out.length >= 12) break;
    const m = /^([^:]{3,42}):\s+(.{15,})$/.exec(line);
    if (!m || /https?$/i.test(m[1]) || /^\d/.test(m[1])) continue;
    if (TOPIC_RE.test(line)) continue;
    push(cleanTerm(m[1]), cleanDef(m[2]));
  }

  // 2) Frases sobre el texto corrido
  const prose = lines.join(' ').replace(/\s+/g, ' ');
  const sentences = prose.split(/(?<=[.!?])\s+(?=[¿¡]?\p{Lu})/u);
  for (const s of sentences) {
    if (out.length >= 12) break;
    const den = /^(?:Se\s+(?:denomina|llama|conoce\s+como|define\s+como)|Llamamos|Denominamos)\s+(.{3,45}?)\s+(?:a|al|a\s+la|a\s+los|a\s+las)\s+(.{15,})$/i.exec(s);
    if (den) { push(cleanTerm(den[1]), cleanDef(den[2])); continue; }
    const es = /^((?:(?:El|La|Los|Las|Un|Una)\s+)?\p{Lu}[\p{L}\-]*(?:\s+[\p{L}\-]+){0,3})\s+(es|son)\s+((?:un|una|el|la|los|las|unos|unas|aquel|aquella|aquello|cada|todo|toda|la\s+parte|el\s+conjunto|el\s+proceso)\b.{12,})$/u.exec(s);
    if (es) push(cleanTerm(es[1]), cleanDef(`${es[2] === 'son' ? 'Son' : 'Es'} ${es[3]}`));
  }

  // 3) Encabezado corto en MAYÚSCULAS seguido de su explicación
  for (let i = 0; i < lines.length - 1 && out.length < 12; i++) {
    const l = lines[i];
    if (l.length < 3 || l.length > 40 || !isAllCaps(l) || /\d/.test(l) || l.split(/\s+/).length > 5) continue;
    const next = lines[i + 1];
    if (!next || isAllCaps(next) || next.length < 20) continue;
    const extra = lines[i + 2];
    const def = !/[.!?]$/.test(next) && extra && !isAllCaps(extra) && !TOPIC_RE.test(extra) && !NUM_HEADING_RE.test(extra) ? `${next} ${extra}` : next;
    push(cleanTerm(l), cleanDef(def));
  }
  return out.slice(0, 12);
}

// ---------- resumen ----------

/** Primeras 2–3 frases informativas (sin encabezados ni líneas cortas), ≤ 400 caracteres. */
export function buildSummary(lines: string[]): string {
  const body = lines.filter((l) => l.length >= 40 && !TOPIC_RE.test(l) && !NUM_HEADING_RE.test(l) && !isAllCaps(l));
  const prose = body.join(' ').replace(/\s+/g, ' ').replace(/-\s(?=\p{Ll})/gu, '');
  const sentences = prose.split(/(?<=[.!?])\s+(?=[¿¡]?\p{Lu})/u);
  const picked: string[] = [];
  let len = 0;
  for (const raw of sentences) {
    const s = raw.trim();
    const words = s.split(/\s+/).length;
    const digits = (s.match(/\d/g) ?? []).length;
    if (s.length < 40 || s.length > 320 || words < 6 || digits > s.length * 0.15) continue;
    if (/https?:|@|www\./i.test(s)) continue;
    if (!/[.!?]$/.test(s)) continue;
    if (len + s.length + 1 > 400) break;
    picked.push(s);
    len += s.length + 1;
    if (picked.length >= 3) break;
  }
  if (!picked.length && prose) return clip(prose, 400);
  return picked.join(' ');
}
