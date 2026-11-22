import { describe, it, expect, vi } from 'vitest';
import {
  alignPolygons,
  applyDampening,
  applyTemporalSmoothing,
  calculateAspectFitDrawConfig,
  calculateDrawDimensions,
  detectDocumentContour,
  fallbackTextContour,
  getDefaultPoly,
  getElementDimensions,
  isFramePixelBuffer,
  warpCardBuffer,
} from './cardProcessor';

// Exact-value tests: every assertion pins the precise arithmetic, so operator,
// comparison, and constant mutants in the geometry pipeline cannot slip past.

describe('cardProcessor exact geometry', () => {
  it('getElementDimensions prefers video, then natural, then plain fields', () => {
    expect(
      getElementDimensions({
        videoWidth: 100,
        videoHeight: 50,
        naturalWidth: 999,
        naturalHeight: 888,
        width: 1,
        height: 2,
      } as never)
    ).toEqual({ width: 100, height: 50 });
    expect(
      getElementDimensions({ videoWidth: '100', naturalWidth: 640, naturalHeight: 480 } as never)
    ).toEqual({ width: 640, height: 480 });
    expect(
      getElementDimensions({ naturalWidth: 'x', width: 320, height: 240 } as never)
    ).toEqual({ width: 320, height: 240 });
  });

  it('isFramePixelBuffer requires a Uint8ClampedArray data field', () => {
    expect(isFramePixelBuffer(undefined)).toBe(false);
    expect(isFramePixelBuffer('buffer')).toBe(false);
    expect(isFramePixelBuffer({})).toBe(false);
    expect(isFramePixelBuffer({ data: new Uint8Array(4) })).toBe(false);
    expect(isFramePixelBuffer({ data: [1, 2, 3] })).toBe(false);
    expect(isFramePixelBuffer({ data: new Uint8ClampedArray(4) })).toBe(true);
  });

  it('calculateDrawDimensions syncs the canvas size and covers exactly', () => {
    const canvas = { clientWidth: 800, clientHeight: 800, width: 400, height: 200 } as never as {
      clientWidth: number;
      clientHeight: number;
      width: number;
      height: number;
    };
    const video = { videoWidth: 1600, videoHeight: 900 } as never;
    const result = calculateDrawDimensions(video, canvas as never);
    expect(canvas.width).toBe(800);
    expect(canvas.height).toBe(800);
    expect(result).toEqual({
      drawW: 800 * (1600 / 900),
      drawH: 800,
      drawX: (800 - 800 * (1600 / 900)) / 2,
      drawY: 0,
    });

    const tall = calculateDrawDimensions(
      { videoWidth: 600, videoHeight: 800 } as never,
      { clientWidth: 800, clientHeight: 400, width: 800, height: 400 } as never
    );
    expect(tall).toEqual({
      drawW: 800,
      drawH: 800 / (600 / 800),
      drawX: 0,
      drawY: (400 - 800 / (600 / 800)) / 2,
    });

    // Equal ratios take the else branch and produce an exact fit.
    const fit = calculateDrawDimensions(
      { videoWidth: 800, videoHeight: 400 } as never,
      { clientWidth: 800, clientHeight: 400, width: 800, height: 400 } as never
    );
    expect(fit).toEqual({ drawW: 800, drawH: 400, drawX: 0, drawY: 0 });
  });

  it('calculateAspectFitDrawConfig fits exactly in both orientations and at equality', () => {
    expect(calculateAspectFitDrawConfig(1600, 900, { width: 800, height: 800 })).toEqual({
      drawW: 800,
      drawH: 450,
      drawX: 0,
      drawY: 175,
    });
    expect(calculateAspectFitDrawConfig(600, 1000, { width: 800, height: 800 })).toEqual({
      drawW: 480,
      drawH: 800,
      drawX: 160,
      drawY: 0,
    });
    expect(calculateAspectFitDrawConfig(800, 400, { width: 400, height: 200 })).toEqual({
      drawW: 400,
      drawH: 200,
      drawX: 0,
      drawY: 0,
    });
  });

  it('getDefaultPoly centers an exact 5:3 box, with the boundary ratio taking the else branch', () => {
    expect(getDefaultPoly({ videoWidth: 2000, videoHeight: 1000 } as never)).toEqual([
      { x: 250, y: 50 },
      { x: 1750, y: 50 },
      { x: 1750, y: 950 },
      { x: 250, y: 950 },
    ]);
    expect(getDefaultPoly({ videoWidth: 1000, videoHeight: 1000 } as never)).toEqual([
      { x: 50, y: 230 },
      { x: 950, y: 230 },
      { x: 950, y: 770 },
      { x: 50, y: 770 },
    ]);
    // ratio exactly 5/3 is NOT > 5/3
    expect(getDefaultPoly({ videoWidth: 1500, videoHeight: 900 } as never)).toEqual([
      { x: 75, y: 45 },
      { x: 1425, y: 45 },
      { x: 1425, y: 855 },
      { x: 75, y: 855 },
    ]);
  });

  it('alignPolygons returns the exact rotation with the minimum total distance', () => {
    const prev = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(alignPolygons(prev, prev)).toEqual(prev);
    const rot2 = [
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ];
    expect(alignPolygons(rot2, prev)).toEqual(prev);
    const rot3 = [
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 0, y: 0 },
    ];
    expect(alignPolygons(rot3, prev)).toEqual(prev);
  });

  it('applyDampening switches at exactly 150px and blends with exact weights', () => {
    const prev = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    const atBoundary = [
      { x: 150, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    const lines1: string[] = [];
    const locked = applyDampening(atBoundary, prev, lines1);
    expect(lines1).toEqual(['Filter: Locked']);
    expect(locked[0]).toEqual({ x: 0 * 0.6 + 150 * 0.4, y: 0 });
    expect(locked[1]).toEqual({ x: 100, y: 0 });

    const beyond = [
      { x: 151, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    const lines2: string[] = [];
    const heavy = applyDampening(beyond, prev, lines2);
    expect(lines2).toEqual(['Filter: Heavy Dampening']);
    expect(heavy[0]).toEqual({ x: 0 * 0.95 + 151 * 0.05, y: 0 });
    expect(heavy[3]).toEqual({ x: 0, y: 100 });
  });

  it('applyTemporalSmoothing normalizes a fresh polygon with exact rotations', () => {
    const normalized = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(applyTemporalSmoothing(normalized, null, [])).toEqual(normalized);

    // d12 (20) > d01 (5): exactly one rotation.
    const longSecond = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 20 },
      { x: 0, y: 20 },
    ];
    expect(applyTemporalSmoothing(longSecond, null, [])).toEqual([
      { x: 5, y: 0 },
      { x: 5, y: 20 },
      { x: 0, y: 20 },
      { x: 0, y: 0 },
    ]);

    // Upside-down quad with equal adjacent edges: no first rotation, then the
    // top edge sum exceeds the bottom, so exactly two rotations.
    const upsideDown = [
      { x: 0, y: 20 },
      { x: 20, y: 20 },
      { x: 20, y: 0 },
      { x: 0, y: 0 },
    ];
    expect(applyTemporalSmoothing(upsideDown, null, [])).toEqual([
      { x: 20, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 20 },
      { x: 20, y: 20 },
    ]);

    // Both checks fire in sequence: d12 > d01 rotates once, and the rotated
    // quad's top sum then ties the bottom sum, so it stops there.
    const combined = [
      { x: 0, y: 20 },
      { x: 10, y: 20 },
      { x: 10, y: 0 },
      { x: 0, y: 0 },
    ];
    expect(applyTemporalSmoothing(combined, null, [])).toEqual([
      { x: 10, y: 20 },
      { x: 10, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 20 },
    ]);

    // A NaN previous polygon takes the same normalization path as null.
    const nanPrev = [
      { x: NaN, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ];
    expect(applyTemporalSmoothing(normalized, nanPrev, [])).toEqual(normalized);
  });
});

describe('detectDocumentContour with a scripted OpenCV', () => {
  const makeCv = (contourSpecs: Array<{ area: number; rows: number; points: number[] }>) => {
    const calls: Record<string, unknown[][]> = {};
    const record =
      (name: string) =>
      (...args: unknown[]) => {
        (calls[name] ??= []).push(args);
      };
    const cv = {
      COLOR_RGBA2GRAY: 7,
      BORDER_DEFAULT: 3,
      RETR_LIST: 2,
      CHAIN_APPROX_SIMPLE: 1,
      calls,
      matFromImageData: vi.fn((input: unknown) => ({ input, delete: vi.fn() })),
      cvtColor: vi.fn(record('cvtColor')),
      GaussianBlur: vi.fn(record('GaussianBlur')),
      Canny: vi.fn(record('Canny')),
      Size: class {
        constructor(
          public w: number,
          public h: number
        ) {}
      },
      MatVector: class {
        size() {
          return contourSpecs.length;
        }
        get(i: number) {
          return { spec: contourSpecs[i] };
        }
        delete = vi.fn();
      },
      Mat: class {
        delete = vi.fn();
      },
      findContours: vi.fn(record('findContours')),
      contourArea: vi.fn((cnt: { spec: { area: number } }) => cnt.spec.area),
      arcLength: vi.fn(() => 400),
      approxPolyDP: vi.fn(
        (cnt: { spec: { rows: number; points: number[] } }, approx: { rows: number; data32S: number[] }) => {
          approx.rows = cnt.spec.rows;
          approx.data32S = cnt.spec.points;
        }
      ),
    };
    // approxPolyDP writes into a fresh Mat per contour; give Mat the fields.
    cv.Mat = class {
      rows = 0;
      data32S: number[] = [];
      delete = vi.fn();
    } as never;
    return cv;
  };

  const buffer = { width: 200, height: 120, data: new Uint8ClampedArray(200 * 120 * 4) };

  it('runs the exact preprocessing pipeline and picks the largest qualifying quad, scaled and angle-sorted', () => {
    const cv = makeCv([
      // Qualifies (area 15000 > 10% of 24000) but is not the largest.
      { area: 15000, rows: 4, points: [20, 20, 180, 20, 180, 100, 20, 100] },
      // Largest quad, given in scrambled order to exercise the angular sort.
      { area: 20000, rows: 4, points: [190, 110, 10, 110, 10, 10, 190, 10] },
      // Below the 10% area threshold: never approximated.
      { area: 2000, rows: 4, points: [0, 0, 10, 0, 10, 10, 0, 10] },
      // Big enough but not a quad.
      { area: 22000, rows: 5, points: [0, 0, 10, 0, 10, 10, 0, 10, 5, 5] },
    ]);
    const res = detectDocumentContour(cv as never, buffer as never, 0.5, 200, 120);
    expect(cv.calls.cvtColor[0][2]).toBe(7);
    const blurSize = cv.calls.GaussianBlur[0][2] as { w: number; h: number };
    expect([blurSize.w, blurSize.h]).toEqual([5, 5]);
    expect(cv.calls.Canny[0].slice(2)).toEqual([75, 200, 3, false]);
    expect(cv.calls.findContours[0].slice(3)).toEqual([2, 1]);
    expect(res.maxArea).toBe(20000);
    // Points divided by processScale 0.5 and sorted by angle around centroid.
    expect(res.bestPoly).toEqual([
      { x: 20, y: 20 },
      { x: 380, y: 20 },
      { x: 380, y: 220 },
      { x: 20, y: 220 },
    ]);
  });

  it('returns a null polygon when no contour qualifies', () => {
    const cv = makeCv([{ area: 100, rows: 4, points: [0, 0, 1, 0, 1, 1, 0, 1] }]);
    const res = detectDocumentContour(cv as never, buffer as never, 0.5, 200, 120);
    expect(res.bestPoly).toBeNull();
    expect(res.maxArea).toBe(0);
  });
});

describe('fallbackTextContour boundaries', () => {
  const makeContours = (specs: Array<{ area: number; rect: object }>) => ({
    size: () => specs.length,
    get: (i: number) => ({ spec: specs[i] }),
  });
  const cvFor = () => ({
    contourArea: (cnt: { spec: { area: number } }) => cnt.spec.area,
    boundingRect: (cnt: { spec: { rect: object } }) => cnt.spec.rect,
  });
  const video = { width: 1000, height: 800 } as never;

  it('rejects contours at the exact area and margin boundaries', () => {
    // area exactly 50 is not > 50; rect x exactly at 5% is not > 5%.
    const specs = [
      { area: 50, rect: { x: 100, y: 100, width: 300, height: 100 } },
      { area: 500, rect: { x: 20, y: 100, width: 300, height: 100 } },
    ];
    const out = fallbackTextContour(
      cvFor() as never,
      video,
      makeContours(specs) as never,
      0.4,
      400,
      320
    );
    expect(out).toBeNull();
  });

  it('rejects a text span exactly 10% of the width', () => {
    const specs = [{ area: 500, rect: { x: 100, y: 100, width: 40, height: 60 } }];
    const out = fallbackTextContour(
      cvFor() as never,
      video,
      makeContours(specs) as never,
      0.4,
      400,
      320
    );
    expect(out).toBeNull();
  });
});

describe('warpCardBuffer exact OpenCV calls', () => {
  it('passes exact corner arrays, defaults to 1000x600, and copies the output data', () => {
    const matFromArray = vi.fn((..._args: unknown[]) => ({ delete: vi.fn() }));
    const warpPerspective = vi.fn();
    const dstData = new Uint8Array(1000 * 600 * 4).fill(7);
    const cv = {
      CV_32FC2: 13,
      INTER_LINEAR: 1,
      BORDER_CONSTANT: 0,
      matFromImageData: vi.fn(() => ({ delete: vi.fn() })),
      Mat: class {
        data = dstData;
        delete = vi.fn();
      },
      matFromArray,
      getPerspectiveTransform: vi.fn(() => ({ delete: vi.fn() })),
      warpPerspective,
      Size: class {
        constructor(
          public w: number,
          public h: number
        ) {}
      },
      Scalar: class {},
    };
    const corners = [
      { x: 1, y: 2 },
      { x: 3, y: 4 },
      { x: 5, y: 6 },
      { x: 7, y: 8 },
    ];
    const out = warpCardBuffer(
      cv as never,
      { width: 10, height: 10, data: new Uint8ClampedArray(400) } as never,
      corners
    );
    expect(out.width).toBe(1000);
    expect(out.height).toBe(600);
    expect(matFromArray).toHaveBeenNthCalledWith(1, 4, 1, 13, [1, 2, 3, 4, 5, 6, 7, 8]);
    expect(matFromArray).toHaveBeenNthCalledWith(2, 4, 1, 13, [0, 0, 1000, 0, 1000, 600, 0, 600]);
    const sizeArg = warpPerspective.mock.calls[0][3] as { w: number; h: number };
    expect([sizeArg.w, sizeArg.h]).toEqual([1000, 600]);
    expect(warpPerspective.mock.calls[0][4]).toBe(1);
    expect(warpPerspective.mock.calls[0][5]).toBe(0);
    expect(out.data).toBeInstanceOf(Uint8ClampedArray);
    expect(out.data).toHaveLength(1000 * 600 * 4);
    expect(out.data[0]).toBe(7);
    expect(out.data).not.toBe(dstData);
  });
});
