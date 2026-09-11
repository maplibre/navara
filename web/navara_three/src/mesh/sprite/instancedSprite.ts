import {
  PointMesh as NavaraPointMesh,
  BillboardMesh as NavaraBillboardMesh,
} from "@navaramap/engine";
import { degreeToRadian } from "@navaramap/three-api";
import {
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  Object3D,
  ShaderMaterial,
  BufferAttribute,
  type BufferGeometry,
  Color,
  type Material,
  PerspectiveCamera,
  Vector2,
} from "three";
import invariant from "tiny-invariant";

import {
  readBatchScalar,
  readBatchShowOpacity,
  registerBatchedMaterial,
  SPRITE_BATCH_SUPPORT,
  updateBatchAttribute,
  type BatchedAttributeName,
  type BatchTextureSupport,
  type DefaultBatchAttributeValues,
} from "../../batchTexture";
import {
  DECLUTTER_FADE_MS,
  type DeclutterCandidate,
  type DeclutterParticipant,
} from "../../declutter/types";
import type { EventContext } from "../../event/context";
import { createInstancedSpriteMaterialEnhancer } from "../../material/enhancer";
import type { CustomObject3DEventMap } from "../../object3DEvent";
import { buildBatchIndexMap } from "../batchIndexMap";
import { GEOMETRY_TYPES, type GeometryType } from "../constants";
import { PickableMesh } from "../pickableMesh";

import { BillboardAtlas, type AtlasRect } from "./billboardAtlas";
import { loadAtlasImageFromUrl } from "./billboardAtlasImageLoader";

type SpriteGeometryType = Extract<
  GeometryType,
  typeof GEOMETRY_TYPES.Point | typeof GEOMETRY_TYPES.Billboard
>;

export type InstancedSpriteOptions = {
  renderOrder?: number;
  ctx: EventContext;
  geometryType: SpriteGeometryType;
};

type PositionsInfo = {
  position:
    | Float32Array<ArrayBufferLike>
    | {
        high: Float32Array<ArrayBufferLike>;
        low: Float32Array<ArrayBufferLike>;
      };
  batchIDs: Float32Array<ArrayBufferLike> | null;
  positionSize: number;
  batchIDSize: number;
  nPositions: number;
  RTE: boolean;
};

/** Reusable Vector2 to avoid per-frame allocations in onBeforeRender. */
const _tmpSize = new Vector2();

/** Reusable scratch for per-feature style writes. */
const _tmpColorArray: [number, number, number] = [0, 0, 0];
const _tmpDefaultColor = new Color();
const _tmpDefaultEmissive = new Color();

