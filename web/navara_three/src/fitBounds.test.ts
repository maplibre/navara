import { describe, expect, it } from "vitest";

import { fitBoundsArgs } from "./fitBounds";

// The fit itself is solved and tested in the engine
// (`crates/navara_camera/src/fit_bounds.rs`).
describe("fitBoundsArgs", () => {
  it("passes positions as [lng, lat, height] triples, height 0 by default", () => {
    const args = fitBoundsArgs([
      { lng: 139.7, lat: 35.6 },
      { lng: 139.8, lat: 35.7, height: 120 },
    ]);
    expect(args.positions).toEqual(
      new Float64Array([139.7, 35.6, 0, 139.8, 35.7, 120]),
    );
    expect(args.bbox).toBeUndefined();
  });

  it("passes a box as [west, south, east, north]", () => {
    const args = fitBoundsArgs({
      west: 178,
      south: -20,
      east: -177,
      north: -15,
    });
    expect(args.bbox).toEqual(new Float64Array([178, -20, -177, -15]));
    expect(args.positions).toBeUndefined();
  });

  it("passes the padding as [top, right, bottom, left]", () => {
    const box = { west: 0, south: 0, east: 1, north: 1 };
    expect(fitBoundsArgs(box).padding).toEqual(new Float64Array([0, 0, 0, 0]));
    expect(fitBoundsArgs(box, 40).padding).toEqual(
      new Float64Array([40, 40, 40, 40]),
    );
    expect(fitBoundsArgs(box, { right: 280, left: 10 }).padding).toEqual(
      new Float64Array([0, 280, 0, 10]),
    );
  });
});
