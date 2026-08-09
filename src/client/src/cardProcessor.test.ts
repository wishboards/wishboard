import { describe, it, expect } from 'vitest';
import {
  getElementDimensions,
  calculateDrawDimensions,
  calculateAspectFitDrawConfig,
  getDefaultPoly,
  alignPolygons,
  applyDampening,
  fallbackTextContour,
} from './cardProcessor';

describe('cardProcessor geometry & layout utilities', () => {
  it('detects element dimensions for video, image, and canvas elements', () => {
    const video = { videoWidth: 1280, videoHeight: 720 } as any;
    expect(getElementDimensions(video)).toEqual({ width: 1280, height: 720 });

    const img = { naturalWidth: 800, naturalHeight: 600 } as any;
    expect(getElementDimensions(img)).toEqual({ width: 800, height: 600 });

    const canvas = { width: 640, height: 480 } as any;
    expect(getElementDimensions(canvas)).toEqual({ width: 640, height: 480 });
  });

  it('calculates draw dimensions for video aspect wider than canvas aspect', () => {
    const video = { videoWidth: 1600, videoHeight: 900 } as any; // 16:9 aspect
    const canvas = {
      clientWidth: 800,
      clientHeight: 800, // 1:1 aspect
      width: 800,
      height: 800,
    } as any;

    const result = calculateDrawDimensions(video, canvas);
    expect(result.drawW).toBe(800 * (16 / 9));
    expect(result.drawX).toBeLessThan(0);
  });

  it('calculates draw dimensions for video aspect taller than canvas aspect', () => {
    const video = { videoWidth: 600, videoHeight: 800 } as any; // 3:4 aspect
    const canvas = {
      clientWidth: 800,
      clientHeight: 400, // 2:1 aspect
      width: 800,
      height: 400,
    } as any;

    const result = calculateDrawDimensions(video, canvas);
    expect(result.drawH).toBe(800 / (600 / 800));
    expect(result.drawY).toBeLessThan(0);
  });

  it('calculates aspect fit draw configuration', () => {
    const configWider = calculateAspectFitDrawConfig(1600, 900, { width: 800, height: 800 });
    expect(configWider.drawH).toBeCloseTo(800 / (16 / 9));
    expect(configWider.drawY).toBeGreaterThan(0);

    const configTaller = calculateAspectFitDrawConfig(600, 1000, { width: 800, height: 800 });
    expect(configTaller.drawW).toBeCloseTo(800 * (600 / 1000));
    expect(configTaller.drawX).toBeGreaterThan(0);
  });

  it('generates default polygon centered on element aspect ratio', () => {
    const videoWide = { videoWidth: 1920, videoHeight: 1080 } as any; // > 5/3 ratio
    const polyWide = getDefaultPoly(videoWide);
    expect(polyWide).toHaveLength(4);

    const videoTall = { videoWidth: 800, videoHeight: 1000 } as any; // < 5/3 ratio
    const polyTall = getDefaultPoly(videoTall);
    expect(polyTall).toHaveLength(4);
  });

  it('aligns polygon vertices to minimize total Euclidean distance', () => {
    const previousPoly = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    // Rotated by 1 index
    const rotatedPoly = [
      { x: 0, y: 10 },
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ];

    const aligned = alignPolygons(rotatedPoly, previousPoly);
    expect(aligned[0]).toEqual({ x: 0, y: 0 });
    expect(aligned[1]).toEqual({ x: 10, y: 0 });
  });

  it('applies dampening filters based on distance thresholds', () => {
    const previousPoly = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];

    // Low distance change (Locked filter)
    const smallShiftPoly = [
      { x: 5, y: 5 },
      { x: 105, y: 5 },
      { x: 105, y: 105 },
      { x: 5, y: 105 },
    ];
    const debugLinesLocked: string[] = [];
    const lockedRes = applyDampening(smallShiftPoly, previousPoly, debugLinesLocked);
    expect(debugLinesLocked).toContain('Filter: Locked');
    expect(lockedRes[0].x).toBeCloseTo(0 * 0.6 + 5 * 0.4);

    // High distance change (Heavy Dampening filter)
    const largeShiftPoly = [
      { x: 200, y: 200 },
      { x: 300, y: 200 },
      { x: 300, y: 300 },
      { x: 200, y: 300 },
    ];
    const debugLinesHeavy: string[] = [];
    const heavyRes = applyDampening(largeShiftPoly, previousPoly, debugLinesHeavy);
    expect(debugLinesHeavy).toContain('Filter: Heavy Dampening');
    expect(heavyRes[0].x).toBeCloseTo(0 * 0.95 + 200 * 0.05);
  });
});

