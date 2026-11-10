/**
 * WCAG 2.1 Contrast Ratio Utilities & Verification
 *
 * Relative luminance calculation according to WCAG 2.1 specifications:
 * https://www.w3.org/WAI/GL/wiki/Relative_luminance
 */

export interface RGB {
  r: number;
  g: number;
  b: number;
}

/**
 * Parses a hex string or rgb/rgba string into RGB.
 */
export function colorToRgb(color: string): RGB | null {
  const clean = color.trim();
  if (clean.startsWith('#')) {
    return hexToRgb(clean);
  }
  const rgbaMatch = clean.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgbaMatch) {
    const r = parseInt(rgbaMatch[1], 10);
    const g = parseInt(rgbaMatch[2], 10);
    const b = parseInt(rgbaMatch[3], 10);
    return isNaN(r) || isNaN(g) || isNaN(b) ? null : { r, g, b };
  }
  return null;
}

/**
 * Parses a 3-character, 6-character, or 8-character hex string into RGB.
 */
export function hexToRgb(hex: string): RGB | null {
  const clean = hex.trim().replace(/^#/, '');
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16);
    const g = parseInt(clean[1] + clean[1], 16);
    const b = parseInt(clean[2] + clean[2], 16);
    return isNaN(r) || isNaN(g) || isNaN(b) ? null : { r, g, b };
  }
  if (clean.length === 6 || clean.length === 8) {
    const r = parseInt(clean.substring(0, 2), 16);
    const g = parseInt(clean.substring(2, 4), 16);
    const b = parseInt(clean.substring(4, 6), 16);
    return isNaN(r) || isNaN(g) || isNaN(b) ? null : { r, g, b };
  }
  return null;
}

/**
 * Computes the relative luminance of an sRGB color.
 */
export function getRelativeLuminance({ r, g, b }: RGB): number {
  const [rs, gs, bs] = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

/**
 * Calculates WCAG contrast ratio between two colors (ranging from 1 to 21).
 */
export function getContrastRatio(color1: string | RGB, color2: string | RGB): number {
  const rgb1 = typeof color1 === 'string' ? colorToRgb(color1) : color1;
  const rgb2 = typeof color2 === 'string' ? colorToRgb(color2) : color2;

  if (!rgb1 || !rgb2) return 1;

  const lum1 = getRelativeLuminance(rgb1);
  const lum2 = getRelativeLuminance(rgb2);

  const brighter = Math.max(lum1, lum2);
  const darker = Math.min(lum1, lum2);

  return (brighter + 0.05) / (darker + 0.05);
}

/**
 * Evaluates whether text meets WCAG AA (4.5:1 normal, 3.0:1 large/controls)
 */
export function checkWcagAA(
  foreground: string,
  background: string,
  isLargeOrControl = false
): { pass: boolean; ratio: number; required: number } {
  const ratio = getContrastRatio(foreground, background);
  const required = isLargeOrControl ? 3.0 : 4.5;
  return {
    pass: ratio >= required,
    ratio: Math.round(ratio * 100) / 100,
    required,
  };
}
