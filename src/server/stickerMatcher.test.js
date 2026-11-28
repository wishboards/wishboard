import { describe, it, expect } from 'vitest';
import {
  loadBundledStickerCatalog,
  matchBundledSticker,
  synthesizeGeometricSvg,
  matchOrSynthesizeSticker,
} from './stickerMatcher.js';

describe('stickerMatcher', () => {
  it('loads bundled CC0-1.0 / MIT stickers without excluded licenses', () => {
    const catalog = loadBundledStickerCatalog();
    expect(catalog.size).toBeGreaterThan(0);
    expect(catalog.get('nonbinary')).toEqual({
      src: '/assets/stickers/nonbinary.svg',
      license: 'CC0-1.0',
    });
    for (const entry of catalog.values()) {
      expect(['CC0-1.0', 'MIT']).toContain(entry.license);
      expect(entry.src).toMatch(/^\/assets\/stickers\/.+\.svg$/);
    }
  });

  it('matches bundled stickers by label, tag, or alias', () => {
    const nonbinary = matchBundledSticker({ label: 'Nonbinary', category: 'gender' });
    expect(nonbinary).toEqual({
      source: 'bundled',
      src: '/assets/stickers/nonbinary.svg',
      license: 'CC0-1.0',
      sticker: { type: 'image', src: '/assets/stickers/nonbinary.svg' },
    });

    const aro = matchBundledSticker({ tag: 'aro', category: 'orientation' });
    expect(aro?.source).toBe('bundled');
    expect(aro?.src).toBe('/assets/stickers/aromantic.svg');

    const miss = matchBundledSticker({ label: 'Rope Jam Enthusiast 999', category: 'interests' });
    expect(miss).toBeNull();
  });

  it('synthesizes deterministic constrained geometric SVGs with zero scripts or user text', () => {
    const svg1 = synthesizeGeometricSvg({ label: 'Tea Lounge', category: 'interests' });
    const svg2 = synthesizeGeometricSvg({ label: 'Tea Lounge', category: 'interests' });
    expect(svg1).toBe(svg2);
    expect(svg1).toContain('<svg');
    expect(svg1).toContain('viewBox="0 0 64 64"');
    expect(svg1).not.toContain('<script');
    expect(svg1).not.toContain('<foreignObject');
    expect(svg1).not.toContain('Tea Lounge');

    const xssSvg = synthesizeGeometricSvg({
      label: '"><script>alert(1)</script><svg onload="alert(2)">',
      category: 'interests',
    });
    expect(xssSvg).toContain('<svg');
    expect(xssSvg).not.toContain('<script');
    expect(xssSvg).not.toContain('alert(1)');
    expect(xssSvg).not.toContain('onload');
  });

  it('falls back to synthesized geometric SVG when no bundled sticker matches', () => {
    const matched = matchOrSynthesizeSticker({ label: 'Demisexual', category: 'orientation' });
    expect(matched.source).toBe('bundled');
    expect(matched.src).toBe('/assets/stickers/demisexual.svg');

    const fallback = matchOrSynthesizeSticker({
      label: 'zzz_unknown_nonsense_999111',
      category: 'interests',
    });
    expect(fallback.source).toBe('synthesized');
    expect(fallback.license).toBe('CC0-1.0');
    expect(fallback.sticker.type).toBe('svg');
    expect(fallback.svg).toContain('<svg');
  });

  it('exercises all 4 geometric motifs deterministically across diverse labels', () => {
    const svgs = Array.from({ length: 24 }, (_, i) =>
      synthesizeGeometricSvg({ label: `motif-seed-${i}`, category: 'interests' })
    );
    expect(svgs.some((s) => s.includes('<rect') && s.includes('opacity="0.2"'))).toBe(true);
    expect(svgs.some((s) => s.includes('<line'))).toBe(true);
    expect(svgs.some((s) => s.includes('32,6 58,26'))).toBe(true);
    expect(svgs.some((s) => s.includes('M 16 44 L 32 16 L 48 44 Z'))).toBe(true);
  });
});
