import type ThreeView from "@navaramap/three";
import type { HeightRange } from "@navaramap/three";
import { describe, expect, it, vi } from "vitest";

import { GroundVolumeWatch } from "./groundVolume";

const EXTENT = { west: 0, south: 0, east: 1, north: 1 };

describe("GroundVolumeWatch", () => {
  it("reports the heights of a new extent before the observer fires", () => {
    let observe: ((range: HeightRange) => void) | undefined;
    const view = {
      sampleTerrainHeightRange: () => ({ min: 10, max: 20 }),
      observeTerrainHeightRange: (
        _extent: unknown,
        cb: (range: HeightRange) => void,
      ) => {
        observe = cb;
        return () => {};
      },
    } as unknown as ThreeView;
    const onChange = vi.fn();
    const watch = new GroundVolumeWatch(
      view,
      (range) => [range.min, range.max],
      onChange,
    );

    watch.watch(EXTENT);
    expect(watch.heights).toEqual([10, 20]);
    expect(onChange).toHaveBeenCalledTimes(1);

    // The observer's first event repeats the sampled range.
    observe?.({ min: 10, max: 20 });
    expect(onChange).toHaveBeenCalledTimes(1);

    observe?.({ min: 5, max: 20 });
    expect(watch.heights).toEqual([5, 20]);
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});
