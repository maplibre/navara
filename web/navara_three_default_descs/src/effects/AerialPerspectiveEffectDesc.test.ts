import type ThreeView from "@navaramap/three";
import type { GBufferName, ViewContext } from "@navaramap/three";
import { Pass } from "postprocessing";
import { describe, expect, it, vi } from "vitest";

import type { AerialPerspectiveOptions } from "./aerialPerspective/index";
import {
  AerialPerspectiveEffectDesc,
  type AerialPerspectiveConfig,
} from "./AerialPerspectiveEffectDesc";

// The package index boots the worker pool, which needs a browser.
vi.mock("@navaramap/three", () =>
  vi.importActual("../../../navara_three/src/core/EffectDesc"),
);

// `BaseDesc` generates its id in the engine WASM, which is not loaded here.
vi.mock("../../../wasm/navara_engine/navara_wasm.js", () => ({
  generateId: () => "aerialPerspective",
}));

// The real pass needs the atmosphere textures and a WebGL context; the desc
// only drives its setters.
vi.mock("./aerialPerspective/index", () => {
  class AerialPerspective {
    raw = Object.assign(new Pass("AerialPerspective"), {
      setCustomDepthTexture: vi.fn(),
    });
    rawEffect = { shadowTerm: false, specularTerm: false };
    visible = true;
  }
  return {
    AerialPerspective,
    DEFAULT_AERIAL_PERSPECTIVE_OPTIONS: {
      useNormalBuffer: true,
      shadow: false,
      specular: false,
    },
  };
});

type Lighting = Omit<AerialPerspectiveOptions, "enabled">;

const create = (
  aerialPerspective?: Lighting,
  config: AerialPerspectiveConfig = { aerialPerspective },
) => {
  const emit = vi.fn();
  const ctx = {
    emit,
    getPass: () => undefined,
    addPass: vi.fn(),
    _getEffects: () => [
      {
        ref: {
          getKey: () => "mrt",
          depthBuffer: {},
          depthBufferPacking: 0,
        },
      },
    ],
  } as unknown as ViewContext;
  const view = {
    atmosphere: {},
    camera: { raw: {} },
  } as unknown as ThreeView;
  const desc = new AerialPerspectiveEffectDesc(view, ctx, config);
  return { desc, emit };
};

const createLive = (
  aerialPerspective?: Lighting,
  config?: AerialPerspectiveConfig,
) => {
  const created = create(aerialPerspective, config);
  created.desc.onCreate();
  created.emit.mockClear();
  return created;
};

describe("AerialPerspectiveEffectDesc.getRequiredBuffers", () => {
  it.each<[Lighting | undefined, GBufferName[]]>([
    [undefined, ["normal"]],
    [{ irradiance: true }, ["normal"]],
    [{ shadow: true }, ["normal", "shadow"]],
    [{ specular: true }, ["normal", "shadow"]],
    [{ useNormalBuffer: false }, []],
    // The terms are compiled out without a normal buffer.
    [{ useNormalBuffer: false, shadow: true }, []],
    [{ useNormalBuffer: false, specular: true }, []],
  ])("derives the buffers from %o", (config, expected) => {
    expect(create(config).desc.getRequiredBuffers()).toEqual(expected);
  });

  it("keeps useNormalBuffer across an update that omits it", () => {
    const { desc } = createLive({ useNormalBuffer: false, shadow: true });

    desc.onUpdateConfig({ aerialPerspective: { irradiance: true } });
    desc.onUpdateConfig({ visible: false });

    expect(desc.getRequiredBuffers()).toEqual([]);
  });

  it.each<[Lighting, Lighting, GBufferName[]]>([
    [{ shadow: true }, { shadow: undefined }, ["normal", "shadow"]],
    [{ specular: true }, { specular: undefined }, ["normal", "shadow"]],
    [{ useNormalBuffer: false }, { useNormalBuffer: undefined }, []],
  ])("keeps %o across an explicit %o", (config, update, expected) => {
    const { desc, emit } = createLive(config);

    desc.onUpdateConfig({ aerialPerspective: update });

    expect(desc.getRequiredBuffers()).toEqual(expected);
    expect(emit).not.toHaveBeenCalledWith("gbufferRequirementsChanged");
  });

  it("does not share requirements through a shared config object", () => {
    const shared = { aerialPerspective: { shadow: true } };
    const a = createLive(undefined, shared);
    const b = createLive(undefined, shared);

    a.desc.onUpdateConfig({ aerialPerspective: { useNormalBuffer: false } });

    expect(a.desc.getRequiredBuffers()).toEqual([]);
    expect(b.desc.getRequiredBuffers()).toEqual(["normal", "shadow"]);
  });
});

describe("AerialPerspectiveEffectDesc.onUpdateConfig", () => {
  // `_syncGBuffers` reads the requirements synchronously inside the event.
  const recordRequirements = (
    desc: AerialPerspectiveEffectDesc,
    emit: ReturnType<typeof vi.fn>,
  ) => {
    const seen: (readonly GBufferName[])[] = [];
    emit.mockImplementation((event: string) => {
      if (event === "gbufferRequirementsChanged") {
        seen.push(desc.getRequiredBuffers());
      }
    });
    return seen;
  };

  it("re-derives the G-buffers when useNormalBuffer is toggled", () => {
    const { desc, emit } = createLive();
    const seen = recordRequirements(desc, emit);

    desc.onUpdateConfig({ aerialPerspective: { useNormalBuffer: false } });
    expect(seen).toEqual([[]]);

    desc.onUpdateConfig({ aerialPerspective: { useNormalBuffer: true } });
    expect(seen).toEqual([[], ["normal"]]);
  });

  it("re-derives the G-buffers when a term needs them again", () => {
    const { desc, emit } = createLive({
      useNormalBuffer: false,
      shadow: true,
    });
    const seen = recordRequirements(desc, emit);

    desc.onUpdateConfig({ aerialPerspective: { useNormalBuffer: true } });
    expect(seen).toEqual([["normal", "shadow"]]);

    desc.onUpdateConfig({ aerialPerspective: { shadow: false } });
    expect(seen).toEqual([["normal", "shadow"], ["normal"]]);
  });

  it("leaves the G-buffers alone when the requirements do not change", () => {
    const { desc, emit } = createLive({ useNormalBuffer: false });

    desc.onUpdateConfig({ aerialPerspective: { irradiance: true } });
    desc.onUpdateConfig({ aerialPerspective: { shadow: true } });
    desc.onUpdateConfig({ aerialPerspective: { useNormalBuffer: false } });

    expect(emit).not.toHaveBeenCalledWith("gbufferRequirementsChanged");
  });
});
