// Lista de avisos (recordatorios) de un examen o trabajo, con quitar y añadir por presets.
import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { Sheet } from '../../components/ui';
import type { Reminder } from '../../db/types';
import { addDaysISO, capitalize, toDateTime } from '../../lib/dates';
import { reminderLabel } from '../../lib/labels';
import { uid } from '../../lib/id';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { SectionHead } from './common';
import { CustomReminderSheet } from '../../components/CustomReminder';

type Preset = { kind: 'before'; minutes: number } | { kind: 'dayAt'; days: number; time: string };

export const REMINDER_PRESETS: Preset[] = [
  { kind: 'dayAt', days: 7, time: '10:00' },
  { kind: 'dayAt', days: 3, time: '10:00' },
  { kind: 'dayAt', days: 2, time: '10:00' },
  { kind: 'dayAt', days: 1, time: '20:00' },
  { kind: 'dayAt', days: 0, time: '09:00' },
  { kind: 'before', minutes: 1440 },
  { kind: 'before', minutes: 60 },
  { kind: 'before', minutes: 15 },
];

export const reminderKey = (r: Preset | Reminder) =>
  r.kind === 'before' ? `b:${r.minutes}` : `d:${r.days}:${r.time}`;

export const withId = (p: Preset | Reminder): Reminder => ({ ...p, id: uid() }) as Reminder;

/** Fecha/hora en que saltará el aviso. */
export function reminderAt(r: Preset | Reminder, date: string, time?: string): Date {
  if (r.kind === 'before') return new Date(toDateTime(date, time).getTime() - r.minutes * 60000);
  return toDateTime(addDaysISO(date, -r.days), r.time);
}

export const reminderWhen = (r: Preset | Reminder, date: string, time?: string) =>
  capitalize(format(reminderAt(r, date, time), "EEE d MMM · HH:mm", { locale: es }).replace('.', ''));

const sortReminders = (list: Reminder[], date: string, time?: string) =>
  [...list].sort((a, b) => reminderAt(a, date, time).getTime() - reminderAt(b, date, time).getTime());

export function ReminderList({ title, reminders, date, time, onChange }: {
  title: string;
  reminders: Reminder[];
  date?: string;
  time?: string;
  onChange: (next: Reminder[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(false);
  const present = new Set(reminders.map(reminderKey));
  const available = REMINDER_PRESETS.filter((p) => !present.has(reminderKey(p)));
  const list = date ? sortReminders(reminders, date, time) : reminders;

  return (
    <section className="st-section">
      <SectionHead title={title} />
      {!date && <p className="muted small">Pon una fecha para que los avisos puedan saltar.</p>}
      {list.length === 0 && <p className="muted small">Sin avisos.</p>}
      {list.map((r) => {
        const past = date ? reminderAt(r, date, time).getTime() < Date.now() : false;
        return (
          <div className="st-row" key={r.id}>
            <Icon name="bell" size={18} stroke={1.8} />
            <div className="grow st-row__text">
              <span className={past ? 'st-row__title muted' : 'st-row__title'}>{reminderLabel(r)}</span>
              {date && <span className="st-row__meta">{reminderWhen(r, date, time)}{past ? ' · ya pasó' : ''}</span>}
            </div>
            <button type="button" className="iconbtn" aria-label={`Quitar aviso ${reminderLabel(r)}`}
              onClick={() => onChange(reminders.filter((x) => x.id !== r.id))}>
              <Icon name="close" size={18} stroke={2} />
            </button>
          </div>
        );
      })}
      <button type="button" className="st-addbtn" onClick={() => setOpen(true)}>
        <Icon name="plus" size={18} stroke={2} />Añadir aviso
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Añadir aviso">
        <div className="stack" style={{ gap: 0 }}>
          {available.map((p) => (
            <button type="button" key={reminderKey(p)} className="list-row"
              onClick={() => { onChange([...reminders, withId(p)]); setOpen(false); }}>
              <Icon name="bell" size={18} stroke={1.8} />
              <span className="grow">
                <span className="list-row__title" style={{ display: 'block' }}>{reminderLabel(withId(p))}</span>
                {date && <span className="list-row__meta">{reminderWhen(p, date, time)}</span>}
              </span>
              <Icon name="plus" size={18} stroke={2} />
            </button>
          ))}
        </div>
        <button type="button" className="btn btn--block" style={{ marginTop: 12 }} onClick={() => { setOpen(false); setCustom(true); }}>
          <Icon name="plus" size={18} stroke={2.2} />Personalizar un aviso
        </button>
        <button type="button" className="btn btn--block btn--ghost" style={{ marginTop: 4 }} onClick={() => setOpen(false)}>Cancelar</button>
      </Sheet>
      <CustomReminderSheet open={custom} onClose={() => setCustom(false)} date={date} time={time}
        onAdd={(r) => { if (!present.has(reminderKey(r))) onChange([...reminders, r]); }} />
    </section>
  );
}