// Coupled with crates/navara_feature/src/geometry/point.rs::pixel_to_world
export class InstancedSpriteMesh
  extends Mesh<BufferGeometry, Material | Material[], CustomObject3DEventMap>
  implements PickableMesh, DeclutterParticipant
{
  private _geometryType: SpriteGeometryType = GEOMETRY_TYPES.Point;
  /**
   * Feature (batch) index → this feature's instance ids. A feature owns
   * multiple instances for MultiPoint geometry and for points derived from
   * line/polygon vertices via `geometryTypes`, so per-feature styling must
   * fan out to all of them. `null` means instances and features are 1:1.
   */
  private _batchIndexToInstances: Map<number, number[]> | null = null;
  /**
   * Per-instance feature (batch) index, mirroring the `_batchid` attribute for
   * CPU-side reads (declutter). `null` means instances and features are 1:1.
   */
  private _instanceBatchIndex: Float32Array | null = null;
  /** Feature count — the batch data texture's column count. */
  private _batchLength = 0;
  /** Instance count of the current geometry; bounds the identity fallback. */
  private _instanceCount = 0;
  private _atlas?: BillboardAtlas;
  private _defaultUrl?: string;
  /** Atlas rect of the current default image; re-applied to an instance when
   * its per-feature override is cleared. */
  private _defaultRect?: AtlasRect;
  /** Instance ids whose image was overridden per-feature; the default image
   * from the material no longer applies to them. */
  private _imageOverrides = new Set<number>();
  /** Latest override URL requested per instance. An async pack only applies
   * if it still matches, so a newer override or a clear wins over slow loads. */
  private _requestedImageUrls = new Map<number, string>();
  /** Forwards the atlas byte footprint to the engine's memory ledger; wired
   * by the feature-added handler once the owning entity bits are known. */
  private _atlasBytesReporter?: (bytes: number) => void;
  private _reportedAtlasBytes = 0;
  private _active = true;
  readonly ctx: EventContext;
  /** Material enhancer for encapsulated state management */
  private _enhancedMaterial?: ReturnType<
    typeof createInstancedSpriteMaterialEnhancer
  >;
  /** Per-instance world anchors in ECEF meters (f64, 3 per instance), kept in
   *  sync with the position attributes for the declutter pass. */
  private _anchors: Float64Array | null = null;
  /** Whether this mesh's instances participate in screen-space decluttering. */
  private _declutter = false;
  /** Layer-level placement priority from the material. */
  private _declutterPriority = 0;
  /** Per-instance priorities set through the evaluator (NaN = no override,
   *  fall back to the layer value). Lazily allocated on first use. */
  private _declutterPriorityOverrides: Float32Array | null = null;
  /** Per-instance fade targets for `instanceDeclutterHide` (0 = shown,
   *  1 = hidden); the attribute animates toward these in stepDeclutterFade. */
  private _declutterTargets: Float32Array | null = null;
  /** True while any instance's hide factor may differ from its target. */
  private _declutterAnimating = false;

  constructor(options: InstancedSpriteOptions) {
    super();
    this.renderOrder = options.renderOrder ?? this.renderOrder;
    this.ctx = options.ctx;
    this._geometryType = options.geometryType;
    this.ctx.declutter?.register(this);
    // `processObjectRemoved` dispatches this for every removed mesh; it is the
    // reliable teardown signal (this class's dispose() is not called there).
    this.addEventListener("removedFromWorld", () => {
      this.ctx.declutter?.unregister(this);
    });
  }

  setActive(active: boolean) {
    this._active = active;
    this.updateVisibility();
    this.ctx.declutter?.markDirty();
  }

  /**
   * Set the geometry type for this mesh.
   *
   * This affects how FeatureEvaluator provides meshGeomType to evaluators,
   * which is used by MapLibreStylePlugin to determine which properties to apply
   * (e.g., billboard vs text rendering for symbol layers).
   *
   * Changing this after initialization is supported and will affect subsequent
   * feature evaluations, but does NOT automatically trigger re-evaluation.
   * Call layer.forceUpdate() if you need to re-evaluate existing features.
   */
  setGeometryType(type: SpriteGeometryType): void {
    this._geometryType = type;
  }

  /**
   * Get the geometry type of this mesh.
   * Defaults to GEOMETRY_TYPES.Point if not explicitly set.
   */
  get geometryType(): SpriteGeometryType {
    return this._geometryType;
  }

  // --- DeclutterParticipant ---

  collectDeclutterCandidates(out: DeclutterCandidate[]): void {
    if (!this.visible || !this._declutter || !this._anchors) return;
    const enhancer = this._enhancedMaterial;
    if (!enhancer) return;
    const material = this.material as ShaderMaterial;

    const state = enhancer.states();
    const cx = Math.min(Math.max(state.center[0], -0.5), 0.5);
    const cy = Math.min(Math.max(state.center[1], -0.5), 0.5);
    // Mirror of instancedSprite.vert.glsl — aspect is per-instance
    // (from the atlas rect), not a material-level uniform; there is no
    // material-wide "aspect" state to read.
    const uvRect = state.billboard
      ? (this.geometry?.getAttribute("instanceUvRect") as
          InstancedBufferAttribute | undefined)
      : undefined;
    const anchors = this._anchors;
    const batchIndices = this._instanceBatchIndex;
    const overrides = this._declutterPriorityOverrides;
    const targets = this._declutterTargets;
    const count = Math.min(this._instanceCount, anchors.length / 3);

    for (let i = 0; i < count; i++) {
      // Style values mirror the shader: read the batch data texture, falling
      // back to the material-level state where a slot was never allocated.
      const batchIndex = batchIndices ? batchIndices[i] : i;
      const showOpacity = readBatchShowOpacity(material, batchIndex);
      if (showOpacity && showOpacity.show < 0.5) continue; // hidden by user `show`
      const batchSize = readBatchScalar(material, batchIndex, "size");
      const size =
        batchSize !== undefined && batchSize >= 0.0 ? batchSize : state.scale;
      if (size <= 0.0) continue;
      const addHeight =
        readBatchScalar(material, batchIndex, "height") ?? state.addHeight;

      const override = overrides ? overrides[i] : Number.NaN;
      const rectH = uvRect ? uvRect.getW(i) : 0;
      const rectW = uvRect ? uvRect.getZ(i) : 0;
      // Mirror of the shader's empty-rect cull: an instance with no image
      // packed yet is not drawn, so it must not reserve declutter space and
      // hide the labels around it.
      if (uvRect && (rectW <= 0.0 || rectH <= 0.0)) continue;
      const aspect = uvRect ? rectW / rectH : 1.0;

      // Mirror of instancedSprite.vert.glsl:122-125 — the quad spans
      // (position.xy - center) * vec2(aspect, 1) * size around the anchor.
      out.push({
        anchorX: anchors[i * 3],
        anchorY: anchors[i * 3 + 1],
        anchorZ: anchors[i * 3 + 2],
        addHeight,
        minX: (-0.5 - cx) * aspect * size,
        maxX: (0.5 - cx) * aspect * size,
        minY: (-0.5 - cy) * size,
        maxY: (0.5 - cy) * size,
        sizeInMeters: state.sizeInMeters,
        // NaN-safe: an unset override falls back to the layer priority.
        priority: Number.isNaN(override) ? this._declutterPriority : override,
        isShown: targets ? targets[i] === 0 : true,
        owner: this,
        handle: i,
      });
    }
  }

  applyDeclutter(handle: number, hidden: boolean): void {
    this.setDeclutterHiddenByInstance(handle, hidden);
  }

  stepDeclutterFade(deltaMs: number): boolean {
    if (!this._declutterAnimating) return false;
    const attr = this.geometry?.getAttribute("instanceDeclutterHide") as
      InstancedBufferAttribute | undefined;
    const targets = this._declutterTargets;
    if (!attr || !targets) {
      this._declutterAnimating = false;
      return false;
    }

    const step = deltaMs / DECLUTTER_FADE_MS;
    const count = Math.min(attr.count, targets.length);
    let stillAnimating = false;
    let changed = false;
    for (let i = 0; i < count; i++) {
      let value = attr.getX(i);
      const target = targets[i];
      if (value === target) continue;
      value =
        value < target
          ? Math.min(value + step, target)
          : Math.max(value - step, target);
      attr.setX(i, value);
      changed = true;
      if (value !== target) stillAnimating = true;
    }
    if (changed) attr.needsUpdate = true;
    this._declutterAnimating = stillAnimating;
    return stillAnimating;
  }

  private _cacheDeclutterState(m: NavaraPointMesh | NavaraBillboardMesh) {
    const nextDeclutter = m.material.declutter ?? true;
    if (this._declutter && !nextDeclutter) {
      // Leaving declutter mode: clear hides the pass applied — the mesh stops
      // producing candidates, so nothing else would ever re-show them.
      this._clearDeclutterHidden();
    }
    this._declutter = nextDeclutter;
    this._declutterPriority = m.material.declutterPriority ?? 0;
  }

  private _clearDeclutterHidden(): void {
    const targets = this._declutterTargets;
    if (!targets) return;
    targets.fill(0.0);
    // Everything fades back in from wherever its hide factor currently is.
    this._declutterAnimating = true;
  }

  /** Reconstruct absolute ECEF anchors from the same arrays the position
   *  attributes receive (RTE high+low split, or RTC-relative + center). */
  private _cacheAnchors(
    positionsInfo: PositionsInfo,
    transform: { tx: number; ty: number; tz: number },
  ): void {
    const { nPositions, positionSize, RTE } = positionsInfo;
    const anchors =
      this._anchors && this._anchors.length === nPositions * 3
        ? this._anchors
        : new Float64Array(nPositions * 3);

    if (RTE) {
      const pos = positionsInfo.position as {
        high: Float32Array<ArrayBufferLike>;
        low: Float32Array<ArrayBufferLike>;
      };
      for (let i = 0; i < nPositions; i++) {
        const s = i * positionSize;
        anchors[i * 3] = pos.high[s] + pos.low[s];
        anchors[i * 3 + 1] = pos.high[s + 1] + pos.low[s + 1];
        anchors[i * 3 + 2] = (pos.high[s + 2] ?? 0.0) + (pos.low[s + 2] ?? 0.0);
      }
    } else {
      const pos = positionsInfo.position as Float32Array<ArrayBufferLike>;
      for (let i = 0; i < nPositions; i++) {
        const s = i * positionSize;
        anchors[i * 3] = pos[s] + transform.tx;
        anchors[i * 3 + 1] = pos[s + 1] + transform.ty;
        anchors[i * 3 + 2] = (pos[s + 2] ?? 0.0) + transform.tz;
      }
    }
    this._anchors = anchors;
  }

  async _init(m: NavaraPointMesh | NavaraBillboardMesh) {
    const positionsInfo = this.extractPositions(m);
    if (positionsInfo === null) {
      console.warn("No position data found for InstancedSpriteMesh");
      return;
    }

    this._cacheDeclutterState(m);
    this._cacheAnchors(positionsInfo, m.transform);

    // Create Geometry
    this.geometry = this._initGeometry(positionsInfo, m);

    // Create Material
    this.material = await this._initMaterial(positionsInfo, m);

    this.frustumCulled = false; // Disable since bounding box doesn't account for instance positions
    this.ctx.declutter?.markDirty();
  }

  async _update(m: NavaraPointMesh | NavaraBillboardMesh) {
    const enhancer = this.getEnhancer();
    const material = this.material as ShaderMaterial;

    this._cacheDeclutterState(m);

    if (material.visible !== m.material.show) {
      material.visible = m.material.show ?? true;
      this.updateVisibility();
    }

    // Update enhancer state for uniform-backed properties. Style defaults
    // (color/opacity/addHeight) are uniforms; per-feature overrides live in
    // the batch data texture and win once written.
    // `color` only until batch color is enabled: from then on every feature
    // reads the texture (written value or the backfilled snapshot), same
    // snapshot semantics as PolygonMesh._update.
    const batchColorEnabled = !!(
      material.userData.defines as Record<string, unknown> | undefined
    )?.USE_BATCH_COLOR;
    enhancer.update({
      base: {
        scale: m.material.size ?? 100.0,
        center: [m.material.center?.x ?? 0.0, m.material.center?.y ?? 0.0],
        sizeInMeters: m.material.sizeInMeters ?? true,
        offsetDepth: m.material.offsetDepth ?? true,
        transparent: m.material.transparent ?? true,
        depthTest: m.material.depthTest ?? true,
        color: batchColorEnabled ? undefined : (m.material.color ?? 0xffffff),
        opacity: m.material.opacity ?? 1.0,
        addHeight: m.material.height ?? 0.0,
        effectIdsMask:
          this.ctx.viewContext.selectiveEffectRegistry?.computeMask(
            m.material.effectIds ?? [],
          ) ?? 0,
        emissiveColor: m.material.emissiveColor ?? 0,
        emissiveIntensity: m.material.emissiveIntensity ?? 0,
      },
    });

    // Position updates (per-instance attributes)
    {
      const positionsInfo = this.extractPositions(m);

      if (positionsInfo) {
        this._cacheAnchors(positionsInfo, m.transform);
        if (positionsInfo.RTE) {
          const pos = positionsInfo.position as {
            high: Float32Array<ArrayBufferLike>;
            low: Float32Array<ArrayBufferLike>;
          };
          const pLow = this.geometry.getAttribute(
            "instancePositionLOW",
          ) as InstancedBufferAttribute;
          const pHigh = this.geometry.getAttribute(
            "instancePositionHIGH",
          ) as InstancedBufferAttribute;
          pLow.copyArray(pos.low);
          pHigh.copyArray(pos.high);
          pLow.needsUpdate = true;
          pHigh.needsUpdate = true;
        } else {
          const pos = positionsInfo.position as Float32Array<ArrayBufferLike>;
          const p = this.geometry.getAttribute(
            "instancePosition",
          ) as InstancedBufferAttribute;
          p.copyArray(pos);
          p.needsUpdate = true;
        }
      }
    }

    // Billboard-specific updates
    if (m instanceof NavaraBillboardMesh) {
      enhancer.update({
        base: { alphaTest: m.material.alphaTest ?? 0.0 },
      });

      if (m.material.url) {
        await this._setDefaultImage(m.material.url);
      }
    }

    this.ctx.declutter?.markDirty();
  }

  private _initGeometry(
    positionsInfo: PositionsInfo,
    m: NavaraPointMesh | NavaraBillboardMesh,
  ) {
    invariant(positionsInfo.batchIDs, "Batch IDs not found!");

    // prettier-ignore
    const vertices = new Float32Array([
      -0.5, -0.5, 0.0, // v0
       0.5, -0.5, 0.0, // v1
       0.5,  0.5, 0.0, // v2
      -0.5, -0.5, 0.0, // v3
       0.5,  0.5, 0.0, // v4
      -0.5,  0.5, 0.0, // v5
    ]);

    // prettier-ignore
    const uvs = new Float32Array([
      0.0, 0.0, // v0
      1.0, 0.0, // v1
      1.0, 1.0, // v2
      0.0, 0.0, // v3
      1.0, 1.0, // v4
      0.0, 1.0, // v5
    ]);

    const instanceCount = positionsInfo.nPositions;

    // Create the Instanced Mesh
    // We use InstancedBufferGeometry to inject our custom attributes
    const instancedGeometry = new InstancedBufferGeometry();
    instancedGeometry.setAttribute(
      "position",
      new BufferAttribute(vertices, 3),
    );
    instancedGeometry.setAttribute("uv", new BufferAttribute(uvs, 2));
    instancedGeometry.instanceCount = instanceCount;

    this._instanceCount = instanceCount;
    this._rebuildBatchIndexMap(m);
    this._batchLength = m.batch_length;

    // Per-instance feature index for the batch data texture lookup. An
    // identity mapping (the common case) gets a plain ramp.
    let batchIdArray = this._instanceBatchIndex;
    if (!batchIdArray) {
      batchIdArray = new Float32Array(instanceCount);
      for (let i = 0; i < instanceCount; i++) batchIdArray[i] = i;
    }
    instancedGeometry.setAttribute(
      "_batchid",
      new InstancedBufferAttribute(batchIdArray, 1),
    );

    if (m instanceof NavaraBillboardMesh) {
      // instanceUvRect: vec4(x, y, w, h) — this instance's atlas sub-rect in
      // pixels. Zeroed until an image is packed; the vertex shader culls empty
      // rects, so instances stay invisible rather than garbled.
      instancedGeometry.setAttribute(
        "instanceUvRect",
        new InstancedBufferAttribute(new Float32Array(instanceCount * 4), 4),
      );
    }

    if (positionsInfo.RTE) {
      const pos = positionsInfo.position as {
        high: Float32Array<ArrayBufferLike>;
        low: Float32Array<ArrayBufferLike>;
      };
      instancedGeometry.setAttribute(
        "instancePositionLOW",
        new InstancedBufferAttribute(pos.low, positionsInfo.positionSize),
      );
      instancedGeometry.setAttribute(
        "instancePositionHIGH",
        new InstancedBufferAttribute(pos.high, positionsInfo.positionSize),
      );
    } else {
      const pos = positionsInfo.position as Float32Array<ArrayBufferLike>;
      instancedGeometry.setAttribute(
        "instancePosition",
        new InstancedBufferAttribute(pos, positionsInfo.positionSize),
      );
    }
    // Declutter hide factors (0 = shown … 1 = hidden). Decluttered instances
    // start hidden and fade in once the placement pass grants them space, so
    // dense tiles don't flash their full clutter before the first pass runs.
    const initialHide = this._declutter ? 1.0 : 0.0;
    const declutterBuffer = new Float32Array(instanceCount).fill(initialHide);
    this._declutterTargets = new Float32Array(instanceCount).fill(initialHide);
    instancedGeometry.setAttribute(
      "instanceDeclutterHide",
      new InstancedBufferAttribute(declutterBuffer, 1),
    );
    instancedGeometry.setAttribute(
      "instanceBatchID",
      new InstancedBufferAttribute(
        positionsInfo.batchIDs,
        positionsInfo.batchIDSize,
      ),
    );

    return instancedGeometry;
  }

  private async _initMaterial(
    positionsInfo: PositionsInfo,
    m: NavaraPointMesh | NavaraBillboardMesh,
  ) {
    const isBillboard = m instanceof NavaraBillboardMesh;
    const material = new ShaderMaterial();

    // Create enhancer
    const enhancer = createInstancedSpriteMaterialEnhancer(material);
    this._enhancedMaterial = enhancer;

    // Mount with initial props
    enhancer.mount({
      base: {
        useRTE: positionsInfo.RTE,
        billboard: isBillboard,
        scale: m.material.size ?? 100.0,
        center: [m.material.center?.x ?? 0.0, m.material.center?.y ?? 0.0],
        sizeInMeters: m.material.sizeInMeters ?? true,
        offsetDepth: m.material.offsetDepth ?? true,
        alphaTest: isBillboard ? (m.material.alphaTest ?? 0.0) : 0.0,
        pickable: false,
        transparent: m.material.transparent ?? true,
        depthTest: m.material.depthTest ?? true,
        color: m.material.color ?? 0xffffff,
        opacity: m.material.opacity ?? 1.0,
        addHeight: m.material.height ?? 0.0,
        rtcCenter: [m.transform.tx, m.transform.ty, m.transform.tz],
      },
    });

    // Initialize uniforms early so they're available before onBeforeCompile
    const mutates = enhancer.mutates();
    mutates.updateUniforms(material.uniforms, enhancer.states());

    // Set up onBeforeRender for per-frame updates (farPlane + RTE eye position)
    material.onBeforeRender = (
      _renderer,
      _scene,
      camera,
      _geometry,
      _mat,
      _group,
    ) => {
      const pCam = camera as PerspectiveCamera;
      mutates.updateFarPlane(pCam.far);
      mutates.updateFovRad(degreeToRadian(pCam.fov));
      mutates.updateScreenHeightPx(
        _renderer.getDrawingBufferSize(_tmpSize).y / _renderer.getPixelRatio(),
      );

      if (positionsInfo.RTE) {
        mutates.updateRteUniforms(
          camera.position.x,
          camera.position.y,
          camera.position.z,
          enhancer.states(),
        );
      } else {
        mutates.updateRtcUniforms(camera.matrixWorldInverse, enhancer.states());
      }
    };

    // Set custom program cache key and onBeforeCompile
    material.customProgramCacheKey = enhancer.programCacheKey;
    material.onBeforeCompile = enhancer.transformShader;

    // Register for per-feature styling. Slots and the texture itself are
    // allocated lazily on the first attribute write.
    const batchUniform = registerBatchedMaterial(
      material,
      { ...this._getBatchTextureSupport(), batchLength: this._batchLength },
      this.ctx.viewContext.getRenderer(),
    );
    enhancer.update({ base: { batchDataTexture: batchUniform } });

    // Handle billboard texture
    if (isBillboard && m.material.url) {
      await this._setDefaultImage(m.material.url);
    }

    material.visible = m.material.show ?? true;
    this.updateVisibility();
    return material;
  }

  private updateVisibility() {
    const material = this.material;
    const materialVisible =
      material instanceof ShaderMaterial ? material.visible : true;
    this.visible = this._active && materialVisible;
  }

  private extractPositions(
    m: NavaraPointMesh | NavaraBillboardMesh,
  ): PositionsInfo | null {
    const { buf } = this.ctx;
    const g = m.geometry;

    const batchIdsData = g.batch_ids;
    const batchIDs = buf.removeF32(batchIdsData.data);
    const batchIDSize = batchIdsData.size;

    const positionData = g.position;
    const position = positionData
      ? buf.removeF32(positionData.data)
      : undefined;

    if (position && positionData) {
      const positionSize = positionData.size;
      const nPositions = position.length / positionSize;

      return {
        position,
        batchIDs,
        batchIDSize,
        positionSize,
        nPositions,
        RTE: false,
      };
    }

    const positionHighData = g.position_3d_high;
    const positionLowData = g.position_3d_low;
    const positionHigh = positionHighData
      ? buf.removeF32(positionHighData.data)
      : undefined;
    const positionLow = positionLowData
      ? buf.removeF32(positionLowData.data)
      : undefined;

    if (positionHigh && positionLow && positionHighData && positionLowData) {
      const positionLowSize = positionLowData.size;
      const positionHighSize = positionHighData.size;
      invariant(
        positionLowSize === positionHighSize,
        "Position high and low size mismatch",
      );

      const nPositions = positionHigh.length / positionHighSize;

      return {
        position: { high: positionHigh, low: positionLow },
        batchIDs,
        batchIDSize,
        positionSize: positionHighSize,
        nPositions,
        RTE: true,
      };
    }

    return null;
  }

  private _ensureAtlas(): BillboardAtlas {
    this._atlas ??= new BillboardAtlas({ loadImage: loadAtlasImageFromUrl });
    return this._atlas;
  }

  /**
   * Wire the callback that reports this mesh's atlas footprint to the
   * engine's memory ledger, and immediately report the current footprint —
   * the default image may have been packed during `_init`, before the
   * feature-added handler could wire the reporter.
   */
  setAtlasBytesReporter(reporter: (bytes: number) => void): void {
    this._atlasBytesReporter = reporter;
    this._reportAtlasBytes();
  }

  /** Report the atlas footprint if it changed since the last report. Must run
   * after every `pack()` — the atlas may have grown even when the pack failed
   * (growth up to `maxSize` happens before "no space" is decided). */
  private _reportAtlasBytes(): void {
    if (!this._atlasBytesReporter) return;
    const bytes = this._atlas?.byteLength ?? 0;
    if (bytes === this._reportedAtlasBytes) return;
    this._reportedAtlasBytes = bytes;
    this._atlasBytesReporter(bytes);
  }

  /**
   * Push the atlas texture and size to the material. The texture object is
   * replaced whenever the atlas grows, so this must run after every pack().
   */
  private _syncAtlasUniforms(): void {
    const atlas = this._atlas;
    if (!atlas) return;
    this.getEnhancer().update({
      base: {
        texture: { value: atlas.texture },
        atlasSize: [atlas.size, atlas.size],
      },
    });
  }

  /**
   * Load the material-level image and apply its rect to every instance that
   * hasn't been overridden per-feature via setFeatureImageByBatchId.
   */
  private async _setDefaultImage(url: string): Promise<void> {
    if (this._defaultUrl === url) return;
    this._defaultUrl = url;

    const rect = await this._ensureAtlas().pack(url);
    this._reportAtlasBytes();
    if (!rect) return;
    // A newer default image won the race while this one was loading.
    if (this._defaultUrl !== url) return;

    this._defaultRect = rect;
    this._syncAtlasUniforms();
    const rectAttr = this.geometry.getAttribute(
      "instanceUvRect",
    ) as InstancedBufferAttribute;
    for (let i = 0; i < rectAttr.count; i++) {
      if (this._imageOverrides.has(i)) continue;
      rectAttr.setXYZW(i, rect.x, rect.y, rect.w, rect.h);
    }
    rectAttr.needsUpdate = true;
    this._onAtlasRectsChanged();
  }

  /**
   * An instance's atlas rect changed. The rect drives the quad's aspect and
   * whether the instance draws at all, so the declutter bounds computed before
   * the image landed are stale — and because packs resolve long after the
   * frame that requested them, the view has usually gone idle by now. Without
   * the render request the page keeps showing the pre-image state until the
   * next camera move.
   */
  private _onAtlasRectsChanged(): void {
    this.ctx.declutter?.markDirty();
    this.ctx.renderFlag.forceUpdate = true;
  }

  onBeforePicking(): void {
    this.getEnhancer().update({ base: { pickable: true } });
  }

  onAfterPicking(): void {
    this.getEnhancer().update({ base: { pickable: false } });
  }

  getRenderable(): Object3D {
    return this;
  }

  /**
   * Get the enhancer, throwing if not initialized.
   */
  private getEnhancer(): NonNullable<typeof this._enhancedMaterial> {
    if (!this._enhancedMaterial) {
      throw new Error(
        "InstancedSpriteMesh material enhancer is not initialized. This usually indicates a failure during construction or geometry/material setup.",
      );
    }
    return this._enhancedMaterial;
  }

  /**
   * See {@link buildBatchIndexMap}. The batch_index handle stays owned by the
   * ECS geometry, whose destroy path frees it (`remove_from_buf`).
   */
  private _rebuildBatchIndexMap(
    m: NavaraPointMesh | NavaraBillboardMesh,
  ): void {
    const batchIndexData = m.geometry.batch_index?.data;
    const built = buildBatchIndexMap(
      batchIndexData !== undefined ? this.ctx.buf.u32(batchIndexData) : null,
    );
    this._instanceBatchIndex = built?.perInstance ?? null;
    this._batchIndexToInstances = built?.byBatchIndex ?? null;
  }

  /** All instances owned by the feature at `batchIndex`; empty when unknown. */
  private instancesOfBatchIndex(batchIndex: number): number[] {
    if (this._batchIndexToInstances) {
      return this._batchIndexToInstances.get(batchIndex) ?? [];
    }
    return batchIndex >= 0 && batchIndex < this._instanceCount
      ? [batchIndex]
      : [];
  }

  _getBatchTextureSupport(): BatchTextureSupport {
    return SPRITE_BATCH_SUPPORT;
  }

  /**
   * Write one per-feature style into the batch data texture (bounds and
   * value validation, slot allocation, and define stamping live in
   * {@link updateBatchAttribute}). One write covers every instance of the
   * feature — no per-instance fan-out.
   */
  private _updateBatchAttribute(
    batchIndex: number,
    attribute: BatchedAttributeName,
    value: number | number[] | boolean,
  ): boolean {
    return updateBatchAttribute(
      this.material as ShaderMaterial,
      batchIndex,
      attribute,
      value,
      this._defaultBatchAttributeValues(),
    );
  }

  /** Allocation-time backfill defaults, from the mesh-level material state. */
  private _defaultBatchAttributeValues(): DefaultBatchAttributeValues {
    const state = this.getEnhancer().states();
    return {
      color: _tmpDefaultColor.setHex(state.color),
      emissive: _tmpDefaultEmissive.setHex(state.emissiveColor),
      emissiveIntensity: state.emissiveIntensity,
      height: state.addHeight,
    };
  }

  setFeatureColorByBatchIndex(batchIndex: number, color: Color) {
    this._updateBatchAttribute(
      batchIndex,
      "color",
      color.toArray(_tmpColorArray),
    );
  }

  setFeatureShowByBatchIndex(batchIndex: number, rawVisible: boolean) {
    if (this._updateBatchAttribute(batchIndex, "show", rawVisible)) {
      this.ctx.declutter?.markDirty();
    }
  }

  setFeatureOpacityByBatchIndex(batchIndex: number, opacity: number) {
    this._updateBatchAttribute(batchIndex, "opacity", opacity);
  }

  setFeatureHeightByBatchIndex(batchIndex: number, height: number) {
    if (this._updateBatchAttribute(batchIndex, "height", height)) {
      this.ctx.declutter?.markDirty();
    }
  }

  setFeatureEmissiveByBatchIndex(batchIndex: number, emissive: Color) {
    this._updateBatchAttribute(
      batchIndex,
      "emissive",
      emissive.toArray(_tmpColorArray),
    );
  }

  setFeatureEmissiveIntensityByBatchIndex(
    batchIndex: number,
    intensity: number,
  ) {
    this._updateBatchAttribute(batchIndex, "emissiveIntensity", intensity);
  }

  /**
   * Set one instance's declutter fade target; the attribute animates toward
   * it in {@link stepDeclutterFade}. Deliberately separate from the batch
   * texture's `show` so user-driven visibility and declutter results compose
   * instead of clobbering each other.
   */
  setDeclutterHiddenByInstance(instanceIndex: number, hidden: boolean) {
    const targets = this._declutterTargets;
    if (!targets || instanceIndex < 0 || instanceIndex >= targets.length) {
      return;
    }
    targets[instanceIndex] = hidden ? 1.0 : 0.0;
    // Cheap over-approximation; stepDeclutterFade clears it when everything
    // has reached its target.
    this._declutterAnimating = true;
  }

  /**
   * Set a per-feature placement priority (higher wins), overriding the
   * layer-level `declutterPriority` for this instance. Driven by the feature
   * evaluator.
   */
  setFeatureDeclutterPriorityByBatchIndex(
    batchIndex: number,
    priority: number,
  ) {
    const instances = this.instancesOfBatchIndex(batchIndex);
    if (instances.length === 0) return;

    if (!this._declutterPriorityOverrides) {
      const count = this._anchors ? this._anchors.length / 3 : 0;
      if (count === 0) return;
      this._declutterPriorityOverrides = new Float32Array(count).fill(
        Number.NaN,
      );
    }
    let changed = false;
    for (const instanceId of instances) {
      if (instanceId >= this._declutterPriorityOverrides.length) continue;
      if (this._declutterPriorityOverrides[instanceId] === priority) continue;
      this._declutterPriorityOverrides[instanceId] = priority;
      changed = true;
    }
    if (changed) {
      this.ctx.declutter?.markDirty();
    }
  }

  setFeatureSizeByBatchIndex(batchIndex: number, size: number) {
    if (this._updateBatchAttribute(batchIndex, "size", size)) {
      this.ctx.declutter?.markDirty();
    }
  }

  /**
   * Give one feature its own image, packed into this mesh's texture atlas.
   * Loads are deduplicated by URL, so styling many features with few distinct
   * images fetches each image once. On load failure the feature keeps its
   * current (default) image. Passing a nullish `url` clears the override and
   * reverts the feature to the material's default image. No-op for
   * non-billboard (point) meshes.
   */
  async setFeatureImageByBatchIndex(
    batchIndex: number,
    url: string | null | undefined,
  ): Promise<void> {
    const instances = this.instancesOfBatchIndex(batchIndex);
    if (instances.length === 0) return;

    const rectAttr = this.geometry.getAttribute("instanceUvRect") as
      InstancedBufferAttribute | undefined;
    if (!rectAttr) return;

    if (url == null) {
      let cleared = false;
      for (const instanceId of instances) {
        this._requestedImageUrls.delete(instanceId);
        if (!this._imageOverrides.delete(instanceId)) continue;
        // Zero rect (invisible) until the default image finishes loading,
        // same as instances that never had an override.
        const rect = this._defaultRect;
        rectAttr.setXYZW(
          instanceId,
          rect?.x ?? 0,
          rect?.y ?? 0,
          rect?.w ?? 0,
          rect?.h ?? 0,
        );
        cleared = true;
      }
      if (cleared) {
        rectAttr.needsUpdate = true;
        this._onAtlasRectsChanged();
      }
      return;
    }

    for (const instanceId of instances) {
      this._requestedImageUrls.set(instanceId, url);
    }
    const rect = await this._ensureAtlas().pack(url);
    this._reportAtlasBytes();
    if (!rect) return;
    let applied = false;
    for (const instanceId of instances) {
      // A newer override or a clear superseded this load while in flight.
      if (this._requestedImageUrls.get(instanceId) !== url) continue;
      this._imageOverrides.add(instanceId);
      rectAttr.setXYZW(instanceId, rect.x, rect.y, rect.w, rect.h);
      applied = true;
    }
    if (applied) {
      this._syncAtlasUniforms();
      rectAttr.needsUpdate = true;
      this._onAtlasRectsChanged();
    }
  }

  dispose(): void {
    this.ctx.declutter?.unregister(this);
    this.geometry?.dispose();

    // The material's uTexture points at the atlas texture; the atlas owns it.
    this._atlas?.dispose();
    this._atlas = undefined;

    // Clear this mesh's atlas term from the memory ledger. When disposal was
    // caused by the owning tile's eviction the entity is already gone and the
    // report is a no-op; when only this feature was removed the tile survives
    // and the term must not linger.
    if (this._reportedAtlasBytes !== 0) {
      this._reportedAtlasBytes = 0;
      this._atlasBytesReporter?.(0);
    }

    (this.material as ShaderMaterial).dispose();

    // Clear internal collections to release references
    this._batchIndexToInstances = null;
    this._instanceBatchIndex = null;
    this._anchors = null;
    this._declutterTargets = null;
    this._declutterPriorityOverrides = null;
    this._imageOverrides.clear();
    this._requestedImageUrls.clear();
  }
}
