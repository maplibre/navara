import type { BaseEventMap, XYZ } from "@navaramap/core";
import {
  headingPitchRollToFixedFrame,
  type GeodeticPlacement,
} from "@navaramap/three-api";
import { Euler, Matrix4, Object3D, Vector3, type Mesh } from "three";
import invariant from "tiny-invariant";

import type ThreeView from "../index";
import { applyLitOption } from "../material";
import type { GBufferName } from "../material/gbufferLayout";
import type { Scenes } from "../scene";

import {
  BaseDesc,
  type BaseInstance,
  type BaseDescConfig,
  type BaseDescConfigUpdate,
} from "./BaseDesc";
import { ConflictingTransformError } from "./errors";
import type { ViewContext } from "./ViewContext";

export type MeshConfig = {
  type?: "mesh";
  /**
   * Local translation. When `matrix` or `matrixWorld` is also set, this is
   * treated as an offset *inside* that frame (left-multiplied by the frame).
   * Otherwise it's applied directly as `Object3D.position`.
   */
  position?: XYZ;
  /**
   * Local scale. See {@link position} for interaction with `matrix` / `matrixWorld`.
   */
  scale?: XYZ;
  /**
   * Local Euler rotation (XYZ order). See {@link position} for interaction
   * with `matrix` / `matrixWorld`.
   */
  rotation?: XYZ;
  /**
   * Local frame. When combined with `position` / `rotation` / `scale`, the
   * effective local matrix is `matrix · T(position) · R(rotation) · S(scale)`.
   * Disables Three.js's auto matrix update.
   *
   * Mutually exclusive with `matrixWorld` and `geodetic`: all three define the
   * object's placement.
   */
  matrix?: Matrix4;
  /**
   * World frame (e.g. an NUE-to-ECEF tangent frame on the globe). When
   * combined with `position` / `rotation` / `scale`, the effective world
   * matrix is `matrixWorld · T(position) · R(rotation) · S(scale)`, so the
   * offset fields are interpreted in the frame's local coordinates.
   * Disables Three.js's auto matrix-world update.
   *
   * Mutually exclusive with `matrix` and `geodetic`: all three define the
   * object's placement.
   */
  matrixWorld?: Matrix4;
  /**
   * High-level geographic placement in degrees and metres. Builds a
   * West-Up-North tangent frame at `lng`/`lat`/`height` and applies
   * `heading`/`pitch`/`roll`/`scale`, then occupies the same slot as
   * `matrixWorld` — so `position` / `rotation` / `scale` remain offsets
   * *inside* the resulting frame.
   *
   * `heading` is the compass bearing the asset's front (glTF `+Z`) faces, the
   * same convention as `setCamera`. Because the frame is Y-up with `+Z` north,
   * an unmodified glTF asset needs no up-axis correction.
   *
   * Mutually exclusive with `matrix` and `matrixWorld`.
   */
  geodetic?: GeodeticPlacement;
  /**
   * Lighting override for every material of the mesh. `false` outputs albedo
   * only, while normals and the shadow G-buffer keep being written.
   * `undefined` follows `view.lit` — passing it to `update()` resets a mesh
   * to inheriting again.
   */
  lit?: boolean;
} & BaseDescConfig;

export type MeshUpdate = Pick<
  MeshConfig,
  "position" | "scale" | "rotation" | "matrix" | "matrixWorld" | "lit"
> & {
  /**
   * Partial geographic placement, merged into the stored placement — so
   * `update({ geodetic: { heading } })` keeps the existing lng/lat/height.
   * `lng` and `lat` are required only when the object has no placement yet.
   */
  geodetic?: Partial<GeodeticPlacement>;
} & BaseDescConfigUpdate;

export type PassKey = keyof Pick<
  Scenes,
  "opaque" | "transparent" | "mrt" | "skyEnvMap" | "draped"
>;

