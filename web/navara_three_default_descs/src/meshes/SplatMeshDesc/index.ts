import type ThreeView from "@navaramap/three";
import {
  MeshDesc,
  type MeshConfig,
  type MeshUpdate,
  type PassKey,
  type ViewContext,
} from "@navaramap/three";
import type { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";
import type { Scene } from "three";

import {
  ORIGIN_KEY,
  ORIGIN_UPDATER,
  ensureSparkOriginPatch,
} from "./sparkOriginPatch";
import { SplatOriginController } from "./splatOriginController";

/**
 * Lazily loaded @sparkjsdev/spark module. Spark is a ~5MB module (its WASM is
 * inlined as base64 in its dist), so it must not be a static import: that
 * would land the whole splat stack in every bundle that merely registers
 * `SplatMeshDesc` (e.g. via DefaultPlugin).
 */
type SparkModule = typeof import("@sparkjsdev/spark");
let spark: SparkModule | undefined;
let sparkLoading: Promise<SparkModule> | undefined;

function loadSpark(): Promise<SparkModule> {
  sparkLoading ??= import("@sparkjsdev/spark").then(
    (m) => (spark = m),
    (error: unknown) => {
      // Allow a later retry (e.g. a transient network failure).
      sparkLoading = undefined;
      throw error;
    },
  );
  return sparkLoading;
}

/** The loaded spark module; only callable once `loadSpark()` has resolved. */
function requireSpark(): SparkModule {
  if (!spark) {
    throw new Error(
      "SplatMeshDesc: @sparkjsdev/spark is not loaded yet (onCreate awaits it before any spark use).",
    );
  }
  return spark;
}

/** Default grid cell (m) for the dynamic RTC origin. See {@link SplatOriginController}. */
const DEFAULT_ORIGIN_CELL_SIZE = 2000;

type SplatDescription = {
  splat?: {
    url: string;
    lod?: boolean;
    /**
     * Grid cell edge (m) for the dynamic floating-origin that keeps splats
     * precise at globe scale. Shared per transparent scene: the first splat's
     * value wins. Smaller = tighter precision but more re-sorts. Default 2000.
     */
    originCellSize?: number;
  };
};

// Update accepts partials; `url`, `lod` and `originCellSize` are frozen
// post-creation (only warn if an explicitly provided value differs).
type SplatDescriptionUpdate = {
  splat?: {
    url?: string;
    lod?: boolean;
    originCellSize?: number;
  };
};

export type SplatMeshConfig = MeshConfig & SplatDescription;

export type SplatMeshUpdate = MeshUpdate & SplatDescriptionUpdate;

type SharedEntry = {
  renderer: SparkRenderer;
  refCount: number;
  enableLod: boolean;
  /** Fanout of per-descriptor `onDirty` callbacks. */
  listeners: Set<() => void>;
  /** Dynamic floating-origin driver shared by every splat on this renderer. */
  controller: SplatOriginController;
};

const shared = new WeakMap<Scene, SharedEntry>();

function acquireSparkRenderer(
  ctx: ViewContext,
  opts: { enableLod: boolean; onDirty: () => void; cellSize: number },
): { enableLod: boolean; controller: SplatOriginController } {
  // Transparent scene: render after atmosphere/aerial-perspective so baked color survives.
  const target = ctx.scenes.transparent;
  const existing = shared.get(target);
  if (existing) {
    // Asymmetric: a lod:true descriptor can't add LoD to a renderer built
    // without it, but lod:false on a LoD-enabled renderer runs fine.
    if (opts.enableLod && !existing.enableLod) {
      console.warn(
        `SplatMeshDesc: splat.lod=true requested but the shared SparkRenderer was created with splat.lod=false; rendering this mesh without LoD.`,
      );
    }
    existing.listeners.add(opts.onDirty);
    existing.refCount += 1;
    // Re-assert in case another view changed the global override.
    requireSpark().SparkRenderer.sparkOverride = existing.renderer;
    return { enableLod: existing.enableLod, controller: existing.controller };
  }

  const { SparkRenderer } = requireSpark();
  const listeners = new Set<() => void>([opts.onDirty]);
  const renderer = new SparkRenderer({
    renderer: ctx.getRenderer(),
    enableLod: opts.enableLod,
    // Fan out to every descriptor sharing this renderer.
    onDirty: () => listeners.forEach((fn) => fn()),
  });

  // The patch reads the live origin vector and calls the updater each frame to
  // grid-snap it to the camera and recenter registered splats.
  const controller = new SplatOriginController(opts.cellSize);
  renderer.userData[ORIGIN_KEY] = controller.origin;
  renderer.userData[ORIGIN_UPDATER] = controller.update;
  ensureSparkOriginPatch(SparkRenderer);

  target.add(renderer);
  SparkRenderer.sparkOverride = renderer;

  shared.set(target, {
    renderer,
    refCount: 1,
    enableLod: opts.enableLod,
    listeners,
    controller,
  });
  return { enableLod: opts.enableLod, controller };
}

function releaseSparkRenderer(ctx: ViewContext, listener: () => void): void {
  const target = ctx.scenes.transparent;
  const entry = shared.get(target);
  if (!entry) return;

  entry.listeners.delete(listener);
  entry.refCount -= 1;
  if (entry.refCount > 0) return;

  target.remove(entry.renderer);
  entry.renderer.dispose();
  // Clear (not restore): a saved override could outlive its renderer.
  const { SparkRenderer } = requireSpark();
  if (SparkRenderer.sparkOverride === entry.renderer) {
    SparkRenderer.sparkOverride = undefined;
  }
  shared.delete(target);
}

function warnIfChanged<T>(field: string, next: T, current: T): void {
  if (next !== undefined && next !== current) {
    console.warn(
      `SplatMeshDesc: splat.${field} cannot be changed after creation; recreate the descriptor.`,
    );
  }
}

export type SplatMeshEvent = {
  /** Emitted once the splat file has been fetched and parsed. */
  load: () => void;
  /** Emitted when fetching or parsing the splat file fails. */
  error: (error: unknown) => void;
  needsUpdate: () => void;
};

export class SplatMeshDesc extends MeshDesc<
  SplatMeshConfig,
  SplatMeshUpdate,
  SplatMesh,
  SplatMeshEvent
> {
  private config: SplatMeshConfig;
  private holdsSlot = false;
  /** Bound listener for the shared SparkRenderer's `onDirty` fanout. */
  private onSparkDirty?: () => void;
  /** Shared dynamic-origin driver this splat registers with (RTC). */
  private controller?: SplatOriginController;

  constructor(view: ThreeView, ctx: ViewContext, config: SplatMeshConfig) {
    super(view, ctx, config);
    this.config = config;
  }

  protected override getPassKey(): PassKey {
    return "transparent";
  }

  createMesh(): SplatMesh {
    const cfg = this.config.splat;
    if (!cfg?.url) {
      throw new Error("SplatMeshDesc requires splat.url");
    }

    const requestedLod = cfg.lod ?? false;
    // SparkJS fires `onDirty` when its async sort/LoD worker finishes a new
    // pass; without this, the new ordering only shows up on the next external
    // frame request (camera move, etc.).
    this.onSparkDirty = () => this.requestUpdate();
    const { enableLod: rendererLod, controller } = acquireSparkRenderer(
      this.ctx,
      {
        enableLod: requestedLod,
        onDirty: this.onSparkDirty,
        cellSize: cfg.originCellSize ?? DEFAULT_ORIGIN_CELL_SIZE,
      },
    );
    this.controller = controller;
    const effectiveLod = requestedLod && rendererLod;

    // Slot held only during load; released on `mesh.initialized` settle.
    if (this.ctx.concurrencyManager.canIncrement()) {
      this.ctx.concurrencyManager.increment();
      this.holdsSlot = true;
    }

    // Pin url locally so a concurrent `onUpdateConfig()` doesn't make
    // the catch log the new url for an old failure.
    const url = cfg.url;
    const mesh = new (requireSpark().SplatMesh)({ url, lod: effectiveLod });

    mesh.initialized
      .then(() => {
        this.requestUpdate();
        this.emit("load");
      })
      .catch((err: unknown) => {
        console.warn(`SplatMesh load failed (${url}):`, err);
        this.emit("error", err);
      })
      .finally(() => this.releaseSlot());
    return mesh;
  }

  /**
   * Async (see `BaseDesc.onCreate`): awaits the lazily loaded spark module,
   * then runs the normal synchronous creation flow. `addMesh` returns the
   * handle immediately; the splat appears once the module has loaded, and an
   * import failure surfaces as this descriptor's `error` event.
   */
  override async onCreate(): Promise<void> {
    await loadSpark();
    // Deleted while the module was loading — don't create anything.
    if (this.destroyed) return;
    super.onCreate();
    // Base class has applied the (ECEF) world transform. Register with the
    // dynamic-origin controller, which recenters this mesh to a camera-tracking
    // origin so Spark's accumulator only ever sees small coordinates.
    const mesh = this.raw;
    if (!mesh || !this.controller) return;

    // Stash the original ECEF world matrix so the controller can re-derive the
    // recentered matrix for any origin it snaps to.
    this.controller.register(mesh, mesh.matrixWorld.clone());
  }

  /**
   * A terrain-height observation (under `geodetic` + `heightReference:
   * "terrain"`) makes the base class re-write `mesh.matrixWorld` to the
   * freshly-resolved ECEF matrix. The RTC controller caches its own copy of
   * that matrix to re-derive the recentered one on every origin snap, so it
   * must be re-registered here — otherwise the splat keeps rendering at the
   * height captured when it was created (or last moved).
   */
  protected override reapplyGeodeticFrame(): void {
    super.reapplyGeodeticFrame();
    const mesh = this.raw;
    if (mesh && this.controller) {
      this.controller.register(mesh, mesh.matrixWorld.clone());
    }
  }

  private releaseSlot(): void {
    if (this.holdsSlot) {
      this.ctx.concurrencyManager.decrement();
      this.holdsSlot = false;
    }
  }

  onUpdateConfig(updates: SplatMeshUpdate): void {
    const next = updates.splat;
    const current = this.config.splat;
    // Skip omitted fields so partial updates don't false-warn. The rendered
    // splat stays frozen at construction either way.
    if (next && current) {
      if (next.url !== undefined) {
        warnIfChanged("url", next.url, current.url);
        current.url = next.url;
      }
      if (next.lod !== undefined) {
        warnIfChanged("lod", next.lod, current.lod ?? false);
        current.lod = next.lod;
      }
      if (next.originCellSize !== undefined) {
        warnIfChanged(
          "originCellSize",
          next.originCellSize,
          current.originCellSize,
        );
        current.originCellSize = next.originCellSize;
      }
    }
    super.onUpdateConfig(updates);

    // A transform update makes the base class re-apply the raw ECEF matrix to
    // `mesh.matrixWorld` (undoing the RTC recenter). Refresh the controller's
    // cached matrix from it and re-recenter now, otherwise the splat renders at
    // ECEF until the next origin change — which would then snap it back to the
    // *original* placement captured at creation. Only the matrixWorld/matrix/
    // geodetic path is RTC-managed (the base recomputes `matrixWorld` there);
    // the auto-update position-only path is moved by the base class directly.
    const spatialChanged =
      updates.matrix !== undefined ||
      updates.matrixWorld !== undefined ||
      updates.geodetic !== undefined ||
      updates.position !== undefined ||
      updates.scale !== undefined ||
      updates.rotation !== undefined;
    const mesh = this.raw;
    if (
      spatialChanged &&
      mesh &&
      this.controller &&
      (this.matrixWorld || this.matrix || this.geodetic)
    ) {
      this.controller.register(mesh, mesh.matrixWorld.clone());
    }
  }

  override onDestroy(): void {
    // Capture before super: super removes from scene and nulls `_instance`.
    const mesh = this._instance;
    super.onDestroy();
    if (mesh) this.controller?.unregister(mesh);
    mesh?.dispose();

    // Fallback: destroyed before `mesh.initialized` settled.
    this.releaseSlot();
    if (this.onSparkDirty) {
      releaseSparkRenderer(this.ctx, this.onSparkDirty);
      this.onSparkDirty = undefined;
    }
  }
}
