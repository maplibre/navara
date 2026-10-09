import type ThreeView from "@navaramap/three";
import {
  MeshDescWithSelectiveEffect,
  buildPolylineGeometry,
  polylineGroundVolume,
  createPolylineMaterialEnhancer,
  setupRTECallback,
  type CustomObject3DEventMap,
  type GBufferName,
  type GeographicExtent,
  type MeshConfigWithSelectiveEffect,
  type MeshUpdateWithSelectiveEffect,
  type PassKey,
  type PolylineGeometryMaterial,
  type VectorLayer,
  type ViewContext,
} from "@navaramap/three";
import type { LineString } from "geojson";
import {
  BufferAttribute,
  BufferGeometry,
  Matrix4,
  ShaderMaterial,
  type Object3DEventMap,
} from "three";

import {
  FeatureMesh,
  releaseFeatureMaterial,
  setBatchIdAttribute,
} from "./featureMeshes";
import {
  buildPositions,
  POSITION_KEYS,
  toGeoJsonRings,
  type PositionSource,
} from "./featurePositions";
import { isClampedToGround, toGeometryMaterial } from "./featureStyle";
import { GroundVolumeWatch } from "./groundVolume";

type PolylineMeshEventMap = Object3DEventMap & CustomObject3DEventMap;

/**
 * The `polyline` layer material without the layer-only options. `show` and
 * `lit` are covered by the mesh config's `visible` and `lit`.
 */
export type PolylineMeshStyle = Omit<
  NonNullable<VectorLayer["polyline"]>,
  "tiled" | "geometryTypes" | "show" | "lit" | "__internal__"
>;

type Description = {
  polyline?: PolylineMeshStyle &
    PositionSource & {
      /** Join a repeated first position as a seam instead of two end caps. */
      ring?: boolean;
      /**
       * Light a `clampToGround` line with the terrain normal instead of the
       * volume's.
       *
       * Off by default because it costs a full-screen copy of the globe normal
       * buffer. Enable it only where the globe writes normals: without them,
       * e.g. a `raster-dem` terrain without a `hillshade` layer, the line is
       * shaded with an undefined normal.
       */
      useGroundNormals?: boolean;
    };
};

export type PolylineMeshConfig = MeshConfigWithSelectiveEffect &
  Description & { pickable?: boolean };

export type PolylineMeshUpdate = MeshUpdateWithSelectiveEffect & Description;

type PolylineMeshInstance = FeatureMesh<ShaderMaterial, PolylineMeshEventMap>;

/**
 * Style keys the geometry builder reads; patching one rebuilds the geometry.
 * `width` is applied in the vertex shader.
 */
const GEOMETRY_KEYS = ["clampToGround", "height", "ring"] as const;

/** Style keys the geometry builder does not read. */
const NON_GEOMETRY_KEYS = [...POSITION_KEYS, "ring", "useGroundNormals"];

/**
 * A ground line is culled against the camera's globe depth, which is invalid
 * in a shadow pass.
 */
function castsShadow(style: NonNullable<Description["polyline"]>): boolean {
  return (style.castShadow ?? false) && !isClampedToGround(style);
}

function usesGroundNormals(
  style: NonNullable<Description["polyline"]>,
): boolean {
  return isClampedToGround(style) && (style.useGroundNormals ?? false);
}

/**
 * A single polyline outside the layer/source pipeline, built with the layer's
 * geometry builder and material. `update()` rebuilds it from positions without
 * re-tiling.
 *
 * With `clampToGround` (default), the volume encloses
 * {@link ThreeView.sampleTerrainHeightRange} and the fragment shader keeps
 * fragments whose ground point lies within half a line width of the segment.
 * A clamped line ignores `height`, casts no shadow, and receives directional
 * shadows at its ground point.
 * Otherwise the line is drawn at `height`.
 *
 * The line is lit, so it renders black without lights unless `lit: false`.
 */
export class PolylineMeshDesc extends MeshDescWithSelectiveEffect<
  PolylineMeshConfig,
  PolylineMeshUpdate,
  PolylineMeshInstance
