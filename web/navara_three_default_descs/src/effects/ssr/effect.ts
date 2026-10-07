import { type BlendMode, Effect, type EffectOptions } from "@navaramap/three";
import type { Camera, Texture } from "three";

import {
  SSREffect as SSREffectImpl,
  ssrEffectOptionsDefaults,
} from "./SSREffect";

export type SSROptions = {
  /**
   * Geometry buffer used for reflection calculations. When unset or `null`,
   * the engine's MRT normal buffer is used. Supplying a custom screen-aligned
   * texture lets applications control where SSR applies (e.g. puddles).
   *
   * Each texel must follow the engine's G-buffer encoding:
   * `.xy` = octahedral-packed view-space normal (`packNormalToVec2` from
   * `@takram/three-geospatial/shaders` `packing`);
   * `.z` = reflectance at normal incidence (F0), e.g. 0.02 for water, 0.04
   * for other dielectrics and 1 for a mirror — it sets the Fresnel strength
   * of the reflection, and SSR is skipped where `.z < 0.01`;
   * `.w` = roughness — SSR is skipped where it is 1; with cone tracing
   * (default) it drives the blur cone angle, without cone tracing it
   * multiplies `.z` for the GGX ray jitter.
   *
   * Updating the *contents* of the texture (render-to-texture) takes effect
   * automatically; only swapping the texture *object* requires an update call.
   */
  geometryBuffer?: Texture | null;
  /** Resolution scale factor for SSR rendering (0-1, lower values improve performance) */
  resolutionScale?: number;
  /** Maximum number of ray marching iterations for finding reflection intersections */
  iterations?: number;
  /** Number of binary search refinement steps to improve reflection accuracy */
  binarySearchIterations?: number;
  /** Depth buffer precision threshold for pixel rejection */
  pixelZSize?: number;
  /**
   * Step size in pixels for ray marching along screen space. It is scaled
   * by the renderer's pixel ratio, so `iterations` reaches the same share of
   * the screen on any display density.
   */
  pixelStride?: number;
  /**
   * View distance over which `pixelStride` shrinks to 1 pixel. Rays cast from
   * surfaces beyond it step one pixel at a time, so they reach at most
   * `iterations` pixels.
   */
  pixelStrideZCutoff?: number;
  /** Maximum distance a reflection ray can travel in world units */
  maxRayDistance?: number;
  /** Screen position (0-1) where edge fade begins to hide artifacts */
  screenEdgeFadeStart?: number;
  /** Start angle (radians) for fading reflections based on viewing angle */
  eyeFadeStart?: number;
  /** End angle (radians) for fading reflections based on viewing angle */
  eyeFadeEnd?: number;
  /**
   * Offsets each ray's start along its own stride, trading the banding of a
   * coarse `pixelStride` for noise that the resolve then averages away. Only
   * meaningful with cone tracing enabled, which is where the resolve lives -
   * with `useConeTracing: false` nothing averages the rays and any non-zero
   * value dithers reflection silhouettes into visible speckle.
   */
  jitter?: number;
  /** Blend function for compositing reflections with the scene */
  blendMode?: BlendMode;
  /** Enable cone tracing that improves visual quality, but it might take a cost. */
  useConeTracing?: boolean;
  /** A ratio thats starts fading reflections */
  coneTracingFadeStart?: number;
  /** A ratio that ends fading reflections */
  coneTracingFadeEnd?: number;
  /** The max distance at which a reflection is visible */
  coneTracingMaxDistance?: number;
  /** The number of iteration to accumulate the cone tracing */
  coneTracingIteration?: number;
  /**
   * Width, in ray-buffer texels, of the neighbourhood the resolve gathers when
   * cone tracing is enabled. One ray per pixel makes reflecting a binary
   * decision; averaging the neighbours turns it into a continuous coverage, so
   * reflection silhouettes get antialiased and jittered rays become extra
   * samples of the same lobe instead of noise. Larger is smoother and softer.
   * Odd numbers only.
   */
  resolveKernelSize?: number;
} & EffectOptions;

export const DEFAULT_SSR_OPTIONS: Required<SSROptions> = {
  enabled: false,
  geometryBuffer: null,
  resolutionScale: 0.5,
  iterations: 100,
  binarySearchIterations: 4,
  pixelZSize: 100,
  pixelStride: 5,
  pixelStrideZCutoff: 1000,
  maxRayDistance: 5000,
  screenEdgeFadeStart: 0.75,
  eyeFadeStart: 0,
  eyeFadeEnd: 1,
  jitter: 1,
  blendMode: "normal",
  useConeTracing: true,
  coneTracingFadeStart: ssrEffectOptionsDefaults.coneTracingFadeStart,
  coneTracingFadeEnd: ssrEffectOptionsDefaults.coneTracingFadeEnd,
  coneTracingMaxDistance: ssrEffectOptionsDefaults.coneTracingMaxDistance,
  coneTracingIteration: ssrEffectOptionsDefaults.coneTracingIteration,
  resolveKernelSize: ssrEffectOptionsDefaults.resolveKernelSize,
};

