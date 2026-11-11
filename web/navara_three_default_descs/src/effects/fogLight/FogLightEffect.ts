import type { Color } from "@navaramap/three";
import FogLightFragment from "@shaders/glsl/fogLight.frag.glsl?raw";
import { resolveIncludes } from "@takram/three-geospatial";
import { depth, packing, transform } from "@takram/three-geospatial/shaders";
import {
  Effect as PostProcessingEffect,
  BlendFunction,
  DepthCopyPass,
} from "postprocessing";
import {
  PerspectiveCamera,
  OrthographicCamera,
  Matrix4,
  Uniform,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  WebGLRenderer,
  DataTexture,
  FloatType,
  RGBAFormat,
  NearestFilter,
  ClampToEdgeWrapping,
  Texture,
  RGBADepthPacking,
  type DepthPackingStrategies,
} from "three";

import { FogLightTileGrid } from "./tileGrid";

export type FogLightDefinition = {
  /** Light position in world (ECEF) coordinates */
  position: { x: number; y: number; z: number };
  color: number | Color;
  intensity: number;
  /** World-space influence radius of the fog light. Defaults to 500 if omitted. */
  radius?: number;
};

export type FogLightEffectOptions = {
  /** Array of fog light definitions with position, color, and intensity */
  lights?: FogLightDefinition[];
  /** Density of the volumetric fog (default: 5) */
  fogDensity?: number;
  /**
   * Initial light capacity hint (default: 100). The light textures grow
   * automatically when more lights are set, so this only pre-sizes them.
   */
  maxLights?: number;
  /** Optional normal buffer texture for surface lighting calculations */
  normalBuffer?: Texture;
  /** Whether to apply surface lighting effects (default: true) */
  useSurfaceLighting?: boolean;
  /** Tile size in pixels for tiled/clustered culling */
  tileSize?: number;
  /**
   * Maximum lights evaluated per tile on GPU (default: 64). Acts as a
   * quality/cost dial: shader cost scales roughly linearly with it, and
   * lights beyond the cap degrade into the smooth residual haze instead of
   * disappearing.
   */
  maxLightsPerTile?: number;
  /** Safety scale applied to the effective range for tile registration */
  extentScale?: number;
  /**
   * Falloff coefficient of the halo attenuation 1/(1 + haloFalloff * h),
   * where h is the ray's closest distance to the light in meters
   * (default: 0.1). Higher values tighten halos around their lights —
   * useful to suppress ghost-like glow from lights hidden behind terrain,
   * which the fog model cannot shadow.
   */
  haloFalloff?: number;
  /** Debug: show grid extent overlay in the shader */
  debugShowGrid?: boolean;
  /**
   * Maximum distance from the camera at which fog lights are considered.
   * Lights whose entire influence sphere is farther than this value are
   * culled on CPU. Defaults to the camera's `far` value at effect creation.
   */
  maxFar?: number;
};

export const DEFAULT_FOG_LIGHT_EFFECT_OPTIONS: FogLightEffectOptions = {
  lights: [],
  fogDensity: 5,
  maxLights: 100,
  useSurfaceLighting: true,
  tileSize: 32,
  maxLightsPerTile: 64,
  extentScale: 1.0,
  haloFalloff: 0.1,
  debugShowGrid: false,
};

export class FogLightEffect extends PostProcessingEffect {
  private camera: PerspectiveCamera | OrthographicCamera;
  private invProjectionMatrix: Matrix4;
  private invViewMatrix: Matrix4;
  private viewMatrix: Matrix4;
  private _vpM: Matrix4;

  // Per-light data textures: buf0 = color+intensity, buf1 = position +
  // baked effective range. userRadii keeps the user-specified radii CPU-side
  // (buf1's w channel is overwritten with the derived range each rebuild).
  private lightTex0: DataTexture;
  private lightTex1: DataTexture;
  private buf0: Float32Array;
  private buf1: Float32Array;
  private userRadii: Float32Array;

