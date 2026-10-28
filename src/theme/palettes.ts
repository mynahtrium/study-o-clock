import { solarPosition, skyPhase, type SkyPhase } from '../sky/solar';

/**
 * Visual themes.
 *
 * Every palette is dark. This app is a desk clock meant to sit running for
 * hours, so a bright midday canvas is the wrong default: it glares, and it
 * fights the white-on-dark glass. Instead the identity is carried by hue and
 * warmth, never by lightness.
 */

export type ThemeMode = 'static' | 'dynamic';

export type StaticThemeName = 'obsidian' | 'ember' | 'moss' | 'plum' | 'slate';

export interface Palette {
  /** Gradient endpoints. */
  top: string;
  bottom: string;
  /** Base hue, used by the blurred background blobs. */
  hue: number;
  /** Accent for the focus ring, citations and active pips. */
  accent: string;
  /** 0 = lightest glass, 1 = darkest. */
  glassDarkness: number;
}

export interface ThemeSpec {
  name: StaticThemeName;
  label: string;
  /** Swatch colours shown in settings, derived from the palette itself. */
  palette: Palette;
}

function hsl(hue: number, s: number, l: number): string {
  return `hsl(${hue.toFixed(1)} ${s.toFixed(1)}% ${l.toFixed(1)}%)`;
}

/**
 * Five dark, warm-leaning palettes. None of them is blue: at 200 degrees the
 * sky reads cold and "app-like", which is exactly what this clock should avoid.
 */
export const STATIC_THEMES: ThemeSpec[] = [
  {
    name: 'obsidian',
    label: 'Obsidyen',
    palette: {
      top: hsl(240, 8, 13),
      bottom: hsl(240, 10, 6),
      hue: 240,
      accent: hsl(28, 45, 72),
      glassDarkness: 0.78,
    },
  },
  {
    name: 'ember',
    label: 'Kor',
    palette: {
      top: hsl(18, 22, 15),
      bottom: hsl(12, 26, 7),
      hue: 20,
      accent: hsl(24, 65, 62),
      glassDarkness: 0.76,
    },
  },
  {
    name: 'moss',
    label: 'Yosun',
    palette: {
      top: hsl(96, 14, 13),
      bottom: hsl(110, 16, 6),
      hue: 100,
      accent: hsl(92, 32, 62),
      glassDarkness: 0.78,
    },
  },
  {
    name: 'plum',
    label: 'Erik',
    palette: {
      top: hsl(285, 18, 14),
      bottom: hsl(292, 22, 7),
      hue: 288,
      accent: hsl(288, 40, 70),
      glassDarkness: 0.76,
    },
  },
  {
    name: 'slate',
    label: 'Kaya',
    palette: {
      top: hsl(214, 12, 15),
      bottom: hsl(220, 14, 7),
      hue: 216,
      accent: hsl(36, 38, 70),
      glassDarkness: 0.77,
    },
  },
];

export function staticPalette(name: StaticThemeName): Palette {
  const found = STATIC_THEMES.find((t) => t.name === name);
  return (found ?? STATIC_THEMES[0]!).palette;
}

/* ------------------------------------------------------------------ */
/* Dynamic mode                                                        */
/* ------------------------------------------------------------------ */

interface Stop {
  /** Solar elevation in degrees. Arrays must be ordered ascending. */
  at: number;
  hue: number;
  /** Saturation and lightness of the gradient top. */
  top: [number, number];
  bottom: [number, number];
  accentHue: number;
  glassDarkness: number;
}

/**
 * Dynamic mode is deliberately restrained: it is *dusk-only*. Colour appears at
 * dawn and dusk and nowhere else. Through the working day the palette collapses
 * to a neutral warm grey, so the clock never turns into a bright blue sky while
 * you are trying to study — the thing that made the original version unusable.
 *
 * Note the low saturations at high elevation. That is the point.
 */
const DAY_STOPS: Stop[] = [
  { at: -90, hue: 244, top: [10, 16], bottom: [5, 8], accentHue: 240, glassDarkness: 0.8 },
  { at: -18, hue: 248, top: [13, 17], bottom: [6, 9], accentHue: 242, glassDarkness: 0.79 },
  { at: -8, hue: 268, top: [18, 19], bottom: [8, 10], accentHue: 280, glassDarkness: 0.77 },
  { at: -3, hue: 296, top: [24, 21], bottom: [11, 12], accentHue: 300, glassDarkness: 0.74 },
  // Horizon: the only genuinely colourful moment.
  { at: 0, hue: 18, top: [34, 24], bottom: [15, 13], accentHue: 24, glassDarkness: 0.7 },
  { at: 4, hue: 34, top: [30, 24], bottom: [14, 13], accentHue: 32, glassDarkness: 0.68 },
  // Waste no time getting neutral: by 10 degrees the colour is mostly gone.
  { at: 10, hue: 30, top: [14, 20], bottom: [8, 12], accentHue: 32, glassDarkness: 0.71 },
  { at: 25, hue: 28, top: [9, 17], bottom: [6, 10], accentHue: 30, glassDarkness: 0.76 },
  { at: 50, hue: 26, top: [8, 16], bottom: [5, 9], accentHue: 30, glassDarkness: 0.78 },
  { at: 90, hue: 25, top: [8, 16], bottom: [5, 9], accentHue: 30, glassDarkness: 0.79 },
];

