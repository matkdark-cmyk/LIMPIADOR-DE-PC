/**
 * Motor de armonización de color de énfasis de Windows (Fluent Design).
 * Lee el color de énfasis real de Windows (#RRGGBB) y genera una escala accesible
 * que actualiza dinámicamente las variables CSS de la aplicación en modo Claro y Oscuro.
 */

export const DEFAULT_WINDOWS_ACCENT = '#0067C0';

interface HslColor {
  h: number;
  s: number;
  l: number;
}

function clamp(val: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, val));
}

function parseHexColor(hex: string): { r: number; g: number; b: number } | null {
  const cleaned = hex.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(cleaned)) {
    return null;
  }
  return {
    r: Number.parseInt(cleaned.slice(0, 2), 16),
    g: Number.parseInt(cleaned.slice(2, 4), 16),
    b: Number.parseInt(cleaned.slice(4, 6), 16),
  };
}

function rgbToHsl(r: number, g: number, b: number): HslColor {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn:
        h = (gn - bn) / d + (gn < bn ? 6 : 0);
        break;
      case gn:
        h = (bn - rn) / d + 2;
        break;
      default:
        h = (rn - gn) / d + 4;
        break;
    }
    h *= 60;
  }

  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function hslToHex(h: number, s: number, l: number): string {
  const sn = clamp(s, 0, 100) / 100;
  const ln = clamp(l, 0, 100) / 100;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = ln - c / 2;

  let r = 0;
  let g = 0;
  let b = 0;
  const hNorm = ((h % 360) + 360) % 360;

  if (hNorm < 60) {
    r = c;
    g = x;
  } else if (hNorm < 120) {
    r = x;
    g = c;
  } else if (hNorm < 180) {
    g = c;
    b = x;
  } else if (hNorm < 240) {
    g = x;
    b = c;
  } else if (hNorm < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }

  const toHex = (channel: number) =>
    Math.round((channel + m) * 255)
      .toString(16)
      .padStart(2, '0');

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Normaliza un color hex y aplica toda la escala de énfasis de Windows al DOM
 * manteniendo contraste WCAG AA tanto en tema Claro como en tema Oscuro.
 */
export function applyWindowsAccentToDocument(accentHex?: string | null): string {
  const parsed = parseHexColor(accentHex ?? '') ?? parseHexColor(DEFAULT_WINDOWS_ACCENT)!;
  const normalizedHex =
    parseHexColor(accentHex ?? '') !== null
      ? `#${(accentHex ?? '').trim().replace(/^#/, '').toUpperCase()}`
      : DEFAULT_WINDOWS_ACCENT;

  if (typeof document === 'undefined') {
    return normalizedHex;
  }

  const { h, s, l } = rgbToHsl(parsed.r, parsed.g, parsed.b);
  // Evita acentos demasiado grises o demasiado claros que rompan legibilidad en botones blancos
  const vividS = s < 12 ? 12 : clamp(s, 28, 92);
  const baseL = clamp(l, 34, 46);

  const scale: Record<string, string> = {
    '--color-blue-50': hslToHex(h, clamp(vividS, 25, 85), 96),
    '--color-blue-100': hslToHex(h, clamp(vividS, 25, 85), 91),
    '--color-blue-200': hslToHex(h, clamp(vividS, 25, 85), 82),
    '--color-blue-300': hslToHex(h, clamp(vividS, 30, 88), 72),
    '--color-blue-400': hslToHex(h, clamp(vividS, 35, 90), 62),
    '--color-blue-500': hslToHex(h, vividS, clamp(baseL + 8, 44, 56)),
    '--color-blue-600': hslToHex(h, vividS, baseL),
    '--color-blue-700': hslToHex(h, clamp(vividS + 4, 30, 95), clamp(baseL - 8, 26, 38)),
    '--color-blue-800': hslToHex(h, clamp(vividS + 4, 30, 95), 24),
    '--color-blue-900': hslToHex(h, clamp(vividS, 25, 90), 19),
    '--color-blue-950': hslToHex(h, clamp(vividS, 25, 85), 13),
    '--win-accent': normalizedHex,
  };

  const rootStyle = document.documentElement.style;
  for (const [prop, value] of Object.entries(scale)) {
    rootStyle.setProperty(prop, value);
  }

  return normalizedHex;
}