export class SSR extends Effect<SSREffectImpl, SSROptions> {
  constructor(camera: Camera, _options: SSROptions = {}) {
    const options = { ...DEFAULT_SSR_OPTIONS, ..._options };
    const effect = new SSREffectImpl(camera, {
      geometryBuffer: options.geometryBuffer,
      resolutionScale: options.resolutionScale,
      iterations: options.iterations,
      binarySearchIterations: options.binarySearchIterations,
      pixelZSize: options.pixelZSize,
      pixelStride: options.pixelStride,
      pixelStrideZCutoff: options.pixelStrideZCutoff,
      maxRayDistance: options.maxRayDistance,
      screenEdgeFadeStart: options.screenEdgeFadeStart,
      eyeFadeStart: options.eyeFadeStart,
      eyeFadeEnd: options.eyeFadeEnd,
      jitter: options.jitter,
      blendMode: options.blendMode,
      useConeTracing: options.useConeTracing,
      coneTracingFadeStart: options.coneTracingFadeStart,
      coneTracingFadeEnd: options.coneTracingFadeEnd,
      coneTracingMaxDistance: options.coneTracingMaxDistance,
      coneTracingIteration: options.coneTracingIteration,
      resolveKernelSize: options.resolveKernelSize,
    });

    super(camera, effect, options);

    this.options = options;
    this.init();
  }

  init() {
    if (!this.rawEffect) return;

    // Set initial values from options - check for undefined
    if (this.options.resolutionScale !== undefined) {
      this.resolutionScale = this.options.resolutionScale;
    }
    if (this.options.iterations !== undefined) {
      this.iterations = this.options.iterations;
    }
    if (this.options.binarySearchIterations !== undefined) {
      this.binarySearchIterations = this.options.binarySearchIterations;
    }
    if (this.options.pixelZSize !== undefined) {
      this.pixelZSize = this.options.pixelZSize;
    }
    if (this.options.pixelStride !== undefined) {
      this.pixelStride = this.options.pixelStride;
    }
    if (this.options.pixelStrideZCutoff !== undefined) {
      this.pixelStrideZCutoff = this.options.pixelStrideZCutoff;
    }
    if (this.options.maxRayDistance !== undefined) {
      this.maxRayDistance = this.options.maxRayDistance;
    }
    if (this.options.screenEdgeFadeStart !== undefined) {
      this.screenEdgeFadeStart = this.options.screenEdgeFadeStart;
    }
    if (this.options.eyeFadeStart !== undefined) {
      this.eyeFadeStart = this.options.eyeFadeStart;
    }
    if (this.options.eyeFadeEnd !== undefined) {
      this.eyeFadeEnd = this.options.eyeFadeEnd;
    }
    if (this.options.jitter !== undefined) {
      this.jitter = this.options.jitter;
    }
    if (this.options.useConeTracing !== undefined) {
      this.useConeTracing = this.options.useConeTracing;
    }
    if (this.options.coneTracingFadeStart !== undefined) {
      this.coneTracingFadeStart = this.options.coneTracingFadeStart;
    }
    if (this.options.coneTracingFadeEnd !== undefined) {
      this.coneTracingFadeEnd = this.options.coneTracingFadeEnd;
    }
    if (this.options.coneTracingMaxDistance !== undefined) {
      this.coneTracingMaxDistance = this.options.coneTracingMaxDistance;
    }
    if (this.options.coneTracingIteration !== undefined) {
      this.coneTracingIteration = this.options.coneTracingIteration;
    }
  }

  // Getter and setter properties for all SSR parameters
  get geometryBuffer(): Texture | null {
    return this.rawEffect.geometryBuffer;
  }
  set geometryBuffer(v: Texture | null) {
    this.rawEffect.geometryBuffer = v;
    this.options.geometryBuffer = v;
    this.emit("needsUpdate");
  }

  get resolutionScale(): number {
    return this.options.resolutionScale ?? DEFAULT_SSR_OPTIONS.resolutionScale;
  }
  set resolutionScale(v: number) {
    if (!this.rawEffect) return;
    this.options.resolutionScale = v;
    this.rawEffect.resolutionScale = v;
    this.emit("needsUpdate");
  }

  get iterations(): number {
    return this.options.iterations ?? DEFAULT_SSR_OPTIONS.iterations;
  }
  set iterations(v: number) {
    if (!this.rawEffect) return;
    this.options.iterations = v;
    this.rawEffect.iterations = v;
    this.emit("needsUpdate");
  }

  get binarySearchIterations(): number {
    return (
      this.options.binarySearchIterations ??
      DEFAULT_SSR_OPTIONS.binarySearchIterations
    );
  }
  set binarySearchIterations(v: number) {
    if (!this.rawEffect) return;
    this.options.binarySearchIterations = v;
    this.rawEffect.binarySearchIterations = v;
    this.emit("needsUpdate");
  }

  get pixelZSize(): number {
    return this.options.pixelZSize ?? DEFAULT_SSR_OPTIONS.pixelZSize;
  }
  set pixelZSize(v: number) {
    if (!this.rawEffect) return;
    this.options.pixelZSize = v;
    this.rawEffect.pixelZSize = v;
    this.emit("needsUpdate");
  }

