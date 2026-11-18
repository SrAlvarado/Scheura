// Hoja para crear un aviso a medida: "X minutos/horas/días/semanas antes" o "N días antes a una hora".
import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import type { Reminder } from '../db/types';
import { addDaysISO, capitalize, toDateTime } from '../lib/dates';
import { uid } from '../lib/id';
import { reminderLabel } from '../lib/labels';
import { Segmented, Sheet } from './ui';

type Unit = 'min' | 'h' | 'd' | 'sem';
const UNIT_MIN: Record<Unit, number> = { min: 1, h: 60, d: 1440, sem: 10080 };
const UNIT_LABEL: Record<Unit, string> = { min: 'minutos', h: 'horas', d: 'días', sem: 'semanas' };

/** Cuándo saltará un aviso para una fecha/hora concretas. */
export function reminderMoment(r: Reminder, date: string, time?: string): Date {
  if (r.kind === 'before') return new Date(toDateTime(date, time).getTime() - r.minutes * 60000);
  return toDateTime(addDaysISO(date, -r.days), r.time);
}

export function CustomReminderSheet({ open, onClose, onAdd, date, time }: {
  open: boolean;
  onClose: () => void;
  onAdd: (r: Reminder) => void;
  /** Fecha/hora de la tarea o examen, para enseñar cuándo saltará (opcional). */
  date?: string;
  time?: string;
}) {
  const [mode, setMode] = useState<'before' | 'dayAt'>('dayAt');
  const [amount, setAmount] = useState('30');
  const [unit, setUnit] = useState<Unit>('min');
  const [days, setDays] = useState('1');
  const [at, setAt] = useState('20:00');

  useEffect(() => {
    if (open) { setMode('dayAt'); setAmount('30'); setUnit('min'); setDays('1'); setAt('20:00'); }
  }, [open]);

  const n = Math.max(0, Math.floor(Number(amount) || 0));
  const d = Math.max(0, Math.min(60, Math.floor(Number(days) || 0)));
  const valid = mode === 'before' ? n > 0 && n * UNIT_MIN[unit] <= 60 * 1440 : /^\d{2}:\d{2}$/.test(at);
  const draft: Reminder = mode === 'before'
    ? { id: uid(), kind: 'before', minutes: n * UNIT_MIN[unit] }
    : { id: uid(), kind: 'dayAt', days: d, time: at };

  const when = valid && date
    ? capitalize(format(reminderMoment(draft, date, time), "EEEE d 'de' MMMM 'a las' HH:mm", { locale: es }))
    : null;

  return (
    <Sheet open={open} onClose={onClose} title="Aviso personalizado">
      <div className="stack" style={{ gap: 16 }}>
        <Segmented label="Tipo de aviso" value={mode} onChange={setMode}
          options={[{ value: 'dayAt', label: 'Un día a una hora' }, { value: 'before', label: 'Un rato antes' }]} />

        {mode === 'dayAt' ? (
          <div className="group">
            <label className="cell">
              <span className="cell__label">Días antes</span>
              <select value={String(d)} onChange={(e) => setDays(e.target.value)} aria-label="Días antes">
                {Array.from({ length: 31 }, (_, i) => (
                  <option key={i} value={i}>{i === 0 ? 'El mismo día' : i === 1 ? 'El día anterior' : `${i} días antes`}</option>
                ))}
              </select>
            </label>
            <label className="cell">
              <span className="cell__label">A las</span>
              <input type="time" value={at} onChange={(e) => setAt(e.target.value)} aria-label="Hora del aviso" />
            </label>
          </div>
        ) : (
          <div className="group">
            <label className="cell">
              <span className="cell__label">Cantidad</span>
              <input type="number" inputMode="numeric" min={1} max={999} value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Cantidad" />
            </label>
            <label className="cell">
              <span className="cell__label">Unidad</span>
              <select value={unit} onChange={(e) => setUnit(e.target.value as Unit)} aria-label="Unidad">
                {(Object.keys(UNIT_LABEL) as Unit[]).map((u) => <option key={u} value={u}>{UNIT_LABEL[u]} antes</option>)}
              </select>
            </label>
          </div>
        )}

        <div className="card" style={{ background: 'var(--rose-soft)', borderColor: 'var(--rose-line)' }} aria-live="polite">
          <div className="xsmall muted" style={{ fontWeight: 700, letterSpacing: '.06em' }}>TE AVISAREMOS</div>
          <div style={{ fontWeight: 700, fontSize: 17, marginTop: 4 }}>{valid ? reminderLabel(draft) : 'Elige cuándo'}</div>
          {when && <div className="small muted" style={{ marginTop: 2 }}>{when}</div>}
          {when && date && reminderMoment(draft, date, time).getTime() < Date.now() && (
            <div className="xsmall" style={{ marginTop: 4, color: 'var(--danger)' }}>Ese momento ya ha pasado: este aviso no saltará.</div>
          )}
          {mode === 'before' && !time && date && <div className="xsmall muted" style={{ marginTop: 4 }}>Sin hora, se cuenta desde las 09:00.</div>}
        </div>

        <button type="button" className="btn btn--primary btn--block" disabled={!valid} onClick={() => { onAdd(draft); onClose(); }}>
          Añadir aviso
        </button>
        <button type="button" className="btn btn--block btn--ghost" onClick={onClose}>Cancelar</button>
      </div>
    </Sheet>
  );
}
