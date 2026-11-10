import { describe, it, expect } from 'vitest';
import { getContrastRatio, checkWcagAA, hexToRgb, getRelativeLuminance } from './contrast';

describe('WCAG Contrast Utilities', () => {
  it('parses hex colors accurately', () => {
    expect(hexToRgb('#fff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(hexToRgb('#000000')).toEqual({ r: 0, g: 0, b: 0 });
    expect(hexToRgb('invalid')).toBeNull();
  });

  it('computes accurate relative luminance', () => {
    expect(getRelativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1.0, 2);
    expect(getRelativeLuminance({ r: 0, g: 0, b: 0 })).toBeCloseTo(0.0, 2);
  });

  it('calculates correct contrast ratio for pure black and white (21:1)', () => {
    const ratio = getContrastRatio('#000000', '#ffffff');
    expect(ratio).toBeCloseTo(21.0, 1);
  });

  describe('Coded Theme Preset Buttons Contrast Verification', () => {
    const presets = [
      {
        name: 'midnight',
        canvas: '#080d1a',
        surface: '#1e293b',
        textPrimary: '#f8fafc',
        accentPrimary: '#f59e0b',
        accentContrast: '#0f172a',
        danger: '#ef4444',
      },
      {
        name: 'daylight',
        canvas: '#f8fafc',
        surface: '#ffffff',
        textPrimary: '#0f172a',
        accentPrimary: '#2563eb',
        accentContrast: '#ffffff',
        danger: '#dc2626',
      },
      {
        name: 'corkhouse',
        canvas: '#2b1f14',
        surface: '#3a2b1f',
        textPrimary: '#fbf7ee',
        accentPrimary: '#d97706',
        accentContrast: '#ffffff',
        danger: '#ef4444',
      },
      {
        name: 'high-contrast',
        canvas: '#000000',
        surface: '#000000',
        textPrimary: '#ffffff',
        accentPrimary: '#ffff00',
        accentContrast: '#000000',
        danger: '#ff4444',
      },
    ];

    presets.forEach((preset) => {
      it(`preset [${preset.name}] meets WCAG requirements for interactive buttons`, () => {
        // Primary button: accentContrast text on accentPrimary background
        const primaryCheck = checkWcagAA(preset.accentContrast, preset.accentPrimary, true);
        expect(
          primaryCheck.pass,
          `Preset ${preset.name} primary button contrast ${primaryCheck.ratio}:1 fails threshold ${primaryCheck.required}:1`
        ).toBe(true);

        // Danger button on surface: danger text on surface background (large/control target 3.0:1)
        const dangerCheck = checkWcagAA(preset.danger, preset.surface, true);
        expect(
          dangerCheck.pass,
          `Preset ${preset.name} danger button text contrast ${dangerCheck.ratio}:1 against surface fails threshold ${dangerCheck.required}:1`
        ).toBe(true);

        // Secondary button text on surface: textPrimary on surface background (WCAG AA 4.5:1)
        const secondaryCheck = checkWcagAA(preset.textPrimary, preset.surface, false);
        expect(
          secondaryCheck.pass,
          `Preset ${preset.name} secondary text contrast ${secondaryCheck.ratio}:1 against surface fails threshold ${secondaryCheck.required}:1`
        ).toBe(true);
      });
    });
  });
});
