// Research and development by https://github.com/takram-design-engineering

import { blendFunction, type BlendMode } from "@navaramap/three";
import fragmentShader from "@shaders/glsl/ssrEffect.frag.glsl?raw";
import {
  Effect,
  EffectAttribute,
  Resolution,
  ShaderPass,
} from "postprocessing";
import {
  FloatType,
  LinearFilter,
  NearestFilter,
  Uniform,
  WebGLRenderTarget,
  type Camera,
  type DepthPackingStrategies,
  type Texture,
  type TextureDataType,
  type WebGLRenderer,
} from "three";

import {
  ConeTracingPass,
  coneTracingPassOptionsDefaults,
} from "./ConeTracingPass";
import {
  SSRMaterial,
  ssrMaterialParametersDefaults,
  type SSRMaterialParameters,
} from "./SSRMaterial";

export type SSREffectOptions = {
  blendMode?: BlendMode;
  resolutionScale?: number;
  width?: number;
  height?: number;
  resolutionX?: number;
  resolutionY?: number;
  useConeTracing?: boolean;
  coneTracingFadeStart?: number;
  coneTracingFadeEnd?: number;
  coneTracingMaxDistance?: number;
  coneTracingIteration?: number;
  resolveKernelSize?: number;
} & Omit<SSRMaterialParameters, "inputBuffer" | "depthBuffer">;

export const ssrEffectOptionsDefaults = {
  blendMode: "normal",
  ...coneTracingPassOptionsDefaults,
} satisfies SSREffectOptions;

export class SSREffect extends Effect {
  readonly resolution: Resolution;
  readonly renderTarget: WebGLRenderTarget;
  readonly ssrMaterial: SSRMaterial;
  readonly ssrPass: ShaderPass;
  readonly coneRenderTarget: WebGLRenderTarget;
  readonly coneTracingPass: ConeTracingPass;
  private _useConeTracing: boolean;

  constructor(
    private camera: Camera,
    options?: SSREffectOptions,
  ) {
    const {
      blendMode,
      geometryBuffer = null,
      resolutionScale = 0.5,
      width,
      height,
      resolutionX = width,
      resolutionY = height,
      coneTracingFadeStart,
      coneTracingFadeEnd,
      coneTracingMaxDistance,
      coneTracingIteration,
      resolveKernelSize,
      useConeTracing,
      ...others
    } = {
      ...ssrMaterialParametersDefaults,
      ...ssrEffectOptionsDefaults,
      ...options,
    };
    super("SSREffect", fragmentShader, {
      blendFunction: blendFunction(blendMode),
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map<string, Uniform>([["ssrBuffer", new Uniform(null)]]),
    });

    // With cone tracing this target holds hit UVs and hit depth rather than
    // color. The default 8-bit unorm format quantizes a UV to 1/255 of the
    // screen, which snaps reflections onto a coarse grid, and it destroys the
    // logarithmic depth entirely, so full float precision is required.
    this.renderTarget = new WebGLRenderTarget(1, 1, {
      depthBuffer: false,
      stencilBuffer: false,
      type: FloatType,
    });
    this.renderTarget.texture.name = "SSR.Reflection";

    this.ssrMaterial = new SSRMaterial({
      ...others,
      generateRayTracingBuffer: useConeTracing,
    });
    this.ssrPass = new ShaderPass(this.ssrMaterial);
    this.ssrMaterial.geometryBuffer = geometryBuffer;

    this.coneRenderTarget = new WebGLRenderTarget(1, 1, {
      depthBuffer: false,
      stencilBuffer: false,
    });
    this.coneRenderTarget.texture.name = "ConeSSR.Reflection";
    this.coneTracingPass = new ConeTracingPass({
      fadeStart: coneTracingFadeStart,
      fadeEnd: coneTracingFadeEnd,
      maxDistance: coneTracingMaxDistance,
      rayTracingBuffer: this.renderTarget.texture,
      normalBuffer: geometryBuffer,
      specularBuffer: null,
      indirectSpecularBuffer: null,
      iteration: coneTracingIteration,
      resolveKernelSize,
    });

    this._useConeTracing = !!useConeTracing;
    this.updateRayTracingBufferFilter();

    const ssrBuffer = this.uniforms.get("ssrBuffer");
    if (ssrBuffer) {
      ssrBuffer.value = useConeTracing
        ? this.coneRenderTarget.texture
        : this.renderTarget.texture;
    }

    if (camera != null) {
      this.mainCamera = camera;
    }

    this.resolution = new Resolution(
      this,
      resolutionX,
      resolutionY,
      resolutionScale,
    );
    this.resolution.addEventListener("change", this.onResolutionChange);
  }

