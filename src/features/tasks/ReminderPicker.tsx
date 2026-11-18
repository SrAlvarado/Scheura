// Recordatorios: presets, etiquetas y selectores reutilizados por el formulario de tarea y Avisos.
import type { Reminder } from '../../db/types';
import { reminderLabel } from '../../lib/labels';
import { uid } from '../../lib/id';
import { Icon } from '../../components/Icon';
import { Sheet } from '../../components/ui';

type RemNoId = { kind: 'before'; minutes: number } | { kind: 'dayAt'; days: number; time: string };

export const REMINDER_PRESETS: RemNoId[] = [
  { kind: 'dayAt', days: 0, time: '08:00' },
  { kind: 'before', minutes: 60 },
  { kind: 'before', minutes: 1440 },
  { kind: 'before', minutes: 4320 },
  { kind: 'before', minutes: 10080 },
  { kind: 'dayAt', days: 1, time: '20:00' },
];

/** Clave para comparar recordatorios sin tener en cuenta el id. */
export const remKey = (r: RemNoId | Reminder) => (r.kind === 'before' ? `b:${r.minutes}` : `d:${r.days}:${r.time}`);

export const remLabel = (r: RemNoId | Reminder) =>
  r.kind === 'before' && r.minutes === 10080 ? '1 semana antes' : reminderLabel({ id: '', ...r } as Reminder);

export const withId = (r: RemNoId | Reminder): Reminder => ({ ...r, id: uid() }) as Reminder;

/** Minutos aproximados antes del momento (para ordenar: más lejanos primero). */
const remOrder = (r: RemNoId | Reminder) => (r.kind === 'before' ? r.minutes : r.days * 1440 + 9 * 60 - toMin(r.time));
const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
export const sortReminders = <T extends RemNoId | Reminder>(list: T[]) => [...list].sort((a, b) => remOrder(b) - remOrder(a));

/** Chips conmutables: presets + los actuales. */
export function ReminderChips({ value, onChange }: { value: Reminder[]; onChange: (v: Reminder[]) => void }) {
  const active = new Set(value.map(remKey));
  const extra = value.filter((r) => !REMINDER_PRESETS.some((p) => remKey(p) === remKey(r)));
  const all: (RemNoId | Reminder)[] = sortReminders([...REMINDER_PRESETS, ...extra]);
  const toggle = (r: RemNoId | Reminder) => {
    const k = remKey(r);
    onChange(active.has(k) ? value.filter((x) => remKey(x) !== k) : [...value, withId(r)]);
  };
  return (
    <div className="chips" role="group" aria-label="Recordatorios">
      {all.map((r) => {
        const on = active.has(remKey(r));
        return (
          <button key={remKey(r)} type="button" className="chip" aria-pressed={on} onClick={() => toggle(r)}>
            {on && <Icon name="check" size={14} stroke={2.6} />}
            {remLabel(r)}
          </button>
        );
      })}
    </div>
  );
}

/** Hoja para añadir un recordatorio desde los presets (excluye los ya elegidos). */
export function ReminderPresetSheet({ open, onClose, exclude, onPick, title = 'Añadir aviso' }: {
  open: boolean; onClose: () => void; exclude: Reminder[]; onPick: (r: Reminder) => void; title?: string;
}) {
  const ex = new Set(exclude.map(remKey));
  const options = [...REMINDER_PRESETS, { kind: 'before', minutes: 10 } as RemNoId, { kind: 'before', minutes: 15 } as RemNoId, { kind: 'before', minutes: 30 } as RemNoId,
    { kind: 'before', minutes: 2880 } as RemNoId, { kind: 'dayAt', days: 0, time: '09:00' } as RemNoId, { kind: 'dayAt', days: 2, time: '10:00' } as RemNoId]
    .filter((r, i, arr) => !ex.has(remKey(r)) && arr.findIndex((x) => remKey(x) === remKey(r)) === i);
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      {options.length === 0 ? (
        <p className="muted small">Ya tienes todos los avisos disponibles.</p>
      ) : (
        <div className="group">
          {sortReminders(options).map((r) => (
            <button key={remKey(r)} type="button" className="cell" onClick={() => { onPick(withId(r)); onClose(); }}>
              <span className="cell__label">{remLabel(r)}</span>
              <Icon name="plus" size={18} />
            </button>
          ))}
        </div>
      )}
      <button type="button" className="btn btn--block btn--ghost" style={{ marginTop: 12 }} onClick={onClose}>Cancelar</button>
    </Sheet>
  );
}
