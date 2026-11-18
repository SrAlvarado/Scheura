import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { db, updateSettings } from '../../db/db';
import { loadDemoData } from '../../db/seed';
import { notificationPermission, requestNotificationPermission } from '../../lib/notifications';
import { Segmented } from '../../components/ui';
import LoginForm from './LoginForm';
import { Icon } from '../../components/Icon';
import './settings.css';

type Platform = 'ios' | 'android';
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
const isIOS = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && typeof document !== 'undefined' && 'ontouchend' in document);
const isStandalone = () =>
  (typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches) ||
  (typeof navigator !== 'undefined' && (navigator as Navigator & { standalone?: boolean }).standalone === true);

const STEPS: Record<Platform, { pre: string; strong: string; post?: string; icon: string }[]> = {
  ios: [
    { pre: 'Abre esta página en ', strong: 'Safari', icon: 'search' },
    { pre: 'Toca el ', strong: 'botón Compartir', post: ' de la barra inferior', icon: 'share' },
    { pre: 'Elige ', strong: '«Añadir a pantalla de inicio»', icon: 'plus' },
  ],
  android: [
    { pre: 'Abre esta página en ', strong: 'Chrome', icon: 'search' },
    { pre: 'Toca el ', strong: 'menú ⋮', post: ' arriba a la derecha', icon: 'more' },
    { pre: 'Elige ', strong: '«Instalar app»', post: ' o «Añadir a pantalla de inicio»', icon: 'download' },
  ],
};