export type MeshBaseInstance<Instance extends object = object> =
  Instance extends Object3D
    ? Instance
    : Instance extends {
          raw: infer Raw extends Object3D;
        }
      ? Instance & { raw: Raw } & BaseInstance
      : Instance & BaseInstance;

/**
 * `geodetic`, `matrix` and `matrixWorld` all claim the object's placement, so
 * they share a single slot and at most one may be set. Every consumer resolves
 * that slot with a priority chain (`applyTransform`, `applyRTETransform`), so
 * allowing two would silently drop the lower-priority one — notably `matrix`
 * under `matrixWorld`, which cannot be honoured at all once
 * `matrixWorldAutoUpdate` is off. Takes the values rather than reading `this`,
 * so a caller can check a prospective state before committing it. Exported so
 * subclasses that override `onUpdateConfig` (e.g. RTE Descriptors like
 * `GLTFModelDesc`) reuse this single check instead of hand-rolling their own.
 */
export function assertNoTransformConflict(
  geodetic: GeodeticPlacement | undefined,
  matrix: Matrix4 | undefined,
  matrixWorld: Matrix4 | undefined,
): void {
  if (geodetic) {
    if (matrixWorld) {
      throw new ConflictingTransformError("geodetic", "matrixWorld");
    }
    if (matrix) {
      throw new ConflictingTransformError("geodetic", "matrix");
    }
  }
  if (matrix && matrixWorld) {
    throw new ConflictingTransformError("matrixWorld", "matrix");
  }
}

/**
 * Merges a partial placement onto an existing one and checks it is complete.
 * Pure — returns the merged value instead of assigning it, so the caller can
 * validate before committing. Exported so subclasses that manage their own
 * `onUpdateConfig` (e.g. `GLTFModelDesc`'s RTE-split transform) can merge a
 * `geodetic` update with the same semantics instead of re-deriving them.
 */
export function mergeGeodetic(
  current: GeodeticPlacement | undefined,
  update: Partial<GeodeticPlacement>,
): GeodeticPlacement {
  const merged = { ...current, ...update };
  if (merged.lng === undefined || merged.lat === undefined) {
    throw new Error(
      "`geodetic` update requires `lng` and `lat` when the object has no geodetic placement yet.",
    );
  }
  return merged as GeodeticPlacement;
}

