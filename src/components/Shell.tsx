// Estructura común: cabecera de escritorio (≥900px) + barra de pestañas flotante iOS + botón + (móvil).
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { Icon } from './Icon';

const TABS = [
  { to: '/', label: 'Hoy', icon: 'today' },
  { to: '/calendario', label: 'Calendario', icon: 'calendar' },
  { to: '/estudio', label: 'Estudio', icon: 'book' },
  { to: '/resumen', label: 'Resumen', icon: 'chart' },
];

/** Rutas de nivel superior: muestran la barra de pestañas en móvil. */
const TOP_LEVEL = ['/', '/calendario', '/estudio', '/resumen'];

export function Shell() {
  const { pathname } = useLocation();
  const showTabs = TOP_LEVEL.includes(pathname);
  const active = (to: string) => (to === '/' ? pathname === '/' : pathname.startsWith(to));

  return (
    <div className="app">
      <header className="dheader">
        <Link to="/" className="dheader__logo">scheura<span style={{ color: 'var(--pink)' }}>.</span></Link>
        <nav aria-label="Secciones">
          {TABS.map((t) => (
            <NavLink key={t.to} to={t.to} aria-current={active(t.to) ? 'page' : undefined}>{t.label}</NavLink>
          ))}
        </nav>
        <Link to="/ajustes" className="iconbtn" aria-label="Ajustes"><Icon name="gear" /></Link>
        <Link to="/tarea/nueva" className="btn btn--primary btn--sm">+ Nueva</Link>
      </header>

      <Outlet />

      {showTabs && (
        <>
          <nav className="tabbar glass" aria-label="Secciones">
            {TABS.map((t) => (
              <Link key={t.to} to={t.to} className="tab" aria-current={active(t.to) ? 'page' : undefined}>
                <Icon name={t.icon} size={24} />
                <span>{t.label}</span>
              </Link>
            ))}
          </nav>
          <Link to="/tarea/nueva" className="fab glass" aria-label="Nueva tarea"><Icon name="plus" size={26} stroke={2.2} /></Link>
        </>
      )}
    </div>
  );
}
