import type ThreeView from "@navaramap/three";
import {
  EffectDesc,
  geodeticToVector3,
  type EffectConfig,
  type EffectUpdate,
  type GBufferName,
  type MRTPassEffectDesc,
  type ViewContext,
} from "@navaramap/three";
import { resolveIncludes } from "@takram/three-geospatial";
import { depth, packing, transform } from "@takram/three-geospatial/shaders";
import { Pass } from "postprocessing";
import {
  HalfFloatType,
  Matrix4,
  NearestFilter,
  NoBlending,
  ShaderMaterial,
  Uniform,
  Vector3,
  WebGLRenderTarget,
  type PerspectiveCamera,
  type Texture,
  type WebGLRenderer,
} from "three";

// Rewrites the scene geometry (normal) buffer so SSR applies on puddle areas:
// inside each puddle the normal is flattened to the geodetic up direction, the
// reflectivity mask (z channel) is raised and the roughness (w channel) is
// lowered. The result is fed to SSREffectDesc via its `geometryBuffer` option.
// The geometry buffer encoding is vec4(packNormalToVec2(viewNormal), mask, roughness).
const fragmentShader = /* glsl */ `
  #include <common>
  #include <packing>

  #include "core/depth"
  #include "core/packing"
  #include "core/transform"

  uniform sampler2D normalBuffer;
  uniform sampler2D depthBuffer;
  uniform float cameraNear;
  uniform float cameraFar;
  uniform mat4 projectionMatrix;
  uniform mat4 inverseProjectionMatrix;

  // Puddle centers in view space, converted from ECEF on the CPU every frame
  // so the values stay small enough for 32-bit floats.
  uniform vec3 puddleCentersView[NUM_PUDDLES];
  uniform vec3 upView;
  uniform float radius;
  uniform float wetness;
  uniform float wetRoughness;

  in vec2 vUv;

  float readDepth(const vec2 uv) {
    #if DEPTH_PACKING == 3201
    return unpackRGBAToDepth(texture2D(depthBuffer, uv));
    #else
    return texture2D(depthBuffer, uv).r;
    #endif
  }

  float getViewZ(const float depth) {
    #ifdef PERSPECTIVE_CAMERA
    return perspectiveDepthToViewZ(depth, cameraNear, cameraFar);
    #else
    return orthographicDepthToViewZ(depth, cameraNear, cameraFar);
    #endif
  }

  void main() {
    vec4 geometry = texture2D(normalBuffer, vUv);
    float depth = readDepth(vUv);

    // Skip the sky.
    if (depth >= 1.0 - 1e-7) {
      gl_FragColor = geometry;
      return;
    }

    float viewZ = getViewZ(reverseLogDepth(depth, cameraNear, cameraFar));
    vec3 viewPosition = screenToView(
      vUv,
      depth,
      viewZ,
      projectionMatrix,
      inverseProjectionMatrix
    );

    // Only surfaces facing the geodetic up direction can hold a puddle.
    // Terrain does not write into the MRT normal buffer (its packed normal
    // stays zero), so treat those pixels as ground and let the distance mask
    // decide alone.
    vec3 viewNormal = unpackVec2ToNormal(geometry.xy);
    bool hasNormal = dot(geometry.xy, geometry.xy) > 1e-6;
    float upness = hasNormal
      ? smoothstep(0.8, 0.95, dot(viewNormal, upView))
      : 1.0;

    float mask = 0.0;
    for (int i = 0; i < NUM_PUDDLES; ++i) {
      float d = distance(viewPosition, puddleCentersView[i]);
      mask = max(mask, 1.0 - smoothstep(radius * 0.7, radius, d));
    }

    float puddle = mask * upness * wetness;
    if (puddle > 0.0) {
      // For terrain pixels the stored normal is meaningless, so blend from up.
      vec3 baseNormal = hasNormal ? viewNormal : upView;
      geometry.xy = packNormalToVec2(normalize(mix(baseNormal, upView, puddle)));
      geometry.z = max(geometry.z, puddle);
      geometry.w = mix(geometry.w, wetRoughness, puddle);
    }
    gl_FragColor = geometry;
  }
`;