  private readonly onResolutionChange = (): void => {
    this.setSize(this.resolution.baseWidth, this.resolution.baseHeight);
  };

  /**
   * The ray tracing target is rendered at `resolutionScale` and read back at
   * full resolution. Hit UVs must not be interpolated across hit/miss
   * boundaries — the blend would produce coordinates pointing at unrelated
   * parts of the screen — whereas plain reflection color upsamples fine.
   */
  private updateRayTracingBufferFilter(): void {
    const filter = this._useConeTracing ? NearestFilter : LinearFilter;
    const texture = this.renderTarget.texture;
    if (texture.minFilter !== filter) {
      texture.minFilter = filter;
      texture.magFilter = filter;
      texture.needsUpdate = true;
    }
  }

  get mainCamera(): Camera {
    return this.camera;
  }

  override set mainCamera(value: Camera) {
    this.camera = value;
    this.ssrMaterial.copyCameraSettings(value);
    this.coneTracingPass.coneTracingMaterial.copyCameraSettings(this.camera);
  }

  override initialize(
    renderer: WebGLRenderer,
    alpha: boolean,
    frameBufferType: TextureDataType,
  ): void {
    this.ssrPass.initialize(renderer, alpha, frameBufferType);
    this.coneTracingPass.initialize(renderer, alpha, frameBufferType);
    // The resolve output holds premultiplied colour, so 8-bit would crush the
    // low end of a reflection as its coverage falls off.
    if (frameBufferType !== undefined) {
      this.coneRenderTarget.texture.type = frameBufferType;
    }
  }

  override update(
    renderer: WebGLRenderer,
    inputBuffer: WebGLRenderTarget,
    deltaTime?: number,
  ): void {
    this.ssrMaterial.uniforms.pixelRatio.value = renderer.getPixelRatio();

    // First pass: ray tracing
    this.ssrPass.render(renderer, inputBuffer, this.renderTarget);

    if (this.useConeTracing) {
      // Second pass: cone tracing
      this.coneTracingPass.update(renderer, inputBuffer, deltaTime);

      this.coneTracingPass.render(renderer, inputBuffer, this.coneRenderTarget);
    }
  }

  override setSize(width: number, height: number): void {
    const resolution = this.resolution;
    resolution.setBaseSize(width, height);
    this.renderTarget.setSize(resolution.width, resolution.height);
    this.ssrMaterial.setSize(resolution.width, resolution.height);
    this.ssrMaterial.copyCameraSettings(this.camera);
    this.coneRenderTarget.setSize(resolution.width, resolution.height);
    this.coneTracingPass.setSize(resolution.width, resolution.height);
    this.coneTracingPass.coneTracingMaterial.setRayBufferSize(
      resolution.width,
      resolution.height,
    );
    this.coneTracingPass.coneTracingMaterial.copyCameraSettings(this.camera);
  }

  override setDepthTexture(
    depthTexture: Texture,
    depthPacking?: DepthPackingStrategies,
  ): void {
    this.ssrMaterial.depthBuffer = depthTexture;
    this.ssrMaterial.depthPacking = depthPacking ?? 0;
    this.coneTracingPass.setDepthTexture(depthTexture, depthPacking);
  }

  get resolutionScale(): number {
    return this.resolution.scale;
  }

  set resolutionScale(value: number) {
    this.resolution.scale = value;
  }

  get geometryBuffer(): Texture | null {
    return this.ssrMaterial.geometryBuffer;
  }

  set geometryBuffer(value: Texture | null) {
    this.ssrMaterial.geometryBuffer = value;
    this.coneTracingPass.coneTracingMaterial.normalBuffer = value;
  }

