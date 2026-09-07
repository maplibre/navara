// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="../external/types/n8ao.d.ts" />

import type { Nullable } from "@navaramap/core";
import { Color, Pass, type EffectOptions } from "@navaramap/three";
import { N8AOPostPass, type QualityMode } from "n8ao";
import { Scene, type Camera } from "three";

export { ToneMappingMode } from "postprocessing";

export { type QualityMode as SSAOQualityMode } from "n8ao";

export type SSAOOptions = {
  samples?: Nullable<number>;
  radius?: Nullable<number>;
  intensity?: number;
  color?: Color;
  halfRes?: Nullable<boolean>;
  quality?: QualityMode;
} & EffectOptions;

export const DEFAULT_SSAO_OPTIONS: Required<SSAOOptions> = {
  enabled: true,
  samples: null,
  radius: null,
  intensity: 1,
  color: new Color().setHex(0),
  halfRes: false,
  quality: "Low",
};

export class SSAO extends Pass<N8AOPostPass, unknown, SSAOOptions> {
  camera: Camera;
  width: number;
  height: number;

  constructor(
    camera: Camera,
    width: number,
    height: number,
    options?: SSAOOptions,
  ) {
    const pass = new N8AOPostPass(
      // This is used only for a transparent scene, but we aren't using it, so we just assign an empty scene.
      new Scene(),
      camera,
      width,
      height,
    );
    super(pass, null, { ...DEFAULT_SSAO_OPTIONS, ...options });

    this.camera = camera;
    this.width = width;
    this.height = height;
  }

  protected onMounted(): void {
    if (!this.rawPass) return;

    const quality = this.quality;
    this.quality = quality;

    if (this.options.samples) {
      this.samples = this.options.samples;
    }
    if (this.options.radius) {
      this.radius = this.options.radius;
    }
    if (this.options.halfRes != null) {
      this.halfRes = this.options.halfRes;
    }

    const intensity = this.intensity;
    this.intensity = intensity;
    const color = this.color;
    this.color = color;

    this.rawPass.configuration.gammaCorrection = false;
    // Navara manages transparency.
    this.rawPass.autoDetectTransparency = false;
    // The composer buffer this pass copies into can carry live scene depth
    // (depends on swap parity); n8ao leaves depthTest on, which culls the copy
    // for anything nearer than sqrt(far) under logarithmic depth.
    this.rawPass.copyQuad.material.depthTest = false;
  }

  get quality() {
    return this.options.quality ?? DEFAULT_SSAO_OPTIONS.quality;
  }
  set quality(v: QualityMode) {
    this.options.quality = v;

    if (!this.rawPass) return;
    this.rawPass.setQualityMode(v);

    this.emit("needsUpdate");
  }
  get halfRes() {
    return this.options.halfRes ?? !!DEFAULT_SSAO_OPTIONS.halfRes;
  }
  set halfRes(v: boolean) {
    this.options.halfRes = v;

    if (!this.rawPass) return;
    this.rawPass.configuration.halfRes = v;

    this.emit("needsUpdate");
  }
  get samples() {
    return this.options.samples ?? DEFAULT_SSAO_OPTIONS.samples;
  }
  set samples(v: Nullable<number>) {
    this.options.samples = v;

    if (!this.rawPass) return;
    this.rawPass.configuration.aoSamples =
      v ?? this.rawPass.configuration.aoSamples;

    this.emit("needsUpdate");
  }
  get radius() {
    return this.options.radius ?? DEFAULT_SSAO_OPTIONS.radius;
  }
  set radius(v: Nullable<number>) {
    this.options.radius = v;

    if (!this.rawPass) return;
    this.rawPass.configuration.aoRadius =
      v ?? this.rawPass.configuration.aoRadius;

    this.emit("needsUpdate");
  }
  get intensity() {
    return this.options.intensity ?? DEFAULT_SSAO_OPTIONS.intensity;
  }
  set intensity(v: number) {
    this.options.intensity = v;

    if (!this.rawPass) return;
    this.rawPass.configuration.intensity = v;

    this.emit("needsUpdate");
  }
  get color() {
    return this.options.color ?? DEFAULT_SSAO_OPTIONS.color;
  }
  set color(v: Color) {
    this.options.color = v;

    if (!this.rawPass) return;
    this.rawPass.configuration.color = v.raw;

    this.emit("needsUpdate");
  }
}