const vertexShader = /* glsl */ `
  out vec2 vUv;

  void main() {
    vUv = position.xy * 0.5 + 0.5;
    gl_Position = vec4(position.xy, 1.0, 1.0);
  }
`;

type PuddleGeometryPassOptions = {
  normalBuffer: Texture | null;
  depthBuffer: Texture;
  depthPacking: number;
  puddleCount: number;
  radius: number;
  wetness: number;
  roughness: number;
};

class PuddleGeometryMaterial extends ShaderMaterial {
  constructor(options: PuddleGeometryPassOptions) {
    super({
      name: "PuddleGeometryMaterial",
      fragmentShader: resolveIncludes(fragmentShader, {
        core: { depth, packing, transform },
      }),
      vertexShader,
      uniforms: {
        normalBuffer: new Uniform(options.normalBuffer),
        depthBuffer: new Uniform(options.depthBuffer),
        cameraNear: new Uniform(0),
        cameraFar: new Uniform(1),
        projectionMatrix: new Uniform(new Matrix4()),
        inverseProjectionMatrix: new Uniform(new Matrix4()),
        puddleCentersView: new Uniform(
          Array.from({ length: options.puddleCount }, () => new Vector3()),
        ),
        upView: new Uniform(new Vector3(0, 1, 0)),
        radius: new Uniform(options.radius),
        wetness: new Uniform(options.wetness),
        wetRoughness: new Uniform(options.roughness),
      },
      defines: {
        DEPTH_PACKING: `${options.depthPacking}`,
        NUM_PUDDLES: `${options.puddleCount}`,
        PERSPECTIVE_CAMERA: "1",
      },
      blending: NoBlending,
      toneMapped: false,
      depthWrite: false,
      depthTest: false,
    });
  }
}

class PuddleGeometryPass extends Pass {
  readonly renderTarget: WebGLRenderTarget;
  // Puddle centers in ECEF, updated per frame by the descriptor.
  readonly worldCenters: Vector3[];

  private readonly viewCamera: PerspectiveCamera;
  private readonly scratch = new Vector3();

  constructor(camera: PerspectiveCamera, options: PuddleGeometryPassOptions) {
    super("PuddleGeometryPass");
    this.needsSwap = false;
    this.viewCamera = camera;
    this.fullscreenMaterial = new PuddleGeometryMaterial(options);
    this.worldCenters = Array.from(
      { length: options.puddleCount },
      () => new Vector3(),
    );
    this.renderTarget = new WebGLRenderTarget(1, 1, {
      depthBuffer: false,
      stencilBuffer: false,
      type: HalfFloatType,
      minFilter: NearestFilter,
      magFilter: NearestFilter,
    });
    this.renderTarget.texture.name = "PuddleGeometry.Buffer";
  }

  get material(): PuddleGeometryMaterial {
    return this.fullscreenMaterial as PuddleGeometryMaterial;
  }

  // The pipeline drives passes through `visible`; postprocessing uses `enabled`.
  get visible(): boolean {
    return this.enabled;
  }

  set visible(value: boolean) {
    this.enabled = value;
  }

  override render(
    renderer: WebGLRenderer,
    inputBuffer: WebGLRenderTarget | null,
  ): void {
    if (inputBuffer) {
      const { width, height } = inputBuffer;
      if (
        this.renderTarget.width !== width ||
        this.renderTarget.height !== height
      ) {
        this.renderTarget.setSize(width, height);
      }
    }

    // View-dependent uniforms must use the camera state of the current frame.
    const camera = this.viewCamera;
    const uniforms = this.material.uniforms;
    uniforms.cameraNear.value = camera.near;
    uniforms.cameraFar.value = camera.far;
    uniforms.projectionMatrix.value.copy(camera.projectionMatrix);
    uniforms.inverseProjectionMatrix.value.copy(camera.projectionMatrixInverse);
    const centers = uniforms.puddleCentersView.value as Vector3[];
    for (let i = 0; i < centers.length; i++) {
      centers[i]
        .copy(this.worldCenters[i])
        .applyMatrix4(camera.matrixWorldInverse);
    }
    // Geodetic up approximated by the normalized ECEF position of the first
    // puddle, transformed into view space.
    (uniforms.upView.value as Vector3)
      .copy(this.scratch.copy(this.worldCenters[0]).normalize())
      .transformDirection(camera.matrixWorldInverse);

    renderer.setRenderTarget(this.renderTarget);
    renderer.render(this.scene, this.camera);
  }

