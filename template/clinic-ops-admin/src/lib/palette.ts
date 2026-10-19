/**
 * Colour themes ("theme changer"). A palette is three user-facing colours:
 *   accent  — buttons, links, selected tabs/rows, focus ring
 *   sidebar — the context-sidebar surface (light mode; dark mode uses a faint tint of it)
 *   rail    — the dark/light icon rail on the far left
 * Everything else (hover, subtle tints, readable text on the accent, rail icon colours) is derived,
 * and text colours are pushed until they meet WCAG AA contrast (4.5:1).
 */
export interface Palette {
  id: string;
  name: string;
  accent: string;
  sidebar: string;
  rail: string;
  custom?: boolean;
}

/** The default reproduces the original Soft Enterprise look exactly (no overrides are applied). */
export const DEFAULT_PALETTE_ID = 'violet';

export const PRESET_PALETTES: Palette[] = [
  { id: 'violet', name: 'Soft violet', accent: '#5b47c7', sidebar: '#f8f8f9', rail: '#24252d' },
  { id: 'ocean', name: 'Ocean', accent: '#1f5fd6', sidebar: '#f5f8fc', rail: '#1c2535' },
  { id: 'emerald', name: 'Emerald', accent: '#047857', sidebar: '#f4f9f7', rail: '#17231e' },
  { id: 'sunset', name: 'Sunset', accent: '#c2410c', sidebar: '#fbf7f4', rail: '#2a211d' },
  { id: 'rose', name: 'Rose', accent: '#be185d', sidebar: '#fcf6f8', rail: '#2a1e25' },
  { id: 'graphite', name: 'Graphite', accent: '#3f3f46', sidebar: '#f6f6f7', rail: '#15161a' },
  { id: 'daylight', name: 'Daylight', accent: '#5b47c7', sidebar: '#fafafb', rail: '#ececf1' },
];

const HEX = /^#([0-9a-f]{6})$/i;
export const isHex = (v: string) => HEX.test(v.trim());

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const toHex = (c: number[]) => `#${c.map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('')}`;

/** Mix `a` towards `b` by t (0–1). */
export function mix(a: string, b: string, t: number) {
  const A = rgb(a);
  const B = rgb(b);
  return toHex(A.map((x, i) => x + (B[i] - x) * t));
}

export function luminance(hex: string) {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

/** Move `fg` towards `toward` until it reaches `min` contrast against `bg`. */
function ensureContrast(fg: string, bg: string, toward: string, min = 4.5) {
  let c = fg;
  for (let i = 0; i < 20 && contrast(c, bg) < min; i++) c = mix(c, toward, 0.1);
  return c;
}

const LIGHT_SURFACE = '#ffffff';
const DARK_SURFACE = '#1c1c23';

export interface DerivedPalette {
  accent: string;
  accentHover: string;
  onAccent: string;
  accentTextLight: string;
  accentTextDark: string;
  sidebar: string;
  rail: string;
  railIcon: string;
  railHover: string;
  railSelectedBg: string;
  railSelectedIcon: string;
  /** Contrast of the text on a primary button (accent background) — shown in the editor. */
  buttonContrast: number;
}

export function derivePalette(p: Palette): DerivedPalette {
  const accent = p.accent.toLowerCase();
  const onAccent = contrast('#ffffff', accent) >= 4.5 ? '#ffffff' : '#111114';
  const railLight = luminance(p.rail) > 0.4;
  const accentTextLight = ensureContrast(accent, LIGHT_SURFACE, '#000000');
  return {
    accent,
    accentHover: mix(accent, '#000000', 0.12),
    onAccent,
    accentTextLight,
    accentTextDark: ensureContrast(mix(accent, '#ffffff', 0.35), DARK_SURFACE, '#ffffff'),
    sidebar: p.sidebar,
    rail: p.rail,
    railIcon: ensureContrast(railLight ? mix(p.rail, '#000000', 0.55) : mix(p.rail, '#ffffff', 0.6), p.rail, railLight ? '#000000' : '#ffffff', 4.5),
    railHover: railLight ? mix(p.rail, '#000000', 0.06) : mix(p.rail, '#ffffff', 0.08),
    railSelectedBg: mix(p.rail, accent, railLight ? 0.22 : 0.35),
    railSelectedIcon: railLight ? accentTextLight : ensureContrast(mix(accent, '#ffffff', 0.6), mix(p.rail, accent, 0.35), '#ffffff', 4.5),
    buttonContrast: contrast(onAccent, accent),
  };
}

const VARS: Record<keyof Omit<DerivedPalette, 'buttonContrast'>, string> = {
  accent: '--pal-accent',
  accentHover: '--pal-accent-hover',
  onAccent: '--pal-on-accent',
  accentTextLight: '--pal-accent-text-light',
  accentTextDark: '--pal-accent-text-dark',
  sidebar: '--pal-sidebar',
  rail: '--pal-rail',
  railIcon: '--pal-rail-icon',
  railHover: '--pal-rail-hover',
  railSelectedBg: '--pal-rail-selected-bg',
  railSelectedIcon: '--pal-rail-selected-icon',
};

/** Apply a palette to the document (the default palette removes all overrides). */
export function applyPalette(p: Palette | undefined, root: HTMLElement = document.documentElement) {
  if (!p || p.id === DEFAULT_PALETTE_ID) {
    root.removeAttribute('data-palette');
    Object.values(VARS).forEach((v) => root.style.removeProperty(v));
    return;
  }
  const d = derivePalette(p);
  root.setAttribute('data-palette', p.id);
  (Object.keys(VARS) as (keyof typeof VARS)[]).forEach((k) => root.style.setProperty(VARS[k], d[k]));
}

export function findPalette(id: string, custom: Palette[]): Palette {
  return [...PRESET_PALETTES, ...custom].find((p) => p.id === id) ?? PRESET_PALETTES[0];
}
