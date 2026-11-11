import {
  EffectDesc,
  type EffectConfig,
  type EffectUpdate,
} from "../../core/EffectDesc";
import type { ViewContext } from "../../core/ViewContext";
import type ThreeView from "../../index";
import { SkyEnvMapPass } from "../../passes";

type Description = {
  skyEnvMap?: {
    resolution?: number;
  };
};

export type SkyEnvMapPassConfig = Description & EffectConfig;

export type SkyEnvMapPassUpdate = Description & EffectUpdate;

export class SkyEnvMapEffectDesc extends EffectDesc<
  SkyEnvMapPassConfig,
  SkyEnvMapPassUpdate,
  SkyEnvMapPass
> {
  static key = "skyEnvMap";
  static insertBefore = ["mrt"];

  private config: SkyEnvMapPassConfig;

  constructor(view: ThreeView, ctx: ViewContext, config: SkyEnvMapPassConfig) {
    super(view, ctx, config);
    this.config = config;
  }

  createPass(): SkyEnvMapPass {
    const scenes = this.ctx.scenes;
    const camera = this.view.camera.raw;

    const resolution = this.config.skyEnvMap?.resolution ?? 256;

    const pass = new SkyEnvMapPass(scenes, camera, resolution);

    return pass;
  }

  onUpdateConfig(updates: SkyEnvMapPassUpdate): void {
    super.onUpdateConfig(updates);

    if (!this._instance) return;

    Object.assign(this.config, updates);

    if (updates.skyEnvMap?.resolution !== undefined) {
      // Would need to recreate the pass to change resolution
      // For now, resolution is set at creation time only
    }
  }
}
