import type { Atmosphere } from "@navaramap/three";
import { PerspectiveCamera, Vector2 } from "three";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Clouds, type CloudsOptions } from "./pass";

// The real package starts the worker pool on import; Clouds only needs the
// pass base class.
vi.mock("@navaramap/three", async () => {
  const { EventHandler } = await import("@navaramap/core");
  const { EffectPass } = await import("postprocessing");
  class Pass extends EventHandler {
    rawPass: unknown;
    rawEffect: unknown;
    protected options: object;
    constructor(pass: unknown, effect: unknown, options?: object) {
      super();
      this.rawPass = pass;
      this.rawEffect = effect;
      this.options = { ...options };
    }
  }
  return {
    Pass,
    CustomEffectPass: EffectPass,
    CLOUD_LOCAL_WEATHER_URL: "",
    CLOUD_SHAPE_URL: "",
    CLOUD_SHAPE_DETAIL_URL: "",
    CLOUD_TURBULENCE_URL: "",
    STBN_URL: "",
  };
});

const atmosphereStub = () =>
  ({
    enableShadows: { value: false },
    onTexturesReady: () => {},
    on: () => {},
  }) as unknown as Atmosphere;

const createClouds = (options: CloudsOptions) => {
  vi.spyOn(Clouds.prototype, "loadAll").mockReturnValue(
    new Promise<never>(() => {}),
  );
  return new Clouds(new PerspectiveCamera(), atmosphereStub(), options);
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Clouds shadow map", () => {
  it.each([
    ["low", 256, 2],
    ["medium", 256, 3],
    ["high", 512, 3],
    ["ultra", 1024, 3],
  ] as const)(
    "takes the %s preset's map size and cascade count",
    (qualityPreset, mapSize, cascadeCount) => {
      const clouds = createClouds({ qualityPreset });
      expect(clouds.shadowMapSize.toArray()).toEqual([mapSize, mapSize]);
      expect(clouds.shadowCascadeCount).toBe(cascadeCount);
    },
  );

  it("prefers explicit options over the preset", () => {
    const clouds = createClouds({
      qualityPreset: "low",
      shadowMapSize: new Vector2(1024, 1024),
      shadowCascadeCount: 4,
    });
    expect(clouds.shadowMapSize.toArray()).toEqual([1024, 1024]);
    expect(clouds.shadowCascadeCount).toBe(4);
  });
});
