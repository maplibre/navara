import type {
  TextMesh as NavaraTextMesh,
  TextMaterial as NavaraTextMaterial,
  Transform,
} from "@navaramap/engine";
import { lineLabelFit, lineLabelPlace } from "@navaramap/engine-api";
import type { FontManager } from "@navaramap/font";
import { degreeToRadian } from "@navaramap/three-api";
import {
  Color,
  type PerspectiveCamera,
  MathUtils,
  Object3D,
  ShaderMaterial,
  Vector2,
} from "three";
import invariant from "tiny-invariant";

import {
  hasBatchScalarSlot,
  readBatchScalar,
  registerBatchedMaterial,
  TEXT_BATCH_SUPPORT,
  unpackOrientation,
  updateBatchAttribute,
  type BatchAttributeDefaults,
  type BatchedAttributeName,
  type BatchTextureSupport,
} from "../../batchTexture";
import {
  DECLUTTER_FADE_MS,
  type DeclutterCandidate,
  type DeclutterParticipant,
} from "../../declutter/types";
import type { EventContext } from "../../event/context";
import type { MaterialEnhancer } from "../../material/enhancer/MaterialEnhancer";
import {
  createSdfTextMaterialEnhancer,
  type SdfTextBaseMutates,
  type SdfTextBaseProps,
  type SdfTextBaseState,
} from "../../material/enhancer/sdfText";
import { buildBatchIndexMap } from "../batchIndexMap";
import { GEOMETRY_TYPES } from "../constants";
import { InstancedMesh, type InstancedMeshOptions } from "../instanced";
import type { PickableMesh } from "../pickableMesh";

import { backgroundSliceCount, GlyphBuffers } from "./glyphBuffers";
import { GlyphSlotAllocator, type GlyphRun } from "./glyphSlots";
import { LabelDataTexture, LabelRow } from "./labelData";
import {
  createAnchorVisibilityState,
  isAnchorPotentiallyVisible,
  syncAnchorVisibilityState,
} from "./labelVisibility";
import { ALIGN_FACTORS, buildLabelLayout, type LayoutOptions } from "./layout";
import {
  LINE_LABEL_RESULT_STRIDE,
  type LinePath,
  PATH_META_STRIDE,
  findRepeatedLabels,
  packLineLabelFits,
  packLineLabels,
  takeLinePath,
} from "./linePlacement";
import { PendingSettlement } from "./pendingSettlement";

/** Reusable scratch to avoid per-frame / per-write allocations. */
const _tmpSize = new Vector2();
const _tmpColor = new Color();
const _tmpColorArray: [number, number, number] = [0, 0, 0];
const _visibility = createAnchorVisibilityState();

/**
 * Line labels per row of the path texture. At 32 samples (16 texels) a label
 * that is a 1024-texel row, so the 4096-row limit the batch texture also
 * assumes holds ~262k labels — well past a dense tile, where the default
 * 64-texel row ran out at 16k.
 */
const PATH_LABELS_PER_ROW = 64;

type PositionsInfoBase = {
  batchIDs: Float32Array<ArrayBufferLike> | null;
  positionSize: number;
  batchIDSize: number;
  nPositions: number;
  /** Per-anchor east/north metre offsets sampling the line the anchor sits on,
   *  at `pathStride` floats per anchor. Only present under line placement. */
  pathSamples: Float32Array<ArrayBufferLike> | null;
  /** Floats per anchor in {@link pathSamples} — twice the sample count. */
  pathStride: number;
  /** Per-anchor `(metres between path samples, metres of real line either side
   *  of the anchor)`. */
  pathMeta: Float32Array<ArrayBufferLike> | null;
  /** Per-anchor tangent bearing in degrees clockwise from north. */
  bearings: Float32Array<ArrayBufferLike> | null;
  /** Per-anchor `(min, max]` ground metres per screen pixel it is shown over,
   *  `SCALE_BAND_STRIDE` floats each. Present exactly when `bearings` is. */
  scaleBands: Float32Array<ArrayBufferLike> | null;
};

type PositionsInfo = PositionsInfoBase &
  (
    | {
        RTE: true;
        position: {
          high: Float32Array<ArrayBufferLike>;
          low: Float32Array<ArrayBufferLike>;
        };
      }
    | {
        RTE: false;
        position: Float32Array<ArrayBufferLike>;
      }
  );

/**
 * One label in the batch.
 *
 * This replaces what used to be a whole `Mesh` + `ShaderMaterial` +
 * `InstancedBufferGeometry` per label. Fields that the shader reads are
 * mirrored into the label data texture on write; they are kept here too
 * because the declutter pass and the glyph-retain bookkeeping need them on the
 * CPU every frame.
 */
type LabelRecord = {
  /** Row block in the label data texture, and this label's declutter handle. */
  slot: number;
  /** Anchor (position) slot this label sits on, NOT the feature index: a
   * feature spans several anchors for MultiPoint geometry and for labels
   * derived from line/polygon vertices via `geometryTypes`. */
  instanceIndex: number;
  batchId: number;
  /** Feature index — the column in the shared batch data texture holding
   *  this label's style (color/opacity/size/height). */
  batchIndex: number;
  /** The text currently laid out into the glyph run. */
  text: string;
  /**
   * The most recent text asked for. Differs from {@link text} only while an
   * async font preparation is in flight or parked (see
   * {@link prepareDeferred}); the prepare callback compares against it so a
   * slow prepare can't clobber a newer text that landed meanwhile.
   */
  requestedText: string;
  /**
   * True while {@link requestedText} awaits font preparation parked on anchor
   * visibility: unprepared text is not shaped — and its font faces not
   * fetched — until a placement pass finds the anchor potentially visible
   * (inside the frustum and not behind the globe's horizon). See
   * `prepareDeferredLabels`.
   */
  prepareDeferred: boolean;
  /** Glyph-instance slots this label owns, or null when it has no text. */
  run: GlyphRun | null;
  /** Unique atlas glyphs the current text renders. */
  glyphKeys: bigint[];
  /** The set currently retained in the atlas, or null when holding none. */
  retainedKeys: bigint[] | null;
  /**
   * Visibility asked for by the material's `show` or the evaluator, held
   * separately from {@link show} because it routinely arrives *before* the
   * label has any text (the evaluator emits `show` ahead of `text`). Folding
   * the two together would drop it.
   */
  requestedShow: boolean;
  /** Effective visibility: `requestedShow && text !== ""`. Mirrors the STATE
   *  row's `show` channel. */
  show: boolean;
  fontSize: number;
  addHeight: number;
  colorHex: number;
  opacity: number;
  /** Block metrics in ems; `widthEm === 0` means "no collision box". */
  widthEm: number;
  heightEm: number;
  minYEm: number;
  maxYEm: number;
  /** See `LabelLayout.maxWordHalfEm`. */
  maxWordHalfEm: number;
  /** Current animated hide factor and the placement target it fades toward. */
  declutterHide: number;
  declutterTarget: number;
  /** Per-feature placement priority; overrides the layer value when defined. */
  priorityOverride: number | undefined;
  /** World-space anchor in ECEF meters (f64), for the declutter pass. */
  anchor: Float64Array;
};

/**
 * Every text label in a tile-layer, drawn in a single call.
 *
 * Instances are glyphs, not labels: each label owns a contiguous run of glyph
 * slots ({@link GlyphSlotAllocator}) and one row block in a float texture
 * ({@link LabelDataTexture}) that the vertex shader reads through the
 * `labelIndex` attribute. A label changing its text rewrites only its own run
 * — and not even that when the new glyph count stays inside the run's
 * power-of-two size class.
 *
 * Still extends {@link InstancedMesh} because `FeatureEvaluator` dispatches
 * per-feature styling on `instanceof InstancedMesh`; the inherited child-mesh
 * machinery (`allMeshes`, `markVisibility`) is deliberately unused.
 */