/**
 * Abstract base class for creating custom mesh descriptors.
 *
 * Extend this class to add custom Three.js 3D objects (meshes, groups, particles, etc.)
 * to the Navara scene. The base class handles position/scale/rotation synchronization
 * and automatic scene management via {@link getPassKey}.
 *
 * ## Implementing a Custom Mesh Descriptor
 *
 * ### 1. Define configuration types
 *
 * Create a description type for your mesh-specific options, then merge it with the
 * base config and update types:
 *
 * ```typescript
 * type MyMeshDescription = {
 *   myMesh?: {
 *     radius?: number;
 *     color?: Color;
 *     castShadow?: boolean;
 *   };
 * };
 *
 * type MyMeshConfig = MeshConfig & MyMeshDescription;
 * type MyMeshUpdate = MeshUpdate & MyMeshDescription;
 * ```
 *
 * ### 2. Extend `MeshDesc`
 *
 * Implement the {@link createMesh} factory method. Optionally override
 * {@link getPassKey} to control which render scene the mesh belongs to,
 * {@link onUpdateConfig} for dynamic updates, and {@link update} for animation.
 *
 * ```typescript
 * class MyMeshDesc extends MeshDesc<
 *   MyMeshConfig,
 *   MyMeshUpdate,
 *   Mesh<SphereGeometry, MeshStandardMaterial>
 * > {
 *   private config: MyMeshConfig;
 *
 *   constructor(view: ThreeView, ctx: ViewContext, config: MyMeshConfig) {
 *     super(view, ctx, config);
 *     this.config = config;
 *   }
 *
 *   createMesh() {
 *     const cfg = this.config.myMesh ?? {};
 *     const geometry = new SphereGeometry(cfg.radius ?? 1);
 *     const material = new MeshStandardMaterial({
 *       color: cfg.color?.raw ?? 0xffffff,
 *     });
 *     const mesh = new Mesh(geometry, material);
 *     mesh.castShadow = cfg.castShadow ?? false;
 *
 *     // Enable CSM shadows if needed
 *     if (mesh.castShadow) {
 *       this.ctx.applyShadowMaterial(material);
 *     }
 *
 *     return mesh;
 *   }
 *
 *   onUpdateConfig(updates: MyMeshUpdate): void {
 *     if (updates.myMesh && this._instance) {
 *       if (updates.myMesh.color !== undefined) {
 *         this._instance.material.color.set(updates.myMesh.color.raw);
 *       }
 *       this.emit("needsUpdate");
 *     }
 *     super.onUpdateConfig(updates);
 *   }
 * }
 * ```
 *
 * ### 3. Register and use the descriptor
 *
 * ```typescript
 * view.registerMesh("myMesh", MyMeshDesc);
 *
 * const handle = view.addMesh<MyMeshDesc>({
 *   position: { x: 0, y: 100, z: 0 },
 *   scale: { x: 10, y: 10, z: 10 },
 *   rotation: { x: 0, y: Math.PI / 4, z: 0 },
 *   myMesh: { radius: 5, color: new Color("#00ff00") },
 * });
 *
 * // Update dynamically
 * handle.update({ myMesh: { color: new Color("#ff0000") } });
 *
 * // Access the raw Three.js object for direct manipulation
 * const mesh = handle.ref.raw;
 *
 * // Animate on every frame
 * view.on("preUpdate", (time) => {
 *   mesh.rotation.y += 0.01;
 * });
 *
 * // Remove the descriptor
 * handle.delete();
 * ```
 *
 * ## Render Scenes (Pass Keys)
 *
 * Override {@link getPassKey} to control which render scene the mesh is added to:
 * - `"opaque"` (default) - Standard opaque rendering with depth testing.
 * - `"transparent"` - Transparent rendering pass.
 * - `"mrt"` - Multiple Render Target scene, used for selective effects (bloom, outline).
 * - `"skyEnvMap"` - Sky environment map scene.
 * - `"draped"` - This is only for `DrapedMesh`. The mesh is clamped to the terrain.
 *
 * ## Lifecycle
 *
 * 1. **Construction** - The descriptor is instantiated with the view context and config.
 * 2. **{@link createMesh}** - Called during {@link onCreate} to create the Three.js object.
 *    The base class applies position/scale/rotation and adds it to the scene
 *    determined by {@link getPassKey}.
 * 3. **{@link onUpdateConfig}** - Called when `handle.update()` is invoked. The base class
 *    handles `visible`, `matrix`, `matrixWorld`, `position`, `scale`, `rotation`, and `geodetic`; override to handle your
 *    custom properties. Always call `super.onUpdateConfig(updates)`.
 * 4. **{@link update}** - Optional per-frame callback for animation.
 * 5. **{@link onResize}** - Optional callback when the viewport is resized.
 * 6. **{@link onDestroy}** - Called on `handle.delete()`. The base class removes the mesh
 *    from its parent scene. Override to dispose geometry/material resources.
 *
 * @see The `custom-shader` example page for a complete custom mesh descriptor tutorial using
 *      MarchingCubes with a custom shader material.
 *
 * @typeParam Config - Configuration type (extends {@link MeshConfig})
 * @typeParam UpdateConfig - Updatable properties (extends {@link MeshUpdate})
 * @typeParam InstanceObj - The Three.js Object3D type or a wrapper with a `raw` property
 * @typeParam CustomEvent - Additional custom events the descriptor can emit
 * @typeParam Instance - Resolved instance type (inferred automatically)
 */
