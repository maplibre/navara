import type { DepthPackingStrategies, Texture } from "three";
import invariant from "tiny-invariant";

import {
  EffectDesc,
  type EffectConfig,
  type EffectUpdate,
} from "../../core/EffectDesc";
import type { ViewContext } from "../../core/ViewContext";
import type ThreeView from "../../index";
import { CustomRenderPass } from "../../passes";

type Description = {
  mrt?: {
    debugNormal?: boolean;
  };
};

export type MRTPassConfig = Description & EffectConfig;

export type MRTPassUpdate = Description & EffectUpdate;

export class MRTPassEffectDesc extends EffectDesc<
  MRTPassConfig,
  MRTPassUpdate,
  CustomRenderPass
> {
  static key = "mrt";
  // No insertAfter/Before - this is typically the first pass

  private config: MRTPassConfig;

  constructor(view: ThreeView, ctx: ViewContext, config: MRTPassConfig) {
    super(view, ctx, config);
    this.config = config;
  }

  createPass(): CustomRenderPass {
    // Create render pass for MRT scene
    const scenes = this.ctx.scenes;
    const camera = this.view.camera.raw;

    invariant(this.view.globe);

    const pass = new CustomRenderPass(
      scenes,
      camera,
      this.ctx.getInputBuffer(),
      this.view.globe,
      {
        debugNormal: !!this.config.mrt?.debugNormal,
        buffers: this.view.buffers,
        lit: this.view.lit,
        reversedDepth: this.ctx.getRenderer().capabilities.reversedDepthBuffer,
      },
    );

    return pass;
  }

  get normalBuffer(): Texture | undefined {
    const pass = this.raw;
    const index = pass?.textureIndex.normal;
    return index === undefined
      ? undefined
      : pass?.gbufferRenderTarget.textures[index];
  }

  /**
   * Selective-effect bitmask buffer (R=bitmask).
   * `undefined` when the view disabled `buffers.selectiveEffect`.
   */
  get effectIdsBuffer(): Texture | undefined {
    const index = this.raw?.textureIndex.effectIds;
    return index === undefined
      ? undefined
      : this.raw?.gbufferRenderTarget.textures[index];
  }

  /**
   * Emissive RGB buffer (HDR).
   * `undefined` when the view disabled `buffers.emissive`.
   */
  get emissiveBuffer(): Texture | undefined {
    const index = this.raw?.textureIndex.emissive;
    return index === undefined
      ? undefined
      : this.raw?.gbufferRenderTarget.textures[index];
  }

  /**
   * Shadow buffer (R=shadow amount, 0=lit..1=fully shadowed).
   * `undefined` unless an active effect requires the `shadow` buffer.
   */
  get shadowBuffer(): Texture | undefined {
    const index = this.raw?.textureIndex.shadow;
    return index === undefined
      ? undefined
      : this.raw?.gbufferRenderTarget.textures[index];
  }

  get depthBuffer(): Texture | undefined {
    return this.raw?.allDepthCopyPass.texture;
  }

  get depthBufferPacking(): DepthPackingStrategies | undefined {
    return this.raw?.allDepthCopyPass.depthPacking;
  }

  get globeNormalBuffer(): Texture | undefined {
    return this.raw?.globeNormalCopyPass.texture;
  }

  get globeDepthBuffer(): Texture | undefined {
    return this.raw?.globeDepthCopyPass.texture;
  }

  get globeDepthBufferPacking(): DepthPackingStrategies | undefined {
    return this.raw?.globeDepthCopyPass.depthPacking;
  }

  onUpdateConfig(updates: MRTPassUpdate): void {
    super.onUpdateConfig(updates);

    if (!this._instance) return;

    Object.assign(this.config, updates);

    if (updates.mrt?.debugNormal !== undefined) {
      // TODO: Support
    }
  }

  onDestroy(): void {
    super.onDestroy();
  }
}
