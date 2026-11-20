import PostProcessingCommon from "@shaders/glsl/postprocessingCommon.vert.glsl";
import { CopyPass, Pass } from "postprocessing";
import {
  BasicDepthPacking,
  DepthTexture,
  FloatType,
  LinearFilter,
  NearestFilter,
  NoBlending,
  RGBADepthPacking,
  RGBAFormat,
  ShaderMaterial,
  Texture,
  UnsignedByteType,
  WebGLRenderTarget,
  type DepthPackingStrategies,
  type WebGLRenderer,
} from "three";

import { packing } from "../shaders";

const fragmentShader = `
#include <packing>

${packing}

uniform sampler2D tDepth;
#ifdef MERGE_DEPTH
uniform sampler2D tExistingDepth;
#endif

varying vec2 vUv;

float readDepth() {
  #if DEPTH_PACKING == 3201
    return unpackRGBAToDepth(texture2D(tDepth, vUv));
  #else
      return texture2D(tDepth, vUv).r;
  #endif
}

// A reversed depth is copied as a float: RGBA packing is fixed-point and
// would lose the small values of distant surfaces.
#ifdef USE_REVERSED_DEPTH_BUFFER
  #define WRITE_DEPTH(depth) vec4(depth)
  #define READ_COPY(uv) texture2D(tExistingDepth, uv).r
#else
  #define WRITE_DEPTH(depth) packDepthToRGBA(depth)
  #define READ_COPY(uv) unpackRGBAToDepth(texture2D(tExistingDepth, uv))
#endif

void main() {
  float depth = readDepth();

  #ifdef MERGE_DEPTH
  float existingDepth = READ_COPY(vUv);
  // Keep the depth closest to the camera.
  #ifdef USE_REVERSED_DEPTH_BUFFER
  depth = max(depth, existingDepth);
  #else
  depth = min(depth, existingDepth);
  #endif
  #endif

  gl_FragColor = WRITE_DEPTH(depth);
}
`;

/**
 * A pass that copies and optionally merges depth buffers.
 * This is used to accumulate depths from multiple render stages.
 */
export class AllDepthCopyPass extends Pass {
  private _renderTarget: WebGLRenderTarget;
  private _material: ShaderMaterial;
  private _merge: boolean;
  private readonly _reversedDepth: boolean;

  private _copyPassRenderTarget: WebGLRenderTarget;
  private _copyPass: CopyPass;

  /**
   * @param reversedDepth - The depth is reversed: the copy holds it as a
   * float (`BasicDepthPacking`) instead of RGBA-packed.
   */
  constructor(renderTarget?: WebGLRenderTarget, reversedDepth = false) {
    super("AllDepthCopyPass");

    this.needsSwap = false;
    this._reversedDepth = reversedDepth;

    const targetOptions = reversedDepth
      ? { type: FloatType, minFilter: NearestFilter, magFilter: NearestFilter }
      : {
          type: UnsignedByteType,
          minFilter: LinearFilter,
          magFilter: LinearFilter,
        };
    this._copyPassRenderTarget = new WebGLRenderTarget(1, 1, {
      ...targetOptions,
      stencilBuffer: false,
      depthBuffer: false,
    });
    this._copyPass = new CopyPass(this._copyPassRenderTarget);

    this._material = new ShaderMaterial({
      uniforms: {
        tDepth: { value: null },
        tExistingDepth: { value: null },
      },
      vertexShader: PostProcessingCommon,
      fragmentShader,
      blending: NoBlending,
      toneMapped: false,
      depthWrite: false,
      depthTest: false,
      defines: {},
    });

    if (renderTarget) {
      this._renderTarget = renderTarget;
    } else {
      this._renderTarget = new WebGLRenderTarget(1, 1, {
        format: RGBAFormat,
        ...targetOptions,
        generateMipmaps: false,
        stencilBuffer: false,
        depthBuffer: false,
      });
    }

    this.fullscreenMaterial = this._material;
    this._merge = false;
  }

  get texture(): Texture {
    return this._renderTarget.texture;
  }

  get depthPacking(): DepthPackingStrategies {
    return this._reversedDepth ? BasicDepthPacking : RGBADepthPacking;
  }

  /**
   * Set the depth texture to copy from.
   */
  setDepthTexture(
    texture: DepthTexture | Texture | null,
    packing?: DepthPackingStrategies,
  ): void {
    this._material.uniforms.tDepth.value = texture;
    this._material.defines.DEPTH_PACKING = packing ?? BasicDepthPacking;
  }

  /**
   * Copy depth buffer, optionally merging with existing depth.
   * @param merge - If true, merge with existing depth by keeping the minimum (closest) depth
   */
  copyDepth(merge = false): void {
    this._merge = merge;
    if (merge) {
      // Store the current texture as the existing depth
      this._material.uniforms.tExistingDepth.value = this._copyPass.texture;
      this._material.defines.MERGE_DEPTH = "1";
    } else {
      delete this._material.defines.MERGE_DEPTH;
      this._material.uniforms.tExistingDepth.value = null;
    }
    this._material.needsUpdate = true;
  }

  setSize(width: number, height: number): void {
    this._renderTarget.setSize(width, height);
    this._copyPass.setSize(width, height);
  }

  render(
    renderer: WebGLRenderer,
    _inputBuffer: WebGLRenderTarget | null,
    _outputBuffer: WebGLRenderTarget | null,
  ): void {
    const renderTarget = this._renderTarget;

    if (this._merge) {
      this._copyPass.render(renderer, renderTarget, null);
    }

    renderer.setRenderTarget(renderTarget);
    renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this._renderTarget.dispose();
    this._material.dispose();
    this._copyPass.dispose();
    this._copyPassRenderTarget.dispose();
  }
}