  private depthCopyPass: DepthCopyPass;

  // CPU tiled culling (uLightGrid / uLightIndex / uResidual)
  private tileGrid: FogLightTileGrid;

  private _extentScale: number;
  private _maxFar: number;

  // Grid rebuild is skipped while the camera, lights, and fog stay unchanged
  private _gridDirty = true;
  private _prevVpM = new Matrix4();
  private _prevFogDensity = Number.NaN;

  constructor(
    camera: PerspectiveCamera | OrthographicCamera,
    options: FogLightEffectOptions = {},
  ) {
    // Get max lights from options
    const maxLights =
      options.maxLights ?? DEFAULT_FOG_LIGHT_EFFECT_OPTIONS.maxLights ?? 0;

    // Calculate texture dimensions
    const W = Math.ceil(Math.sqrt(maxLights));
    const H = Math.ceil(maxLights / W);

    // Create buffers for DataTextures
    const buf0 = new Float32Array(W * H * 4); // color,intensity
    const buf1 = new Float32Array(W * H * 4); // position(xyz), range(w)

    // Create DataTextures
    const lightTex0 = new DataTexture(buf0, W, H, RGBAFormat, FloatType);
    lightTex0.needsUpdate = true;
    lightTex0.magFilter = lightTex0.minFilter = NearestFilter;
    lightTex0.wrapS = lightTex0.wrapT = ClampToEdgeWrapping;

    const lightTex1 = new DataTexture(buf1, W, H, RGBAFormat, FloatType);
    lightTex1.needsUpdate = true;
    lightTex1.magFilter = lightTex1.minFilter = NearestFilter;
    lightTex1.wrapS = lightTex1.wrapT = ClampToEdgeWrapping;

    const uniforms = new Map<string, Uniform>([
      ["uLightTex0", new Uniform(lightTex0)],
      ["uLightTex1", new Uniform(lightTex1)],
      ["uLightTexSize", new Uniform(new Vector2(W, H))],
      ["cameraPos", new Uniform(camera.position)],
      [
        "fogDensity",
        new Uniform(
          options.fogDensity ?? DEFAULT_FOG_LIGHT_EFFECT_OPTIONS.fogDensity,
        ),
      ],
      [
        "haloFalloff",
        new Uniform(
          options.haloFalloff ?? DEFAULT_FOG_LIGHT_EFFECT_OPTIONS.haloFalloff,
        ),
      ],
      ["normalBuffer", new Uniform(options.normalBuffer ?? null)],
      ["copiedDepthBuffer", new Uniform(null)],
      [
        "useSurfaceLighting",
        new Uniform(
          options.useSurfaceLighting ??
            DEFAULT_FOG_LIGHT_EFFECT_OPTIONS.useSurfaceLighting,
        ),
      ],
      ["resolution", new Uniform(new Vector2())],
      ["cameraNear", new Uniform(camera.near)],
      ["cameraFar", new Uniform(camera.far)],
      ["projectionMatrix", new Uniform(new Matrix4())],
      ["invProjectionMatrix", new Uniform(new Matrix4())],
      ["invViewMatrix", new Uniform(new Matrix4())],
      ["viewMatrix", new Uniform(new Matrix4())],
      // Tiled culling uniforms
      ["uResidual", new Uniform(null)],
      ["uLightGrid", new Uniform(null)],
      ["uLightGridSize", new Uniform(new Vector2(0, 0))],
      ["uLightIndex", new Uniform(null)],
      ["uLightIndexTexSize", new Uniform(new Vector2(0, 0))],
      [
        "uTileSizePx",
        new Uniform(
          options.tileSize ?? DEFAULT_FOG_LIGHT_EFFECT_OPTIONS.tileSize ?? 16,
        ),
      ],
    ]);

    super(
      "FogLightEffect",
      resolveIncludes(FogLightFragment, {
        core: {
          packing,
          depth,
          transform,
        },
      }),
      {
        uniforms,
        blendFunction: BlendFunction.NORMAL,
      },
    );

    this.camera = camera;
    this.invProjectionMatrix = new Matrix4();
    this.invViewMatrix = new Matrix4();
    this.viewMatrix = new Matrix4();
    this._vpM = new Matrix4();
    this.lightTex0 = lightTex0;
    this.lightTex1 = lightTex1;
    this.buf0 = buf0;
    this.buf1 = buf1;
    this.userRadii = new Float32Array(W * H);

    this.tileGrid = new FogLightTileGrid(
      options.tileSize ?? DEFAULT_FOG_LIGHT_EFFECT_OPTIONS.tileSize ?? 16,
      options.maxLightsPerTile ??
        DEFAULT_FOG_LIGHT_EFFECT_OPTIONS.maxLightsPerTile ??
        64,
    );

    this._extentScale =
      options.extentScale ??
      DEFAULT_FOG_LIGHT_EFFECT_OPTIONS.extentScale ??
      1.0;
    this._maxFar = options.maxFar ?? camera.far;

    if (options.debugShowGrid) {
      this.defines.set("DEBUG_SHOW_GRID", "1");
    }

    // The composer's depth buffer cannot be sampled while it is bound, so a
    // copy is rendered each frame and read through copiedDepthBuffer.
    this.depthCopyPass = new DepthCopyPass();
    const depthBufferUniform = this.uniforms.get("copiedDepthBuffer");
    if (depthBufferUniform) {
      depthBufferUniform.value = this.depthCopyPass.texture;
      this.defines.set("DEPTH_PACKING", RGBADepthPacking.toString());
    }

    this.defines.set("MAX_LIGHTS_PER_TILE", this.maxLightsPerTile.toString());
  }