  get iterations(): number {
    return this.ssrMaterial.uniforms.iterations.value;
  }

  set iterations(value: number) {
    this.ssrMaterial.uniforms.iterations.value = value;
  }

  get binarySearchIterations(): number {
    return this.ssrMaterial.uniforms.binarySearchIterations.value;
  }

  set binarySearchIterations(value: number) {
    this.ssrMaterial.uniforms.binarySearchIterations.value = value;
  }

  get pixelZSize(): number {
    return this.ssrMaterial.uniforms.pixelZSize.value;
  }

  set pixelZSize(value: number) {
    this.ssrMaterial.uniforms.pixelZSize.value = value;
  }

  get pixelStride(): number {
    return this.ssrMaterial.uniforms.pixelStride.value;
  }

  set pixelStride(value: number) {
    this.ssrMaterial.uniforms.pixelStride.value = value;
  }

  get pixelStrideZCutoff(): number {
    return this.ssrMaterial.uniforms.pixelStrideZCutoff.value;
  }

  set pixelStrideZCutoff(value: number) {
    this.ssrMaterial.uniforms.pixelStrideZCutoff.value = value;
  }

  get maxRayDistance(): number {
    return this.ssrMaterial.uniforms.maxRayDistance.value;
  }

  set maxRayDistance(value: number) {
    this.ssrMaterial.uniforms.maxRayDistance.value = value;
  }

  get screenEdgeFadeStart(): number {
    return this.ssrMaterial.uniforms.screenEdgeFadeStart.value;
  }

  set screenEdgeFadeStart(value: number) {
    this.ssrMaterial.uniforms.screenEdgeFadeStart.value = value;
  }

  get eyeFadeStart(): number {
    return this.ssrMaterial.uniforms.eyeFadeStart.value;
  }

  set eyeFadeStart(value: number) {
    this.ssrMaterial.uniforms.eyeFadeStart.value = value;
  }

  get eyeFadeEnd(): number {
    return this.ssrMaterial.uniforms.eyeFadeEnd.value;
  }

  set eyeFadeEnd(value: number) {
    this.ssrMaterial.uniforms.eyeFadeEnd.value = value;
  }

  get jitter(): number {
    return this.ssrMaterial.uniforms.jitter.value;
  }

  set jitter(value: number) {
    this.ssrMaterial.uniforms.jitter.value = value;
  }

  get useConeTracing() {
    return this._useConeTracing;
  }
  set useConeTracing(v: boolean) {
    this._useConeTracing = v;
    this.updateRayTracingBufferFilter();
    const ssrBuffer = this.uniforms.get("ssrBuffer");
    this.ssrMaterial.generateRayTracingBuffer = v;
    this.ssrMaterial.needsUpdate = true;
    if (ssrBuffer) {
      ssrBuffer.value = v
        ? this.coneRenderTarget.texture
        : this.renderTarget.texture;
    }
  }

  get coneTracingFadeStart(): number {
    return this.coneTracingPass.coneTracingMaterial.fadeStart;
  }
  set coneTracingFadeStart(value: number) {
    this.coneTracingPass.coneTracingMaterial.fadeStart = value;
  }

  get coneTracingFadeEnd(): number {
    return this.coneTracingPass.coneTracingMaterial.fadeEnd;
  }
  set coneTracingFadeEnd(value: number) {
    this.coneTracingPass.coneTracingMaterial.fadeEnd = value;
  }

  get coneTracingMaxDistance(): number {
    return this.coneTracingPass.coneTracingMaterial.maxDistance;
  }
  set coneTracingMaxDistance(value: number) {
    this.coneTracingPass.coneTracingMaterial.maxDistance = value;
  }

  get coneTracingIteration(): number {
    return this.coneTracingPass.coneTracingMaterial.iteration;
  }
  set coneTracingIteration(value: number) {
    this.coneTracingPass.coneTracingMaterial.iteration = value;
  }

  get resolveKernelSize(): number {
    return this.coneTracingPass.coneTracingMaterial.resolveKernelSize;
  }
  set resolveKernelSize(value: number) {
    this.coneTracingPass.coneTracingMaterial.resolveKernelSize = value;
  }
}
