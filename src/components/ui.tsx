// Componentes de interfaz compartidos. Importar desde '../../components/ui'.
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Icon } from './Icon';
import { SUBJECT_COLORS } from '../lib/colors';
import type { Subject } from '../db/types';

/** Cabecera grande de pantallas principales: fecha/eyebrow + título 44px + acción derecha opcional. */
export function LargeHeader({ eyebrow, title, right, aside }: { eyebrow?: ReactNode; title: ReactNode; right?: ReactNode; aside?: ReactNode }) {
  return (
    <header className="large-header">
      <div className="large-header__top">
        <span className="eyebrow">{eyebrow}</span>
        <div className="row" style={{ gap: 0, marginRight: -10 }}>{right}</div>
      </div>
      <div className="row" style={{ alignItems: 'baseline', justifyContent: 'space-between' }}>
        <h1 className="large-title">{title}</h1>
        {aside}
      </div>
    </header>
  );
}

/** Barra superior iOS para pantallas empujadas. `back` = texto del botón atrás (usa history.back o `backTo`). */
export function NavBar({ title, back, backTo, right }: { title?: ReactNode; back?: string; backTo?: string; right?: ReactNode }) {
  const nav = useNavigate();
  const goBack = () => (backTo ? nav(backTo) : window.history.length > 1 ? nav(-1) : nav('/'));
  return (
    <div className="navbar">
      <div className="navbar__left">
        {back !== undefined && (
          <button className="navbtn" onClick={goBack} aria-label={`Volver a ${back}`}>
            <Icon name="back" size={22} stroke={2.2} />
            {back}
          </button>
        )}
      </div>
      <div className="navbar__title">{title}</div>
      <div className="navbar__right">{right}</div>
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Chip({ pressed, onClick, children, pink }: { pressed?: boolean; onClick?: () => void; children: ReactNode; pink?: boolean }) {
  return (
    <button type="button" className={`chip${pink ? ' chip--pink' : ''}`} aria-pressed={!!pressed} onClick={onClick}>
      {children}
    </button>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="switch">
      <input type="checkbox" role="switch" checked={checked} aria-label={label} onChange={(e) => onChange(e.target.checked)} />
      <span />
    </label>
  );
}

export function Progress({ value, thick, label }: { value: number; thick?: boolean; label?: string }) {
  return (
    <div className={`progress${thick ? ' progress--thick' : ''}`} role="progressbar" aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)} aria-label={label}>
      <div style={{ width: `${Math.round(value * 100)}%` }} />
    </div>
  );
}

export function SubjectChip({ subject }: { subject?: Subject }) {
  if (!subject) return null;
  const c = SUBJECT_COLORS[subject.color];
  return <span className="subject-chip" style={{ background: c.bg, color: c.fg }}>{subject.name}</span>;
}

export function SubjectDot({ subject, size = 8 }: { subject?: Subject; size?: number }) {
  const color = subject ? SUBJECT_COLORS[subject.color].dot : '#bdbdbd';
  return <span className="dot" style={{ background: color, width: size, height: size }} aria-hidden="true" />;
}

/** Hoja inferior (en ordenador se muestra como diálogo centrado). */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
        <div className="sheet__grabber" />
        {title && <h2 className="sheet__title">{title}</h2>}
        {children}
      </div>
    </>
  );
}

/** Toast con acción opcional (p. ej. Deshacer). Se oculta a los 5 s. */
export function useToast() {
  const [toast, setToast] = useState<{ text: string; action?: { label: string; run: () => void } } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);
  const node = toast ? (
    <div className="toast" role="status">
      <span>{toast.text}</span>
      {toast.action && (
        <button onClick={() => { toast.action!.run(); setToast(null); }}>{toast.action.label}</button>
      )}
    </div>
  ) : null;
  return { show: setToast, node };
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

/** Fila de grupo tipo Ajustes que navega. */
export function CellLink({ to, label, value }: { to: string; label: ReactNode; value?: ReactNode }) {
  return (
    <Link to={to} className="cell">
      <span className="cell__label">{label}</span>
      {value !== undefined && <span className="cell__value">{value}</span>}
      <Icon name="chevron" size={16} stroke={2} />
    </Link>
  );
}

/** Confirmación tipo hoja de acciones de iOS. */
export function ConfirmSheet({ open, onClose, title, message, confirmLabel, onConfirm }: { open: boolean; onClose: () => void; title: string; message?: string; confirmLabel: string; onConfirm: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      {message && <p className="muted small" style={{ marginTop: 0 }}>{message}</p>}
      <div className="stack">
        <button className="btn btn--block" style={{ color: 'var(--danger)', borderColor: 'var(--line)' }} onClick={() => { onConfirm(); onClose(); }}>{confirmLabel}</button>
        <button className="btn btn--block btn--ghost" onClick={onClose}>Cancelar</button>
      </div>
    </Sheet>
  );
}
