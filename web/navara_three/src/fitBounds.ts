/** A longitude/latitude box in degrees; `west > east` crosses the antimeridian. */
export type FitBoundsBox = {
  west: number;
  south: number;
  east: number;
  north: number;
};

/** A position to frame: degrees, and meters above the ellipsoid (default 0). */
export type FitBoundsPosition = { lng: number; lat: number; height?: number };

/** What `ThreeView.fitBounds` frames: a box, or a set of positions. */
export type FitBoundsTarget = FitBoundsBox | readonly FitBoundsPosition[];

/** Space in CSS pixels kept free at the canvas edges. */
export type FitBoundsPadding =
  number | { top?: number; right?: number; bottom?: number; left?: number };

const isBox = (target: FitBoundsTarget): target is FitBoundsBox =>
  !Array.isArray(target);

/**
 * The plain arrays `Core.fitBounds` takes: `[lng, lat, height]` triples or
 * `[west, south, east, north]`, and the padding as `[top, right, bottom,
 * left]`.
 */
export function fitBoundsArgs(
  target: FitBoundsTarget,
  padding: FitBoundsPadding = 0,
) {
  const sides =
    typeof padding === "number"
      ? [padding, padding, padding, padding]
      : [
          padding.top ?? 0,
          padding.right ?? 0,
          padding.bottom ?? 0,
          padding.left ?? 0,
        ];
  if (isBox(target)) {
    const { west, south, east, north } = target;
    return {
      positions: undefined,
      bbox: new Float64Array([west, south, east, north]),
      padding: new Float64Array(sides),
    };
  }
  return {
    positions: new Float64Array(
      target.flatMap((p) => [p.lng, p.lat, p.height ?? 0]),
    ),
    bbox: undefined,
    padding: new Float64Array(sides),
  };
}
