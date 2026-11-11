export interface Point {
  x: number;
  y: number;
}

/**
 * Computes a closed-form 2D projective transformation (Paul Heckbert's
 * rectangle-to-quadrilateral homography) mapping canonical card coordinates
 * `(x, y)` in `[0, srcW] × [0, srcH]` onto the arbitrary quadrilateral
 * `[p0, p1, p2, p3]` (ordered top-left, top-right, bottom-right, bottom-left).
 *
 * Matches `cv.getPerspectiveTransform` + `cv.perspectiveTransform` to within
 * Float32 precision (`< 1e-4` px) with zero WASM heap allocations.
 */
export function createQuadTransform(
  srcW: number,
  srcH: number,
  p0: Point,
  p1: Point,
  p2: Point,
  p3: Point
): (x: number, y: number) => Point {
  const dx1 = p1.x - p2.x;
  const dx2 = p3.x - p2.x;
  const sx = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y;
  const dy2 = p3.y - p2.y;
  const sy = p0.y - p1.y + p2.y - p3.y;

  const den = dx1 * dy2 - dx2 * dy1;

  // Affine / parallelogram fast path (or degenerate collinear quad)
  if ((Math.abs(sx) < 1e-10 && Math.abs(sy) < 1e-10) || Math.abs(den) < 1e-10) {
    return (x: number, y: number) => {
      const u = x / srcW;
      const v = y / srcH;
      return {
        x: p0.x + (p1.x - p0.x) * u + (p3.x - p0.x) * v,
        y: p0.y + (p1.y - p0.y) * u + (p3.y - p0.y) * v,
      };
    };
  }

  const g = (sx * dy2 - sy * dx2) / den;
  const h = (dx1 * sy - dy1 * sx) / den;
  const a = p1.x - p0.x + g * p1.x;
  const b = p3.x - p0.x + h * p3.x;
  const c = p0.x;
  const d = p1.y - p0.y + g * p1.y;
  const e = p3.y - p0.y + h * p3.y;
  const f = p0.y;

  return (x: number, y: number) => {
    const u = x / srcW;
    const v = y / srcH;
    const w = g * u + h * v + 1;
    return {
      x: (a * u + b * v + c) / w,
      y: (d * u + e * v + f) / w,
    };
  };
}

/**
 * Projects the top-right sticker zone bounding box from canonical `1000 × 600`
 * card space onto the 4 detected card corners `[p0, p1, p2, p3]`.
 */
export function projectStickerZoneCorners(
  p0: Point,
  p1: Point,
  p2: Point,
  p3: Point,
  width: number,
  height: number,
  pad = 20
): [Point, Point, Point, Point] {
  const transform = createQuadTransform(1000, 600, p0, p1, p2, p3);
  const szX1 = 1000 - width - pad;
  const szY1 = pad;
  const szX2 = 1000 - pad;
  const szY2 = pad + height;

  return [
    transform(szX1, szY1),
    transform(szX2, szY1),
    transform(szX2, szY2),
    transform(szX1, szY2),
  ];
}