> {
  private config: PolylineMeshConfig;
  private pickBatchId?: number;
  /** The transform the current geometry was built with. */
  private bakedTransform = new Matrix4();
  private enhancer?: ReturnType<typeof createPolylineMaterialEnhancer>;
  private readonly ground = new GroundVolumeWatch(
    this.view,
    polylineGroundVolume,
    () => {
      if (!this.enhancer || !this.config.polyline) return;
      this.enhancer.update({
        base: { minMaxHeight: this.minMaxHeight(this.config.polyline) },
      });
      this.emit("needsUpdate");
    },
  );

  constructor(view: ThreeView, ctx: ViewContext, config: PolylineMeshConfig) {
    if (config.polyline?.effectIds) {
      config.effectIds = config.polyline.effectIds;
    }
    super(view, ctx, config);
    this.config = config;
  }

  /** The batch ID assigned to this mesh when picking is enabled. */
  get batchId(): number | undefined {
    return this.pickBatchId;
  }

  private get style(): NonNullable<Description["polyline"]> {
    const style = this.config.polyline;
    if (!style) {
      throw new Error("PolylineMesh configuration is required");
    }
    return style;
  }

  protected override getPassKey(): PassKey {
    // Ground culling happens in the shader, not through the stencil drape.
    return "mrt";
  }

  createMesh(): PolylineMeshInstance {
    const style = this.style;

    this.pickBatchId = this.config.pickable
      ? this.ctx.genGlobalBatchId()
      : undefined;

    const transform = this.composeTransform();
    const built = this.buildGeometry(style, transform);
    this.bakedTransform = transform;
    this.ground.watch(isClampedToGround(style) ? built.extent : undefined);
    const material = new ShaderMaterial();
    material.lights = true;

    const mesh = new FeatureMesh<ShaderMaterial, PolylineMeshEventMap>(
      built.geometry,
      material,
      this.pickBatchId ?? 0,
      (pickable: boolean) => this.enhancer?.update({ base: { pickable } }),
    );
    mesh.castShadow = castsShadow(style);
    mesh.receiveShadow = style.receiveShadow ?? false;
    // RTE positions make the CPU bounding volume meaningless.
    mesh.frustumCulled = false;

    const enhancer = createPolylineMaterialEnhancer(material);
    enhancer.mount({
      base: {
        ...this.baseProps(style),
        useRTE: true,
        isTexturized: false,
        pickable: false,
        groundCulling: isClampedToGround(style),
        useGroundNormals: style.useGroundNormals,
        viewportAndPixelRatio: this.ctx.getViewportAndPixelRatioUniform(),
        frustumNearFar: this.ctx.getFrustumNearFarUniform(),
        frustumRatio: this.ctx.getFrustumRatioUniform(),
        horizonMinHeight: this.ctx.getHorizonMinHeightUniform(),
        globeDepth: this.ctx.getGlobeDepthTextureUniform(),
        globeNormal: this.ctx.getGlobeNormalTextureUniform(),
        inverseProjectionMatrix: this.ctx.getInverseProjectionMatrixUniform(),
      },
    });
    this.enhancer = enhancer;

    const mutates = enhancer.mutates();
    mutates.updateUniforms(material.uniforms, enhancer.states());

    const state = enhancer.states();
    const onBeforeRender = setupRTECallback(
      mesh,
      (modelViewMatrixRTE, cameraPositionHigh, cameraPositionLow) =>
        mutates.updateRteUniforms(
          modelViewMatrixRTE,
          cameraPositionHigh,
          cameraPositionLow,
          state,
        ),
      new Matrix4(),
      new Matrix4(),
    );
    mesh.onBeforeRender = onBeforeRender;
    mesh.onBeforeShadow = onBeforeRender;

    material.customProgramCacheKey = enhancer.programCacheKey;
    material.onBeforeCompile = enhancer.transformShader;
    this.ctx.applyShadowMaterial(material);

    if (this.pickBatchId !== undefined) {
      this.ctx.registerPickableMesh(this.id, mesh);
    }

    return mesh;
  }

  /** Requests the globe normal copy only while shading with it. */
  override getRequiredBuffers(): readonly GBufferName[] {
    return usesGroundNormals(this.style) ? ["globeNormal"] : [];
  }

  /** Enhancer props derived from the style, shared by mount and update. */
  private baseProps(style: NonNullable<Description["polyline"]>) {
    return {
      color: style.color?.toHex(),
      opacity: style.opacity,
      transparent: style.transparent,
      depthWrite: style.depthWrite,
      width: style.width,
      maxWidth: style.maxWidth,
      // A clamped volume must enclose the ground, so it is never offset.
      addHeight: isClampedToGround(style) ? 0 : (style.height ?? 0),
      emissiveColor: style.emissiveColor?.toHex(),
      emissiveIntensity: style.emissiveIntensity,
      minMaxHeight: this.minMaxHeight(style),
      effectIdsMask: this.effectIdsMask(),
    };
  }

  private effectIdsMask(): number {
    return this._effectIds.length > 0
      ? this.ctx.selectiveEffectRegistry.computeMask(this._effectIds)
      : 0;
  }

  protected override updateEffectIdsMask(): void {
    if (!this.enhancer) return;
    this.enhancer.update({ base: { effectIdsMask: this.effectIdsMask() } });
    this.emit("needsUpdate");
  }

  /**
   * Height range of the volume; zero when unclamped. Call after the ground is
   * watched.
   */
  private minMaxHeight(
    style: NonNullable<Description["polyline"]>,
  ): [number, number] {
    if (!isClampedToGround(style)) return [0, 0];

    const ground = this.ground.heights;
    if (!ground) {
      throw new Error(
        "PolylineMesh: the ground volume is read before it is watched",
      );
    }
    return ground;
  }

  /**
   * Bakes the transform into the geometry, since the builder and the ground
   * volume need world positions. The mesh object stays at identity.
   */
  protected override applyTransform(): void {
    const transform = this.composeTransform();
    if (!this._instance || transform.equals(this.bakedTransform)) return;
    this.replaceGeometry(this.buildGeometry(this.style, transform));
    this.bakedTransform = transform;
    this.emit("needsUpdate");
  }

  private replaceGeometry(built: {
    geometry: BufferGeometry;
    extent: GeographicExtent;
  }): void {
    if (!this._instance) return;
    this._instance.geometry.dispose();
    this._instance.geometry = built.geometry;
    this.ground.watch(isClampedToGround(this.style) ? built.extent : undefined);
  }

  /** Builds from `style` without touching the descriptor's state. */
  private buildGeometry(
    style: NonNullable<Description["polyline"]>,
    transform: Matrix4,
  ): {
    geometry: BufferGeometry;
    extent: GeographicExtent;
  } {
    const positions = buildPositions(style, transform);
    if (positions.rings.length !== 1) {
      throw new Error(
        "PolylineMesh takes a single line; add one mesh per part of a multi-line",
      );
    }
    // TODO: Build on a worker. This runs on the main thread for every position update.
    const built = buildPolylineGeometry(
      positions.rings[0],
      positions.geocentric,
      style.ring ?? false,
      toGeometryMaterial<PolylineGeometryMaterial>(style, NON_GEOMETRY_KEYS),
    );
    if (!built) {
      throw new Error("PolylineMesh: fewer than two distinct positions");
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(built.position, 3));
    geometry.setAttribute(
      "position_3d_high",
      new BufferAttribute(built.positionHigh, 3),
    );
    geometry.setAttribute(
      "position_3d_low",
      new BufferAttribute(built.positionLow, 3),
    );
    geometry.setAttribute(
      "start_3d_high",
      new BufferAttribute(built.startHigh, 3),
    );
    geometry.setAttribute(
      "start_3d_low",
      new BufferAttribute(built.startLow, 3),
    );
    geometry.setAttribute("end_3d_high", new BufferAttribute(built.endHigh, 3));
    geometry.setAttribute("end_3d_low", new BufferAttribute(built.endLow, 3));
    geometry.setAttribute(
      "start_normal",
      new BufferAttribute(built.startNormal, 3),
    );
    geometry.setAttribute(
      "end_normal_and_texture_coordinate_normalization_x",
      new BufferAttribute(built.endNormalAndTextureCoordinateNormalizationX, 4),
    );
    geometry.setAttribute(
      "right_normal_and_texture_coordinate_normalization_y",
      new BufferAttribute(
        built.rightNormalAndTextureCoordinateNormalizationY,
        4,
      ),
    );
    geometry.setIndex(new BufferAttribute(built.indices, 1));
    setBatchIdAttribute(
      geometry,
      built.position.length / 3,
      this.pickBatchId ?? 0,
    );
    // `position` holds world-space coordinates, used for depth sorting.
    geometry.computeBoundingSphere();
    return { geometry, extent: built.extent };
  }

  onUpdateConfig(updates: PolylineMeshUpdate): void {
    const patch = updates.polyline;
    if (patch && this._instance && this.enhancer) {
      const style = this.style;
      // Positions always rebuild, since an array may be mutated in place.
      const geometryChanged =
        POSITION_KEYS.some((key) => patch[key] !== undefined) ||
        GEOMETRY_KEYS.some(
          (key) => patch[key] !== undefined && patch[key] !== style[key],
        );
      const usedGroundNormals = usesGroundNormals(style);
      const next = { ...style };
      if (POSITION_KEYS.some((key) => patch[key] !== undefined)) {
        // Position sources are mutually exclusive.
        for (const key of POSITION_KEYS) {
          if (patch[key] === undefined) next[key] = undefined;
        }
      }
      Object.assign(next, patch);
      // Build before committing anything, so a throwing patch leaves the
      // descriptor as it was.
      const built = geometryChanged
        ? this.buildGeometry(next, this.bakedTransform)
        : undefined;

      Object.assign(style, next);
      const clamped = isClampedToGround(style);

      // `clampToGround` is a geometry key, so a toggle always rebuilds.
      if (built) this.replaceGeometry(built);

      if (usesGroundNormals(style) !== usedGroundNormals) {
        this.ctx.emit("gbufferRequirementsChanged");
      }

      this.enhancer.update({
        base: {
          ...this.baseProps(style),
          groundCulling: clamped,
          useGroundNormals: style.useGroundNormals,
        },
      });

      this._instance.castShadow = castsShadow(style);
      this._instance.receiveShadow = style.receiveShadow ?? false;
      if (patch.effectIds !== undefined) {
        updates.effectIds = patch.effectIds;
      }
      this.emit("needsUpdate");
    }

    // The base would copy a frameless `position`/`rotation`/`scale` onto the
    // mesh object, which stays at identity; `applyTransform` bakes them.
    const { position, rotation, scale, ...rest } = updates;
    super.onUpdateConfig(rest);
    if (position !== undefined) this.position = position;
    if (rotation !== undefined) this.rotation = rotation;
    if (scale !== undefined) this.scale = scale;
    this.applyTransform();
  }

  /** The line as drawn, in geodetic GeoJSON, e.g. to hand it to a layer source. */
  toGeoJSON(): LineString {
    const [coordinates] = toGeoJsonRings(
      buildPositions(this.style, this.composeTransform()),
    );
    return { type: "LineString", coordinates };
  }

  protected disposeMesh(): void {
    if (this._instance) {
      this._instance.geometry.dispose();
      releaseFeatureMaterial(this.ctx, this._instance.material);
    }
  }

  override onDestroy(): void {
    this.ground.watch(undefined);
    if (this.pickBatchId !== undefined) {
      this.ctx.unregisterPickableMesh(this.id);
      this.pickBatchId = undefined;
    }
    // Must run before `super.onDestroy()`, which detaches `raw` from its
    // scene and then clears `_instance`.
    this.disposeMesh();
    super.onDestroy();
  }
}
