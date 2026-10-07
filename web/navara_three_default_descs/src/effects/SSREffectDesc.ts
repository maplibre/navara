import type ThreeView from "@navaramap/three";
import {
  EffectDesc,
  type EffectConfig,
  type EffectUpdate,
  type ViewContext,
  type GBufferName,
} from "@navaramap/three";

import { SSR, type SSROptions } from "./ssr";

type Description = {
  ssr?: Omit<SSROptions, "enabled">;
};

export type SSRConfig = Description & EffectConfig;

export type SSRUpdate = Description & EffectUpdate;

export class SSREffectDesc extends EffectDesc<SSRConfig, SSRUpdate, SSR> {
  static key = "ssr";
  static requiredBuffers: readonly GBufferName[] = ["normal"];
  static insertBefore = ["transparent"];

  private config: SSRConfig;

  constructor(view: ThreeView, ctx: ViewContext, config: SSRConfig) {
    super(view, ctx, config);
    this.config = config;
  }

  createPass() {
    const pass = new SSR(this.view.camera.raw, {
      ...this.config.ssr,
      geometryBuffer: this.config.ssr?.geometryBuffer ?? null,
      enabled: this.config.visible ?? true,
    });

    return pass;
  }

  update(_time: number): void {
    if (!this._instance || this.config.ssr?.geometryBuffer) return;
    this._instance.geometryBuffer = this.ctx.getNormalTexture() ?? null;
  }

  onUpdateConfig(updates: SSRUpdate): void {
    super.onUpdateConfig(updates);

    if (!this._instance) return;
    Object.assign(this.config, updates);

    const config = updates.ssr;
    if (!config) return;

    // Update all SSR properties
    if (config.geometryBuffer !== undefined) {
      // null resets to the engine's MRT normal buffer
      this._instance.geometryBuffer =
        config.geometryBuffer ?? this.ctx.getNormalTexture() ?? null;
    }
    if (config.resolutionScale !== undefined) {
      this._instance.resolutionScale = config.resolutionScale;
    }
    if (config.iterations !== undefined) {
      this._instance.iterations = config.iterations;
    }
    if (config.binarySearchIterations !== undefined) {
      this._instance.binarySearchIterations = config.binarySearchIterations;
    }
    if (config.pixelZSize !== undefined) {
      this._instance.pixelZSize = config.pixelZSize;
    }
    if (config.pixelStride !== undefined) {
      this._instance.pixelStride = config.pixelStride;
    }
    if (config.pixelStrideZCutoff !== undefined) {
      this._instance.pixelStrideZCutoff = config.pixelStrideZCutoff;
    }
    if (config.maxRayDistance !== undefined) {
      this._instance.maxRayDistance = config.maxRayDistance;
    }
    if (config.screenEdgeFadeStart !== undefined) {
      this._instance.screenEdgeFadeStart = config.screenEdgeFadeStart;
    }
    if (config.eyeFadeStart !== undefined) {
      this._instance.eyeFadeStart = config.eyeFadeStart;
    }
    if (config.eyeFadeEnd !== undefined) {
      this._instance.eyeFadeEnd = config.eyeFadeEnd;
    }
    if (config.jitter !== undefined) {
      this._instance.jitter = config.jitter;
    }
    if (config.useConeTracing !== undefined) {
      this._instance.useConeTracing = config.useConeTracing;
    }
    if (config.coneTracingFadeStart !== undefined) {
      this._instance.coneTracingFadeStart = config.coneTracingFadeStart;
    }
    if (config.coneTracingFadeEnd !== undefined) {
      this._instance.coneTracingFadeEnd = config.coneTracingFadeEnd;
    }
    if (config.coneTracingMaxDistance !== undefined) {
      this._instance.coneTracingMaxDistance = config.coneTracingMaxDistance;
    }
    if (config.coneTracingIteration !== undefined) {
      this._instance.coneTracingIteration = config.coneTracingIteration;
    }
    if (config.resolveKernelSize !== undefined) {
      this._instance.resolveKernelSize = config.resolveKernelSize;
    }
  }
}
