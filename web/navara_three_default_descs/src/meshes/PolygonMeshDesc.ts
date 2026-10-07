import type ThreeView from "@navaramap/three";
import {
  MeshDescWithSelectiveEffect,
  buildPolygonGeometry,
  polygonGroundVolume,
  createPolygonMaterialEnhancer,
  createShadowDepthMaterial,
  setDrapeGroundNormals,
  setupRTECallback,
  type CustomObject3DEventMap,
  type GBufferName,
  type GeographicExtent,
  type MeshConfigWithSelectiveEffect,
  type MeshUpdateWithSelectiveEffect,
  type PassKey,
  type PolygonGeometryMaterial,
  type VectorLayer,
  type ViewContext,
} from "@navaramap/three";
import type { Polygon } from "geojson";
import {
  BufferAttribute,
  BufferGeometry,
  Matrix4,
  MeshLambertMaterial,
  type Object3DEventMap,
} from "three";

import {
  boundingSphereOfRte,
  FeatureDrapedMesh,
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

type PolygonMeshEventMap = Object3DEventMap & CustomObject3DEventMap;

/**
 * The `polygon` layer material without the layer-only options. `show` and
 * `lit` are covered by the mesh config's `visible` and `lit`; draw an outline
 * as a {@link PolylineMeshDesc} over the same ring.
 */
export type PolygonMeshStyle = Omit<
  NonNullable<VectorLayer["polygon"]>,
  | "tiled"
  | "show"
  | "surfaceShow"
  | "outline"
  | "outlineShow"
  | "outlineColor"
  | "outlineWidth"
  | "lit"
  | "__internal__"
>;

type Description = {
  polygon?: PolygonMeshStyle &
    PositionSource & {
      /**
       * Shades a clamped polygon with the terrain's normal at each pixel, so
       * it takes the terrain's light and shade. Otherwise it is shaded with
       * the ellipsoid's normal, which skips the full-screen copy of the
       * terrain normals.
       */
      useGroundNormals?: boolean;
    };
};

export type PolygonMeshConfig = MeshConfigWithSelectiveEffect &
  Description & { pickable?: boolean };

export type PolygonMeshUpdate = MeshUpdateWithSelectiveEffect & Description;

type PolygonMeshInstance = FeatureDrapedMesh<
  MeshLambertMaterial,
  PolygonMeshEventMap
>;

type PolygonEnhancer = ReturnType<typeof createPolygonMaterialEnhancer>;

/**
 * Style keys the geometry builder reads; patching one rebuilds the geometry.
 * `extrudedHeight` is applied in the vertex shader.
 */
const GEOMETRY_KEYS = ["clampToGround", "perPositionHeight", "height"] as const;

/** Style keys the geometry builder does not read. */
const NON_GEOMETRY_KEYS = [...POSITION_KEYS, "useGroundNormals"];

function usesGroundNormals(
  style: NonNullable<Description["polygon"]>,
): boolean {
  return isClampedToGround(style) && (style.useGroundNormals ?? true);
}

/**
 * A single polygon outside the layer/source pipeline, built with the layer's
 * geometry builder and material. `update()` rebuilds it from positions without
 * re-tiling.
 *
 * With `clampToGround` (default), it is draped with a stencil volume enclosing
 * {@link ThreeView.sampleTerrainHeightRange} and lit with the terrain's normal.
 * A clamped polygon receives shadows but casts none.
 */
export class PolygonMeshDesc extends MeshDescWithSelectiveEffect<
  PolygonMeshConfig,
  PolygonMeshUpdate,
  PolygonMeshInstance
> {
  private config: PolygonMeshConfig;
  private pickBatchId?: number;
  /** The transform the current geometry was built with. */
  private bakedTransform = new Matrix4();
  private enhancer?: PolygonEnhancer;
  private readonly ground = new GroundVolumeWatch(
    this.view,
    polygonGroundVolume,
    () => {
      if (!this.enhancer || !this.config.polygon) return;
      this.enhancer.update({
        base: { minMaxHeight: this.minMaxHeight(this.config.polygon) },
      });
      this.emit("needsUpdate");
    },
  );

  constructor(view: ThreeView, ctx: ViewContext, config: PolygonMeshConfig) {
    if (config.polygon?.effectIds) {
      config.effectIds = config.polygon.effectIds;
    }
    super(view, ctx, config);
    this.config = config;
  }

  /** The batch ID assigned to this mesh when picking is enabled. */
  get batchId(): number | undefined {
    return this.pickBatchId;
  }

  private get style(): NonNullable<Description["polygon"]> {
    const style = this.config.polygon;
    if (!style) {
      throw new Error("PolygonMesh configuration is required");
    }
    return style;
  }

  protected override getPassKey(): PassKey {
    return isClampedToGround(this.style) ? "draped" : super.getPassKey();
  }

  /** Requests the globe normal copy only while shading with it. */
  override getRequiredBuffers(): readonly GBufferName[] {
    return usesGroundNormals(this.style) ? ["globeNormal"] : [];
  }

  createMesh(): PolygonMeshInstance {
    const style = this.style;

    this.pickBatchId = this.config.pickable
      ? this.ctx.genGlobalBatchId()
      : undefined;

    const transform = this.composeTransform();
    const built = this.buildGeometry(style, transform);
    this.bakedTransform = transform;
    this.ground.watch(isClampedToGround(style) ? built.extent : undefined);
    const { material, enhancer } = this.createMaterial(style);
    const mesh = new FeatureDrapedMesh<
      MeshLambertMaterial,
      PolygonMeshEventMap
    >(
      built.geometry,
      material,
      isClampedToGround(style),
      this.pickBatchId ?? 0,
      (pickable) => this.enhancer?.update({ base: { pickable } }),
    );

    mesh.customDepthMaterial = createShadowDepthMaterial(material);
    mesh.castShadow = style.castShadow ?? false;
    mesh.receiveShadow = style.receiveShadow ?? false;
    // RTE positions make the CPU bounding volume meaningless.
    mesh.frustumCulled = false;

    this.wireRte(mesh, enhancer);

    if (this.pickBatchId !== undefined) {
      this.ctx.registerPickableMesh(this.id, mesh);
    }

    return mesh;
  }

  /**
   * Creates the material with its enhancer mounted.
   *
   * Toggling `clampToGround` needs a new material, because the draped pass
   * patches the shader once per material and never reverts it. Call after
   * the ground is watched, since `minMaxHeight` reads it.
   */
  private createMaterial(style: NonNullable<Description["polygon"]>): {
    material: MeshLambertMaterial;
    enhancer: PolygonEnhancer;
  } {
    const material = new MeshLambertMaterial();
    setDrapeGroundNormals(material, style.useGroundNormals ?? true);
    const enhancer = createPolygonMaterialEnhancer(material);
    enhancer.mount({
      base: {
        ...this.baseProps(style),
        useRTE: true,
        isTexturized: false,
        pickable: false,
      },
      water: {
        ...this.waterProps(style),
        timeUniform: this.ctx.getTimeUniform() as { value: number },
        skyEnvMap: this.ctx.getSkyEnvMapTextureUniform().value,
      },
    });
    this.enhancer = enhancer;

    material.customProgramCacheKey = enhancer.programCacheKey;
    material.onBeforeCompile = enhancer.transformShader;
    this.ctx.applyShadowMaterial(material);

    return { material, enhancer };
  }

  /** Binds the RTE callbacks to `enhancer`; re-run after replacing the material. */
  private wireRte(mesh: PolygonMeshInstance, enhancer: PolygonEnhancer) {
    const { base } = enhancer.states();
    const { base: baseMutates } = enhancer.mutates();
    const onBeforeRender = setupRTECallback(
      mesh,
      (modelViewMatrixRTE, cameraPositionHigh, cameraPositionLow) =>
        baseMutates.updateRteUniforms(
          modelViewMatrixRTE,
          cameraPositionHigh,
          cameraPositionLow,
          base,
        ),
    );
    mesh.onBeforeRender = onBeforeRender;
    mesh.onBeforeShadow = onBeforeRender;
  }

  /** Water enhancer props derived from the style, shared by mount and update. */
  private waterProps(style: PolygonMeshStyle) {
    return {
      water: style.water,
      waterScaleNormal: style.waterScaleNormal,
      waterSpeed: style.waterSpeed,
      shininess: style.shininess,
      specularStrength: style.specularStrength,
      applyWaterNormal: style.applyWaterNormal,
      specular: style.specular,
      ior: style.ior,
    };
  }

  /** Enhancer props derived from the style, shared by mount and update. */
  private baseProps(style: PolygonMeshStyle) {
    return {
      color: style.color?.toHex(),
      opacity: style.opacity,
      transparent: style.transparent,
      wireframe: style.wireframe,
      // The enhancer leaves a clamped polygon unlit for textures the terrain
      // shades; a stencil drape is shaded at the ground instead.
      clampToGround: false,
      reflectivity: style.reflectivity,
      roughness: style.roughness,
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
   * Height range of the extrusion; the ground volume when clamped. Call after
   * the ground is watched.
   */
  private minMaxHeight(style: PolygonMeshStyle): [number, number] {
    const height = style.height ?? 0;
    const extrudedHeight = style.extrudedHeight ?? 0;
    if (!isClampedToGround(style)) {
      return [height, height + extrudedHeight];
    }

    const ground = this.ground.heights;
    if (!ground) {
      throw new Error(
        "PolygonMesh: the ground volume is read before it is watched",
      );
    }
    return [Math.min(ground[0], height), Math.max(ground[1], extrudedHeight)];
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
    style: NonNullable<Description["polygon"]>,
    transform: Matrix4,
  ): {
    geometry: BufferGeometry;
    extent: GeographicExtent;
  } {
    const { rings, geocentric } = buildPositions(style, transform);
    // TODO: Build on a worker. This runs on the main thread for every position update.
    const built = buildPolygonGeometry(
      rings,
      geocentric,
      toGeometryMaterial<PolygonGeometryMaterial>(style, NON_GEOMETRY_KEYS),
    );
    if (!built) {
      throw new Error(
        "PolygonMesh: the outer ring has fewer than three vertices, or all of them are collinear",
      );
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      "position_3d_high",
      new BufferAttribute(built.positionHigh, 3),
    );
    geometry.setAttribute(
      "position_3d_low",
      new BufferAttribute(built.positionLow, 3),
    );
    if (built.normal) {
      geometry.setAttribute("normal", new BufferAttribute(built.normal, 3));
    }
    geometry.setAttribute(
      "scaleNormalAndCap",
      new BufferAttribute(built.scaleNormalAndCap, 4),
    );
    geometry.setIndex(new BufferAttribute(built.indices, 1));
    setBatchIdAttribute(
      geometry,
      built.positionHigh.length / 3,
      this.pickBatchId ?? 0,
    );
    // Only the RTE attributes hold positions; used for transparent sorting.
    geometry.boundingSphere = boundingSphereOfRte(
      built.positionHigh,
      built.positionLow,
    );
    return { geometry, extent: built.extent };
  }

  onUpdateConfig(updates: PolygonMeshUpdate): void {
    const patch = updates.polygon;
    if (patch && this._instance && this.enhancer) {
      const style = this.style;
      // Positions always rebuild, since an array may be mutated in place.
      const geometryChanged =
        POSITION_KEYS.some((key) => patch[key] !== undefined) ||
        GEOMETRY_KEYS.some(
          (key) => patch[key] !== undefined && patch[key] !== style[key],
        );
      const wasClamped = isClampedToGround(style);
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
      this._instance.drapedEnable = clamped;

      // `clampToGround` is a geometry key, so a toggle always rebuilds.
      if (built) this.replaceGeometry(built);

      if (clamped !== wasClamped) {
        releaseFeatureMaterial(this.ctx, this._instance.material);
        this._instance.customDepthMaterial?.dispose();
        const { material, enhancer } = this.createMaterial(style);
        this._instance.material = material;
        this._instance.customDepthMaterial =
          createShadowDepthMaterial(material);
        this.wireRte(this._instance, enhancer);
        this.applyLit();
      } else {
        setDrapeGroundNormals(
          this._instance.material,
          style.useGroundNormals ?? true,
        );
        this.enhancer.update({
          base: this.baseProps(style),
          water: this.waterProps(style),
        });
      }
      // A clamp toggle changes the pass, which emits this itself.
      if (
        clamped === wasClamped &&
        usesGroundNormals(style) !== usedGroundNormals
      ) {
        this.ctx.emit("gbufferRequirementsChanged");
      }

      if (patch.castShadow !== undefined) {
        this._instance.castShadow = patch.castShadow;
      }
      if (patch.receiveShadow !== undefined) {
        this._instance.receiveShadow = patch.receiveShadow;
      }
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

  /** The polygon as drawn, in geodetic GeoJSON, e.g. to hand it to a layer source. */
  toGeoJSON(): Polygon {
    return {
      type: "Polygon",
      coordinates: toGeoJsonRings(
        buildPositions(this.style, this.composeTransform()),
      ),
    };
  }

  protected disposeMesh(): void {
    if (this._instance) {
      this._instance.geometry.dispose();
      releaseFeatureMaterial(this.ctx, this._instance.material);
      this._instance.customDepthMaterial?.dispose();
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