/** Evening warms faster than morning cools, so sunset keeps its own ladder. */
const SUNSET_STOPS: Stop[] = [
  { at: -90, hue: 244, top: [10, 16], bottom: [5, 8], accentHue: 240, glassDarkness: 0.8 },
  { at: -18, hue: 250, top: [14, 18], bottom: [6, 10], accentHue: 246, glassDarkness: 0.78 },
  { at: -8, hue: 286, top: [20, 20], bottom: [9, 11], accentHue: 292, glassDarkness: 0.76 },
  { at: -2, hue: 352, top: [26, 23], bottom: [12, 13], accentHue: 348, glassDarkness: 0.73 },
  { at: 2, hue: 14, top: [32, 25], bottom: [14, 14], accentHue: 20, glassDarkness: 0.7 },
  { at: 6, hue: 26, top: [28, 24], bottom: [13, 13], accentHue: 30, glassDarkness: 0.68 },
  { at: 12, hue: 26, top: [15, 20], bottom: [8, 11], accentHue: 30, glassDarkness: 0.72 },
  { at: 25, hue: 26, top: [9, 17], bottom: [6, 10], accentHue: 30, glassDarkness: 0.76 },
  { at: 50, hue: 26, top: [8, 16], bottom: [5, 9], accentHue: 30, glassDarkness: 0.78 },
  { at: 90, hue: 25, top: [8, 16], bottom: [5, 9], accentHue: 30, glassDarkness: 0.79 },
];

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Hue must take the short way around the wheel. A naive lerp from 296 degrees
 * (pre-dawn violet) to 18 (sunrise amber) sweeps backwards through 130 and
 * paints the sky green.
 */
function lerpHue(a: number, b: number, t: number): number {
  const delta = ((b - a + 540) % 360) - 180;
  return (a + delta * t + 360) % 360;
}

export interface DynamicTheme {
  phase: SkyPhase;
  elevation: number;
  palette: Palette;
}

function interpolate(stops: Stop[], elevation: number, phase: SkyPhase): DynamicTheme {
  const clamped = Math.max(-90, Math.min(90, elevation));

  let i = 0;
  while (i < stops.length - 2 && clamped > (stops[i + 1]?.at ?? 90)) i++;

  const a = stops[i] ?? stops[0]!;
  const b = stops[i + 1] ?? a;
  const span = b.at - a.at;
  const t = span === 0 ? 0 : Math.max(0, Math.min(1, (clamped - a.at) / span));

  const hue = lerpHue(a.hue, b.hue, t);

  // A wide hue sweep still passes through green internally. Desaturating the
  // midpoint keeps that invisible without needing a per-step colour model.
  const hueDelta = Math.abs(((b.hue - a.hue + 540) % 360) - 180);
  const washout = hueDelta > 90 ? Math.sin(Math.PI * t) * 0.75 : 0;
  const sat = (x: number, y: number): number => Math.max(3, lerp(x, y, t) * (1 - washout));

  return {
    phase,
    elevation,
    palette: {
      top: hsl(hue, sat(a.top[0], b.top[0]), lerp(a.top[1], b.top[1], t)),
      bottom: hsl((hue + 10) % 360, sat(a.bottom[0], b.bottom[0]), lerp(a.bottom[1], b.bottom[1], t)),
      hue,
      accent: hsl(lerpHue(a.accentHue, b.accentHue, t), 42, 62),
      glassDarkness: lerp(a.glassDarkness, b.glassDarkness, t),
    },
  };
}

export function dynamicTheme(date: Date, latitude: number, longitude: number): DynamicTheme {
  const { elevation, azimuth } = solarPosition(date, latitude, longitude);
  const phase = skyPhase(elevation, azimuth);
  return interpolate(phase === 'dusk' ? SUNSET_STOPS : DAY_STOPS, elevation, phase);
}

/* ------------------------------------------------------------------ */
/* Application                                                         */
/* ------------------------------------------------------------------ */

export function applyPalette(root: HTMLElement, palette: Palette, phase?: SkyPhase): void {
  root.style.setProperty('--sky-top', palette.top);
  root.style.setProperty('--sky-bottom', palette.bottom);
  root.style.setProperty('--sky-hue', palette.hue.toFixed(1));
  root.style.setProperty('--accent', palette.accent);
  root.style.setProperty('--glass-darkness', palette.glassDarkness.toFixed(3));
  root.dataset.sky = phase ?? 'static';
}
