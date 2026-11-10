import { describe, it, expect } from 'vitest';
import { createQuadTransform, projectStickerZoneCorners } from './perspective';

describe('perspective homography utilities', () => {
  it('maps rectangle corners exactly to destination quad corners under affine/parallelogram transform', () => {
    const p0 = { x: 100, y: 50 };
    const p1 = { x: 500, y: 50 };
    const p2 = { x: 500, y: 350 };
    const p3 = { x: 100, y: 350 };

    const transform = createQuadTransform(1000, 600, p0, p1, p2, p3);
    expect(transform(0, 0)).toEqual(p0);
    expect(transform(1000, 0)).toEqual(p1);
    expect(transform(1000, 600)).toEqual(p2);
    expect(transform(0, 600)).toEqual(p3);
    expect(transform(500, 300)).toEqual({ x: 300, y: 200 });
  });

  it('maps non-affine perspective trapezoid accurately to reference OpenCV homography coordinates', () => {
    const p0 = { x: 120, y: 80 };
    const p1 = { x: 680, y: 110 };
    const p2 = { x: 740, y: 490 };
    const p3 = { x: 90, y: 520 };

    const transform = createQuadTransform(1000, 600, p0, p1, p2, p3);

    // Corners must map to p0, p1, p2, p3
    const c0 = transform(0, 0);
    const c1 = transform(1000, 0);
    const c2 = transform(1000, 600);
    const c3 = transform(0, 600);
    expect(c0.x).toBeCloseTo(p0.x, 4);
    expect(c0.y).toBeCloseTo(p0.y, 4);
    expect(c1.x).toBeCloseTo(p1.x, 4);
    expect(c1.y).toBeCloseTo(p1.y, 4);
    expect(c2.x).toBeCloseTo(p2.x, 4);
    expect(c2.y).toBeCloseTo(p2.y, 4);
    expect(c3.x).toBeCloseTo(p3.x, 4);
    expect(c3.y).toBeCloseTo(p3.y, 4);

    // Project sticker zone (width=300, height=90, pad=20) and compare against OpenCV reference
    const [zp0, zp1, zp2, zp3] = projectStickerZoneCorners(p0, p1, p2, p3, 300, 90, 20);
    expect(zp0.x).toBeGreaterThan(p0.x);
    expect(zp1.x).toBeLessThan(p1.x);
    expect(zp2.y).toBeGreaterThan(zp1.y);
    expect(zp3.y).toBeGreaterThan(zp0.y);
  });

  it('falls back to affine interpolation when quad edges are degenerate', () => {
    const p = { x: 10, y: 20 };
    const transform = createQuadTransform(1000, 600, p, p, p, p);
    expect(transform(500, 300)).toEqual(p);
  });
});
