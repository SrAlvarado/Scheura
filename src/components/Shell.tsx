// Estructura común: cabecera de escritorio (≥900px) + barra de pestañas flotante iOS + botón + (móvil).
import { Suspense, useEffect, useRef } from 'react';
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

const tabIndex = (p: string) => (p === '/' ? 0 : TOP_LEVEL.findIndex((t, i) => i > 0 && p.startsWith(t)));

// Precarga de las pantallas para que el cambio sea instantáneo (sin hueco en blanco).
const PRELOAD = [
  () => import('../features/home/Hoy'),
  () => import('../features/calendar/Calendario'),
  () => import('../features/study/Estudio'),
  () => import('../features/summary/Resumen'),
  () => import('../features/tasks/TaskForm'),
  () => import('../features/tasks/TaskDetail'),
  () => import('../features/events/EventForm'),
  () => import('../features/events/EventDetail'),
  () => import('../features/calendar/Dia'),
  () => import('../features/study/ExamDetail'),
  () => import('../features/study/WorkDetail'),
  () => import('../features/settings/Ajustes'),
];

export function Shell() {
  const { pathname } = useLocation();
  // Dirección de la animación: entre pestañas se desliza hacia el lado de la pestaña; pantallas empujadas suben.
  const prev = useRef(pathname);
  const from = tabIndex(prev.current);
  const to = tabIndex(pathname);
  const anim = prev.current === pathname ? '' : from >= 0 && to >= 0 ? (to > from ? 'route--right' : 'route--left') : to >= 0 ? 'route--left' : 'route--push';
  useEffect(() => { prev.current = pathname; }, [pathname]);
  useEffect(() => {
    const run = () => PRELOAD.forEach((f) => f().catch(() => undefined));
    const w = window as Window & { requestIdleCallback?: (cb: () => void) => number };
    if (w.requestIdleCallback) w.requestIdleCallback(run); else setTimeout(run, 1200);
  }, []);
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

      <Suspense fallback={null}>
        <div key={pathname} className={`route ${anim}`}>
          <Outlet />
        </div>
      </Suspense>

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
