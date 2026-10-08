import type ThreeView from "@navaramap/three";
import {
  Color,
  MeshDesc,
  PickableMultiInstancedMeshWrapper,
  createReplacer,
  encodePositionRTE,
  setupRTEBeforeRender,
  RTE_ONE_UNIFORM,
  type MeshConfig,
  type MeshUpdate,
  type PassKey,
  type RTEUserData,
  type ViewContext,
  createGltfLoader,
} from "@navaramap/three";
import ProjectVertexRteModel from "@shaders/glsl/chunks/project_vertex_rte_model.glsl";
import RteUniformParsVertex from "@shaders/glsl/chunks/rte_uniform_pars_vertex.glsl";
import {
  AnimationAction,
  AnimationMixer,
  BufferGeometry,
  Cache,
  Color as ThreeColor,
  Euler,
  Group,
  InstancedMesh,
  LoopOnce,
  LoopRepeat,
  Material,
  Matrix4,
  Mesh,
  Object3D,
  Quaternion,
  ShaderChunk,
  SkinnedMesh,
  Texture,
  Vector3,
  type NormalBufferAttributes,
} from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import invariant from "tiny-invariant";

/**
 * Per-instance configuration for a single model instance.
 * Represents one full model; the transform is applied to every sub-mesh of that instance.
 */
export type ModelChildConfig = {
  position?: { x: number; y: number; z: number };
  rotation?: { x: number; y: number; z: number };
  scale?: { x: number; y: number; z: number };
  matrix?: Matrix4;
  /** Per-instance tint multiplied into the material color. */
  color?: Color;
};

export type InstancedModelsDescription = {
  url: string;
  castShadow?: boolean;
  receiveShadow?: boolean;

  /** Emissive color written to the MRT emissive slot (shared across all instances). */
  emissiveColor?: Color;
  /** Multiplier on the emissive color (default 0 = no emission). */
  emissiveIntensity?: number;

  /** Opacity of the material (0–1). */
  opacity?: number;
  /** Enable alpha blending when true. */
  transparent?: boolean;

  /** Animation clip name to play (shared across all instances). */
  animationActiveClip?: string;
  /** Playback speed (default 1). Shared across all instances. */
  animationSpeed?: number;
  /** Whether the clip loops (default true). */
  animationLoop?: boolean;
  /** Auto-start the configured clip on load (default false). */
  animationAutoPlay?: boolean;

  children?: ModelChildConfig[];
};

type Description = {
  gltfModels?: InstancedModelsDescription;
};

type DescriptionUpdate = {
  gltfModels?: Partial<InstancedModelsDescription>;
};

export type InstancedGltfModelMeshConfig = MeshConfig &
  Description & { pickable?: boolean };

export type InstancedGltfModelMeshUpdate = MeshUpdate & DescriptionUpdate;

export type InstancedGltfModelEvent = {
  load: () => void;
  error: (error: unknown) => void;
  needsUpdate: () => void;
};

const DEFAULT_CAPACITY = 64;
const GROWTH_FACTOR = 2;

const TEXTURE_SLOTS = [
  "map",
  "normalMap",
  "metalnessMap",
  "roughnessMap",
  "emissiveMap",
  "aoMap",
] as const;

function hasMissingTextureData(gltf: GLTF): boolean {
  let missing = false;
  gltf.scene.traverse((o) => {
    if (missing) return;
    const mats = (o as Mesh).material;
    if (!mats) return;
    const list = Array.isArray(mats) ? mats : [mats];
    for (const mat of list) {
      const slots = mat as unknown as Record<
        string,
        Texture | null | undefined
      >;
      for (const slot of TEXTURE_SLOTS) {
        const tex = slots[slot];
        if (tex && tex.source && tex.source.data == null) {
          missing = true;
          return;
        }
      }
    }
  });
  return missing;
}

const _position = new Vector3();
const _quaternion = new Quaternion();
const _scale = new Vector3();
const _euler = new Euler();
const _T = new Matrix4();
const _composed = new Matrix4();
const _tempColor = new ThreeColor();

/**
 * An animation "slot" — one mixer, its cached actions, and the currently
 * playing one. Non-skinned path has a single slot driving the source scene;
 * skinned path has one slot per cloned instance.
 */
type Anim = {
  mixer: AnimationMixer;
  actions: Map<string, AnimationAction>;
  currentAction: AnimationAction | null;
};

/**
 * Instanced GLTF model descriptor.
 *
 * Loads a GLTF once, then fans out every `Mesh` node into a sibling
 * `InstancedMesh` sharing one per-instance matrix slot per model instance.
 *
 * Two internal paths are selected based on the model contents:
 *
 * - **Non-skinned path (instanced):** every `Mesh` node becomes an
 *   `InstancedMesh`. All instances share one `AnimationMixer` running on the
 *   source scene; per-frame, we re-sample each source mesh's `matrixWorld` and
 *   rewrite every instance's matrix as `T_i * sourceLocal_s`. Node-TRS and
 *   morph-target animations both play back correctly.
 * - **Skinned path (per-instance clone fallback):** because three.js's core
 *   `InstancedMesh` cannot apply skinning, skinned GLTFs fall back to one
 *   `SkeletonUtils.clone` per instance, each with its own `AnimationMixer`.
 *   This gives up instanced rendering for the skinned parts, but keeps the
 *   same desc API and plays shared clips in lockstep across clones.
 *
 * Limitations:
 * - Skinned-path picking is currently unsupported (`batchIds` is empty).
 */
