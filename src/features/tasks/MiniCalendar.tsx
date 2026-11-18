// Calendario mensual pequeño (lunes primero) para elegir un día.
import { useState } from 'react';
import { addMonths, endOfMonth, format, parseISO, startOfMonth } from 'date-fns';
import { es } from 'date-fns/locale';
import { Icon } from '../../components/Icon';
import { WEEKDAYS, WEEKDAYS_SHORT, capitalize, toISO, todayISO, weekdayMon0 } from '../../lib/dates';

export function MiniCalendar({ value, onChange, min }: { value?: string; onChange: (d: string) => void; min?: string }) {
  const [month, setMonth] = useState(() => startOfMonth(parseISO(value ?? min ?? todayISO())));
  const today = todayISO();
  const first = toISO(month);
  const last = toISO(endOfMonth(month));
  const lead = weekdayMon0(first);
  const days: string[] = [];
  for (let d = 1; d <= Number(last.slice(8)); d++) days.push(`${first.slice(0, 8)}${String(d).padStart(2, '0')}`);
  const canPrev = !min || toISO(endOfMonth(addMonths(month, -1))) >= min;

  return (
    <div className="minical">
      <div className="minical__head">
        <button type="button" className="iconbtn" onClick={() => setMonth(addMonths(month, -1))} disabled={!canPrev} aria-label="Mes anterior">
          <Icon name="back" size={20} stroke={2.2} />
        </button>
        <h3 className="minical__title" aria-live="polite">{capitalize(format(month, 'MMMM yyyy', { locale: es }))}</h3>
        <button type="button" className="iconbtn" onClick={() => setMonth(addMonths(month, 1))} aria-label="Mes siguiente">
          <Icon name="chevron" size={20} stroke={2.2} />
        </button>
      </div>
      <div className="minical__grid">
        {WEEKDAYS_SHORT.map((w, i) => <span key={w} className="minical__dow" aria-label={WEEKDAYS[i]}>{w}</span>)}
        {Array.from({ length: lead }, (_, i) => <span key={`e${i}`} />)}
        {days.map((d) => {
          const disabled = !!min && d < min;
          return (
            <button key={d} type="button" className={`minical__day${d === today ? ' is-today' : ''}`} disabled={disabled}
              aria-pressed={d === value} aria-label={capitalize(format(parseISO(d), "EEEE d 'de' MMMM", { locale: es }))}
              onClick={() => onChange(d)}>
              {Number(d.slice(8))}
            </button>
          );
        })}
      </div>
    </div>
  );
}