export abstract class MeshDesc<
  Config extends MeshConfig = MeshConfig,
  UpdateConfig extends MeshUpdate = MeshUpdate,
  InstanceObj extends Object3D | { raw: Object3D } =
    Object3D | { raw: Object3D },
  CustomEvent extends BaseEventMap = BaseEventMap,
  Instance extends MeshBaseInstance<InstanceObj> =
    MeshBaseInstance<InstanceObj>,
> extends BaseDesc<Config, UpdateConfig, Instance, CustomEvent> {
  public position?: XYZ;
  public scale?: XYZ;
  public rotation?: XYZ;
  public matrix?: Matrix4;
  public matrixWorld?: Matrix4;
  public geodetic?: GeodeticPlacement;
  /** Terrain height under `geodetic`, when `heightReference` is `"terrain"`. */
  protected terrainHeight?: number;
  private terrainUnsubscribe?: () => void;
  /** Three-state `lit` override (see {@link MeshConfig.lit}). */
  public lit?: boolean;
  private prevPassKey?: PassKey;

  constructor(view: ThreeView, ctx: ViewContext, config?: Config) {
    const resolvedConfig = config ?? ({} as Config);
    super(view, ctx, resolvedConfig);
    this.position = resolvedConfig.position;
    this.scale = resolvedConfig.scale;
    this.rotation = resolvedConfig.rotation;
    this.matrix = resolvedConfig.matrix;
    this.matrixWorld = resolvedConfig.matrixWorld;
    this.geodetic = resolvedConfig.geodetic;
    assertNoTransformConflict(this.geodetic, this.matrix, this.matrixWorld);
    this.lit = resolvedConfig.lit;
  }

  /**
   * Builds the world frame for a {@link GeodeticPlacement}, adding
   * {@link terrainHeight} when one has been observed. This method does not
   * gate on `heightReference` itself — `terrainHeight` is only ever populated
   * for a terrain-referenced placement, and is cleared otherwise.
   *
   * Fields are passed explicitly rather than spread: `headingPitchRollToFixedFrame`
   * rejects `heightReference`, which this class resolves itself.
   */
  protected resolveGeodeticFrame(g: GeodeticPlacement): Matrix4 {
    return headingPitchRollToFixedFrame({
      lng: g.lng,
      lat: g.lat,
      height: (g.height ?? 0) + (this.terrainHeight ?? 0),
      heading: g.heading,
      pitch: g.pitch,
      roll: g.roll,
      scale: g.scale,
    });
  }

  /**
   * Subscribes to terrain height under a terrain-referenced `geodetic`
   * placement.
   *
   * `sampleTerrainHeight` seeds synchronously from tiles already resident, so
   * the object does not sit at the wrong altitude while tiles stream in; the
   * observer then re-places it on every terrain update. With no terrain layer
   * added, the sample is `undefined` and the observer does not fire until a
   * terrain layer is added, so the placement degrades to ellipsoid-relative
   * rather than failing — terrain layers may be added after the object.
   *
   * Protected (not private) so a subclass that manages its own world-matrix
   * representation for `geodetic` (e.g. `GLTFModelDesc`'s RTE position split)
   * can call it directly from its own `onCreate`/`onUpdateConfig` instead of
   * routing through this class's `onCreate`.
   */
  protected subscribeTerrainHeight(): void {
    this.unsubscribeTerrainHeight();

    const g = this.geodetic;
    if (!g || g.heightReference !== "terrain") {
      this.terrainHeight = undefined;
      return;
    }

    const pos = { lat: g.lat, lng: g.lng };
    this.terrainHeight = this.view.sampleTerrainHeight(pos) ?? 0;
    this.terrainUnsubscribe = this.view.observeTerrainHeightAt(
      pos,
      (height) => {
        if (this.terrainHeight === height) return;
        this.terrainHeight = height;
        if (!this.raw) return;
        this.reapplyGeodeticFrame();
        this.requestUpdate();
      },
    );
  }

  /**
   * Re-applies the effective transform after `geodetic`'s resolved frame
   * changes outside of `onUpdateConfig` — currently only a terrain-height
   * observation firing asynchronously. Subclasses that override
   * `applyTransform`'s effect with their own representation (e.g.
   * `GLTFModelDesc`'s RTE position/rotation split, which needs the *encoded*
   * position refreshed too) override this instead of relying on the default.
   */
  protected reapplyGeodeticFrame(): void {
    this.applyTransform();
  }

  private unsubscribeTerrainHeight(): void {
    this.terrainUnsubscribe?.();
    this.terrainUnsubscribe = undefined;
  }

  /**
   * Applies {@link lit} to every material under the mesh. Subclasses that
   * attach materials asynchronously (glTF) call it again once they exist.
   */
  protected applyLit(): void {
    const root = this.raw;
    if (!root) return;
    root.traverse((object) => {
      const material = (object as Partial<Mesh>).material;
      if (!material) return;
      if (Array.isArray(material)) {
        for (const m of material) applyLitOption(m, this.lit);
      } else {
        applyLitOption(material, this.lit);
      }
    });
  }

  /**
   * Determines which render scene the mesh is added to.
   * Override this to change the rendering pass for your mesh.
   *
   * @returns The pass key: `"opaque"` (default), `"transparent"`, `"mrt"`, or `"skyEnvMap"`.
   */
  protected getPassKey(): PassKey {
    return "opaque";
  }

  /**
   * The G-buffers this mesh's material samples, e.g. `globeNormal`. Must be
   * derivable from the config alone, since it is read before
   * {@link onCreate}. An override whose result changes after creation must
   * emit `gbufferRequirementsChanged` on the context, unless the change
   * comes with moving into or out of the draped pass.
   *
   * Defaults to `globeNormal` in the draped pass, where the render pass
   * shades a lit material with the terrain normal. A draped mesh with an
   * unlit material, or a lit one under `setDrapeGroundNormals(material,
   * false)`, can return `[]` to skip the globe-normal copy.
   */
  getRequiredBuffers(): readonly GBufferName[] {
    return this.getPassKey() === "draped" ? ["globeNormal"] : [];
  }

  /**
   * Factory method to create the Three.js 3D object.
   *
   * Override this to return your custom mesh. The returned object can be
   * either a Three.js `Object3D` directly (e.g. `Mesh`, `Group`, `Points`) or
   * a wrapper object with a `raw` property containing the `Object3D`.
   *
   * The base class calls this during {@link onCreate} and automatically
   * applies position, scale, rotation, and adds the object to the appropriate
   * scene. Picking is opt-in: if your layer supports it, construct a
   * {@link PickableMesh} here and register it yourself via
   * `this.ctx.registerPickableMesh(this.id, wrapper)` before returning.
   */
  abstract createMesh(): Instance;

  get raw() {
    if (!this._instance) return;

    if (this._instance instanceof Object3D) {
      return this._instance as Instance extends Object3D ? Instance : never;
    }
    if ("raw" in this._instance) {
      return this._instance.raw as Instance extends {
        raw: infer Raw extends Object3D;
      }
        ? Raw
        : never;
    }
    return;
  }

  onCreate() {
    this._instance = this.createMesh();
    invariant(this.raw);

    this.subscribeTerrainHeight();
    this.applyTransform();
    this.applyLit();

    this._instance.visible = this.visible;

    this.onPassKeyChange();
  }

  /**
   * Composes position, rotation, and scale into a local `T · R · S` matrix.
   * Returns identity when none are set.
   */
  protected composeLocalTransform(): Matrix4 {
    const local = new Matrix4();
    if (this.position) {
      local.multiply(
        new Matrix4().makeTranslation(
          this.position.x,
          this.position.y,
          this.position.z,
        ),
      );
    }
    if (this.rotation) {
      local.multiply(
        new Matrix4().makeRotationFromEuler(
          new Euler(this.rotation.x, this.rotation.y, this.rotation.z),
        ),
      );
    }
    if (this.scale) {
      local.scale(new Vector3(this.scale.x, this.scale.y, this.scale.z));
    }
    return local;
  }

  /**
   * The transform {@link applyTransform} gives the object, as one matrix:
   * `frame · T · R · S`, where the frame is `geodetic`, `matrixWorld` or
   * `matrix` and identity when none is set.
   */
  protected composeTransform(): Matrix4 {
    const frame = this.geodetic
      ? this.resolveGeodeticFrame(this.geodetic)
      : (this.matrixWorld ?? this.matrix);
    const local = this.composeLocalTransform();
    return frame ? new Matrix4().multiplyMatrices(frame, local) : local;
  }

  /**
   * Applies the configured transform to the underlying `Object3D`.
   *
   * When `matrixWorld` / `geodetic` (or `matrix`) is set together with any of
   * `position` / `rotation` / `scale`, the base/frame is left-multiplied
   * by the local `T · R · S`: e.g. `effective = matrixWorld · T · R · S`.
   * This lets callers pass a frame (such as an NUE-to-ECEF matrix) as
   * `matrixWorld` and express offsets inside that frame via
   * `position` / `rotation` / `scale`.
   *
   * The branches below are a priority chain, which is only safe because
   * `assertNoTransformConflict` has already rejected any state with more than
   * one of `geodetic` / `matrixWorld` / `matrix` set — so an earlier branch
   * can never shadow a configured field.
   */
  protected applyTransform(): void {
    invariant(this.raw);
    const hasLocal =
      this.position != null || this.rotation != null || this.scale != null;

    // `geodetic` takes the `matrixWorld` slot; the composition rule
    // `world · T · R · S` is identical either way.
    const worldMatrix = this.geodetic
      ? this.resolveGeodeticFrame(this.geodetic)
      : this.matrixWorld;

    if (worldMatrix) {
      this.raw.matrixAutoUpdate = false;
      this.raw.matrixWorldAutoUpdate = false;
      if (hasLocal) {
        this.raw.matrixWorld.multiplyMatrices(
          worldMatrix,
          this.composeLocalTransform(),
        );
      } else {
        this.raw.matrixWorld.copy(worldMatrix);
      }
      this.raw.updateMatrixWorld();
      return;
    }

    if (this.matrix) {
      this.raw.matrixAutoUpdate = false;
      if (hasLocal) {
        this.raw.matrix.multiplyMatrices(
          this.matrix,
          this.composeLocalTransform(),
        );
      } else {
        this.raw.matrix.copy(this.matrix);
      }
      return;
    }

    if (this.position) this.raw.position.copy(this.position);
    if (this.scale) this.raw.scale.copy(this.scale);
    if (this.rotation)
      this.raw.rotation.set(this.rotation.x, this.rotation.y, this.rotation.z);
  }

  removeFromScene(passKey: PassKey) {
    const scenes = this.ctx.scenes;

    if (scenes[passKey] && this.raw) {
      scenes[passKey].remove(this.raw);
    }
  }

  addToScene(passKey: PassKey) {
    if (!this.raw) return;

    const scenes = this.ctx.scenes;

    if (scenes[passKey]) {
      scenes[passKey].add(this.raw);
    }
  }

  onUpdateConfig(updates: UpdateConfig): void {
    // Validate the PROSPECTIVE transform state before mutating anything: a
    // throw has to leave the Descriptor exactly as it was. Assigning first
    // and checking after would brick the instance — the guard would then fire
    // on every later call, including unrelated ones like `{ visible }`, and
    // the `!== undefined` update convention can never reset a field back to
    // `undefined`, so there would be no way to recover.
    const nextGeodetic =
      updates.geodetic !== undefined
        ? mergeGeodetic(this.geodetic, updates.geodetic)
        : this.geodetic;
    const nextMatrix =
      updates.matrix !== undefined ? updates.matrix : this.matrix;
    const nextMatrixWorld =
      updates.matrixWorld !== undefined
        ? updates.matrixWorld
        : this.matrixWorld;
    assertNoTransformConflict(nextGeodetic, nextMatrix, nextMatrixWorld);

    super.onUpdateConfig(updates);

    const spatialChanged =
      updates.matrix !== undefined ||
      updates.matrixWorld !== undefined ||
      updates.geodetic !== undefined ||
      updates.position !== undefined ||
      updates.scale !== undefined ||
      updates.rotation !== undefined;

    if (updates.geodetic !== undefined) {
      const prevGeodetic = this.geodetic;
      this.geodetic = nextGeodetic;

      // Only these three change what we sample; heading/pitch/roll/scale
      // leave the sampled position and the reference untouched.
      const resubscribe =
        nextGeodetic?.lng !== prevGeodetic?.lng ||
        nextGeodetic?.lat !== prevGeodetic?.lat ||
        nextGeodetic?.heightReference !== prevGeodetic?.heightReference;
      if (resubscribe) {
        this.subscribeTerrainHeight();
      }
    }

    if (updates.matrix !== undefined) this.matrix = updates.matrix;
    if (updates.matrixWorld !== undefined)
      this.matrixWorld = updates.matrixWorld;
    if (updates.position !== undefined) this.position = updates.position;
    if (updates.scale !== undefined) this.scale = updates.scale;
    if (updates.rotation !== undefined) this.rotation = updates.rotation;

    // Key presence, not value: `!== undefined` could not express a reset.
    if ("lit" in updates) {
      this.lit = updates.lit;
      this.applyLit();
    }

    if (!this.raw) return;

    if (spatialChanged) {
      // With a frame present, the effective transform depends on the
      // combination of all stored fields — recompose the whole thing.
      // Without a frame, apply only the fields that were actually passed,
      // so subclasses that strip a field from `updates` (e.g. GLTFModelLayer
      // keeping `raw.position` at 0 for its RTE shader) can still opt out
      // of having the base class copy it onto `raw`.
      if (this.geodetic || this.matrixWorld || this.matrix) {
        this.applyTransform();
      } else {
        if (updates.position !== undefined) {
          this.raw.position.copy(updates.position);
        }
        if (updates.scale !== undefined) {
          this.raw.scale.copy(updates.scale);
        }
        if (updates.rotation !== undefined) {
          this.raw.rotation.set(
            updates.rotation.x,
            updates.rotation.y,
            updates.rotation.z,
          );
        }
      }
    }

    this.onPassKeyChange();
  }

  onPassKeyChange() {
    const nextPassKey = this.getPassKey();
    const prevPassKey = this.prevPassKey;
    if (prevPassKey === nextPassKey) return;
    if (prevPassKey) {
      this.removeFromScene(prevPassKey);
    }
    this.prevPassKey = nextPassKey;
    this.addToScene(nextPassKey);
    if (
      prevPassKey &&
      (prevPassKey === "draped") !== (nextPassKey === "draped")
    ) {
      this.ctx.emit("gbufferRequirementsChanged");
    }
  }

  onDestroy(): void {
    this.unsubscribeTerrainHeight();

    if (this.raw && this.raw.parent) {
      this.raw.parent.remove(this.raw);
    }

    super.onDestroy();
  }

  /**
   * Optional per-frame update callback.
   * Override this to animate the mesh (e.g. rotation, morph targets, shader uniforms).
   * @param time - High-resolution timestamp from the main render loop (same value passed
   *   to `requestAnimationFrame`), in milliseconds.
   */
  update?(time: number): void;

  /**
   * Optional callback when the viewport is resized.
   * Override this to adjust the mesh based on viewport dimensions.
   * @param width - New viewport width in pixels.
   * @param height - New viewport height in pixels.
   */
  onResize?(width: number, height: number): void;
}