export class InstancedGltfModelMeshDesc extends MeshDesc<
  InstancedGltfModelMeshConfig,
  InstancedGltfModelMeshUpdate,
  Group,
  InstancedGltfModelEvent
> {
  private config: InstancedGltfModelMeshConfig;
  private loader = createGltfLoader();
  private gltf: GLTF | null = null;

  // Non-skinned (instanced) path
  private subMeshes: {
    inst: InstancedMesh;
    sourceMesh: Mesh;
    sourceLocal: Matrix4;
  }[] = [];
  private capacity = 0;

  // Skinned fallback path: one cloned scene per instance, parallel to `anims`.
  private hasSkinned = false;
  private skinnedScenes: Object3D[] = [];

  // Animation slots. Non-skinned: 0 or 1 entry driving gltf.scene.
  // Skinned: one per cloned instance, parallel to `skinnedScenes`.
  private anims: Anim[] = [];

  // Shared
  private configs: ModelChildConfig[] = [];
  private lastUpdateTime?: number;

  private pickWrapper?: PickableMultiInstancedMeshWrapper;

  // RTE (Relative-To-Eye) state
  // `raw.matrixWorld` is decomposed into an anchor translation (encoded into
  // rtePosHigh/rtePosLow uniforms) and a residual rotation+scale kept on
  // `raw.matrixWorld` with translation zeroed. All materials used by sub-
  // meshes or skinned clones get patched with RTE shader chunks; one shared
  // onBeforeRender updates `modelViewMatrixRTE` and camera high/low per frame.
  private rteAnchor = new Vector3();
  private rtePosHigh = new Vector3();
  private rtePosLow = new Vector3();
  private rteUserData: RTEUserData = {
    modelViewMatrixRTE: { value: new Matrix4() },
    cameraPositionHigh: { value: new Vector3() },
    cameraPositionLow: { value: new Vector3() },
  };
  private rtePatchedMaterials = new WeakSet<Material>();

  constructor(
    view: ThreeView,
    ctx: ViewContext,
    config: InstancedGltfModelMeshConfig,
  ) {
    super(view, ctx, config);
    this.config = config;
  }

  get batchIds(): readonly number[] {
    return this.pickWrapper?.batchIds ?? [];
  }

  get count(): number {
    return this.configs.length;
  }

  /** Names of animation clips found in the GLTF. Available after `load`. */
  get animationClips(): readonly string[] {
    return this.gltf ? this.gltf.animations.map((c) => c.name) : [];
  }

  createMesh(): Group {
    const root = new Group();
    const cfg = this.config.gltfModels;

    if (cfg?.url) {
      this.loadModel(cfg.url, root).catch((err) => {
        console.error("Failed to load instanced GLTF model:", err);
        this.emit("error", err);
      });
    }
    return root;
  }

  /**
   * Render into the MRT G-buffer rather than the plain opaque pass, so the
   * instances contribute their normal/depth to deferred lighting (aerial
   * perspective, irradiance). The opaque pass writes only color into a
   * single-attachment target, which would leave the models wearing the
   * terrain's G-buffer normal. (Matches the descriptor's pre-revert default.)
   */
  protected override getPassKey(): PassKey {
    return "mrt";
  }

  override onCreate(): void {
    super.onCreate();
    // MeshDesc.applyTransform has just populated `raw.matrixWorld` from the
    // user-supplied `matrixWorld` (and any local TRS). Decompose it so the
    // anchor translation lives in RTE uniforms instead of the world matrix.
    this.captureAnchorFromMatrixWorld();
  }

  /**
   * Pulls the translation out of `raw.matrixWorld` into RTE uniforms, and
   * rebuilds `raw.matrixWorld` with rotation+scale only. Safe to call again
   * after the user updates `matrixWorld`.
   */
  private captureAnchorFromMatrixWorld(): void {
    if (!this.raw) return;

    // `MeshDesc.applyTransform` only writes `raw.matrixWorld` directly when
    // the descriptor's `matrixWorld` (or `geodetic`, which resolves to a
    // world frame the same way — see `MeshDesc.applyTransform`) is set. For
    // the `matrix`-only and local-TRS paths it leaves matrixWorld stale, so
    // decomposing it would pull an identity anchor on the first capture.
    // Also, after our first capture we disable
    // `matrixAutoUpdate`/`matrixWorldAutoUpdate` below, so we can't rely on
    // three.js to recompute matrixWorld on subsequent captures either —
    // refresh it explicitly from the authoritative source.
    if (this.matrixWorld || this.geodetic) {
      // applyTransform already populated raw.matrixWorld.
    } else if (this.matrix) {
      // applyTransform already populated raw.matrix (including any local TRS).
      this.raw.matrixWorld.copy(this.raw.matrix);
    } else {
      // Local-TRS only: applyTransform set raw.position/quaternion/scale.
      this.raw.matrix.compose(
        this.raw.position,
        this.raw.quaternion,
        this.raw.scale,
      );
      this.raw.matrixWorld.copy(this.raw.matrix);
    }

    const q = new Quaternion();
    const s = new Vector3();
    const p = new Vector3();
    this.raw.matrixWorld.decompose(p, q, s);

    this.rteAnchor.copy(p);
    encodePositionRTE(this.rteAnchor, this.rtePosHigh, this.rtePosLow);

    // Rebuild matrixWorld with translation zeroed so the shader sees a
    // modelMatrix that only carries rotation+scale. The residual rotation+
    // scale still matters for orienting the whole group (e.g. NUE frame).
    this.raw.matrixAutoUpdate = false;
    this.raw.matrixWorldAutoUpdate = false;
    this.raw.matrixWorld.compose(new Vector3(0, 0, 0), q, s);
    this.raw.position.set(0, 0, 0);
    this.raw.quaternion.copy(q);
    this.raw.scale.copy(s);
  }

  /**
   * A terrain-height observation (under `geodetic` + `heightReference:
   * "terrain"`) must redo the RTE anchor capture, not just the base class's
   * direct `matrixWorld` write — the rtePosHigh/rtePosLow uniforms would
   * otherwise go stale while `matrixWorld` moved out from under them.
   */
  protected override reapplyGeodeticFrame(): void {
    super.reapplyGeodeticFrame();
    this.captureAnchorFromMatrixWorld();
  }

  /**
   * Inject RTE shader chunks into a material. The chunk branches on
   * `USE_INSTANCING` internally, so the same patch works for both
   * `InstancedMesh` sub-meshes (non-skinned path) and `SkeletonUtils.clone`
   * fallback meshes (skinned path).
   */
  private modifyMaterialForRTE(material: Material): void {
    if (this.rtePatchedMaterials.has(material)) return;

    const prevOnBeforeCompile = material.onBeforeCompile;
    const prevCacheKey = material.customProgramCacheKey?.bind(material);

    material.onBeforeCompile = (shader, renderer) => {
      prevOnBeforeCompile?.call(material, shader, renderer);

      shader.uniforms.u_cameraPositionHigh = this.rteUserData
        .cameraPositionHigh ?? { value: new Vector3() };
      shader.uniforms.u_cameraPositionLow = this.rteUserData
        .cameraPositionLow ?? { value: new Vector3() };
      shader.uniforms.rtePosHigh = { value: this.rtePosHigh };
      shader.uniforms.rtePosLow = { value: this.rtePosLow };
      shader.uniforms.modelViewMatrixRTE = this.rteUserData
        .modelViewMatrixRTE ?? { value: new Matrix4() };
      shader.uniforms.u_rteOne = RTE_ONE_UNIFORM;

      shader.vertexShader = createReplacer(shader.vertexShader)
        .replace(
          "#include <common>",
          `
          #include <common>
          ${RteUniformParsVertex}
          `,
        )
        .replace("#include <project_vertex>", ProjectVertexRteModel)
        .replace(
          "#include <worldpos_vertex>",
          createReplacer(ShaderChunk.worldpos_vertex)
            .replace(
              "vec4 worldPosition = vec4( transformed, 1.0 );",
              "vec4 worldPosition = vec4( absTransformed, 1.0 );",
            )
            .replace("worldPosition = modelMatrix * worldPosition;", "").source,
        ).source;
    };
    material.customProgramCacheKey = () =>
      (prevCacheKey?.() ?? "") + "_nvr_rte_gltf";
    material.needsUpdate = true;

    this.rtePatchedMaterials.add(material);
  }

  /** Patch every material reachable from a scene graph for RTE + shadows. */
  private patchMaterials(root: Object3D): void {
    root.traverse((o) => {
      const m = (o as Mesh).material as Material | Material[] | undefined;
      if (!m) return;
      const mats = Array.isArray(m) ? m : [m];
      for (const mat of mats) {
        this.ctx.applyShadowMaterial(mat);
        this.modifyMaterialForRTE(mat);
      }
    });
  }

  /**
   * Apply the shared material overrides (`emissiveColor` / `emissiveIntensity` /
   * `opacity` / `transparent`) from the config to every material reachable from
   * `root`. Loaded GLTF materials expose a standard `emissive` color, which
   * feeds the emissive MRT slot the same way the non-instanced meshes do.
   */
  private applyMaterialOverrides(root: Object3D | null | undefined): void {
    if (!root) return;
    const cfg = this.config.gltfModels;
    if (
      cfg?.emissiveColor === undefined &&
      cfg?.emissiveIntensity === undefined &&
      cfg?.opacity === undefined &&
      cfg?.transparent === undefined
    ) {
      return;
    }
    root.traverse((o) => {
      const m = (o as Mesh).material as Material | Material[] | undefined;
      if (!m) return;
      const mats = Array.isArray(m) ? m : [m];
      for (const mat of mats) {
        const target = mat as Material & {
          emissive?: ThreeColor;
          emissiveIntensity?: number;
        };
        if (target.emissive) {
          if (cfg.emissiveColor !== undefined) {
            target.emissive.set(cfg.emissiveColor.raw);
          }
          if (cfg.emissiveIntensity !== undefined) {
            target.emissiveIntensity = cfg.emissiveIntensity;
          }
        }
        if (cfg.opacity !== undefined) mat.opacity = cfg.opacity;
        if (cfg.transparent !== undefined) {
          mat.transparent = cfg.transparent;
          mat.needsUpdate = true;
        }
      }
    });
  }

  /**
   * Install the per-frame RTE callback on a mesh. The callback writes shared
   * uniforms (same values regardless of which mesh drives it), so we install
   * on every mesh that might be rendered — that way the uniforms stay live
   * even when individual meshes/clones are removed via removeAt/clear/grow.
   *
   * The shadow pass is handled separately by {@link setupShadowDepth}, which
   * the caller must install on every shadow-casting mesh (not just the RTE
   * callback host): the built-in depth material carries no RTE shader chunks,
   * and `modelViewMatrix` is per-mesh, so the RTE uniforms alone would draw the
   * shadow at the translation-stripped origin.
   */
  private installRTECallback(mesh: Mesh | InstancedMesh): void {
    const cb = setupRTEBeforeRender(mesh, this.rteUserData, new Matrix4());
    if (cb) {
      mesh.onBeforeRender = cb;
    }
  }

  /**
   * Make the shadow/depth pass draw the mesh at its true ECEF position. That
   * pass uses three.js' built-in depth material, which has no RTE shader
   * chunks, so we restore the full translation on the CPU: rebuild the world
   * matrix with `rteAnchor` added back and write `shadowCamera.matrixWorldInverse
   * × fullMatrix` straight into `modelViewMatrix`. The product is formed in JS
   * f64 and only the small, view-relative result is uploaded as f32, so no
   * precision is lost. For an `InstancedMesh` the GPU applies each
   * `instanceMatrix` on top of this shared base.
   */
  private setupShadowDepth(mesh: Mesh | InstancedMesh): void {
    const stripped = new Vector3();
    const fullMatrix = new Matrix4();
    mesh.onBeforeShadow = (
      _renderer: unknown,
      _scene: unknown,
      _camera: unknown,
      shadowCamera: { matrixWorldInverse: Matrix4 },
    ) => {
      if (!mesh.castShadow) return;
      stripped.setFromMatrixPosition(mesh.matrixWorld);
      fullMatrix.copy(mesh.matrixWorld);
      fullMatrix.setPosition(
        this.rteAnchor.x + stripped.x,
        this.rteAnchor.y + stripped.y,
        this.rteAnchor.z + stripped.z,
      );
      mesh.modelViewMatrix.multiplyMatrices(
        shadowCamera.matrixWorldInverse,
        fullMatrix,
      );
    };
  }

  private async loadModel(url: string, root: Group): Promise<void> {
    let gltf = await this.loader.loadAsync(url);
    // three.js's `ImageBitmapLoader` caches the in-flight fetch promise but its
    // terminal `.then` does not return the resolved bitmap (three r184,
    // src/loaders/ImageBitmapLoader.js line 181). When a second
    // `GLTFLoader.loadAsync` for the same URL subscribes to that cached
    // promise, its callback receives `undefined`, so the resulting textures
    // have `source.data === null` and render solid black. Detect that and
    // reload with `three.Cache` briefly off — by then the first load has
    // populated its real bitmaps, so the retry isn't racing anyone.
    if (hasMissingTextureData(gltf)) {
      const wasEnabled = Cache.enabled;
      Cache.enabled = false;
      try {
        gltf = await this.loader.loadAsync(url);
      } finally {
        Cache.enabled = wasEnabled;
      }
    }
    this.gltf = gltf;

    // Detect skinned meshes — if any, we fall back to per-instance clones
    gltf.scene.traverse((c) => {
      if (c instanceof SkinnedMesh) this.hasSkinned = true;
    });

    gltf.scene.updateMatrixWorld(true);

    const initialConfigs = this.config.gltfModels?.children ?? [];

    if (this.hasSkinned) {
      this.initSkinnedPath(root, initialConfigs);
    } else {
      this.initInstancedPath(root, initialConfigs);
    }

    this.configs = [...initialConfigs];

    this.applyMaterialOverrides(root);

    const cfg = this.config.gltfModels;
    if (cfg?.animationAutoPlay && cfg.animationActiveClip) {
      this.playAnimation(cfg.animationActiveClip);
    }

    this.emit("needsUpdate");
    this.emit("load");
  }

  // ---------- Animation (shared) ----------

  /** Build an Anim slot whose mixer drives `target`. */
  private createAnim(target: Object3D): Anim {
    invariant(this.gltf, "GLTF must be loaded before createAnim");
    const cfg = this.config.gltfModels;
    const speed = cfg?.animationSpeed ?? 1;
    const loop = cfg?.animationLoop ?? true;

    const mixer = new AnimationMixer(target);
    const actions = new Map<string, AnimationAction>();
    for (const clip of this.gltf.animations) {
      const action = mixer.clipAction(clip);
      action.setLoop(loop ? LoopRepeat : LoopOnce, Infinity);
      action.setEffectiveTimeScale(speed);
      action.setEffectiveWeight(0);
      action.enabled = true;
      actions.set(clip.name, action);
    }
    return { mixer, actions, currentAction: null };
  }

  private playOn(anim: Anim, name: string): void {
    const action = anim.actions.get(name);
    if (!action) return;
    if (anim.currentAction && anim.currentAction !== action) {
      anim.currentAction.stop();
    }
    action.reset();
    action.setEffectiveWeight(1);
    action.play();
    anim.currentAction = action;
  }

  private stopOn(anim: Anim): void {
    if (anim.currentAction) {
      anim.currentAction.stop();
      anim.currentAction = null;
    }
  }

  playAnimation(name: string): void {
    if (this.anims.length === 0) return;
    if (!this.hasSkinned && !this.anims[0].actions.has(name)) {
      console.warn(`Animation "${name}" not found`);
      return;
    }
    for (const a of this.anims) this.playOn(a, name);
  }

  stopAnimation(): void {
    for (const a of this.anims) this.stopOn(a);
  }

  // ---------- Non-skinned (instanced) path ----------

  private initInstancedPath(
    root: Group,
    initialConfigs: ModelChildConfig[],
  ): void {
    invariant(this.gltf, "GLTF must be loaded before initInstancedPath");
    const gltf = this.gltf;
    this.capacity = Math.max(initialConfigs.length, DEFAULT_CAPACITY);
    const modelCfg = this.config.gltfModels;

    // Walk scene, spin up one InstancedMesh per source Mesh node
    gltf.scene.traverse((node) => {
      if (!(node instanceof Mesh)) return;
      const sourceMesh = node as Mesh<BufferGeometry<NormalBufferAttributes>>;

      const sourceLocal = sourceMesh.matrixWorld.clone();

      const material = sourceMesh.material as Material | Material[];
      const inst = new InstancedMesh(
        sourceMesh.geometry,
        material,
        this.capacity,
      );
      inst.count = initialConfigs.length;
      inst.frustumCulled = false;
      inst.castShadow = modelCfg?.castShadow ?? false;
      inst.receiveShadow = modelCfg?.receiveShadow ?? false;

      const mats = Array.isArray(material) ? material : [material];
      for (const m of mats) {
        this.ctx.applyShadowMaterial(m);
        this.modifyMaterialForRTE(m);
      }

      root.add(inst);
      this.subMeshes.push({ inst, sourceMesh, sourceLocal });
      this.installRTECallback(inst);
      this.setupShadowDepth(inst);
    });

    for (let i = 0; i < initialConfigs.length; i++) {
      this.writeInstanceAt(i, initialConfigs[i]);
    }
    this.markAllInstancesDirty();

    if (gltf.animations.length > 0) {
      this.anims.push(this.createAnim(gltf.scene));
    }

    if (this.config.pickable) {
      const meshes = this.subMeshes.map((s) => s.inst);
      this.pickWrapper = new PickableMultiInstancedMeshWrapper(
        root,
        meshes,
        initialConfigs.length,
        this.ctx,
      );
      this.ctx.registerPickableMesh(this.id, this.pickWrapper);
    }
  }

  private composeInstanceTransform(
    config: ModelChildConfig,
    out: Matrix4,
  ): void {
    if (config.matrix) {
      out.copy(config.matrix);
      return;
    }
    const pos = config.position;
    _position.set(pos?.x ?? 0, pos?.y ?? 0, pos?.z ?? 0);

    const rot = config.rotation;
    if (rot) {
      _euler.set(rot.x, rot.y, rot.z);
      _quaternion.setFromEuler(_euler);
    } else {
      _quaternion.identity();
    }

    const s = config.scale;
    _scale.set(s?.x ?? 1, s?.y ?? 1, s?.z ?? 1);

    out.compose(_position, _quaternion, _scale);
  }

  /** Apply a ModelChildConfig to an Object3D via compose/decompose. */
  private applyTransformToObject(
    obj: Object3D,
    config: ModelChildConfig,
  ): void {
    this.composeInstanceTransform(config, _T);
    _T.decompose(obj.position, obj.quaternion, obj.scale);
  }

  /** Write instance slot `i` into every sub-mesh as `T_i * sourceLocal_s`. */
  private writeInstanceAt(i: number, config: ModelChildConfig): void {
    this.composeInstanceTransform(config, _T);
    for (const { inst, sourceLocal } of this.subMeshes) {
      _composed.multiplyMatrices(_T, sourceLocal);
      inst.setMatrixAt(i, _composed);
    }
    this.writeColorAt(i, config);
  }

  /**
   * Set per-instance tint on every sub-mesh. Three.js's `setColorAt` lazily
   * allocates `instanceColor` (filled white) on first call, so omitting color
   * stays free until at least one instance opts in. Once `instanceColor`
   * exists, an unset color resets the slot to white so stale colors from a
   * prior occupant (after swap-with-last removal or replaceAll) don't leak.
   */
  private writeColorAt(i: number, config: ModelChildConfig): void {
    if (config.color) {
      _tempColor.set(config.color.raw);
    } else {
      _tempColor.setRGB(1, 1, 1);
    }
    for (const { inst } of this.subMeshes) {
      if (!config.color && !inst.instanceColor) continue;
      inst.setColorAt(i, _tempColor);
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    }
  }

  /**
   * Rewrite every instance's matrix for every sub-mesh using the
   * current per-frame `sourceMesh.matrixWorld` instead of the baked local.
   * Only needed when the mixer actually moves node TRS.
   */
  private resampleAndRewriteAll(): void {
    for (const { inst, sourceMesh } of this.subMeshes) {
      for (let i = 0; i < this.configs.length; i++) {
        this.composeInstanceTransform(this.configs[i], _T);
        _composed.multiplyMatrices(_T, sourceMesh.matrixWorld);
        inst.setMatrixAt(i, _composed);
      }
      inst.instanceMatrix.needsUpdate = true;
    }
  }

  private markAllInstancesDirty(): void {
    for (const { inst } of this.subMeshes) {
      inst.instanceMatrix.needsUpdate = true;
    }
  }

  // ---------- Skinned fallback path ----------

  private initSkinnedPath(
    root: Group,
    initialConfigs: ModelChildConfig[],
  ): void {
    invariant(this.gltf, "GLTF must be loaded before initSkinnedPath");
    // SkeletonUtils.clone shares materials — patch the source scene once.
    this.patchMaterials(this.gltf.scene);

    for (const cfg of initialConfigs) {
      this.addSkinnedInstance(root, cfg);
    }

    if (this.config.pickable) {
      console.warn(
        "InstancedGltfModelMeshDesc: picking is not supported for skinned GLTFs (fallback clone path).",
      );
    }
  }

  private addSkinnedInstance(root: Group, config: ModelChildConfig): void {
    invariant(this.gltf, "GLTF must be loaded before addSkinnedInstance");
    const scene = cloneSkinned(this.gltf.scene);
    this.applyTransformToObject(scene, config);

    const modelCfg = this.config.gltfModels;
    let callbackHost: Mesh | SkinnedMesh | null = null;
    scene.traverse((o) => {
      if (o instanceof Mesh || o instanceof SkinnedMesh) {
        o.castShadow = modelCfg?.castShadow ?? false;
        o.receiveShadow = modelCfg?.receiveShadow ?? false;
        // RTE re-projects vertices in the shader, so the CPU-side bounding
        // sphere transformed by matrixWorld doesn't match rendered position.
        // Disable frustum culling to avoid false-positive culls.
        o.frustumCulled = false;
        // The shadow depth override is per-mesh, so it must run on every mesh
        // of the clone — not only the RTE callback host below.
        this.setupShadowDepth(o);
        if (!callbackHost) callbackHost = o;
      }
    });
    // Install the RTE callback once per clone. If this clone gets removed,
    // remaining clones' callbacks still keep the shared uniforms live.
    if (callbackHost) this.installRTECallback(callbackHost);

    root.add(scene);
    this.skinnedScenes.push(scene);
    this.anims.push(this.createAnim(scene));
  }

  // ---------- Public instance API ----------

  /** Add a new instance. Returns its index. */
  add(config: ModelChildConfig): number {
    if (this.hasSkinned) {
      const root = this.raw;
      invariant(root, "Must be created before add()");
      this.addSkinnedInstance(root, config);
      this.configs.push(config);

      const activeClip = this.config.gltfModels?.animationActiveClip;
      if (activeClip) {
        this.playOn(this.anims[this.anims.length - 1], activeClip);
      }

      this.emit("needsUpdate");
      return this.configs.length - 1;
    }

    if (this.configs.length >= this.capacity) this.grow();
    const index = this.configs.length;
    this.configs.push(config);
    for (const { inst } of this.subMeshes) inst.count = this.configs.length;
    this.writeInstanceAt(index, config);
    this.markAllInstancesDirty();
    this.pickWrapper?.addInstance();
    this.emit("needsUpdate");
    return index;
  }

  removeAt(index: number): void {
    if (index < 0 || index >= this.configs.length) {
      throw new Error(`Index ${index} out of bounds`);
    }

    if (this.hasSkinned) {
      this.anims[index].mixer.stopAllAction();
      this.raw?.remove(this.skinnedScenes[index]);

      const last = this.configs.length - 1;
      if (index !== last) {
        this.anims[index] = this.anims[last];
        this.skinnedScenes[index] = this.skinnedScenes[last];
        this.configs[index] = this.configs[last];
      }
      this.anims.pop();
      this.skinnedScenes.pop();
      this.configs.pop();
      this.emit("needsUpdate");
      return;
    }

    const last = this.configs.length - 1;
    if (index !== last) {
      this.configs[index] = this.configs[last];
      this.writeInstanceAt(index, this.configs[index]);
    }
    this.configs.pop();
    for (const { inst } of this.subMeshes) inst.count = this.configs.length;
    this.markAllInstancesDirty();
    this.pickWrapper?.removeInstanceAt(index);
    this.emit("needsUpdate");
  }

  updateAt(index: number, config: Partial<ModelChildConfig>): void {
    if (index < 0 || index >= this.configs.length) {
      throw new Error(`Index ${index} out of bounds`);
    }
    const merged = { ...this.configs[index], ...config };
    this.configs[index] = merged;

    if (this.hasSkinned) {
      this.applyTransformToObject(this.skinnedScenes[index], merged);
    } else {
      this.writeInstanceAt(index, merged);
      this.markAllInstancesDirty();
    }
    this.emit("needsUpdate");
  }

  clear(): void {
    if (this.hasSkinned) {
      for (let i = 0; i < this.anims.length; i++) {
        this.anims[i].mixer.stopAllAction();
        this.raw?.remove(this.skinnedScenes[i]);
      }
      this.anims = [];
      this.skinnedScenes = [];
      this.configs = [];
      this.emit("needsUpdate");
      return;
    }

    this.configs = [];
    for (const { inst } of this.subMeshes) {
      inst.count = 0;
      inst.instanceMatrix.needsUpdate = true;
    }
    this.pickWrapper?.clearInstances();
    this.emit("needsUpdate");
  }

  replaceAll(configs: ModelChildConfig[]): void {
    if (this.hasSkinned) {
      this.clear();
      const root = this.raw;
      invariant(root, "Must be created before replaceAll()");
      for (const c of configs) this.addSkinnedInstance(root, c);
      this.configs = [...configs];

      const activeClip = this.config.gltfModels?.animationActiveClip;
      if (activeClip) this.playAnimation(activeClip);
      this.emit("needsUpdate");
      return;
    }

    while (configs.length > this.capacity) this.grow();
    this.configs = [...configs];
    for (const { inst } of this.subMeshes) inst.count = configs.length;
    for (let i = 0; i < configs.length; i++)
      this.writeInstanceAt(i, configs[i]);
    this.markAllInstancesDirty();
    this.pickWrapper?.replaceAll(configs.length);
    this.emit("needsUpdate");
  }

  private grow(): void {
    const newCapacity = Math.max(
      this.capacity * GROWTH_FACTOR,
      DEFAULT_CAPACITY,
    );
    const oldCount = this.configs.length;
    const root = this.raw;
    invariant(root, "Must be created before growing");

    const newSubs: typeof this.subMeshes = [];
    for (const { inst, sourceMesh, sourceLocal } of this.subMeshes) {
      const newInst = new InstancedMesh(
        inst.geometry,
        inst.material,
        newCapacity,
      );
      newInst.count = oldCount;
      newInst.frustumCulled = false;
      newInst.castShadow = inst.castShadow;
      newInst.receiveShadow = inst.receiveShadow;

      const m = new Matrix4();
      for (let i = 0; i < oldCount; i++) {
        inst.getMatrixAt(i, m);
        newInst.setMatrixAt(i, m);
      }
      newInst.instanceMatrix.needsUpdate = true;

      if (inst.instanceColor) {
        for (let i = 0; i < oldCount; i++) {
          inst.getColorAt(i, _tempColor);
          newInst.setColorAt(i, _tempColor);
        }
        if (newInst.instanceColor) newInst.instanceColor.needsUpdate = true;
      }

      root.remove(inst);
      root.add(newInst);
      inst.dispose();

      // The old inst held the onBeforeRender/onBeforeShadow closures; transfer
      // them to its replacement so RTE uniforms keep updating per frame and the
      // shadow pass keeps drawing at the true ECEF position.
      this.installRTECallback(newInst);
      this.setupShadowDepth(newInst);

      newSubs.push({ inst: newInst, sourceMesh, sourceLocal });
    }
    this.subMeshes = newSubs;
    this.capacity = newCapacity;

    this.pickWrapper?.syncMeshes(this.subMeshes.map((s) => s.inst));
  }

  /** Copy morph-target influences from each source mesh to its sub-InstancedMesh. */
  private syncMorphTargets(): void {
    for (const { inst, sourceMesh } of this.subMeshes) {
      if (sourceMesh.morphTargetInfluences) {
        inst.morphTargetInfluences = sourceMesh.morphTargetInfluences;
        inst.morphTargetDictionary = sourceMesh.morphTargetDictionary;
      }
    }
  }

  update(time: number): void {
    if (this.lastUpdateTime === undefined) {
      this.lastUpdateTime = time;
      return;
    }
    const delta = (time - this.lastUpdateTime) / 1000;
    this.lastUpdateTime = time;

    if (this.anims.length === 0) return;

    // Only step mixers and force renders when an action is actually playing.
    // A loaded-but-idle GLTF (clips present, currentAction null) would
    // otherwise keep the render loop running every frame.
    const active = this.anims.some((a) => a.currentAction);
    if (!active) return;

    for (const a of this.anims) a.mixer.update(delta);

    if (!this.hasSkinned) {
      this.gltf?.scene.updateMatrixWorld(true);
      this.resampleAndRewriteAll();
      this.syncMorphTargets();
    }

    this.emit("needsUpdate");
  }

  onUpdateConfig(updates: InstancedGltfModelMeshUpdate): void {
    if (updates.gltfModels !== undefined) {
      const u = updates.gltfModels;

      if (u.castShadow !== undefined || u.receiveShadow !== undefined) {
        if (this.hasSkinned) {
          for (const scene of this.skinnedScenes) {
            scene.traverse((o) => {
              if (o instanceof Mesh || o instanceof SkinnedMesh) {
                if (u.castShadow !== undefined) o.castShadow = u.castShadow;
                if (u.receiveShadow !== undefined)
                  o.receiveShadow = u.receiveShadow;
              }
            });
          }
        } else {
          for (const { inst } of this.subMeshes) {
            if (u.castShadow !== undefined) inst.castShadow = u.castShadow;
            if (u.receiveShadow !== undefined)
              inst.receiveShadow = u.receiveShadow;
          }
        }
      }

      if (u.animationSpeed !== undefined) {
        for (const anim of this.anims) {
          for (const a of anim.actions.values())
            a.setEffectiveTimeScale(u.animationSpeed);
        }
      }
      if (u.animationLoop !== undefined) {
        const mode = u.animationLoop ? LoopRepeat : LoopOnce;
        for (const anim of this.anims) {
          for (const a of anim.actions.values()) a.setLoop(mode, Infinity);
        }
      }
      if (u.animationActiveClip !== undefined) {
        this.playAnimation(u.animationActiveClip);
      }

      if (u.children !== undefined) {
        this.replaceAll(u.children);
      }

      this.config.gltfModels = {
        ...this.config.gltfModels,
        ...u,
      } as InstancedModelsDescription;

      if (
        u.emissiveColor !== undefined ||
        u.emissiveIntensity !== undefined ||
        u.opacity !== undefined ||
        u.transparent !== undefined
      ) {
        this.applyMaterialOverrides(this.raw);
      }
    }

    const spatialChanged =
      updates.matrix !== undefined ||
      updates.matrixWorld !== undefined ||
      updates.geodetic !== undefined ||
      updates.position !== undefined ||
      updates.scale !== undefined ||
      updates.rotation !== undefined;

    super.onUpdateConfig(updates);

    if (spatialChanged) {
      // Re-extract anchor from the freshly-applied raw.matrixWorld
      this.captureAnchorFromMatrixWorld();
    }
  }

  override onDestroy(): void {
    if (this.pickWrapper) {
      this.ctx.unregisterPickableMesh(this.id);
      this.pickWrapper = undefined;
    }

    for (const anim of this.anims) {
      anim.mixer.stopAllAction();
      anim.actions.clear();
    }
    this.anims = [];
    this.skinnedScenes = [];

    for (const { inst } of this.subMeshes) {
      const mats = Array.isArray(inst.material)
        ? inst.material
        : [inst.material];
      for (const m of mats) this.ctx.removeShadowMaterial(m as Material);
    }

    if (this.raw) {
      this.raw.traverse((o) => {
        if (o instanceof InstancedMesh) {
          o.geometry.dispose();
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) (m as Material).dispose();
          o.dispose();
        }
      });
    }

    if (this.hasSkinned && this.gltf) {
      // SkeletonUtils.clone shares geometries and materials with the source
      // gltf.scene, so dispose them from the source once — disposing on each
      // clone would double-dispose. removeShadowMaterial mirrors the one-time
      // registration done by patchMaterials on the source scene.
      this.gltf.scene.traverse((o) => {
        const mesh = o as Mesh;
        const m = mesh.material as Material | Material[] | undefined;
        if (m) {
          const mats = Array.isArray(m) ? m : [m];
          for (const mat of mats) {
            this.ctx.removeShadowMaterial(mat);
            mat.dispose();
          }
        }
        mesh.geometry?.dispose();
      });
    }

    this.subMeshes = [];
    this.configs = [];

    super.onDestroy();
  }
}
