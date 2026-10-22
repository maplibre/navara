import { describe, expect, it } from "vitest";

import type { CompositeFeatures } from "../../../tileTexture/types";

import {
  composeCompositeContributions,
  compositeFeatureKey,
  createCompositeLayerEnhancers,
} from "./compose";

const OFF: CompositeFeatures = {
  hasHillshade: false,
  hasWater: false,
  hasElevationHeatmap: false,
  hasWatermask: false,
};

const compose = (features: CompositeFeatures, numTextures: number) =>
  composeCompositeContributions(
    createCompositeLayerEnhancers(features),
    numTextures,
  );

describe("compositeFeatureKey", () => {
  it("is unique per feature combination", () => {
    const keys = new Set<string>();
    for (let mask = 0; mask < 16; mask++) {
      keys.add(
        compositeFeatureKey({
          hasHillshade: !!(mask & 1),
          hasElevationHeatmap: !!(mask & 2),
          hasWater: !!(mask & 4),
          hasWatermask: !!(mask & 8),
        }),
      );
    }
    expect(keys.size).toBe(16);
  });
});

describe("composeCompositeContributions", () => {
  it("emits no feature GLSL when everything is off", () => {
    const c = compose(OFF, 2);
    expect(c.slotUniformDecls).not.toContain("uniform");
    expect(c.globalUniformDecls).toBe("");
    expect(c.includes).toBe("");
    expect(c.sampleProducer).toBeUndefined();
    expect(c.perSlotPostSample({ k: 0, absSlot: 0, isVector: false })).toBe("");
    expect(c.perSlotOnWinner({ k: 0, absSlot: 0, isVector: false })).toBe("");
  });

  it("orders slot uniform declarations hillshade → elevation → water", () => {
    const c = compose(
      {
        hasHillshade: true,
        hasElevationHeatmap: true,
        hasWater: true,
        hasWatermask: false,
      },
      2,
    );
    const hill = c.slotUniformDecls.indexOf("uIsHillshades");
    const elev = c.slotUniformDecls.indexOf("uElevationHeatmapParams");
    const water = c.slotUniformDecls.indexOf("uWaters");
    expect(hill).toBeGreaterThanOrEqual(0);
    expect(hill).toBeLessThan(elev);
    expect(elev).toBeLessThan(water);
  });

  it("orders the post-loop blocks hillshade before watermask", () => {
    const c = compose({ ...OFF, hasHillshade: true, hasWatermask: true }, 1);
    const hill = c.postLoop.indexOf("hillshadeNormal");
    const mask = c.postLoop.indexOf("uWatermask");
    expect(hill).toBeGreaterThanOrEqual(0);
    expect(hill).toBeLessThan(mask);
  });

  it("only the elevation heatmap overrides the per-slot sampler", () => {
    expect(compose(OFF, 1).sampleProducer).toBeUndefined();
    const c = compose({ ...OFF, hasElevationHeatmap: true }, 1);
    expect(c.sampleProducer).toBeDefined();
    expect(c.sampleProducer?.({ k: 0, absSlot: 0, isVector: false })).toContain(
      "sampleElevationBilinear",
    );
    expect(c.includes).toContain("sampleElevationBilinear");
  });

  it("writes the per-slot water flag only when water is on", () => {
    const ctx = { k: 1, absSlot: 1, isVector: false };
    expect(compose(OFF, 2).perSlotOnWinner(ctx)).toBe("");
    expect(
      compose({ ...OFF, hasWater: true }, 2).perSlotOnWinner(ctx),
    ).toContain("isWater = uWaters[1]");
  });
});
