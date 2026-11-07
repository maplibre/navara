import { describe, expect, it } from "vitest";

import { Color } from "./Color";
import { mergeLayerDescription } from "./layerDescriptionMerge";

describe("mergeLayerDescription", () => {
  it("merges materials field by field and keeps omitted ones", () => {
    const current = {
      type: "vector",
      source: "s",
      point: { size: 10, color: new Color().setHex(0xff0000) },
      text: { size: 12 },
    };
    const merged = mergeLayerDescription(current, {
      point: { size: 20 },
    });
    expect(merged.point.size).toBe(20);
    expect(merged.point.color).toBe(current.point.color);
    expect(merged.text).toEqual({ size: 12 });
    expect(merged.source).toBe("s");
    expect(current.point.size).toBe(10);
  });

  it("replaces arrays, typed arrays and Color instances", () => {
    const current = {
      type: "raster",
      elevationHeatmap: { colorMap: new Float32Array([1, 2, 3, 4]) },
      raster: { color: new Color().setHex(0x000000) },
      sourceLayers: ["a"],
    };
    const colorMap = new Float32Array(0);
    const color = new Color().setHex(0xffffff);
    const merged = mergeLayerDescription(current, {
      elevationHeatmap: { colorMap },
      raster: { color },
      sourceLayers: ["b", "c"],
    });
    expect(merged.elevationHeatmap.colorMap).toBe(colorMap);
    expect(merged.raster.color).toBe(color);
    expect(merged.sourceLayers).toEqual(["b", "c"]);
  });

  it("keeps the current value for keys set to undefined", () => {
    const merged = mergeLayerDescription(
      { type: "vector", point: { size: 10 } },
      { point: { size: undefined } },
    );
    expect(merged.point.size).toBe(10);
  });
});