  setDepthTexture(
    depthTexture: Texture,
    depthPacking?: DepthPackingStrategies,
  ): void {
    this.depthCopyPass.setDepthTexture(depthTexture, depthPacking);
  }

  /** `Effect.dispose()` reaches only own textures, not the tile grid's. */
  dispose(): void {
    this.tileGrid.dispose();
    super.dispose();
  }

  update(
    renderer: WebGLRenderer,
    inputBuffer: WebGLRenderTarget,
    deltaTime: number,
  ): void {
    // Copy the depth buffer
    this.depthCopyPass.render(renderer, null, null);

    // Update camera matrices
    this.invProjectionMatrix.copy(this.camera.projectionMatrix).invert();
    this.invViewMatrix.copy(this.camera.matrixWorld);
    this.viewMatrix.copy(this.camera.matrixWorld).invert();

    const cameraPosUniform = this.uniforms.get("cameraPos");
    const cameraNearUniform = this.uniforms.get("cameraNear");
    const cameraFarUniform = this.uniforms.get("cameraFar");
    const projectionMatrixUniform = this.uniforms.get("projectionMatrix");
    const invProjectionMatrixUniform = this.uniforms.get("invProjectionMatrix");
    const invViewMatrixUniform = this.uniforms.get("invViewMatrix");
    const viewMatrixUniform = this.uniforms.get("viewMatrix");
    if (cameraPosUniform) cameraPosUniform.value.copy(this.camera.position);
    if (cameraNearUniform) cameraNearUniform.value = this.camera.near;
    if (cameraFarUniform) cameraFarUniform.value = this.camera.far;
    if (invProjectionMatrixUniform)
      invProjectionMatrixUniform.value.copy(this.invProjectionMatrix);
    if (projectionMatrixUniform)
      projectionMatrixUniform.value.copy(this.camera.projectionMatrix);
    if (invViewMatrixUniform)
      invViewMatrixUniform.value.copy(this.invViewMatrix);
    if (viewMatrixUniform) viewMatrixUniform.value.copy(this.viewMatrix);

    if (this.camera instanceof PerspectiveCamera) {
      if (this.defines.get("PERSPECTIVE_CAMERA") !== "1") {
        this.defines.set("PERSPECTIVE_CAMERA", "1");
      }
    } else {
      if (this.defines.get("PERSPECTIVE_CAMERA") != null) {
        this.defines.delete("PERSPECTIVE_CAMERA");
      }
    }

    // Rebuild the tile grid only when the camera, lights, or fog changed.
    const fogDensity =
      (this.uniforms.get("fogDensity")?.value as number | undefined) ?? 1;
    this._vpM.multiplyMatrices(this.camera.projectionMatrix, this.viewMatrix);
    if (
      this._gridDirty ||
      fogDensity !== this._prevFogDensity ||
      !this._vpM.equals(this._prevVpM)
    ) {
      const bakedRangeChanged = this.tileGrid.populate({
        camera: this.camera,
        vpM: this._vpM,
        viewM: this.viewMatrix,
        buf0: this.buf0,
        buf1: this.buf1,
        userRadii: this.userRadii,
        lightCount: this.lightCount,
        fogDensity,
        haloFalloff: this.haloFalloff,
        extentScale: this._extentScale,
        maxFar: this._maxFar,
      });
      if (bakedRangeChanged) this.lightTex1.needsUpdate = true;
      this._prevVpM.copy(this._vpM);
      this._prevFogDensity = fogDensity;
      this._gridDirty = false;
    }

    super.update(renderer, inputBuffer, deltaTime);
  }

