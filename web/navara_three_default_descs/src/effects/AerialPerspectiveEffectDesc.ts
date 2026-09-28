import type ThreeView from "@navaramap/three";
import {
  EffectDesc,
  type EffectConfig,
  type EffectUpdate,
  type ViewContext,
  type MRTPassEffectDesc,
  type GBufferName,
} from "@navaramap/three";
import invariant from "tiny-invariant";

import {
  AerialPerspective,
  type AerialPerspectiveOptions,
  type AerialPerspectiveLightingOptions,
} from "./aerialPerspective/index";

/**
 * The flat `shadow*` and `specular*` keys are the lighting terms.
 * `irradiance` lighting is Lambertian only, so it drops the cascaded shadows
 * (`view.lit = false` skips the forward shadow term) and has no specular; the
 * terms add them back inside the aerial perspective's own lighting. Both
 * require `irradiance` and `useNormalBuffer`. Cloud shadows belong to the
 * clouds effect.
 */
type Description = {
  aerialPerspective?: Omit<AerialPerspectiveOptions, "enabled">;
};

export type AerialPerspectiveConfig = Description & EffectConfig;

export type AerialPerspectiveUpdate = Description & EffectUpdate;

const REQUIRED_BUFFERS: readonly GBufferName[] = ["normal"];
const REQUIRED_BUFFERS_WITH_SHADOW: readonly GBufferName[] = [
  "normal",
  "shadow",
];

export class AerialPerspectiveEffectDesc extends EffectDesc<
  AerialPerspectiveConfig,
  AerialPerspectiveUpdate,
  AerialPerspective
> {
  static key = "aerialPerspective";
  static insertAfter = ["mrt"];

  private config: AerialPerspectiveConfig;
  private shadowTerm: boolean;
  private specularTerm: boolean;

  constructor(
    view: ThreeView,
    ctx: ViewContext,
    config: AerialPerspectiveConfig,
  ) {
    super(view, ctx, config);
    this.config = config;
    const description = config.aerialPerspective ?? {};
    this.shadowTerm = description.shadow ?? false;
    this.specularTerm = description.specular ?? false;
  }

  /**
   * Both terms read the shadow attachment: R for the shadow amount, G for the
   * deferred-lit mask. Read before `onCreate`.
   */
  getRequiredBuffers(): readonly GBufferName[] {
    return this.shadowTerm || this.specularTerm
      ? REQUIRED_BUFFERS_WITH_SHADOW
      : REQUIRED_BUFFERS;
  }

  createPass() {
    const mrtPass = this.find<MRTPassEffectDesc>("mrt");
    invariant(mrtPass?.depthBuffer);

    const pass = new AerialPerspective(
      this.view.atmosphere,
      this.view.camera.raw,
      null,
      {
        ...this.config.aerialPerspective,
        enabled: this.config.visible ?? true,
      },
    );

    pass.raw.setCustomDepthTexture(
      mrtPass.depthBuffer,
      mrtPass.depthBufferPacking,
    );

    return pass;
  }

  onUpdateConfig(updates: AerialPerspectiveUpdate): void {
    super.onUpdateConfig(updates);

    if (!this._instance) return;
    Object.assign(this.config, updates);

    const config = updates.aerialPerspective;
    if (!config) return;

    if (config.inscatter !== undefined) {
      this._instance.inscatter = config.inscatter;
    }
    if (config.transmittance !== undefined) {
      this._instance.transmittance = config.transmittance;
    }
    if (config.irradiance !== undefined) {
      this._instance.irradiance = config.irradiance;
    }
    if (config.sky !== undefined) {
      this._instance.sky = config.sky;
    }
    if (config.sun !== undefined) {
      this._instance.sun = config.sun;
    }
    if (config.moon !== undefined) {
      this._instance.moon = config.moon;
    }
    if (config.albedoScale !== undefined) {
      this._instance.albedoScale = config.albedoScale;
    }
    if (config.useNormalBuffer !== undefined) {
      this._instance.useNormalBuffer = config.useNormalBuffer;
    }
    this.updateLighting(config);
  }

  private updateLighting(config: AerialPerspectiveLightingOptions): void {
    invariant(this._instance);
    const effect = this._instance.rawEffect;

    const wasEnabled = this.shadowTerm || this.specularTerm;
    if (config.shadow !== undefined) {
      this.shadowTerm = config.shadow;
    }
    if (config.specular !== undefined) {
      this.specularTerm = config.specular;
    }
    const enabled = this.shadowTerm || this.specularTerm;
    if (enabled && !wasEnabled) {
      // Allocates the shadow attachment before the shader reads it; the
      // depth texture identity survives the MRT rebuild.
      try {
        this.ctx.emit("gbufferRequirementsChanged");
      } catch (error) {
        // A rejected attachment (MAX_DRAW_BUFFERS) must not leave the terms
        // on, or every later re-derivation fails too.
        this.shadowTerm = false;
        this.specularTerm = false;
        throw error;
      }
    }
    effect.shadowTerm = this.shadowTerm;
    effect.specularTerm = this.specularTerm;
    if (!enabled && wasEnabled) {
      // Releases the shadow attachment.
      this.ctx.emit("gbufferRequirementsChanged");
    }

    if (config.shadowIntensity !== undefined) {
      effect.shadowIntensity = config.shadowIntensity;
    }
    if (config.shadowSoftness !== undefined) {
      effect.shadowSoftness = config.shadowSoftness;
    }
    if (config.shadowSamples !== undefined) {
      effect.shadowSamples = config.shadowSamples;
    }
    if (config.specularIntensity !== undefined) {
      effect.specularIntensity = config.specularIntensity;
    }
  }

  update(_time: number): void {
    const instance = this._instance;
    if (!instance) return;

    // Re-fetched every frame: a G-buffer rebuild swaps the texture objects.
    instance.setNormalBuffer(this.ctx.getNormalTexture() ?? null);
    instance.rawEffect.setShadowBuffer(this.ctx.getShadowTexture() ?? null);
    instance._update();
  }
}