describe('fallbackTextContour', () => {
  const pWidth = 400;
  const pHeight = 800;
  const processScale = 2;
  const video = { videoWidth: 800, videoHeight: 1600 } as any;

  it('returns null when no valid contours are found (area too small or too large)', () => {
    const cvMock = {
      contourArea: (cnt: any) => (cnt.id === 'small' ? 10 : pWidth * pHeight * 0.1),
      boundingRect: () => ({ x: 100, y: 100, width: 100, height: 100 }),
    };
    const contoursMock = {
      size: () => 2,
      get: (i: number) => ({ id: i === 0 ? 'small' : 'large' }),
    };

    const result = fallbackTextContour(cvMock, video, contoursMock, processScale, pWidth, pHeight);
    expect(result).toBeNull();
  });

  it('returns null when bounding box width is too small (maxX - minX <= pWidth * 0.1)', () => {
    const cvMock = {
      contourArea: () => 1000,
      boundingRect: () => ({ x: 100, y: 100, width: pWidth * 0.05, height: 100 }),
    };
    const contoursMock = {
      size: () => 1,
      get: () => ({ id: 'valid-area-small-width' }),
    };

    const result = fallbackTextContour(cvMock, video, contoursMock, processScale, pWidth, pHeight);
    expect(result).toBeNull();
  });

  it('returns expected padded and scaled polygon for matching wide text contours (corrects to 5/3 aspect ratio)', () => {
    const cvMock = {
      contourArea: () => 1000,
      boundingRect: () => ({
        x: pWidth * 0.1,
        y: pHeight * 0.1,
        width: pWidth * 0.6,
        height: pHeight * 0.1,
      }),
    };
    const contoursMock = {
      size: () => 1,
      get: () => ({ id: 'wide-text' }),
    };

    const result = fallbackTextContour(cvMock, video, contoursMock, processScale, pWidth, pHeight);
    expect(result).not.toBeNull();
    expect(result).toHaveLength(4);

    const padX = pWidth * 0.05;
    const padY = pHeight * 0.05;
    const minX = (pWidth * 0.1 - padX) / processScale;
    const minY = (pHeight * 0.1 - padY) / processScale;
    const maxX = (pWidth * 0.1 + pWidth * 0.6 + padX) / processScale;
    const maxY = (pHeight * 0.1 + pHeight * 0.1 + padY) / processScale;

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    // Original w/h ratio is (0.5+0.1) / (0.1+0.1) = 0.6 / 0.2 = 3 which is > 5/3
    // So h is calculated as w * (3/5)
    const expectedW = maxX - minX;
    const expectedH = expectedW * (3 / 5);

    expect(result![0].x).toBeCloseTo(cx - expectedW / 2);
    expect(result![0].y).toBeCloseTo(cy - expectedH / 2);
    expect(result![2].x).toBeCloseTo(cx + expectedW / 2);
    expect(result![2].y).toBeCloseTo(cy + expectedH / 2);
  });

  it('returns expected padded and scaled polygon for matching tall text contours (corrects to 5/3 aspect ratio)', () => {
    const cvMock = {
      contourArea: () => 1000,
      boundingRect: () => ({
        x: pWidth * 0.1,
        y: pHeight * 0.1,
        width: pWidth * 0.2,
        height: pHeight * 0.4,
      }),
    };
    const contoursMock = {
      size: () => 1,
      get: () => ({ id: 'tall-text' }),
    };

    const result = fallbackTextContour(cvMock, video, contoursMock, processScale, pWidth, pHeight);
    expect(result).not.toBeNull();
    expect(result).toHaveLength(4);

    const padX = pWidth * 0.05;
    const padY = pHeight * 0.05;
    const minX = (pWidth * 0.1 - padX) / processScale;
    const minY = (pHeight * 0.1 - padY) / processScale;
    const maxX = (pWidth * 0.1 + pWidth * 0.2 + padX) / processScale;
    const maxY = (pHeight * 0.1 + pHeight * 0.4 + padY) / processScale;

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    // Original w/h ratio is (0.2+0.1) / (0.4+0.1) = 0.3 / 0.5 = 0.6 which is < 5/3
    // So w is calculated as h * (5/3)
    const expectedH = maxY - minY;
    const expectedW = expectedH * (5 / 3);

    expect(result![0].x).toBeCloseTo(cx - expectedW / 2);
    expect(result![0].y).toBeCloseTo(cy - expectedH / 2);
    expect(result![2].x).toBeCloseTo(cx + expectedW / 2);
    expect(result![2].y).toBeCloseTo(cy + expectedH / 2);
  });
});