  override setSize(width: number, height: number): void {
    this.renderTarget.setSize(width, height);
  }
}

export type PuddleGeometryDescription = {
  puddleGeometry?: {
    /** Puddle centers in degrees. The count is fixed at creation. */
    centers?: { lng: number; lat: number }[];
    /** Puddle radius in meters. */
    radius?: number;
    /** Overall strength: 0 = dry, 1 = fully reflective puddles. */
    wetness?: number;
    /** Roughness of the puddle surface (lower = sharper reflection). */
    roughness?: number;
  };
};

export type PuddleGeometryConfig = PuddleGeometryDescription & EffectConfig;

export type PuddleGeometryUpdate = PuddleGeometryDescription & EffectUpdate;

const DEFAULT_CENTERS = [{ lng: 139.758, lat: 35.68 }];

export class PuddleGeometryEffectDesc extends EffectDesc<
  PuddleGeometryConfig,
  PuddleGeometryUpdate,
  PuddleGeometryPass
> {
  static key = "puddleGeometry";
  // Runs right after the G-buffer is produced, before SSR consumes our output.
  static insertAfter = ["mrt"];
  static requiredBuffers: readonly GBufferName[] = ["normal"];

  private config: PuddleGeometryConfig;

  constructor(view: ThreeView, ctx: ViewContext, config: PuddleGeometryConfig) {
    super(view, ctx, config);
    this.config = config;
  }

  /** The custom geometry buffer to pass to SSREffectDesc. */
  get texture(): Texture | undefined {
    return this.raw?.renderTarget.texture;
  }

  createPass() {
    const mrtPass = this.find<MRTPassEffectDesc>("mrt");
    if (!mrtPass?.depthBuffer) {
      throw new Error("MRT pass not ready");
    }

    const config = this.config.puddleGeometry;
    return new PuddleGeometryPass(this.view.camera.raw, {
      normalBuffer: this.ctx.getNormalTexture() ?? null,
      depthBuffer: mrtPass.depthBuffer,
      depthPacking: mrtPass.depthBufferPacking ?? 0,
      puddleCount: (config?.centers ?? DEFAULT_CENTERS).length,
      radius: config?.radius ?? 30,
      wetness: config?.wetness ?? 1,
      roughness: config?.roughness ?? 0.05,
    });
  }

  onUpdateConfig(updates: PuddleGeometryUpdate): void {
    super.onUpdateConfig(updates);

    if (!this._instance) return;
    Object.assign(this.config, updates);

    const config = updates.puddleGeometry;
    if (!config) return;

    const uniforms = this._instance.material.uniforms;
    if (config.radius !== undefined) {
      uniforms.radius.value = config.radius;
    }
    if (config.wetness !== undefined) {
      uniforms.wetness.value = config.wetness;
    }
    if (config.roughness !== undefined) {
      uniforms.wetRoughness.value = config.roughness;
    }
  }

  // Per-frame hook: keep the puddles glued to the terrain surface as tiles load.
  update(): void {
    if (!this._instance) return;

    // Re-fetched every frame: a G-buffer rebuild swaps the texture object.
    this._instance.material.uniforms.normalBuffer.value =
      this.ctx.getNormalTexture() ?? null;

    const centers = this.config.puddleGeometry?.centers ?? DEFAULT_CENTERS;
    for (let i = 0; i < centers.length; i++) {
      const lng = centers[i].lng;
      const lat = centers[i].lat;
      const height = this.view.sampleTerrainHeight({ lng, lat }) ?? 0;
      this._instance.worldCenters[i].copy(
        geodeticToVector3({ lng, lat, height }),
      );
    }
  }
}
