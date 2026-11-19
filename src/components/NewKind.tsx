// Selector «Tarea · Evento · Examen» arriba de los formularios de creación.
import { useNavigate } from 'react-router-dom';
import { Segmented } from './ui';

export type NewKind = 'tarea' | 'evento' | 'examen';

export function NewKindSwitch({ current, date, title }: { current: NewKind; date?: string; title?: string }) {
  const nav = useNavigate();
  const go = (k: NewKind) => {
    if (k === current) return;
    const q = new URLSearchParams();
    if (date) q.set('fecha', date);
    if (title?.trim()) q.set('titulo', title.trim());
    const qs = q.toString() ? `?${q}` : '';
    nav(k === 'tarea' ? `/tarea/nueva${qs}` : k === 'evento' ? `/evento/nuevo${qs}` : `/examen/nuevo${qs}`, { replace: true });
  };
  return (
    <div className="newkind">
      <Segmented label="Qué quieres añadir" value={current} onChange={go}
        options={[{ value: 'tarea', label: 'Tarea' }, { value: 'evento', label: 'Evento' }, { value: 'examen', label: 'Examen' }]} />
    </div>
  );
}
