import ThreeView, { type ViewContext } from "@navaramap/three";
import { describe, expect, it, vi } from "vitest";

import { DEFAULT_BUILDING_WINDOWS_OPTIONS } from "./buildingWindows/options";
import { BuildingWindowsEffectDesc } from "./BuildingWindowsEffectDesc";

// Importing the real @navaramap/three touches WASM at module load. The desc
// only needs its base class here; the pass is never built.
/* eslint-disable @typescript-eslint/no-extraneous-class */
vi.mock("@navaramap/three", () => ({
  default: class ThreeView {},
  Pass: class Pass {},
  SelectiveEffectDesc: class SelectiveEffectDesc {
    onUpdateConfig() {}
  },
}));
vi.mock("./buildingWindows", async () => ({
  BuildingWindowsPass: class BuildingWindowsPass {},
  DEFAULT_BUILDING_WINDOWS_OPTIONS: (await import("./buildingWindows/options"))
    .DEFAULT_BUILDING_WINDOWS_OPTIONS,
}));
/* eslint-enable @typescript-eslint/no-extraneous-class */

const view = new ThreeView();
// ViewContext has private members, so no object literal can satisfy it
// structurally; this desc reads none of it until createPass().
const ctx: ViewContext = {} as ViewContext;
const create = (
  config: ConstructorParameters<typeof BuildingWindowsEffectDesc>[2],
) => new BuildingWindowsEffectDesc(view, ctx, config);

describe("BuildingWindowsEffectDesc options", () => {
  it("fill the defaults and merge updates", () => {
    const desc = create({ buildingWindows: { litRatio: 0.7 } });
    expect(desc.options).toEqual({
      ...DEFAULT_BUILDING_WINDOWS_OPTIONS,
      litRatio: 0.7,
    });

    desc.onUpdateConfig({ buildingWindows: { floorHeight: 4 } });
    expect(desc.options).toEqual({
      ...DEFAULT_BUILDING_WINDOWS_OPTIONS,
      litRatio: 0.7,
      floorHeight: 4,
    });
  });
});
