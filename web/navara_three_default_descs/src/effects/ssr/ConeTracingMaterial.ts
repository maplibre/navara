import { assertType } from "@navaramap/core";
import fragmentShader from "@shaders/glsl/coneTracing.frag.glsl?raw";
import vertexShader from "@shaders/glsl/coneTracing.vert.glsl?raw";
import { resolveIncludes } from "@takram/three-geospatial";
import { depth, packing, transform } from "@takram/three-geospatial/shaders";
import {
  Matrix4,
  NoBlending,
  PerspectiveCamera,
  OrthographicCamera,
  ShaderMaterial,
  Uniform,
  Vector2,
  type Camera,
  type ShaderMaterialParameters,
  type Texture,
} from "three";

export type ConeTracingMaterialParameters = {
  colorBuffer?: Texture | null;
  rayTracingBuffer?: Texture | null;
  normalBuffer?: Texture | null;
  specularBuffer?: Texture | null;
  indirectSpecularBuffer?: Texture | null;

  numMips?: number;
  fadeStart?: number;
  fadeEnd?: number;
  maxDistance?: number;
  iteration?: number;
  resolveKernelSize?: number;
} & ShaderMaterialParameters;

export const coneTracingMaterialParametersDefaults = {
  numMips: 7,
  fadeStart: 0.9,
  fadeEnd: 1.0,
  maxDistance: 500.0,
  iteration: 14,
  resolveKernelSize: 3,
} satisfies ConeTracingMaterialParameters;

export class ConeTracingMaterial extends ShaderMaterial {
  constructor(params?: ConeTracingMaterialParameters) {
    const {
      colorBuffer = null,
      rayTracingBuffer = null,
      normalBuffer = null,
      specularBuffer = null,
      indirectSpecularBuffer = null,
      numMips,
      fadeStart,
      fadeEnd,
      maxDistance,
      iteration,
      resolveKernelSize,
    } = {
      ...coneTracingMaterialParametersDefaults,
      ...params,
    };

    super({
      name: "ConeTracingMaterial",
      fragmentShader: resolveIncludes(fragmentShader, {
        core: {
          depth,
          packing,
          transform,
        },
      }),
      vertexShader,
      uniforms: {
        uDepthBuffer: new Uniform(null),
        inputBuffer: new Uniform(null),
        uColorBuffer: new Uniform(colorBuffer),
        uRayTracingBuffer: new Uniform(rayTracingBuffer),
        uNormalBuffer: new Uniform(normalBuffer),
        uSpecularBuffer: new Uniform(specularBuffer),
        uIndirectSpecularBuffer: new Uniform(indirectSpecularBuffer),
        uBufferSize: new Uniform(new Vector2()),
        uRayTexelSize: new Uniform(new Vector2()),
        uNumMips: new Uniform(numMips),
        uPrefilterExposure: new Uniform(1),
        uFadeStart: new Uniform(fadeStart),
        uFadeEnd: new Uniform(fadeEnd),
        uMaxDistance: new Uniform(maxDistance),
        cameraNear: new Uniform(0),
        cameraFar: new Uniform(1),
        projectionMatrix: new Uniform(new Matrix4()),
        inverseProjectionMatrix: new Uniform(new Matrix4()),
      },
      defines: {
        DEPTH_PACKING: "0",
        ITERATION: iteration,
        RESOLVE_KERNEL: resolveKernelSize,
      },
      blending: NoBlending,
      toneMapped: false,
      depthWrite: false,
      depthTest: false,
    });
  }

  /**
   * `width`/`height` describe the *colour* buffer the cone samples, which is
   * what the mip-level maths is expressed in. The resolve output may well be
   * smaller; that resolution only reaches the shader through
   * {@link setRayBufferSize}.
   */
  setSize(width: number, height: number): void {
    this.uniforms.uBufferSize.value.set(width, height);
  }

  /** Size of the ray-tracing buffer, whose texels the resolve gathers over. */
  setRayBufferSize(width: number, height: number): void {
    this.uniforms.uRayTexelSize.value.set(1 / width, 1 / height);
  }

  copyCameraSettings(camera?: Camera | null): void {
    if (camera == null) {
      return;
    }
    assertType<PerspectiveCamera | OrthographicCamera>(camera);
    const uniforms = this.uniforms;
    uniforms.cameraNear.value = camera.near;
    uniforms.cameraFar.value = camera.far;
    uniforms.projectionMatrix.value.copy(camera.projectionMatrix);
    uniforms.inverseProjectionMatrix.value.copy(camera.projectionMatrixInverse);

    if (camera instanceof PerspectiveCamera) {
      if (this.defines.PERSPECTIVE_CAMERA !== "1") {
        this.defines.PERSPECTIVE_CAMERA = "1";
        this.needsUpdate = true;
      }
    } else {
      if (this.defines.PERSPECTIVE_CAMERA != null) {
        delete this.defines.PERSPECTIVE_CAMERA;
        this.needsUpdate = true;
      }
    }
  }

  get depthBuffer(): Texture | null {
    return this.uniforms.uDepthBuffer.value;
  }

  set depthBuffer(value: Texture | null) {
    this.uniforms.uDepthBuffer.value = value;
  }

  get colorBuffer(): Texture | null {
    return this.uniforms.uColorBuffer.value;
  }

  set colorBuffer(value: Texture | null) {
    this.uniforms.uColorBuffer.value = value;
  }

  get inputBuffer(): Texture | null {
    return this.uniforms.inputBuffer.value;
  }

  set inputBuffer(value: Texture | null) {
    this.uniforms.inputBuffer.value = value;
  }

  get rayTracingBuffer(): Texture | null {
    return this.uniforms.uRayTracingBuffer.value;
  }

  set rayTracingBuffer(value: Texture | null) {
    this.uniforms.uRayTracingBuffer.value = value;
  }

  get normalBuffer(): Texture | null {
    return this.uniforms.uNormalBuffer.value;
  }

  set normalBuffer(value: Texture | null) {
    this.uniforms.uNormalBuffer.value = value;
  }

  get specularBuffer(): Texture | null {
    return this.uniforms.uSpecularBuffer.value;
  }

  set specularBuffer(value: Texture | null) {
    this.uniforms.uSpecularBuffer.value = value;
  }

  get indirectSpecularBuffer(): Texture | null {
    return this.uniforms.uIndirectSpecularBuffer.value;
  }

  set indirectSpecularBuffer(value: Texture | null) {
    this.uniforms.uIndirectSpecularBuffer.value = value;
  }

  get fadeStart(): number {
    return this.uniforms.uFadeStart.value;
  }
  set fadeStart(value: number) {
    this.uniforms.uFadeStart.value = value;
  }

  get fadeEnd(): number {
    return this.uniforms.uFadeEnd.value;
  }
  set fadeEnd(value: number) {
    this.uniforms.uFadeEnd.value = value;
  }

  get maxDistance(): number {
    return this.uniforms.uMaxDistance.value;
  }
  set maxDistance(value: number) {
    this.uniforms.uMaxDistance.value = value;
  }

  get iteration(): number {
    return +(this.defines.ITERATION as string);
  }

  set iteration(value: number) {
    this.defines.ITERATION = value;
    this.needsUpdate = true;
  }

  get resolveKernelSize(): number {
    return +(this.defines.RESOLVE_KERNEL as string);
  }

  set resolveKernelSize(value: number) {
    if (value !== this.resolveKernelSize) {
      this.defines.RESOLVE_KERNEL = value;
      this.needsUpdate = true;
    }
  }
}