  get pixelStride(): number {
    return this.options.pixelStride ?? DEFAULT_SSR_OPTIONS.pixelStride;
  }
  set pixelStride(v: number) {
    if (!this.rawEffect) return;
    this.options.pixelStride = v;
    this.rawEffect.pixelStride = v;
    this.emit("needsUpdate");
  }

  get pixelStrideZCutoff(): number {
    return (
      this.options.pixelStrideZCutoff ?? DEFAULT_SSR_OPTIONS.pixelStrideZCutoff
    );
  }
  set pixelStrideZCutoff(v: number) {
    if (!this.rawEffect) return;
    this.options.pixelStrideZCutoff = v;
    this.rawEffect.pixelStrideZCutoff = v;
    this.emit("needsUpdate");
  }

  get maxRayDistance(): number {
    return this.options.maxRayDistance ?? DEFAULT_SSR_OPTIONS.maxRayDistance;
  }
  set maxRayDistance(v: number) {
    if (!this.rawEffect) return;
    this.options.maxRayDistance = v;
    this.rawEffect.maxRayDistance = v;
    this.emit("needsUpdate");
  }

  get screenEdgeFadeStart(): number {
    return (
      this.options.screenEdgeFadeStart ??
      DEFAULT_SSR_OPTIONS.screenEdgeFadeStart
    );
  }
  set screenEdgeFadeStart(v: number) {
    if (!this.rawEffect) return;
    this.options.screenEdgeFadeStart = v;
    this.rawEffect.screenEdgeFadeStart = v;
    this.emit("needsUpdate");
  }

  get eyeFadeStart(): number {
    return this.options.eyeFadeStart ?? DEFAULT_SSR_OPTIONS.eyeFadeStart;
  }
  set eyeFadeStart(v: number) {
    if (!this.rawEffect) return;
    this.options.eyeFadeStart = v;
    this.rawEffect.eyeFadeStart = v;
    this.emit("needsUpdate");
  }

  get eyeFadeEnd(): number {
    return this.options.eyeFadeEnd ?? DEFAULT_SSR_OPTIONS.eyeFadeEnd;
  }
  set eyeFadeEnd(v: number) {
    if (!this.rawEffect) return;
    this.options.eyeFadeEnd = v;
    this.rawEffect.eyeFadeEnd = v;
    this.emit("needsUpdate");
  }

  get jitter(): number {
    return this.options.jitter ?? DEFAULT_SSR_OPTIONS.jitter;
  }
  set jitter(v: number) {
    if (!this.rawEffect) return;
    this.options.jitter = v;
    this.rawEffect.jitter = v;
    this.emit("needsUpdate");
  }

  get useConeTracing(): boolean {
    return this.options.useConeTracing ?? DEFAULT_SSR_OPTIONS.useConeTracing;
  }
  set useConeTracing(v: boolean) {
    if (!this.rawEffect) return;
    this.options.useConeTracing = v;
    this.rawEffect.useConeTracing = v;
    this.emit("needsUpdate");
  }

  get coneTracingFadeStart(): number {
    return (
      this.options.coneTracingFadeStart ??
      DEFAULT_SSR_OPTIONS.coneTracingFadeStart
    );
  }
  set coneTracingFadeStart(v: number) {
    if (!this.rawEffect) return;
    this.options.coneTracingFadeStart = v;
    this.rawEffect.coneTracingFadeStart = v;
    this.emit("needsUpdate");
  }

  get coneTracingFadeEnd(): number {
    return (
      this.options.coneTracingFadeEnd ?? DEFAULT_SSR_OPTIONS.coneTracingFadeEnd
    );
  }
  set coneTracingFadeEnd(v: number) {
    if (!this.rawEffect) return;
    this.options.coneTracingFadeEnd = v;
    this.rawEffect.coneTracingFadeEnd = v;
    this.emit("needsUpdate");
  }

  get coneTracingMaxDistance(): number {
    return (
      this.options.coneTracingMaxDistance ??
      DEFAULT_SSR_OPTIONS.coneTracingMaxDistance
    );
  }
  set coneTracingMaxDistance(v: number) {
    if (!this.rawEffect) return;
    this.options.coneTracingMaxDistance = v;
    this.rawEffect.coneTracingMaxDistance = v;
    this.emit("needsUpdate");
  }

  get coneTracingIteration(): number {
    return (
      this.options.coneTracingIteration ??
      DEFAULT_SSR_OPTIONS.coneTracingIteration
    );
  }
  set coneTracingIteration(v: number) {
    if (!this.rawEffect) return;
    this.options.coneTracingIteration = v;
    this.rawEffect.coneTracingIteration = v;
    this.emit("needsUpdate");
  }

  get resolveKernelSize(): number {
    return (
      this.options.resolveKernelSize ?? DEFAULT_SSR_OPTIONS.resolveKernelSize
    );
  }
  set resolveKernelSize(v: number) {
    if (!this.rawEffect) return;
    this.options.resolveKernelSize = v;
    this.rawEffect.resolveKernelSize = v;
    this.emit("needsUpdate");
  }
}
