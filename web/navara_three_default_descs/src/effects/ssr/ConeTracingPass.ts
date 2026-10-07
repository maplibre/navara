import vertexShader from "@shaders/glsl/coneTracing.vert.glsl?raw";
import fragmentShader from "@shaders/glsl/coneTracingPrefilter.frag.glsl?raw";
import { ShaderPass } from "postprocessing";
import {
  LinearMipmapLinearFilter,
  NoBlending,
  ShaderMaterial,
  Texture,
  Uniform,
  UnsignedByteType,
  Vector2,
  WebGLRenderTarget,
  type WebGLRenderer,
  type TextureDataType,
  type DepthPackingStrategies,
} from "three";

import {
  ConeTracingMaterial,
  coneTracingMaterialParametersDefaults,
  type ConeTracingMaterialParameters,
} from "./ConeTracingMaterial";

export type ConeTracingPassOptions = {
  coneTracingFadeStart?: number;
  coneTracingFadeEnd?: number;
  coneTracingMaxDistance?: number;
  coneTracingIteration?: number;
  rayTracingBuffer?: Texture | null;
  normalBuffer?: Texture | null;
} & ConeTracingMaterialParameters;

export const coneTracingPassOptionsDefaults = {
  coneTracingFadeStart: coneTracingMaterialParametersDefaults.fadeStart,
  coneTracingFadeEnd: coneTracingMaterialParametersDefaults.fadeEnd,
  coneTracingMaxDistance: coneTracingMaterialParametersDefaults.maxDistance,
  coneTracingIteration: coneTracingMaterialParametersDefaults.iteration,
  resolveKernelSize: coneTracingMaterialParametersDefaults.resolveKernelSize,
  rayTracingBuffer: null,
  normalBuffer: null,
} satisfies ConeTracingPassOptions;

export class ConeTracingPass extends ShaderPass {
  readonly coneTracingMaterial: ConeTracingMaterial;

  readonly prefilterMaterial: ShaderMaterial;
  readonly prefilterPass: ShaderPass;
  readonly mippedRenderTarget: WebGLRenderTarget;

  private compressColor = false;

  constructor(options?: ConeTracingPassOptions) {
    const { rayTracingBuffer, normalBuffer, ...others } = {
      ...coneTracingMaterialParametersDefaults,
      ...coneTracingPassOptionsDefaults,
      ...options,
    };

    const material = new ConeTracingMaterial({
      ...coneTracingMaterialParametersDefaults,
      ...others,
      rayTracingBuffer,
      normalBuffer,
    });

    super(material);

    this.coneTracingMaterial = material;

    // A mipmap min filter is required for the shader's textureLod() to reach
    // the pre-convolved levels: with LinearFilter (the default) GL only ever
    // samples mip 0, so the roughness-driven blur silently does nothing and
    // the raw per-ray noise passes straight through.
    this.mippedRenderTarget = new WebGLRenderTarget(1, 1, {
      generateMipmaps: true,
      minFilter: LinearMipmapLinearFilter,
    });
    material.colorBuffer = this.mippedRenderTarget.texture;
    this.prefilterMaterial = new ShaderMaterial({
      name: "ConeTracingPrefilterMaterial",
      fragmentShader,
      vertexShader,
      uniforms: {
        inputBuffer: new Uniform(null),
        depthBuffer: new Uniform(null),
        exposure: new Uniform(1),
        resolution: new Uniform(new Vector2(1, 1)),
      },
      blending: NoBlending,
      toneMapped: false,
      depthWrite: false,
      depthTest: false,
    });
    this.prefilterPass = new ShaderPass(this.prefilterMaterial);
  }

  update(
    renderer: WebGLRenderer,
    inputBuffer: WebGLRenderTarget,
    _deltaTime?: number,
  ) {
    const exposure = this.compressColor ? renderer.toneMappingExposure : 0;
    this.prefilterMaterial.uniforms.exposure.value = exposure;
    this.coneTracingMaterial.uniforms.uPrefilterExposure.value = exposure;
    this.prefilterPass.render(renderer, inputBuffer, this.mippedRenderTarget);
  }

  override initialize(
    renderer: WebGLRenderer,
    alpha: boolean,
    frameBufferType: TextureDataType,
  ): void {
    super.initialize(renderer, alpha, frameBufferType);
    this.prefilterPass.initialize(renderer, alpha, frameBufferType);
    if (frameBufferType !== undefined) {
      this.mippedRenderTarget.texture.type = frameBufferType;
    }
    // The compressed colour spans only [0, 1 / exposure), which 8-bit would
    // quantise into a few dozen levels that the inverse then stretches.
    this.compressColor =
      this.mippedRenderTarget.texture.type !== UnsignedByteType;
  }

  setDepthTexture(
    depthTexture: Texture,
    _depthPacking?: DepthPackingStrategies,
  ): void {
    this.coneTracingMaterial.depthBuffer = depthTexture;
    this.prefilterMaterial.uniforms.depthBuffer.value = depthTexture;
  }

  /**
   * Sizes the *colour* buffer the cone samples and the mip chain built over
   * it. Both the mip count and the mip-level maths that indexes it are
   * expressed in these pixels, so passing the resolve's own resolution keeps
   * the physical blur radius identical while quartering the per-frame copy and
   * mipmap work. The resolve's output resolution never comes through here; it
   * is set by whichever render target the pass is asked to render into.
   */
  override setSize(width: number, height: number): void {
    this.coneTracingMaterial.setSize(width, height);
    this.mippedRenderTarget.setSize(width, height);
    this.prefilterMaterial.uniforms.resolution.value.set(width, height);

    // Calculate number of mip levels
    const numMips = Math.floor(Math.log2(Math.max(width, height))) + 1;
    this.coneTracingMaterial.uniforms.uNumMips.value = numMips;
  }
}