  writeLight(
    i: number,
    color: Color,
    intensity: number,
    position: Vector3,
    radius = 500,
  ): void {
    const k = 4 * i;
    this.buf0[k + 0] = color.raw.r;
    this.buf0[k + 1] = color.raw.g;
    this.buf0[k + 2] = color.raw.b;
    this.buf0[k + 3] = intensity;

    this.buf1[k + 0] = position.x;
    this.buf1[k + 1] = position.y;
    this.buf1[k + 2] = position.z;
    // Placeholder until the tile grid bakes the effective range into w
    this.buf1[k + 3] = radius;
    this.userRadii[i] = radius;
  }

  updateLightTextures(): void {
    this.lightTex0.needsUpdate = true;
    this.lightTex1.needsUpdate = true;
    this._gridDirty = true;
  }

  /** Number of light slots the data textures currently hold. */
  get lightCapacity(): number {
    return this.buf0.length / 4;
  }

  /** Grow the light data textures so at least `count` lights fit. */
  ensureLightCapacity(count: number): void {
    if (count <= this.lightCapacity) return;
    const W = Math.ceil(Math.sqrt(count));
    const H = Math.ceil(count / W);

    const buf0 = new Float32Array(W * H * 4);
    const buf1 = new Float32Array(W * H * 4);
    buf0.set(this.buf0);
    buf1.set(this.buf1);
    this.buf0 = buf0;
    this.buf1 = buf1;
    const userRadii = new Float32Array(W * H);
    userRadii.set(this.userRadii);
    this.userRadii = userRadii;

    // Resizing a DataTexture requires releasing the GL texture: three
    // allocates immutable storage on first upload, so an in-place
    // image swap would texSubImage past the old dimensions (GL_INVALID_VALUE)
    this.lightTex0.image.data = buf0;
    this.lightTex0.image.width = W;
    this.lightTex0.image.height = H;
    this.lightTex0.dispose();
    this.lightTex0.needsUpdate = true;
    this.lightTex1.image.data = buf1;
    this.lightTex1.image.width = W;
    this.lightTex1.image.height = H;
    this.lightTex1.dispose();
    this.lightTex1.needsUpdate = true;

    const sizeUni = this.uniforms.get("uLightTexSize");
    if (sizeUni) (sizeUni.value as Vector2).set(W, H);
    this._gridDirty = true;
  }