export class BatchedSdfTextMesh
  extends InstancedMesh<Object3D>
  implements PickableMesh, DeclutterParticipant
{
  /**
   * Geometry type of this mesh.
   */
  readonly geometryType = GEOMETRY_TYPES.Text;

  readonly ctx: EventContext;
  /** The font identifier from material — may be a family name or a URL. */
  private _fontIdentifier: string;
  /** Per-batch text quality. All labels in the batch share it because they
   *  sample the same atlas texture; flipping quality requires a new batch. */
  private _highQuality: boolean;
  private _fontManager: FontManager;
  private _needRender?: () => void;
  /** Unsubscribe from the font manager's atlas-eviction notifications. */
  private _unsubscribeEvict?: () => void;
  /**
   * Face URLs loaded by this mesh for font-family fonts.
   * Each URL in this set has had loadFont() called exactly once by this mesh
   * and must be balanced with unloadFont() on dispose or font change.
   */
  private _loadedFaceUrls: Set<string>;
  private _positions: PositionsInfo | null = null;
  private _material: NavaraTextMaterial;
  private _transform: Transform;

  /** Labels in slot order — `_labels[slot]` is also the declutter handle map. */
  private _labels: LabelRecord[] = [];
  /** Sparse anchor slot → label; labels are created on first per-feature touch. */
  private _labelByInstance: (LabelRecord | undefined)[] = [];
  /**
   * Anchors whose evaluator said `show:false` before any label existed. The
   * evaluator applies `show` before `text`, so without parking the intent
   * here a later text setter would create the label visible.
   */
  private _hiddenBeforeLabel = new Set<number>();
  /**
   * Feature (batch) index → this feature's anchor slots. A feature owns
   * multiple anchors for MultiPoint geometry and for labels derived from
   * line/polygon vertices via `geometryTypes`, so per-feature styling must fan
   * out to all of them. `null` means anchors and features are 1:1.
   */
  private _batchIndexToInstances: Map<number, number[]> | null = null;
  /** Per-anchor feature index; `null` means anchors and features are 1:1. */
  private _instanceBatchIndex: Float32Array | null = null;
  /** Feature count — the batch data texture's column count. */
  private _batchLength = 0;

  /** In-flight per-feature text preparations; see {@link whenLabelsSettled}. */
  private _pendingTextPrepares = new PendingSettlement();

  private _glyphs: GlyphBuffers;
  private _slots = new GlyphSlotAllocator();
  private _labelData: LabelDataTexture;
  /** Per-label resampled line, only allocated under along-line placement. Uses
   *  the same slotted-float-texture machinery as `_labelData`, with its own
   *  much wider stride: two samples per RGBA texel. */
  private _pathData: LabelDataTexture | null = null;
  /**
   * The resampled line each anchor sits on, held apart from {@link _positions}.
   *
   * A geometry update replaces the position info wholesale, and its buffers are
   * consumed out of the store on extraction — so re-extracting for a terrain
   * height change can hand back position data with no path attached. The path
   * itself never changes for a given tile, so it is kept here and only replaced
   * when an update actually brings a new one. Losing it would leave every label
   * unvalidated, and therefore culled, for the life of the batch.
   */
  private _path: LinePath | null = null;
  /** Per-label screen-space collision box from the last placement pass, four
   *  values per slot (minX, maxX, minY, maxY). A line label is turned to follow
   *  its road, so the unrotated block metrics would model a north-south street
   *  name as a wide horizontal box and let its neighbours sit on top of it. */
  private _lineBoxes: Float64Array | null = null;
  /** Per-label rejection from the same pass: the label's level is not the one
   *  on screen, it does not fit its road, or the road bends too far under it.
   *  Such labels draw nothing, so they must not claim declutter space either. */
  private _lineRejected: Uint8Array | null = null;
  /** {@link _lineRejected} as the previous pass left it, to tell which labels a
   *  pass turned on or off. */
  private _linePrevRejected: Uint8Array | null = null;
  /** Reused gather buffer for the labels a placement pass actually has to
   *  judge, so the filter below costs no allocation per pass. */
  private _linePlaceable: LabelRecord[] = [];
  /** The subset of those that passed the fit phase and so need their path sent
   *  to the full placement. */
  private _linePlaceSurvivors: LabelRecord[] = [];
  /** The view matrix both kernel phases read. Held here because the pass runs
   *  once per batch and `Matrix4.elements` is a plain array — copying it into a
   *  fresh `Float64Array` each time was hundreds of allocations per pass. */
  private _lineViewMatrix = new Float64Array(16);

  /** Layout inputs baked into glyph quads; a change forces a re-layout. */
  private _maxWidth: number;
  private _lineHeight: number;
  private _textAlign: number;

  /** Labels currently parked in `prepareDeferred`, so the per-pass promotion
   *  scan can bail without touching `_labels` when nothing is parked. */
  private _deferredCount = 0;

  /** Layer-level declutter settings, mirrored from the material. */
  private _declutter: boolean;
  private _declutterPriority: number;
  /** Skips the per-frame fade walk entirely once everything has settled. */
  private _declutterAnimating = false;

  private _enhancer: MaterialEnhancer<
    ShaderMaterial,
    { base?: SdfTextBaseProps },
    SdfTextBaseState,
    SdfTextBaseMutates,
    readonly ["shader"]
  >;

  constructor(
    ctx: EventContext,
    m: NavaraTextMesh,
    fontIdentifier: string,
    options: InstancedMeshOptions,
    loadedFaceUrls?: Set<string>,
  ) {
    super(options);
    this.ctx = ctx;
    this._fontIdentifier = fontIdentifier;
    invariant(ctx.fontManager);
    this._fontManager = ctx.fontManager;
    this._loadedFaceUrls = loadedFaceUrls ?? new Set();

    // One getter call each: wasm getters clone, so these snapshots are owned
    // by this batch and safe to use after the event object is freed.
    const material = m.material;
    this._material = material;
    this._transform = m.transform;
    this._highQuality = material.highQuality ?? false;

    this._maxWidth = material.maxWidth ?? 0;
    this._lineHeight = material.lineHeight ?? 1.0;
    this._textAlign = ALIGN_FACTORS[material.textAlign ?? "center"] ?? 0.5;
    this._declutter = material.declutter ?? true;
    this._declutterPriority = material.declutterPriority ?? 0;

    this._positions = this.extractPositions(m);
    this._path = takeLinePath(this._positions);
    this._rebuildBatchIndexMap(m);
    this._batchLength = m.batch_length;
    this._glyphs = new GlyphBuffers();
    this._labelData = new LabelDataTexture();
    // The stride comes from the data the engine actually sent, so the GLSL
    // define and the texture layout are both derived from the Rust constant
    // rather than restating it.
    const pathTexels = this._path ? this._path.stride / 4 : 0;
    this._pathData =
      pathTexels > 0
        ? new LabelDataTexture(16, pathTexels, pathTexels * PATH_LABELS_PER_ROW)
        : null;

    this.geometry = this._glyphs.geometry;
    const mat = new ShaderMaterial({
      transparent: true,
      // depthWrite must stay enabled: the fragment shader's per-pixel outline
      // depth offset (sdfText.frag.glsl) relies on fills writing a nearer depth
      // so a neighbouring glyph's fill occludes this glyph's outline at overlaps
      // — without depth writes that outline-seam fix becomes a no-op.
      depthWrite: true,
    });
    this._enhancer = createSdfTextMaterialEnhancer(mat);
    this._setupMaterial(mat, material);
    this.material = mat;
    this.renderOrder = options.renderOrder ?? this.renderOrder;
    // Geometry positions are unit quads; the real transform happens in the
    // shader, so a three.js bounding sphere would be meaningless here.
    this.frustumCulled = false;

    this._syncLabelDataUniform();
    this._syncPathDataUniform();
    this._initLabels();

    // When the shared atlas evicts glyphs, a still-in-flight glyph this batch
    // already baked into a visible label may have had its rect reused. Rebuild
    // any such stale label so its UVs and retains refresh.
    this._unsubscribeEvict = this._fontManager.onAtlasEvicted(
      this._fontIdentifier,
      this._highQuality,
      () => this._revalidateStaleLabels(),
    );
    ctx.declutter?.register(this);
  }

  get fontIdentifier(): string {
    return this._fontIdentifier;
  }

  get highQuality(): boolean {
    return this._highQuality;
  }

  // --- Material ---

  /** Mount the enhancer and install the batch's single per-frame hook. */
  private _setupMaterial(
    mat: ShaderMaterial,
    material: NavaraTextMaterial,
  ): void {
    this._enhancer.mount({
      base: {
        useRTE: this._positions?.RTE ?? false,
        useMsdf: this._highQuality,
        // Driven by the geometry rather than by `material.placement`: the
        // engine only ships a path when it actually resampled a line, so the
        // shader branch and the data it reads can never disagree.
        linePlacement: this._pathData !== null,
        pathSamples: (this._path?.stride ?? 0) / 2,
        lineOffset: material.lineOffset ?? 0,
        center: material.center
          ? [material.center.x, material.center.y]
          : undefined,
        flatFacing: material.textFacing === "flat",
        rotateWithCamera: material.rotateWithCamera ?? true,
        rotation: material.rotation ?? 0,
        sizeInMeters: material.sizeInMeters ?? true,
        offsetDepth: material.offsetDepth ?? true,
        outlineWidth: material.outlineWidth ?? 0,
        outlineColor: material.outlineColor ?? 0x000000,
        outlineOpacity: clamp01(material.outlineOpacity ?? 1.0),
        showBackground: material.backgroundColor !== undefined,
        backgroundColor: material.backgroundColor,
        backgroundOutlineColor: material.borderColor ?? 0x000000,
        backgroundOutlineWidth: material.borderWidth ?? 0.1,
        depthTest: material.depthTest ?? true,
        backfaceCulling: material.backfaceCulling ?? false,
        transparent: material.transparent ?? true,
        effectIdsMask: this._computeEffectIdsMask(material),
        emissiveColor: material.emissiveColor ?? 0,
        emissiveIntensity: material.emissiveIntensity ?? 0,
        rtcCenter: [this._transform.tx, this._transform.ty, this._transform.tz],
      },
    });

    // Populate uniforms early (before onBeforeCompile fires).
    const mutates = this._enhancer.mutates();
    mutates.updateUniforms(mat.uniforms, this._enhancer.states());

    mat.onBeforeCompile = this._enhancer.transformShader;
    mat.customProgramCacheKey = this._enhancer.programCacheKey;

    // Register for per-feature styling: every label's style (color/opacity/
    // size/height) is written through to the shared batch data texture, keyed
    // by the feature index in the label's STATE row.
    const batchUniform = registerBatchedMaterial(
      mat,
      { ...this._getBatchTextureSupport(), batchLength: this._batchLength },
      this.ctx.viewContext.getRenderer(),
    );
    this._enhancer.mutates().setBatchDataTexture(batchUniform);

    // One closure for the whole batch, where there used to be one per label.
    const state = this._enhancer.states();
    mat.onBeforeRender = (renderer, _scene, camera) => {
      const pCam = camera as PerspectiveCamera;
      mutates.updatePerFrame(
        degreeToRadian(pCam.fov),
        renderer.getDrawingBufferSize(_tmpSize).y / renderer.getPixelRatio(),
        pCam.far,
        camera.position.x,
        camera.position.y,
        camera.position.z,
        camera.matrixWorldInverse,
        state,
      );
      // Keep atlas-size uniforms in sync with the (possibly resized) shared
      // DataTexture so glyph pixel rects always normalize to the right UV.
      mutates.updateAtlasSizes();
    };
  }

  private _computeEffectIdsMask(material: NavaraTextMaterial): number {
    return (
      this.ctx.viewContext.selectiveEffectRegistry?.computeMask(
        material.effectIds ?? [],
      ) ?? 0
    );
  }

  /** Re-point the shader at the label texture (it is swapped on grow). */
  private _syncLabelDataUniform(): void {
    const { texture, size } = this._labelData;
    this._enhancer.mutates().setLabelDataTexture(texture, size.x, size.y);
  }

  /**
   * Re-decide which way each line label reads and whether it still fits.
   *
   * Both answers move with the camera — a pixel-sized label grows in world
   * metres as the camera pulls back — so they are resolved here, at the
   * placement pass's cadence, rather than baked when the tile was parsed. The
   * numeric work is the Rust `lineLabelPlace`, which mirrors the vertex
   * shader's own sizing; see `crates/navara_wasm_api/src/line_label.rs`.
   *
   * Only labels that could become declutter candidates are judged, under the
   * same two conditions {@link collectDeclutterCandidates} applies — an
   * invisible batch, and a label with no shaped text, are both dropped there a
   * moment later, so placing them is pure waste. Measured on a dense London
   * view that waste was most of the pass: ~28% of batches were not visible and
   * only ~7k of ~24k labels per pass were shown. Whatever marks those
   * conditions dirty already has to mark the declutter pass dirty for
   * collection to be correct, so this filter inherits that guarantee — keep
   * the two predicates identical.
   *
   * What survives that filter then goes through the kernel in two phases. The
   * fit test needs no path samples, and on a dense view rejects roughly four
   * labels in five, so it runs first over a compact array; only survivors have
   * their 32 path points gathered and sent. See the "Two phases" section of
   * `line_label.rs`.
   *
   * The fit test also rejects every anchor whose level is not the one on
   * screen. Each position along a line carries one anchor per level, each with
   * a path sized for it, so zooming across a level boundary retires one label
   * and admits its stack-mate at the same spot — see {@link _handOffLineLabel}.
   */
  placeLineLabels(
    camera: PerspectiveCamera,
    _widthPx: number,
    heightPx: number,
  ): void {
    const line = this._path;
    if (!this.visible) return;
    if (!this._pathData || !line || this._labels.length === 0) return;

    const placeable = this._linePlaceable;
    placeable.length = 0;
    for (const record of this._labels) {
      if (!record.show || record.widthEm <= 0 || record.fontSize <= 0) continue;
      // A plain point sharing the batch has no path to be placed along.
      if (!this._isAlongLine(record)) continue;
      placeable.push(record);
    }
    if (placeable.length === 0) return;

    // Sized by the label count, not the placed count: both arrays are addressed
    // by slot, and the labels skipped above still occupy slots between the ones
    // that were placed.
    const slotCount = this._labels.length;
    if ((this._lineBoxes?.length ?? 0) < slotCount * 4) {
      this._lineBoxes = new Float64Array(slotCount * 4);
      // Kept across the grow: the next pass compares against it.
      const grown = new Uint8Array(slotCount);
      if (this._lineRejected) grown.set(this._lineRejected);
      this._lineRejected = grown;
      this._linePrevRejected = new Uint8Array(slotCount);
    }
    const boxes = this._lineBoxes;
    const rejected = this._lineRejected;
    const prevRejected = this._linePrevRejected;
    invariant(boxes && rejected && prevRejected, "line placement buffers");
    prevRejected.set(rejected);

    const sizeInMeters = this._material.sizeInMeters ?? true;
    const spacingPx = this._material.spacing ?? 250;
    const fovRad = MathUtils.degToRad(camera.fov);
    camera.updateMatrixWorld();
    const view = this._lineViewMatrix;
    view.set(camera.matrixWorldInverse.elements);

    const state = this._enhancer.states();
    const center = [
      Math.min(Math.max(state.center[0], -0.5), 0.5),
      Math.min(Math.max(state.center[1], -0.5), 0.5),
    ] as const;

    // Phase one: which labels are short enough to sit on their line at all.
    const fits = lineLabelFit(
      packLineLabelFits(placeable, line, { sizeInMeters, center }),
      view,
      heightPx,
      fovRad,
      spacingPx,
    );

    const survivors = this._linePlaceSurvivors;
    survivors.length = 0;
    for (let i = 0; i < placeable.length; i++) {
      const slot = placeable[i].slot;
      if (fits[i] !== 0) {
        survivors.push(placeable[i]);
        continue;
      }
      // Rejected here, so it never reaches phase two. Its box is left alone:
      // `collectDeclutterCandidates` skips rejected labels, and the shader
      // culls them, so nothing reads it.
      this._labelData.setComponent(slot, LabelRow.PATH, 3, 1);
      rejected[slot] = 1;
    }
    if (survivors.length > 0)
      this._placeLineSurvivors(survivors, view, {
        heightPx,
        fovRad,
        spacingPx,
        sizeInMeters,
        center,
        lineOffset: state.lineOffset,
        flatFacing: state.flatFacing,
      });

    for (const record of placeable) {
      if (!rejected[record.slot]) continue;
      if (!prevRejected[record.slot]) this._handOffLineLabel(record);
      this._hideRejectedLineLabel(record);
    }
  }

  /** Phase two of {@link placeLineLabels}: reading direction, curvature and
   *  the collision box — all of which need the path — then the repeat test. */
  private _placeLineSurvivors(
    survivors: LabelRecord[],
    view: Float64Array,
    pass: {
      heightPx: number;
      fovRad: number;
      spacingPx: number;
      sizeInMeters: boolean;
      center: readonly [number, number];
      lineOffset: number;
      flatFacing: boolean;
    },
  ): void {
    const line = this._path;
    const boxes = this._lineBoxes;
    const rejected = this._lineRejected;
    invariant(line && boxes && rejected, "line placement buffers");
    const { heightPx, fovRad, spacingPx, sizeInMeters, center } = pass;

    const packed = packLineLabels(survivors, line, {
      sizeInMeters,
      maxAngleDeg: this._material.maxAngle ?? 45,
      keepUpright: this._material.keepUpright ?? true,
      center,
      lineOffset: pass.lineOffset,
      readFlip: (slot) =>
        this._labelData.getComponent(slot, LabelRow.PATH, 2) !== 0,
      readFlatFacing: (slot) => this._resolveFlatFacing(slot, pass.flatFacing),
    });

    const result = lineLabelPlace(
      packed.labels,
      packed.paths,
      line.stride / 2,
      view,
      heightPx,
      fovRad,
      spacingPx,
    );

    const accepted: LabelRecord[] = [];
    const metersPerPx: number[] = [];
    for (let i = 0; i < survivors.length; i++) {
      const slot = survivors[i].slot;
      const r = i * LINE_LABEL_RESULT_STRIDE;
      this._labelData.setComponent(slot, LabelRow.PATH, 2, result[r]);
      this._labelData.setComponent(slot, LabelRow.PATH, 3, result[r + 1]);
      rejected[slot] = result[r + 1] > 0.5 ? 1 : 0;
      boxes[slot * 4] = result[r + 2];
      boxes[slot * 4 + 1] = result[r + 3];
      boxes[slot * 4 + 2] = result[r + 4];
      boxes[slot * 4 + 3] = result[r + 5];
      if (!rejected[slot]) {
        accepted.push(survivors[i]);
        metersPerPx.push(result[r + 6]);
      }
    }

    // Last, as in MapLibre: a label dropped for its angle must not have hidden
    // a same-name neighbour first.
    for (const i of findRepeatedLabels(accepted, metersPerPx, spacingPx)) {
      const slot = accepted[i].slot;
      this._labelData.setComponent(slot, LabelRow.PATH, 3, 1);
      rejected[slot] = 1;
    }
  }

  /**
   * Whether this label sits on a line, as opposed to a plain point sharing the
   * batch (`geometryTypes: ["point", "line"]`). The engine keeps the path
   * buffers one entry per point and marks plain points with a zero sample
   * step, which the shader tests the same way.
   */
  private _isAlongLine(record: LabelRecord): boolean {
    const meta = this._path?.meta;
    return (meta?.[record.instanceIndex * PATH_META_STRIDE] ?? 0) > 0;
  }

  /**
   * Pass a label's declutter state to the stack-mate that takes over its
   * position, when a placement pass has just rejected it.
   *
   * Crossing a level boundary retires the anchor sized for the old level and
   * admits the one sized for the new, at the same spot with the same text.
   * Left alone the newcomer would enter declutter as a fresh candidate and fade
   * in while the label it replaces snaps out — a blink along every line on
   * screen at once. The stack's anchors are adjacent instances sharing one
   * anchor point.
   */
  private _handOffLineLabel(from: LabelRecord): void {
    if (!this._declutter) return;
    const rejected = this._lineRejected;
    const prevRejected = this._linePrevRejected;
    invariant(rejected && prevRejected, "line placement buffers");
    const [x, y, z] = from.anchor;
    for (const direction of [-1, 1]) {
      for (let i = from.instanceIndex + direction; ; i += direction) {
        const to = this._labelByInstance[i];
        if (
          !to ||
          to.anchor[0] !== x ||
          to.anchor[1] !== y ||
          to.anchor[2] !== z
        )
          break;
        if (rejected[to.slot] || !prevRejected[to.slot]) continue;
        to.declutterHide = from.declutterHide;
        to.declutterTarget = from.declutterTarget;
        this._writeDeclutterHide(to);
        if (to.declutterHide !== to.declutterTarget) {
          this._declutterAnimating = true;
        }
        return;
      }
    }
  }

  /**
   * Drop a rejected line label to hidden in the declutter pass's eyes.
   *
   * The shader culls it and `collectDeclutterCandidates` skips it, so the
   * declutter pass never gets to tell it that it lost. Left alone its target
   * would still say "shown", and when it fits again it would come back as an
   * incumbent — winning equal-priority ties and the sticky collision shrink
   * over labels that really were on screen. Snapped rather than faded: it
   * draws nothing either way, so it comes back as a fresh candidate and fades
   * in like one.
   */
  private _hideRejectedLineLabel(record: LabelRecord): void {
    if (!this._declutter) return;
    record.declutterTarget = 1;
    if (record.declutterHide === 1) return;
    record.declutterHide = 1;
    this._writeDeclutterHide(record);
  }

  /**
   * Whether a label lies flat, as the shader resolves it: the feature's own
   * facing once any feature has one (the batch texture then governs every
   * feature), the material's until then.
   */
  private _resolveFlatFacing(slot: number, materialFlat: boolean): boolean {
    const record = this._labels[slot];
    const packed = record
      ? readBatchScalar(
          this.material as ShaderMaterial,
          record.batchIndex,
          "orientation",
        )
      : undefined;
    return packed === undefined
      ? materialFlat
      : unpackOrientation(packed).flatFacing;
  }

  /** Same, for the path texture. */
  private _syncPathDataUniform(): void {
    if (!this._pathData) return;
    const { texture, size } = this._pathData;
    this._enhancer.mutates().setPathDataTexture(texture, size.x, size.y);
  }

  /**
   * Copy this anchor's resampled line into the path texture and record where it
   * landed, so the vertex shader can find it from the label's PATH row.
   *
   * Texels per label are fixed, so the label's own slot index addresses its
   * path run too — no second allocator.
   */
  private _writePath(record: LabelRecord): void {
    const line = this._path;
    const path = this._pathData;
    if (!line || !path) return;

    const texelsPerLabel = line.stride / 4;
    if (path.ensureCapacity(record.slot + 1)) this._syncPathDataUniform();

    const src = record.instanceIndex * line.stride;
    for (let texel = 0; texel < texelsPerLabel; texel++) {
      const i = src + texel * 4;
      path.setRow(
        record.slot,
        texel,
        line.samples[i],
        line.samples[i + 1],
        line.samples[i + 2],
        line.samples[i + 3],
      );
    }

    const alongLine = this._isAlongLine(record);
    this._labelData.setRow(
      record.slot,
      LabelRow.PATH,
      record.slot * texelsPerLabel,
      // Zero for a plain point, which is what tells the shader to lay it out
      // as an ordinary label.
      line.meta?.[record.instanceIndex * PATH_META_STRIDE] ?? 0,
      0, // flip — decided per pass by `placeLineLabels`
      // Rejected until that pass has judged it. A label drawn before its first
      // placement runs has no flip yet, so it would appear for a frame or two
      // reading backwards — and while tiles stream in there is always a fresh
      // batch in that state. A plain point is never judged, so never waits.
      alongLine ? 1 : 0,
    );
  }

  // --- Label lifecycle ---

  /**
   * A material-level text renders without the evaluator ever setting text, so
   * that case needs a label per anchor up front. With per-feature texts (MVT)
   * most features never receive one, so labels are otherwise created lazily on
   * the first per-feature setter — a label slot is just an index plus a few
   * float writes, unlike the mesh-per-label this replaced.
   */
  private _initLabels(): void {
    const info = this._positions;
    if (!info || !this._material.text) return;
    for (let i = 0; i < info.nPositions; i++) this._ensureLabel(i);
  }

  private _ensureLabel(instanceIndex: number): LabelRecord | undefined {
    const existing = this._labelByInstance[instanceIndex];
    if (existing) return existing;

    const info = this._positions;
    if (!info || instanceIndex < 0 || instanceIndex >= info.nPositions) {
      return undefined;
    }

    const material = this._material;
    const slot = this._labels.length;
    if (this._labelData.ensureCapacity(slot + 1)) {
      this._syncLabelDataUniform();
    }

    const record: LabelRecord = {
      slot,
      instanceIndex,
      batchId: info.batchIDs
        ? info.batchIDs[instanceIndex * info.batchIDSize]
        : 0,
      batchIndex: this._instanceBatchIndex
        ? this._instanceBatchIndex[instanceIndex]
        : instanceIndex,
      text: "",
      requestedText: "",
      prepareDeferred: false,
      run: null,
      glyphKeys: [],
      retainedKeys: null,
      requestedShow: this._hiddenBeforeLabel.delete(instanceIndex)
        ? false
        : (material.show ?? true),
      // No text yet, so nothing is shown regardless of `requestedShow`.
      show: false,
      fontSize: material.size ?? 16.0,
      addHeight: material.height ?? 0.0,
      colorHex: material.color ?? 0xffffff,
      opacity: clamp01(material.opacity ?? 1.0),
      widthEm: 0,
      heightEm: 0,
      minYEm: 0,
      maxYEm: 1,
      maxWordHalfEm: 0,
      // Decluttered labels start hidden and fade in once the placement pass
      // grants them space — otherwise dense tiles flash their full clutter for
      // a frame before the first pass runs.
      declutterHide: this._declutter ? 1 : 0,
      declutterTarget: this._declutter ? 1 : 0,
      priorityOverride: undefined,
      anchor: new Float64Array(3),
    };

    this._labels.push(record);
    this._labelByInstance[instanceIndex] = record;

    this._writeAnchor(record);
    this._writePath(record);
    this._writeStyle(record);
    this._writeFontSize(record);
    this._writeAddHeight(record);
    this._writeBox(record);
    this._writeState(record);
    return record;
  }

  // --- Label data texture writes ---

  private _writeAnchor(record: LabelRecord): void {
    const info = this._positions;
    if (!info) return;
    const idx = record.instanceIndex * info.positionSize;
    const anchor = record.anchor;

    if (info.RTE) {
      const { high, low } = info.position;
      const hx = high[idx];
      const hy = high[idx + 1];
      const hz = high[idx + 2] ?? 0;
      const lx = low[idx];
      const ly = low[idx + 1];
      const lz = low[idx + 2] ?? 0;
      this._labelData.setRow(
        record.slot,
        LabelRow.POSITION_HIGH,
        hx,
        hy,
        hz,
        0,
      );
      this._labelData.setRow(record.slot, LabelRow.POSITION_LOW, lx, ly, lz, 0);
      anchor[0] = hx + lx;
      anchor[1] = hy + ly;
      anchor[2] = hz + lz;
    } else {
      const p = info.position;
      const px = p[idx];
      const py = p[idx + 1];
      const pz = p[idx + 2] ?? 0;
      const { tx, ty, tz } = this._transform;
      this._labelData.setRow(
        record.slot,
        LabelRow.POSITION_HIGH,
        px,
        py,
        pz,
        0,
      );
      this._labelData.setRow(record.slot, LabelRow.POSITION_LOW, 0, 0, 0, 0);
      anchor[0] = px + tx;
      anchor[1] = py + ty;
      anchor[2] = pz + tz;
    }
  }

  // --- Batch data texture writes (per-feature style) ---

  _getBatchTextureSupport(): BatchTextureSupport {
    return TEXT_BATCH_SUPPORT;
  }

  /** Write one per-feature style into the shared batch data texture (bounds
   *  and value validation live in {@link updateBatchAttribute}). */
  private _updateBatchAttribute(
    batchIndex: number,
    attribute: BatchedAttributeName,
    value: number | number[] | boolean,
    defaults?: Partial<BatchAttributeDefaults>,
  ): boolean {
    return updateBatchAttribute(
      this.material as ShaderMaterial,
      batchIndex,
      attribute,
      value,
      defaults,
    );
  }

  /** The material's orientation/rotation, backfilled into a new batch slot. */
  private _orientationDefaults(): BatchAttributeDefaults {
    return {
      rotation: (this._material.rotation ?? 0) * MathUtils.DEG2RAD,
      flatFacing: this._material.textFacing === "flat",
      rotateWithCamera: this._material.rotateWithCamera ?? true,
    };
  }

  private _writeStyle(record: LabelRecord): void {
    _tmpColor.setHex(record.colorHex);
    this._updateBatchAttribute(
      record.batchIndex,
      "color",
      _tmpColor.toArray(_tmpColorArray),
    );
    this._updateBatchAttribute(record.batchIndex, "opacity", record.opacity);
  }

  private _writeBox(record: LabelRecord): void {
    this._labelData.setRow(
      record.slot,
      LabelRow.BOX,
      record.widthEm,
      record.heightEm,
      record.minYEm,
      record.maxYEm,
    );
  }

  private _writeState(record: LabelRecord): void {
    this._labelData.setRow(
      record.slot,
      LabelRow.STATE,
      record.declutterHide,
      record.batchId,
      record.show ? 1 : 0,
      record.batchIndex,
    );
  }

  private _writeFontSize(record: LabelRecord): void {
    this._updateBatchAttribute(record.batchIndex, "size", record.fontSize);
  }

  private _writeAddHeight(record: LabelRecord): void {
    this._updateBatchAttribute(record.batchIndex, "height", record.addHeight);
  }

  private _writeShow(record: LabelRecord): void {
    this._labelData.setComponent(
      record.slot,
      LabelRow.STATE,
      2,
      record.show ? 1 : 0,
    );
  }

  private _writeDeclutterHide(record: LabelRecord): void {
    this._labelData.setComponent(
      record.slot,
      LabelRow.STATE,
      0,
      record.declutterHide,
    );
  }

  // --- Glyph runs ---

  private _layoutOptions(text: string): LayoutOptions {
    return {
      text,
      maxWidth: this._maxWidth,
      lineHeight: this._lineHeight,
      textAlign: this._textAlign,
    };
  }

  /**
   * Shape `text`, lay it out, and write the label's glyph run. Assumes the
   * text is already prepared in the font worker.
   */
  private _applyText(record: LabelRecord, text: string): void {
    // `requestedText` is deliberately not touched here: it belongs to the
    // intent-setting paths (`setTextByBatchIndex`, the material-text update).
    // A re-layout of the *current* text (font/layout change) must not clobber
    // a newer intent that is still in flight or parked on visibility.
    record.text = text;

    if (!text) {
      this._releaseRun(record);
      record.widthEm = 0;
      record.heightEm = 0;
      this._writeBox(record);
      this._setGlyphKeys(record, []);
      this._recomputeShow(record);
      return;
    }

    const shapeResult = this._fontManager.shapeText(
      this._fontIdentifier,
      text,
      this._highQuality,
    );
    if (!shapeResult) {
      this._releaseRun(record);
      record.widthEm = 0;
      this._writeBox(record);
      this._setGlyphKeys(record, []);
      this._recomputeShow(record);
      return;
    }

    const layout = buildLabelLayout(shapeResult, this._layoutOptions(text));

    record.widthEm = layout.widthEm;
    record.heightEm = layout.heightEm;
    record.minYEm = layout.minYEm;
    record.maxYEm = layout.maxYEm;
    record.maxWordHalfEm = layout.maxWordHalfEm;
    this._writeBox(record);

    if (layout.quads.length === 0) {
      this._releaseRun(record);
      this._setGlyphKeys(record, layout.glyphKeys);
      this._recomputeShow(record);
      return;
    }

    // Extra slots for the background strips, which always lead the run so they
    // draw before the label's glyphs.
    const needed =
      layout.quads.length + backgroundSliceCount(layout.quads.length);
    const previous = record.run;
    const run = this._slots.realloc(previous, needed);
    record.run = run;

    this._glyphs.ensureCapacity(this._slots.highWater);
    this._glyphs.setInstanceCount(this._slots.highWater);

    // A relocated run leaves its old slots live in the buffer; blank them so
    // they don't keep drawing the previous text.
    if (previous && previous.start !== run.start) {
      this._glyphs.clearRun(previous.start, previous.capacity);
    }

    this._glyphs.writeRun(
      run.start,
      run.capacity,
      record.slot,
      layout.quads,
      true,
    );

    this._setGlyphKeys(record, layout.glyphKeys);
    this._recomputeShow(record);
  }

  /** Return a label's glyph slots and blank them. */
  private _releaseRun(record: LabelRecord): void {
    if (!record.run) return;
    this._glyphs.clearRun(record.run.start, record.run.capacity);
    this._slots.free(record.run);
    record.run = null;
  }

  // --- Atlas glyph references ---

  /** Replace the retained glyph set, releasing the old references and (if
   *  shown) retaining the new ones. */
  private _setGlyphKeys(record: LabelRecord, keys: bigint[]): void {
    if (record.retainedKeys) {
      this._fontManager.releaseGlyphs(
        this._fontIdentifier,
        this._highQuality,
        record.retainedKeys,
      );
      record.retainedKeys = null;
    }
    record.glyphKeys = keys;
    this._syncGlyphRefs(record);
  }

  /**
   * Reconcile atlas references with visibility: retain glyphs while the label
   * is shown, release them when hidden. If shown after the glyphs were evicted
   * (cache no longer prepared), re-prepare to re-rasterize them and rebuild
   * with fresh metrics.
   */
  private _syncGlyphRefs(record: LabelRecord): void {
    const visible = record.show && record.glyphKeys.length > 0;

    if (visible && !record.retainedKeys) {
      if (
        !this._fontManager.isTextPrepared(
          this._fontIdentifier,
          record.text,
          this._highQuality,
        )
      ) {
        // Glyphs were evicted while hidden; re-rasterize then rebuild (which
        // re-enters here with the fresh set and retains it).
        const text = record.text;
        this._fontManager
          .prepareText(
            this._fontIdentifier,
            text,
            this._highQuality,
            this._loadedFaceUrls,
          )
          .then(() => {
            if (record.text !== text) return;
            this._applyText(record, text);
            this._markDeclutterDirty();
            this._needRender?.();
          })
          .catch((err: unknown) => {
            console.error("SDF text: re-prepare on show failed:", err);
          });
        return;
      }
      this._fontManager.retainGlyphs(
        this._fontIdentifier,
        this._highQuality,
        record.glyphKeys,
      );
      record.retainedKeys = record.glyphKeys;
    } else if (!visible && record.retainedKeys) {
      this._fontManager.releaseGlyphs(
        this._fontIdentifier,
        this._highQuality,
        record.retainedKeys,
      );
      record.retainedKeys = null;
    }
  }

  /**
   * Fold `requestedShow` and "has text" into the effective visibility, pushing
   * it to the shader and reconciling atlas retains when it flips.
   */
  private _recomputeShow(record: LabelRecord): void {
    const next = record.requestedShow && !!record.text;
    if (record.show === next) return;
    record.show = next;
    this._writeShow(record);
    this._syncGlyphRefs(record);
  }

  /**
   * After an atlas eviction, re-lay-out any shown label whose text is now
   * stale (its pinned glyphs may have been evicted before the retain landed
   * and its rect reused). Fresh labels short-circuit on the cheap
   * `isTextPrepared` check, so this is inexpensive to run per eviction.
   */
  private _revalidateStaleLabels(): void {
    const q = this._highQuality;
    for (const record of this._labels) {
      const text = record.text;
      if (!record.show || !text) continue;
      if (this._fontManager.isTextPrepared(this._fontIdentifier, text, q)) {
        continue;
      }
      this._fontManager
        .prepareText(this._fontIdentifier, text, q, this._loadedFaceUrls)
        .then(() => {
          // Text may have changed (or the label hidden) while re-preparing.
          if (record.text !== text || !record.show) return;
          this._refreshAtlasTextures();
          // Force a rebuild even though the text string is unchanged: the
          // baked atlas rects and glyph retains must refresh.
          this._applyText(record, text);
          this._markDeclutterDirty();
          this._needRender?.();
        })
        .catch((err: unknown) => {
          console.error("Failed to revalidate text after eviction:", err);
        });
    }
  }

  private _refreshAtlasTextures(): void {
    const mutates = this._enhancer.mutates();
    const tex = this._fontManager.getAtlasTexture(
      this._fontIdentifier,
      this._highQuality,
    );
    if (tex) mutates.setAtlasTexture({ value: tex });
    mutates.setColorAtlasTexture({
      value: this._fontManager.getColorAtlasTexture(
        this._fontIdentifier,
        this._highQuality,
      ),
    });
  }

  // --- DeclutterParticipant ---

  /**
   * Build each shown label's collision box. The local box mirrors the vertex
   * shader's layout: glyphs span [0, textWidth] x [bgMinY, bgMaxY] in em
   * units, shifted by the `center` anchor and scaled by the font size.
   */
  collectDeclutterCandidates(out: DeclutterCandidate[]): void {
    if (!this.visible || !this._declutter) return;
    const state = this._enhancer.states();
    const cx = Math.min(Math.max(state.center[0], -0.5), 0.5);
    const cy = Math.min(Math.max(state.center[1], -0.5), 0.5);

    const boxes = this._lineBoxes;
    for (const record of this._labels) {
      if (!record.show || record.widthEm <= 0) continue;
      const size = record.fontSize;
      if (size <= 0) continue;
      // A rejected line label draws nothing, so it must not evict a label that
      // does.
      if (this._lineRejected?.[record.slot]) continue;

      const w = record.widthEm;
      const h = record.heightEm;
      // Line labels are turned to follow their road, so the placement pass
      // hands back the box they actually cover; everything else is a
      // screen-aligned block around its anchor.
      //
      // A label created since the last pass has no box yet. Falling back to the
      // unrotated block matters: reading past the array would put `undefined`
      // — and then NaN — into the packed candidate, and a NaN box never
      // registers a collision, so the label would silently overlap everything.
      // A plain point in a line batch is screen-aligned like any other label.
      const b = record.slot * 4;
      const hasBox =
        boxes !== null && b + 3 < boxes.length && this._isAlongLine(record);
      out.push({
        anchorX: record.anchor[0],
        anchorY: record.anchor[1],
        anchorZ: record.anchor[2],
        addHeight: record.addHeight,
        minX: hasBox ? boxes[b] : (0 - cx * w) * size,
        maxX: hasBox ? boxes[b + 1] : (w - cx * w) * size,
        minY: hasBox ? boxes[b + 2] : (record.minYEm - cy * h) * size,
        maxY: hasBox ? boxes[b + 3] : (record.maxYEm - cy * h) * size,
        sizeInMeters: state.sizeInMeters,
        priority: record.priorityOverride ?? this._declutterPriority,
        isShown: record.declutterTarget === 0,
        owner: this,
        handle: record.slot,
        contentKey: record.text,
      });
    }
  }

  applyDeclutter(handle: number, hidden: boolean): void {
    const record = this._labels[handle];
    if (!record) return;
    const target = hidden ? 1 : 0;
    if (record.declutterTarget === target) return;
    record.declutterTarget = target;
    if (record.declutterHide !== target) this._declutterAnimating = true;
  }

  stepDeclutterFade(deltaMs: number): boolean {
    if (!this._declutterAnimating) return false;

    const step = deltaMs / DECLUTTER_FADE_MS;
    let stillAnimating = false;
    for (const record of this._labels) {
      const target = record.declutterTarget;
      let value = record.declutterHide;
      if (value === target) continue;
      value =
        value < target
          ? Math.min(value + step, target)
          : Math.max(value - step, target);
      record.declutterHide = value;
      this._writeDeclutterHide(record);
      if (value !== target) stillAnimating = true;
    }
    this._declutterAnimating = stillAnimating;
    return stillAnimating;
  }

  /** Candidates changed (text, style, position, visibility): ask the shared
   *  declutter pass to re-place on its next update. */
  private _markDeclutterDirty(): void {
    this.ctx.declutter?.markDirty();
  }

  override setActive(active: boolean) {
    const activating = active && !this.active;
    super.setActive(active);
    // Tile-swap handoff: this batch replaces another (its parent tile is
    // hidden in the same swap), so any label whose content the previous
    // declutter pass already showed nearby starts granted instead of fading
    // in from hidden — otherwise every swap blinks the whole tile's labels
    // out for a throttled pass plus a fade-in. Genuinely new labels keep the
    // fade; the next pass re-places everything and corrects any misseed.
    if (activating && this._declutter) {
      const declutter = this.ctx.declutter;
      if (declutter) {
        for (const record of this._labels) {
          if (!record.show || record.declutterHide === 0) continue;
          const a = record.anchor;
          if (declutter.wasRecentlyShown(record.text, a[0], a[1], a[2])) {
            record.declutterHide = 0;
            record.declutterTarget = 0;
            this._writeDeclutterHide(record);
          }
        }
      }
    }
    this._markDeclutterDirty();
  }

  /**
   * Resolves once every per-feature text preparation currently in flight has
   * landed (glyph runs written), bounded by `timeoutMs`.
   *
   * The tile-LOD swap on the Rust side hides a parent tile the moment its
   * children report rendered, so the caller must not report this batch
   * rendered while labels are still shaping — the swap would show a batch
   * that draws nothing (a tile-shaped blank).
   *
   * Only preparations already started are awaited. With declutter enabled,
   * `setTextByBatchIndex` parks unprepared text until a placement pass
   * confirms the anchor is on screen, so those labels are not yet in flight
   * and this resolves immediately — cached text (the common case for a child
   * tile repeating its parent's strings) applies synchronously and needs no
   * wait either. The gate therefore only bites on the non-decluttered path;
   * decluttered swaps rely on the placement handoff in {@link setActive}.
   */
  whenLabelsSettled(timeoutMs: number): Promise<void> {
    return this._pendingTextPrepares.whenSettled(timeoutMs);
  }

  // --- Picking ---

  override onBeforePicking() {
    this._enhancer.update({ base: { pickable: true } });
  }

  override onAfterPicking() {
    this._enhancer.update({ base: { pickable: false } });
  }

  override getRenderable(): Object3D {
    return this;
  }

  // --- Geometry / material updates from the engine ---

  private extractPositions(m: NavaraTextMesh): PositionsInfo | null {
    const { buf } = this.ctx;
    const g = m.geometry;

    const batchIdsData = g.batch_ids;
    const batchIDs = buf.removeF32(batchIdsData.data);
    const batchIDSize = batchIdsData.size;

    // Present only for along-line placement, where the engine resampled each
    // anchor's line so the shader can bend glyphs onto it.
    const pathSamplesData = g.path_samples;
    const pathSamples = pathSamplesData
      ? buf.removeF32(pathSamplesData.data)
      : null;
    const pathStride = pathSamplesData?.size ?? 0;
    const pathMeta = g.path_meta ? buf.removeF32(g.path_meta.data) : null;
    const bearings = g.bearings ? buf.removeF32(g.bearings.data) : null;
    const scaleBands = g.scale_bands ? buf.removeF32(g.scale_bands.data) : null;

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
        pathSamples,
        pathStride,
        pathMeta,
        bearings,
        scaleBands,
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
        pathSamples,
        pathStride,
        pathMeta,
        bearings,
        scaleBands,
      };
    }

    return null;
  }

  /** See {@link buildBatchIndexMap} (anchor slots play the instance role). */
  private _rebuildBatchIndexMap(m: NavaraTextMesh): void {
    const batchIndexData = m.geometry.batch_index?.data;
    const built = buildBatchIndexMap(
      batchIndexData !== undefined ? this.ctx.buf.u32(batchIndexData) : null,
    );
    this._instanceBatchIndex = built?.perInstance ?? null;
    this._batchIndexToInstances = built?.byBatchIndex ?? null;
  }

  /** All anchor slots owned by the feature at `batchIndex`. */
  private _instancesOfBatchIndex(batchIndex: number): number[] {
    if (this._batchIndexToInstances) {
      return this._batchIndexToInstances.get(batchIndex) ?? [];
    }
    const nPositions = this._positions?.nPositions ?? 0;
    return batchIndex >= 0 && batchIndex < nPositions ? [batchIndex] : [];
  }

  async _update(m: NavaraTextMesh, needRender?: () => void) {
    if (needRender) this._needRender = needRender;

    const material = m.material;
    const text = material.text ?? "";
    // Kept so _applyUpdate can tell which material fields actually changed:
    // engine change events re-send the full material even when only geometry
    // or activation moved, and only genuine changes may overwrite per-feature
    // (evaluator-set) values.
    const prevMaterial = this._material;
    this._material = material;
    this._transform = m.transform;

    const positionInfo = this.extractPositions(m);
    if (positionInfo) {
      invariant(
        this._positions === null ||
          positionInfo.nPositions === this._positions.nPositions,
        "Number of positions in the updated geometry must match the initial geometry",
      );
      this._positions = positionInfo;
      this._path = takeLinePath(positionInfo) ?? this._path;
      this._rebuildBatchIndexMap(m);
      this._enhancer
        .mutates()
        .setRtcCenter([m.transform.tx, m.transform.ty, m.transform.tz]);
      for (const record of this._labels) this._writeAnchor(record);
      // Anchors moved (e.g. terrain height resolution) — re-place labels.
      this._markDeclutterDirty();
    }

    // A non-empty default text renders without per-feature setText calls, so
    // any lazily-skipped labels must exist before `_applyUpdate`.
    if (text) this._initLabels();

    const fontIdentifier = m.material.font ?? this._fontIdentifier;
    const needFontUpdate = fontIdentifier !== this._fontIdentifier;

    // Quality is immutable per batch (see _highQuality docs); use the batch's
    // quality everywhere, ignoring `m.material.highQuality` on updates.
    const q = this._highQuality;

    if (needFontUpdate) {
      // Unload old font resources.
      if (this._loadedFaceUrls.size > 0) {
        await Promise.all(
          [...this._loadedFaceUrls].map((url) =>
            this._fontManager.unloadFont(url, q),
          ),
        );
        this._loadedFaceUrls.clear();
      } else if (!this._fontManager.isFamily(this._fontIdentifier)) {
        await this._fontManager.unloadFont(this._fontIdentifier, q);
      }
      // For standalone new fonts load upfront; family faces are loaded lazily
      // by prepareText below.
      if (!this._fontManager.isFamily(fontIdentifier)) {
        await this._fontManager.loadFont(fontIdentifier, q);
      }
    }
    this._fontIdentifier = fontIdentifier;

    // If the text hasn't been prepared in the worker yet, schedule async preparation
    if (
      (needFontUpdate || text) &&
      !this._fontManager.isTextPrepared(this._fontIdentifier, text, q)
    ) {
      this._fontManager
        .prepareText(this._fontIdentifier, text, q, this._loadedFaceUrls)
        .then(() => {
          this._applyUpdate(material, prevMaterial, needRender, needFontUpdate);
        })
        .catch((err: unknown) => {
          console.error("Failed to prepare text:", err);
          needRender?.();
        });
      return;
    }

    this._applyUpdate(material, prevMaterial, needRender, needFontUpdate);
  }

  private _applyUpdate(
    material: NavaraTextMaterial,
    prevMaterial: NavaraTextMaterial,
    needRender?: () => void,
    forceUpdate = false,
  ) {
    this._refreshAtlasTextures();

    // Layout properties are baked into the glyph instances, so a change forces
    // a re-layout even when the text itself is unchanged.
    const nextMaxWidth = material.maxWidth ?? 0;
    const nextLineHeight = material.lineHeight ?? 1.0;
    const nextTextAlign = ALIGN_FACTORS[material.textAlign ?? "center"] ?? 0.5;
    const layoutChanged =
      nextMaxWidth !== this._maxWidth ||
      nextLineHeight !== this._lineHeight ||
      nextTextAlign !== this._textAlign;
    this._maxWidth = nextMaxWidth;
    this._lineHeight = nextLineHeight;
    this._textAlign = nextTextAlign;

    // Read before applying visibility: the declutter pass consults these even
    // while other style state is skipped for hidden labels.
    const nextDeclutter = material.declutter ?? true;
    if (this._declutter && !nextDeclutter) {
      // Leaving declutter mode: clear any hide the pass applied — the batch
      // stops producing candidates, so nothing else would ever re-show it.
      for (const record of this._labels) {
        record.declutterTarget = 0;
        if (record.declutterHide !== 0) this._declutterAnimating = true;
      }
    }
    this._declutter = nextDeclutter;
    this._declutterPriority = material.declutterPriority ?? 0;

    this._enhancer.update({
      base: {
        // `useRTE` / `useMsdf` / `linePlacement` / `pathSamples` are absent on
        // purpose: they pick the shader program and are driven by the geometry,
        // so they are settled at mount and on re-init, not by a style update.
        // Everything else the material owns belongs here — a field left out
        // keeps its mounted value forever, since the state merge reads
        // `props.x ?? currentState.x`.
        lineOffset: material.lineOffset ?? 0,
        center: material.center
          ? [material.center.x, material.center.y]
          : [0.5, 0.0],
        flatFacing: material.textFacing === "flat",
        rotateWithCamera: material.rotateWithCamera ?? true,
        rotation: material.rotation ?? 0,
        sizeInMeters: material.sizeInMeters ?? true,
        offsetDepth: material.offsetDepth ?? true,
        outlineWidth: material.outlineWidth ?? 0,
        outlineColor: material.outlineColor ?? 0x000000,
        outlineOpacity: clamp01(material.outlineOpacity ?? 1.0),
        showBackground: material.backgroundColor !== undefined,
        backgroundColor: material.backgroundColor,
        backgroundOutlineColor: material.borderColor ?? 0x000000,
        backgroundOutlineWidth: material.borderWidth ?? 0,
        depthTest: material.depthTest ?? true,
        backfaceCulling: material.backfaceCulling ?? false,
        transparent: material.transparent ?? true,
        effectIdsMask: this._computeEffectIdsMask(material),
        emissiveColor: material.emissiveColor ?? 0,
        emissiveIntensity: material.emissiveIntensity ?? 0,
      },
    });

    // Per-label values the material supplies defaults for. A *changed*
    // material value overwrites whatever the evaluator had set per feature
    // (mirroring the pre-batching behaviour for real `layer.update` calls) —
    // but engine change events re-send the whole material for geometry or
    // activation updates too, and stomping evaluator values with an unchanged
    // material made labels visibly pulse: every terrain-height event reset
    // per-feature sizes to the default for a few frames until the app's
    // evaluator ran again.
    const materialText = material.text;
    const materialShow = material.show ?? true;
    const colorHex = material.color ?? 0xffffff;
    const opacity = clamp01(material.opacity ?? 1.0);
    const fontSize = material.size ?? 16.0;
    const addHeight = material.height ?? 0;
    const showChanged = materialShow !== (prevMaterial.show ?? true);
    const styleChanged =
      colorHex !== (prevMaterial.color ?? 0xffffff) ||
      opacity !== clamp01(prevMaterial.opacity ?? 1.0);
    const fontSizeChanged = fontSize !== (prevMaterial.size ?? 16.0);
    const addHeightChanged = addHeight !== (prevMaterial.height ?? 0);
    const mat = this.material as ShaderMaterial;
    const rotationDeg = material.rotation ?? 0;
    const flatFacing = material.textFacing === "flat";
    const followCamera = material.rotateWithCamera ?? true;
    // Orientation/rotation are uniform-driven until some feature gets its own
    // value. Once a slot exists every feature reads the texture, so a changed
    // material value must be written through or evaluator overrides would
    // outlive it — the same "a material update overwrites per-feature style"
    // rule the style/size writes above follow.
    const rotationChanged =
      rotationDeg !== (prevMaterial.rotation ?? 0) &&
      hasBatchScalarSlot(mat, "rotation");
    const orientationChanged =
      (flatFacing !== (prevMaterial.textFacing === "flat") ||
        followCamera !== (prevMaterial.rotateWithCamera ?? true)) &&
      hasBatchScalarSlot(mat, "orientation");

    // A changed material show clobbers evaluator overrides — including hide
    // intents parked on anchors that never got a label.
    if (showChanged) this._hiddenBeforeLabel.clear();

    for (const record of this._labels) {
      if (styleChanged) {
        record.colorHex = colorHex;
        record.opacity = opacity;
        this._writeStyle(record);
      }
      if (fontSizeChanged) {
        record.fontSize = fontSize;
        this._writeFontSize(record);
      }
      if (addHeightChanged) {
        record.addHeight = addHeight;
        this._writeAddHeight(record);
      }
      if (rotationChanged) {
        this.setFeatureRotationByBatchIndex(record.batchIndex, rotationDeg);
      }
      if (orientationChanged) {
        this.setFeatureFacingByBatchIndex(
          record.batchIndex,
          flatFacing ? "flat" : "upright",
        );
        this.setFeatureRotateWithCameraByBatchIndex(
          record.batchIndex,
          followCamera,
        );
      }

      if (showChanged) record.requestedShow = materialShow;
      if (materialText !== undefined && materialText !== "") {
        // The material text overrides whatever the evaluator asked for —
        // including a prepare that is in flight or parked on visibility.
        record.requestedText = materialText;
        this._clearDeferred(record);
        this._applyText(record, materialText);
      } else if (forceUpdate || layoutChanged) {
        // Font or layout changed — re-lay-out existing text.
        this._applyText(record, record.text);
      }
      this._recomputeShow(record);
    }

    this._markDeclutterDirty();
    if (needRender) needRender();
  }

  // --- Per-feature API (the FeatureEvaluator contract) ---

  setTextByBatchIndex(batchIndex: number, text: string) {
    for (const instanceIndex of this._instancesOfBatchIndex(batchIndex)) {
      this._setTextByInstance(instanceIndex, text);
    }
  }

  private _setTextByInstance(instanceIndex: number, text: string) {
    // An empty text on a label that doesn't exist yet changes nothing (a
    // lazily-skipped label is exactly an invisible empty-text label); only a
    // non-empty text forces one into existence.
    const record = text
      ? this._ensureLabel(instanceIndex)
      : this._labelByInstance[instanceIndex];
    if (!record) return;

    // Record the intent up front so a slower prepare for an older text can
    // detect that it has been superseded.
    record.requestedText = text;

    if (
      text &&
      !this._fontManager.isTextPrepared(
        this._fontIdentifier,
        text,
        this._highQuality,
      )
    ) {
      // Unprepared text costs a worker round-trip and possibly font-face
      // fetches, and low-zoom tiles span far more world than the screen shows
      // (a z0 tile carries every country's name). Park preparation until a
      // placement pass confirms the anchor can actually appear on screen
      // (`prepareDeferredLabels`). Deciding here instead would race camera
      // initialization: early tiles evaluate before the first render commits
      // the camera pose to `matrixWorld`, wrongly passing far-side labels.
      // The pass runs with the render camera on the next frame, so visible
      // labels start preparing at most one throttle window later.
      if (this.ctx.declutter) {
        if (!record.prepareDeferred) {
          record.prepareDeferred = true;
          this._deferredCount++;
        }
        this._markDeclutterDirty();
        this._needRender?.();
        return;
      }
      this._prepareAndApply(record, text);
      return;
    }

    this._clearDeferred(record);
    this._applyText(record, text);
    this._markDeclutterDirty();
    this._needRender?.();
  }

  /** Kick off async font preparation for `text`, then lay it out — unless a
   *  newer text supersedes it while the fonts load. */
  private _prepareAndApply(record: LabelRecord, text: string): void {
    // Tracked so `whenLabelsSettled` can gate the tile's render-completion
    // report on the glyphs actually being written (this chain ends after
    // `_applyText`), not merely on the font round-trip finishing. This is the
    // single point where preparation starts — both the inline path above and
    // the promotion of a parked label in `prepareDeferredLabels` route here.
    this._pendingTextPrepares.track(
      this._fontManager
        .prepareText(
          this._fontIdentifier,
          text,
          this._highQuality,
          this._loadedFaceUrls,
        )
        .then(() => {
          // A newer text may have landed while the font loaded.
          if (record.requestedText !== text) return;
          this._refreshAtlasTextures();
          this._applyText(record, text);
          this._markDeclutterDirty();
          this._needRender?.();
        })
        .catch((err: unknown) => {
          console.error("Failed to prepare text:", err);
          this._needRender?.();
        }),
    );
  }

  private _clearDeferred(record: LabelRecord): void {
    if (record.prepareDeferred) {
      record.prepareDeferred = false;
      this._deferredCount--;
    }
  }

  /**
   * Promote parked labels whose anchor became potentially visible: start
   * their font preparation and apply the text when it lands. Runs at the
   * start of every placement pass (see {@link DeclutterParticipant}) — the
   * cadence at which visibility can actually change.
   */
  prepareDeferredLabels(camera: PerspectiveCamera): void {
    if (this._deferredCount === 0 || !this.visible) return;
    const state = syncAnchorVisibilityState(camera, _visibility);
    for (const record of this._labels) {
      if (!record.prepareDeferred) continue;
      const a = record.anchor;
      if (!isAnchorPotentiallyVisible(state, a[0], a[1], a[2])) continue;
      this._clearDeferred(record);

      const text = record.requestedText;
      // Parked intent may have gone stale: cleared, or applied via another
      // path (e.g. a material-level text update).
      if (!text || text === record.text) continue;
      if (
        this._fontManager.isTextPrepared(
          this._fontIdentifier,
          text,
          this._highQuality,
        )
      ) {
        this._applyText(record, text);
        this._markDeclutterDirty();
        this._needRender?.();
        continue;
      }
      this._prepareAndApply(record, text);
    }
  }

  override setFeatureColorByBatchIndex(batchIndex: number, color: Color) {
    for (const instanceIndex of this._instancesOfBatchIndex(batchIndex)) {
      const record = this._ensureLabel(instanceIndex);
      if (!record) continue;
      record.colorHex = color.getHex();
      this._writeStyle(record);
    }
  }

  override setFeatureShowByBatchIndex(batchIndex: number, rawVisible: boolean) {
    for (const instanceIndex of this._instancesOfBatchIndex(batchIndex)) {
      // A label that doesn't exist yet is already effectively `show:false`, so
      // only `show:true` needs to force one into existence — the common MVT
      // case is thousands of features that stay hidden and never get a label.
      const record = rawVisible
        ? this._ensureLabel(instanceIndex)
        : this._labelByInstance[instanceIndex];
      if (!record) {
        if (!rawVisible) this._hiddenBeforeLabel.add(instanceIndex);
        continue;
      }
      record.requestedShow = rawVisible;
      this._recomputeShow(record);
    }
    this._markDeclutterDirty();
  }

  override setFeatureHeightByBatchIndex(batchIndex: number, height: number) {
    for (const instanceIndex of this._instancesOfBatchIndex(batchIndex)) {
      const record = this._ensureLabel(instanceIndex);
      if (!record) continue;
      record.addHeight = height;
      this._writeAddHeight(record);
    }
    this._markDeclutterDirty();
  }

  /**
   * Orientation and in-plane rotation for one feature, overriding the
   * material's. `rotation` is in degrees, clockwise seen from the front; it is
   * converted to the radians the shader wants here, matching the material path.
   */
  setFeatureFacingByBatchIndex(batchIndex: number, facing: "upright" | "flat") {
    this._updateBatchAttribute(
      batchIndex,
      "flatFacing",
      facing === "flat",
      this._orientationDefaults(),
    );
  }

  setFeatureRotateWithCameraByBatchIndex(batchIndex: number, follow: boolean) {
    this._updateBatchAttribute(
      batchIndex,
      "rotateWithCamera",
      follow,
      this._orientationDefaults(),
    );
  }

  setFeatureRotationByBatchIndex(batchIndex: number, degrees: number) {
    this._updateBatchAttribute(
      batchIndex,
      "rotation",
      degrees * MathUtils.DEG2RAD,
      this._orientationDefaults(),
    );
  }

  setFeatureSizeByBatchIndex(batchIndex: number, size: number) {
    for (const instanceIndex of this._instancesOfBatchIndex(batchIndex)) {
      const record = this._ensureLabel(instanceIndex);
      if (!record) continue;
      record.fontSize = Number.isFinite(size)
        ? Math.max(0.0, size)
        : record.fontSize;
      this._writeFontSize(record);
    }
    this._markDeclutterDirty();
  }

  setFeatureOpacityByBatchIndex(batchIndex: number, opacity: number) {
    for (const instanceIndex of this._instancesOfBatchIndex(batchIndex)) {
      const record = this._ensureLabel(instanceIndex);
      if (!record) continue;
      record.opacity = clamp01(opacity);
      this._writeStyle(record);
    }
  }

  /** Per-feature emissive (fill only; drives selective bloom). Style-only:
   *  no label has to exist — the write lands in the batch data texture. */
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

  setFeatureDeclutterPriorityByBatchIndex(
    batchIndex: number,
    priority: number,
  ) {
    for (const instanceIndex of this._instancesOfBatchIndex(batchIndex)) {
      const record = this._ensureLabel(instanceIndex);
      if (!record) continue;
      record.priorityOverride = priority;
    }
    this._markDeclutterDirty();
  }

  /**
   * Labels are no longer three.js objects, so there is no child mesh to hand
   * back. Overridden to stop the base class returning an unrelated object from
   * its (unused) `allMeshes` array.
   */
  override getMeshByBatchIndex(): undefined {
    return undefined;
  }

  // --- Cleanup ---

  dispose() {
    this.ctx.declutter?.unregister(this);
    this._unsubscribeEvict?.();
    this._unsubscribeEvict = undefined;

    const q = this._highQuality;
    // Release every label's atlas retains. The per-label meshes this replaced
    // were never disposed (they were detached from `children` while hidden),
    // so these references used to leak.
    for (const record of this._labels) {
      if (!record.retainedKeys) continue;
      this._fontManager.releaseGlyphs(
        this._fontIdentifier,
        q,
        record.retainedKeys,
      );
      record.retainedKeys = null;
    }
    this._labels.length = 0;
    this._labelByInstance.length = 0;
    this._batchIndexToInstances = null;
    this._instanceBatchIndex = null;

    this._labelData.dispose();
    this._pathData?.dispose();
    this._glyphs.dispose();
    (this.material as ShaderMaterial).dispose();

    const unload =
      this._loadedFaceUrls.size > 0
        ? Promise.all(
            [...this._loadedFaceUrls].map((url) =>
              this._fontManager.unloadFont(url, q),
            ),
          )
        : this._fontManager.unloadFont(this._fontIdentifier, q);
    void unload.catch((err: unknown) => {
      console.error("Failed to unload font during dispose:", err);
    });
  }
}

/** Clamp to [0, 1], treating non-finite input as fully opaque. */
function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1.0;
}