export default function Bienvenida() {
  const nav = useNavigate();
  const [step, setStep] = useState(1);
  const [platform, setPlatform] = useState<Platform>(isIOS ? 'ios' : 'android');
  const [installed, setInstalled] = useState(isStandalone);
  // main.tsx guarda el evento si llega antes de que esta pantalla se monte
  const [installEvt, setInstallEvt] = useState<BeforeInstallPromptEvent | null>(
    () => ((window as unknown as { __installPrompt?: BeforeInstallPromptEvent }).__installPrompt ?? null),
  );
  const [perm, setPerm] = useState(notificationPermission);
  const [askingPerm, setAskingPerm] = useState(false);
  const [demo, setDemo] = useState(false);
  const [hasData, setHasData] = useState(true);
  const [finishing, setFinishing] = useState(false);
  const [account, setAccount] = useState<string | undefined>();

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallEvt(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => { setInstalled(true); setInstallEvt(null); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    db.subjects.count().then((n) => setHasData(n > 0)).catch(() => undefined);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const install = async () => {
    if (!installEvt) return;
    await installEvt.prompt();
    const choice = await installEvt.userChoice;
    if (choice.outcome === 'accepted') setInstalled(true);
    setInstallEvt(null);
  };

  const allow = async () => {
    setAskingPerm(true);
    try { setPerm(await requestNotificationPermission()); } finally { setAskingPerm(false); }
  };

  const finish = async (withDemo: boolean) => {
    setFinishing(true);
    try {
      if (withDemo) await loadDemoData();
      await updateSettings({ onboarded: true });
    } finally {
      nav('/', { replace: true });
    }
  };

  let body: ReactNode;
  if (step === 1) {
    body = (
      <div className="welcome__hero">
        <h1 className="welcome__mark">scheura<span>.</span></h1>
        <p className="welcome__value">Tus clases, exámenes y entregas, en un solo sitio.</p>
        <ul className="welcome__features">
          <li>Tu día de un vistazo, con lo urgente primero.</li>
          <li>Cuánto llevas preparado cada examen.</li>
          <li>Entra con tu usuario y tenlo en todos tus dispositivos.</li>
        </ul>
      </div>
    );
  } else if (step === 2) {
    body = (
      <div className="welcome__step">
        <h1 className="welcome__h">Añádela a tu pantalla de inicio</h1>
        {installed ? (
          <div className="welcome__installed" role="status">
            <span className="welcome__stepicon"><Icon name="check" size={22} stroke={2.4} /></span>
            <span>Ya está instalada. Scheura se abre como una app desde tu pantalla de inicio.</span>
          </div>
        ) : (
          <>
            <p className="welcome__p">Así se abre como una app, a pantalla completa, y puede enviarte avisos.</p>
            <Segmented
              label="Tu teléfono"
              value={platform}
              onChange={setPlatform}
              options={[{ value: 'ios', label: 'iPhone' }, { value: 'android', label: 'Android' }]}
            />
            {platform === 'android' && installEvt && (
              <button type="button" className="btn btn--primary btn--block" onClick={install}>
                <Icon name="download" size={20} /> Instalar
              </button>
            )}
            <ol className="welcome__steps">
              {STEPS[platform].map((s, i) => (
                <li key={i}>
                  <span className="welcome__n">{i + 1}</span>
                  <span>{s.pre}<strong>{s.strong}</strong>{s.post}</span>
                  <span className="welcome__stepicon" aria-hidden="true"><Icon name={s.icon} size={22} /></span>
                </li>
              ))}
            </ol>
            <p className="welcome__note">
              {platform === 'ios'
                ? 'En iPhone tiene que ser desde Safari. Los avisos solo funcionan con la app añadida a la pantalla de inicio (iOS 16.4 o posterior).'
                : 'Si no ves «Instalar app», busca «Añadir a pantalla de inicio» en el mismo menú.'}
            </p>
          </>
        )}
      </div>
    );
  } else if (step === 3) {
    body = (
      <div className="welcome__step">
        <h1 className="welcome__h">{account ? 'Sesión iniciada' : 'Tu cuenta'}</h1>
        {account ? (
          <div className="welcome__installed" role="status">
            <span className="welcome__stepicon"><Icon name="check" size={22} stroke={2.4} /></span>
            <span>Has entrado como <strong>{account}</strong>. Tus datos se sincronizan entre tus dispositivos.</span>
          </div>
        ) : (
          <>
            <p className="welcome__p">Entra con tu usuario para tener tu agenda en el móvil y en el ordenador. Si es tu primera vez, inventa uno.</p>
            <LoginForm submitLabel="Entrar" onDone={({ user }) => { setAccount(user); setHasData(true); setStep(4); }} />
            <p className="welcome__note">También puedes usar Scheura sin cuenta y entrar más tarde desde Ajustes › Sincronizar dispositivos.</p>
          </>
        )}
      </div>
    );
  } else {
    const granted = perm === 'granted';
    body = (
      <div className="welcome__step">
        <h1 className="welcome__h">Activa los avisos</h1>
        <p className="welcome__p">
          Te avisamos antes de cada examen y entrega: 3 días antes, el día anterior a las 20:00 y 1 h antes. Puedes cambiarlo cuando quieras en Ajustes.
        </p>
        <div className="welcome__notif" aria-hidden="true">
          <span className="welcome__app">s<span>.</span></span>
          <div className="welcome__notif-body">
            <strong>Examen mañana</strong>
            <span className="muted">Repasa los temas que te quedan. Lo tienes a las 10:00.</span>
          </div>
        </div>
        <div className="stack" style={{ gap: 8 }}>
          <button
            type="button"
            className="btn btn--block welcome__allow"
            aria-pressed={granted}
            disabled={askingPerm || perm === 'unsupported' || perm === 'denied' || granted}
            onClick={allow}
            style={granted ? { opacity: 1 } : undefined}
          >
            {granted && <Icon name="check" size={20} stroke={2.4} />}
            {granted ? 'Avisos activados' : perm === 'denied' ? 'Avisos bloqueados' : perm === 'unsupported' ? 'Avisos no disponibles' : askingPerm ? 'Esperando…' : 'Activar avisos'}
          </button>
          {perm === 'denied' && <p className="welcome__note" style={{ textAlign: 'center' }}>Los has bloqueado. Puedes permitirlos en los ajustes del navegador.</p>}
          {perm === 'unsupported' && (
            <p className="welcome__note" style={{ textAlign: 'center' }}>
              {isIOS && !installed ? 'En iPhone, primero añade Scheura a la pantalla de inicio y ábrela desde allí.' : 'Este navegador no permite avisos.'}
            </p>
          )}
          {isIOS && perm !== 'unsupported' && !installed && (
            <p className="welcome__note" style={{ textAlign: 'center' }}>En iPhone, los avisos solo llegan si abres Scheura desde la pantalla de inicio.</p>
          )}
        </div>
        {!hasData && (
          <label className="welcome__demo">
            <input type="checkbox" checked={demo} onChange={(e) => setDemo(e.target.checked)} />
            <span>Empezar con datos de ejemplo</span>
          </label>
        )}
      </div>
    );
  }

  return (
    <div className="welcome">
      <div className="welcome__top">
        <span className="eyebrow">Paso {step} de 4</span>
        {step < 4 && (
          <button type="button" className="welcome__skip" onClick={() => finish(false)} disabled={finishing}>Saltar</button>
        )}
      </div>
      <main className="welcome__main">{body}</main>
      <footer className="welcome__foot">
        <div className="welcome__dots" role="progressbar" aria-label="Progreso de la bienvenida" aria-valuemin={1} aria-valuemax={4} aria-valuenow={step}>
          {[1, 2, 3, 4].map((n) => <span key={n} data-on={n === step} />)}
        </div>
        <div className="welcome__btns">
          {step > 1 && <button type="button" className="btn" onClick={() => setStep(step - 1)}>Atrás</button>}
          {step < 4 ? (
            <button type="button" className="btn btn--primary" onClick={() => setStep(step + 1)}>{step === 3 && !account ? 'Ahora no' : 'Siguiente'}</button>
          ) : (
            <button type="button" className="btn btn--primary" onClick={() => finish(demo)} disabled={finishing}>
              {finishing ? 'Preparando…' : 'Empezar'}
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}
