import { Effect, createReplacer, type EffectOptions } from "@navaramap/three";
import { DepthOfFieldEffect, BlendFunction } from "postprocessing";
import type { Camera } from "three";

export type DepthOfFieldOptions = {
  /** Normalized focus distance that defines where the focus plane is, Range is [0.0, 1.0]. */
  focusDistance?: number;
  /** Virtual lens focal length that controls how quickly sharpness falls off around the focus plane, Range is [0.0, 1.0]. */
  focalLength?: number;
  /** Multiplier applied to the blur kernel that scales the apparent size of bokeh highlights. */
  bokehScale?: number;
} & EffectOptions;

export const DEFAULT_DEPTH_OF_FIELD_OPTIONS: Required<DepthOfFieldOptions> = {
  enabled: false,
  focusDistance: 1000,
  focalLength: 1000,
  bokehScale: 7,
};

// postprocessing turns a reversed depth into a standard one before calling
// three's perspectiveDepthToViewZ, which undoes a reversed depth itself.
const COC_REVERSED_DEPTH_FLIP =
  "#elif defined(USE_REVERSED_DEPTH_BUFFER)\ndepth=1.0-depth;\n";

export class DepthOfField extends Effect<
  DepthOfFieldEffect,
  DepthOfFieldOptions
> {
  constructor(camera: Camera, options?: DepthOfFieldOptions) {
    const effect = new DepthOfFieldEffect();
    // Throws once postprocessing stops flipping, so the patch goes with it.
    const coc = effect.cocMaterial;
    coc.fragmentShader = createReplacer(coc.fragmentShader).replace(
      COC_REVERSED_DEPTH_FLIP,
      "",
    ).source;
    super(camera, effect, options);
  }

  protected onMounted(): void {
    if (!this.rawEffect) return;
    this.rawEffect.blendMode.blendFunction = BlendFunction.NORMAL;
    this.rawEffect.cocMaterial.uniforms.focusDistance.value =
      this.options.focusDistance ??
      DEFAULT_DEPTH_OF_FIELD_OPTIONS.focusDistance;
    this.rawEffect.cocMaterial.uniforms.focalLength.value =
      this.options.focalLength ?? DEFAULT_DEPTH_OF_FIELD_OPTIONS.focalLength;
    this.rawEffect.bokehScale =
      this.options.bokehScale ?? DEFAULT_DEPTH_OF_FIELD_OPTIONS.bokehScale;
  }

  get focusDistance() {
    return (
      this.options.focusDistance ?? DEFAULT_DEPTH_OF_FIELD_OPTIONS.focusDistance
    );
  }

  set focusDistance(v: number) {
    if (this.options.focusDistance === v) return;
    this.options.focusDistance = v;
    if (!this.rawEffect) return;
    this.rawEffect.cocMaterial.uniforms.focusDistance.value = v;
    this.emit("needsUpdate");
  }

  get focalLength() {
    return (
      this.options.focalLength ?? DEFAULT_DEPTH_OF_FIELD_OPTIONS.focalLength
    );
  }

  set focalLength(v: number) {
    if (this.options.focalLength === v) return;
    this.options.focalLength = v;
    if (!this.rawEffect) return;
    this.rawEffect.cocMaterial.uniforms.focalLength.value = v;
    this.emit("needsUpdate");
  }

  get bokehScale() {
    return this.options.bokehScale ?? DEFAULT_DEPTH_OF_FIELD_OPTIONS.bokehScale;
  }

  set bokehScale(v: number) {
    if (this.options.bokehScale === v) return;
    this.options.bokehScale = v;
    if (!this.rawEffect) return;
    this.rawEffect.bokehScale = v;
    this.emit("needsUpdate");
  }
}
