import type { ColorKey } from '../db/types';

/** Colores suaves por asignatura: bg = fondo del chip, fg = texto (≥4.5:1 sobre bg), dot = punto. */
export const SUBJECT_COLORS: Record<ColorKey, { name: string; bg: string; fg: string; dot: string }> = {
  azul: { name: 'Azul', bg: '#EEF3FB', fg: '#2F5DA8', dot: '#7BA4E0' },
  ambar: { name: 'Ámbar', bg: '#FDF3E3', fg: '#8A5A00', dot: '#E8B04A' },
  verde: { name: 'Verde', bg: '#E9F6EF', fg: '#1F7A4A', dot: '#5CC08A' },
  lila: { name: 'Lila', bg: '#F3EFFB', fg: '#5B3FA8', dot: '#A58BE0' },
  rosa: { name: 'Rosa', bg: '#FCEEF3', fg: '#A3164C', dot: '#F08DB0' },
  turquesa: { name: 'Turquesa', bg: '#E6F6F6', fg: '#16706F', dot: '#4FC1BF' },
  teja: { name: 'Teja', bg: '#FBEDE7', fg: '#9A3F1C', dot: '#E58B66' },
  grafito: { name: 'Grafito', bg: '#F0F0F0', fg: '#424242', dot: '#9E9E9E' },
};
export const COLOR_KEYS = Object.keys(SUBJECT_COLORS) as ColorKey[];