  updateDepthBuffer(depthBuffer: Texture | null): void {
    const depthBufferUniform = this.uniforms.get("depthBuffer");
    if (depthBufferUniform) {
      depthBufferUniform.value = depthBuffer;
    }
  }

  setSize(width: number, height: number): void {
    this.depthCopyPass.setSize(width, height);
    const res = this.uniforms.get("resolution");
    if (res) (res.value as Vector2).set(width, height);
    this.tileGrid.setSize(width, height);
    this.syncTileGridUniforms();
    this._gridDirty = true;
  }

  /** Low-resolution copy of the scene depth, for depth-aware upsampling. */
  get copiedDepthTexture(): Texture {
    return this.depthCopyPass.texture;
  }

  /** Toggle fog-only output (used by the downsampled composite path). */
  setFogOnlyOutput(enabled: boolean): void {
    const current = this.defines.get("FOG_ONLY_OUTPUT") === "1";
    if (enabled === current) return;
    if (enabled) {
      this.defines.set("FOG_ONLY_OUTPUT", "1");
    } else {
      this.defines.delete("FOG_ONLY_OUTPUT");
    }
    this.setChanged();
  }

  get lightCount() {
    const numDefine = this.defines.get("NUM_FOG_LIGHT");
    return Number(numDefine);
  }

  set maxLightsPerTile(v: number) {
    const value = Math.max(1, Math.floor(v));
    this.tileGrid.maxLightsPerTile = value;
    this.defines.set("MAX_LIGHTS_PER_TILE", String(value));
    this.syncTileGridUniforms();
    this._gridDirty = true;
    this.setChanged();
  }
  get maxLightsPerTile(): number {
    return this.tileGrid.maxLightsPerTile;
  }

  set extentScale(v: number) {
    this._extentScale = Math.max(0, v);
    this._gridDirty = true;
  }
  get extentScale(): number {
    return this._extentScale;
  }

  set maxFar(v: number) {
    this._maxFar = Math.max(0, v);
    this._gridDirty = true;
  }
  get maxFar(): number {
    return this._maxFar;
  }

  set haloFalloff(v: number) {
    const value = Math.max(0, v);
    const uni = this.uniforms.get("haloFalloff");
    if (uni) uni.value = value;
    // The effective range derives from the falloff, so the grid must rebuild
    this._gridDirty = true;
  }
  get haloFalloff(): number {
    return (
      (this.uniforms.get("haloFalloff")?.value as number | undefined) ??
      DEFAULT_FOG_LIGHT_EFFECT_OPTIONS.haloFalloff ??
      0.1
    );
  }

  set debugShowGrid(v: boolean) {
    if (v) this.defines.set("DEBUG_SHOW_GRID", "1");
    else this.defines.delete("DEBUG_SHOW_GRID");
    this.setChanged();
  }

  get debugShowGrid(): boolean {
    return this.defines.get("DEBUG_SHOW_GRID") === "1";
  }

  // Point the tiled-culling uniforms at the grid's (possibly reallocated)
  // textures and sizes.
  private syncTileGridUniforms(): void {
    const gridUni = this.uniforms.get("uLightGrid");
    if (gridUni) gridUni.value = this.tileGrid.gridTexture ?? null;
    const indexUni = this.uniforms.get("uLightIndex");
    if (indexUni) indexUni.value = this.tileGrid.indexTexture ?? null;
    const residualUni = this.uniforms.get("uResidual");
    if (residualUni) residualUni.value = this.tileGrid.residualTexture ?? null;
    const gridSizeUni = this.uniforms.get("uLightGridSize");
    if (gridSizeUni)
      (gridSizeUni.value as Vector2).set(
        this.tileGrid.gridW,
        this.tileGrid.gridH,
      );
    const indexSizeUni = this.uniforms.get("uLightIndexTexSize");
    if (indexSizeUni)
      (indexSizeUni.value as Vector2).set(
        this.tileGrid.indexTexW,
        this.tileGrid.indexTexH,
      );
  }
}
