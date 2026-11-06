import type ThreeView from "@navaramap/three";
import {
  Pass,
  SelectiveEffectDesc,
  type EffectConfig,
  type EffectUpdate,
  type GBufferName,
  type MRTPassEffectDesc,
  type ViewContext,
} from "@navaramap/three";

import {
  BuildingWindowsPass,
  DEFAULT_BUILDING_WINDOWS_OPTIONS,
  type BuildingWindowsOptions,
} from "./buildingWindows";

export type { BuildingWindowsOptions } from "./buildingWindows";

type Description = {
  buildingWindows?: BuildingWindowsOptions;
};

export type BuildingWindowsConfig = Description & EffectConfig;

export type BuildingWindowsUpdate = Description & EffectUpdate;

/**
 * Lit windows on the walls of the layers that list this effect in their
 * `effectIds`: a floor/column grid anchored to the world, with the lit share
 * rising with height above the ground. Works on any geometry that writes the
 * G-buffer (extruded polygons, 3D Tiles), since it reads normal, depth and
 * effect ids after the MRT pass.
 *
 * Runs right after `mrt`. The built-in `selectiveBloom` is inserted the same
 * way, so add `selectiveBloom` first and `buildingWindows` second for the
 * windows to be drawn before the bloom composite.
 */
export class BuildingWindowsEffectDesc extends SelectiveEffectDesc<
  BuildingWindowsConfig & { selectiveEffect?: true },
  BuildingWindowsUpdate
> {
  static key = "buildingWindows";
  static insertAfter = ["mrt"];
  static insertBefore = ["transparent"];
  static requiredBuffers: readonly GBufferName[] = [
    "normal",
    "selectiveEffect",
  ];

  /** Options with the defaults filled in; the pass reads these every frame. */
  readonly options: Required<BuildingWindowsOptions>;

  constructor(
    view: ThreeView,
    ctx: ViewContext,
    config: BuildingWindowsConfig,
  ) {
    super(view, ctx, { ...config, selectiveEffect: true });
    this.options = {
      ...DEFAULT_BUILDING_WINDOWS_OPTIONS,
      ...config.buildingWindows,
    };
  }

  /** Camera height above the ellipsoid in meters. */
  getCameraHeight(): number {
    return this.view.camera.positionGeographic.height;
  }

  onUpdateConfig(updates: BuildingWindowsUpdate): void {
    super.onUpdateConfig(updates);
    Object.assign(this.options, updates.buildingWindows);
  }

  createPass(): Pass<BuildingWindowsPass, null> {
    const mrt = this.find<MRTPassEffectDesc>("mrt");
    if (!mrt) throw new Error("BuildingWindowsEffectDesc: MRT pass not found.");
    return new Pass(
      new BuildingWindowsPass(this, this.view.camera.raw, mrt),
      null,
      { enabled: true },
    );
  }
}
