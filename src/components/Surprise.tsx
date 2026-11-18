// Sorpresa temporal: ramo de tulipanes rosas + corazones subiendo + frase, al iniciar sesión.
// Se muestra una vez por dispositivo y solo hasta SURPRISE.until. Para quitarla: borrar este archivo,
// su CSS, el <Surprise /> de App.tsx y la línea `queueSurprise()` de LoginForm.tsx.
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo } from 'react';
import { db, getMeta, setMeta } from '../db/db';
import './surprise.css';

export const SURPRISE = {
  until: new Date('2026-11-19T23:59:59').getTime(),
  phrase: 'Que nunca te falten tulipanes, ni tiempo para lo que te hace feliz.',
  signature: '— M.',
};

/** Llamar tras un inicio de sesión correcto. */
export async function queueSurprise() {
  if (Date.now() > SURPRISE.until) return;
  if (await getMeta<boolean>('surprise.shown')) return;
  await setMeta('surprise.pending', true);
}

const PINKS = ['#F8BBD0', '#F48FB1', '#F06292', '#EC407A', '#D81B60'];

/** Tulipán: cabeza centrada en (0,0); el tallo baja hasta (bx,by) relativo. */
function Tulip({ x, y, rot, color, dark, light, bx, by, delay }: { x: number; y: number; rot: number; color: string; dark: string; light: string; bx: number; by: number; delay: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <path d={`M0 6 Q ${bx * 0.35} ${by * 0.5} ${bx} ${by}`} stroke="#5E9F6B" strokeWidth="4" fill="none" strokeLinecap="round" />
      <g className="sp-head" style={{ animationDelay: `${delay}s` }} transform={`rotate(${rot})`}>
        <path d="M-17 -6 C-19 -18 -18 -28 -16 -34 L-8 -24 L0 -40 L8 -24 L16 -34 C18 -28 19 -18 17 -6 C15 10 -15 10 -17 -6 Z" fill={color} />
        <path d="M-17 -6 C-19 -18 -18 -28 -16 -34 L-8 -24 C-11 -14 -10 -2 -4 7 C-11 6 -16 2 -17 -6 Z" fill={dark} />
        <path d="M0 -40 C6 -30 7 -12 2 7 C-1 7 -3 7 -4 7 C-8 -10 -6 -30 0 -40 Z" fill={light} opacity=".9" />
      </g>
    </g>
  );
}

function Bouquet() {
  // cabezas de tulipán: posición, giro, tono
  const heads = [
    { x: 150, y: 70, rot: 0, c: 2 },
    { x: 108, y: 92, rot: -14, c: 1 },
    { x: 192, y: 92, rot: 14, c: 3 },
    { x: 72, y: 128, rot: -24, c: 3 },
    { x: 228, y: 128, rot: 24, c: 1 },
    { x: 128, y: 128, rot: -6, c: 0 },
    { x: 172, y: 130, rot: 8, c: 2 },
  ];
  return (
    <svg className="sp-bouquet" viewBox="0 0 300 380" role="img" aria-label="Ramo de tulipanes rosas">
      {/* hojas */}
      <path d="M150 250 C100 220 80 170 92 150 C115 180 135 210 150 250 Z" fill="#7CB987" />
      <path d="M150 250 C200 220 220 170 208 150 C185 180 165 210 150 250 Z" fill="#6AAE77" />
      <path d="M150 255 C120 200 128 160 140 150 C148 190 152 220 150 255 Z" fill="#8CC497" />
      {heads.map((h, i) => (
        <Tulip key={i} x={h.x} y={h.y} rot={h.rot} color={PINKS[h.c + 1] ?? PINKS[2]} dark={PINKS[Math.min(h.c + 2, 4)]} light={PINKS[h.c]}
          bx={150 - h.x} by={262 - h.y} delay={i * 0.35} />
      ))}
      {/* papel */}
      <path d="M70 232 L230 232 L172 362 L128 362 Z" fill="#FFF4F7" stroke="#F8BBD0" strokeWidth="2" strokeLinejoin="round" />
      <path d="M70 232 L118 232 L140 362 L128 362 Z" fill="#FDE7EF" />
      <path d="M230 232 L182 232 L160 362 L172 362 Z" fill="#FDE7EF" />
      {/* lazo */}
      <path d="M150 300 C125 282 108 292 116 306 C122 316 140 308 150 300 Z" fill="#D81B60" />
      <path d="M150 300 C175 282 192 292 184 306 C178 316 160 308 150 300 Z" fill="#D81B60" />
      <path d="M146 302 L134 336 L142 334 L148 342 L150 304 Z" fill="#C2185B" />
      <path d="M154 302 L166 336 L158 334 L152 342 L150 304 Z" fill="#C2185B" />
      <circle cx="150" cy="301" r="7" fill="#AD1457" />
    </svg>
  );
}

function Heart({ style }: { style: React.CSSProperties }) {
  return (
    <svg className="sp-heart" style={style} viewBox="0 0 24 22" aria-hidden="true">
      <path d="M12 21s-8.5-5.4-10.6-10.3C-.3 6.8 2.3 2 6.6 2c2.4 0 4 1.3 5.4 3.2C13.4 3.3 15 2 17.4 2c4.3 0 6.9 4.8 5.2 8.7C20.5 15.6 12 21 12 21z" />
    </svg>
  );
}

export default function Surprise() {
  const pending = useLiveQuery(async () => (await db.meta.get('surprise.pending'))?.value === true, []);
  const show = !!pending && Date.now() <= SURPRISE.until;

  const hearts = useMemo(
    () => Array.from({ length: 26 }, (_, i) => ({
      left: `${(i * 37) % 100}%`,
      width: `${14 + ((i * 7) % 22)}px`,
      animationDelay: `${(i * 0.45) % 7}s`,
      animationDuration: `${6 + ((i * 13) % 50) / 10}s`,
      color: PINKS[i % PINKS.length],
      ['--sway' as string]: `${((i % 5) - 2) * 18}px`,
    })),
    [],
  );

  useEffect(() => {
    if (!show) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [show]);

  if (!show) return null;
  return (
    <div className="sp" role="dialog" aria-modal="true" aria-label="Una sorpresa">
      <div className="sp-hearts" aria-hidden="true">
        {hearts.map((h, i) => <Heart key={i} style={h} />)}
      </div>
      <div className="sp-card">
        <Bouquet />
        <p className="sp-phrase">{SURPRISE.phrase}</p>
        {SURPRISE.signature && <p className="sp-sign">{SURPRISE.signature}</p>}
        <button className="btn btn--primary sp-btn" onClick={close}>Abrir mi agenda</button>
      </div>
    </div>
  );
}

async function close() {
  await setMeta('surprise.shown', true);
  await setMeta('surprise.pending', false);
}
