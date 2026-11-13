import type ThreeView from "@navaramap/three";
import type { Layer, LayerDescription } from "@navaramap/three";
import { describe, expect, it } from "vitest";

import {
  descriptionOf,
  mergeLayerDescription,
  trackLayerDescriptions,
} from "./layerDescriptions";

/**
 * Stands in for `Color`: a class instance, which the merge replaces whole.
 * (Importing `@navaramap/three` at runtime loads the worker pool.)
 */
class Color {
  hex = 0;
  setHex(hex: number): this {
    this.hex = hex;
    return this;
  }
}

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

/** The handful of `on` / `off` / `emit` the tracker uses. */
function emitter() {
  const handlers = new Map<string, Set<(...args: unknown[]) => void>>();
  return {
    on(name: string, fn: (...args: unknown[]) => void) {
      if (!handlers.has(name)) handlers.set(name, new Set());
      handlers.get(name)?.add(fn);
    },
    off(name: string, fn: (...args: unknown[]) => void) {
      handlers.get(name)?.delete(fn);
    },
    emit(name: string, ...args: unknown[]) {
      for (const fn of handlers.get(name) ?? []) fn(...args);
    },
    count(name: string) {
      return handlers.get(name)?.size ?? 0;
    },
  };
}

describe("trackLayerDescriptions", () => {
  const added = (
    desc: Record<string, unknown>,
  ): {
    view: ReturnType<typeof emitter>;
    layer: ReturnType<typeof emitter>;
    stop: () => void;
  } => {
    const view = emitter();
    const layer = emitter();
    const stop = trackLayerDescriptions(view as unknown as ThreeView);
    view.emit("layerAdded", layer, desc as LayerDescription);
    return { view, layer, stop };
  };
  const of = (layer: unknown) =>
    descriptionOf(layer as Layer) as unknown as Record<string, unknown>;

  it("records the added description with a source handle as its id", () => {
    const { layer } = added({
      type: "vector",
      source: { id: "src-1" },
      point: { size: 4 },
    });
    expect(of(layer)).toEqual({
      type: "vector",
      source: "src-1",
      point: { size: 4 },
    });
  });

  it("merges every update on top", () => {
    const { layer } = added({
      type: "vector",
      source: "s",
      point: { size: 4 },
    });
    layer.emit("updated", { type: "vector", point: { color: 0xff0000 } });
    expect(of(layer).point).toEqual({ size: 4, color: 0xff0000 });
  });

  it("stores an explicit color ramp clear as an empty array", () => {
    const { layer } = added({
      type: "raster",
      source: "dem",
      elevationHeatmap: { colorMap: new Float32Array([1, 2]) },
    });
    layer.emit("updated", {
      type: "raster",
      elevationHeatmap: { colorMap: undefined },
    });
    const heatmap = of(layer).elevationHeatmap as { colorMap: Float32Array };
    expect(heatmap.colorMap).toHaveLength(0);
  });

  it("stops listening when the layer is removed and when stopped", () => {
    const { view, layer, stop } = added({ type: "vector", source: "s" });
    expect(layer.count("updated")).toBe(1);
    view.emit("layerRemoved", layer);
    expect(layer.count("updated")).toBe(0);
    stop();
    expect(view.count("layerAdded")).toBe(0);
    expect(view.count("layerRemoved")).toBe(0);
  });

  it("is empty for a layer it never saw", () => {
    expect(of(emitter())).toEqual({});
  });
});
