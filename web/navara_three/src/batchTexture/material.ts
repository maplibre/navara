import type { Material, WebGLRenderer } from "three";

import { BatchTextureLayout, MAX_BATCH_TEXTURE_WIDTH } from "./layout";
import type {
  BatchScalarKey,
  BatchScalarSlotKey,
  BatchTextureConfig,
  BatchTextureUniform,
  BatchVec3Key,
} from "./types";

/** GLSL define suffix per scalar slot key (e.g. USE_BATCH_HEIGHT / BATCHED_TEXTURE_COMP_HEIGHT). */
export const SCALAR_DEFINE_SUFFIX: Record<BatchScalarSlotKey, string> = {
  height: "HEIGHT",
  extrudedHeight: "EXTRUDED_HEIGHT",
  lineWidth: "LINE_WIDTH",
  size: "SIZE",
  showOpacity: "SHOW_OPACITY",
  emissiveIntensity: "EMISSIVE_INTENSITY",
};

/** GLSL define suffix per vec3 key (e.g. USE_BATCH_COLOR / BATCHED_TEXTURE_ROW_COLOR). */
export const VEC3_DEFINE_SUFFIX: Record<BatchVec3Key, string> = {
  color: "COLOR",
  emissive: "EMISSIVE",
};

/**
 * Per-texture styling state shared by every material sampling the same batch
 * data texture (e.g. a polygon mesh and its outline). Slot allocations stamp
 * layout defines on all attached materials, and texture growth swaps the
 * shared uniform's `.value`.
 */
export type BatchTextureState = {
  layout: BatchTextureLayout;
  uniform: BatchTextureUniform;
  /** Capability gate: scalar attributes the mesh type's shaders can receive. */
  supported: Set<BatchScalarKey>;
  /** Capability gate for vec3 attributes (color is universally supported). */
  supportedVec3s: Set<BatchVec3Key>;
  /** 0 until known; the texture cannot be created before it is. */
  batchLength: number;
  width: number;
  groups: number;
  materials: Set<Material>;
  /**
   * Renderer of the view owning this state's meshes. The flush queues are
   * module-global while each view flushes with its own renderer, so uploads
   * must be claimed by owner — a foreign renderer's `initTexture` would
   * allocate into the wrong WebGL context and steal the first-upload
   * bookkeeping. Unset (tests) means any renderer may flush.
   */
  renderer?: WebGLRenderer;
};

/**
 * Batch texture state per material. A module-private WeakMap instead of
 * `material.userData`: it keeps the state fully typed and out of the
 * JSON round-trip `Material.copy` applies to userData (the state is
 * circular — state.materials contains the material).
 */
const states = new WeakMap<Material, BatchTextureState>();

/** Wrapped program cache key per material (see wrapProgramCacheKey). */
const wrappedCacheKeys = new WeakMap<Material, () => string>();

/** Internal accessor shared with core.ts; not part of the public API. */
export function getBatchTextureState(
  material: Material,
): BatchTextureState | undefined {
  return states.get(material);
}

export function getBatchTextureLayout(
  material: Material,
): BatchTextureLayout | undefined {
  return getBatchTextureState(material)?.layout;
}

export function getBatchTextureUniform(
  material: Material,
): BatchTextureUniform | undefined {
  return getBatchTextureState(material)?.uniform;
}

/**
 * Bind the material's batch texture state to the renderer of the view that
 * owns it, so `flushBatchTextureUpdates` only uploads its own view's
 * textures. Must run before the first attribute write (meshes call it from
 * `_initBatchDataTexture`, which every write path goes through).
 */
export function setBatchTextureRenderer(
  material: Material,
  renderer: WebGLRenderer,
): void {
  const state = getBatchTextureState(material);
  if (state) state.renderer = renderer;
}

/**
 * Detach a disposed material from its batch texture state; the last detach
 * disposes the texture (its dispose listener drains the module-global flush
 * queues). Without this, dirtySpans/pendingFirstUpload would pin textures of
 * unloaded tiles and disposed views forever.
 */
function releaseBatchMaterial(material: Material): void {
  const state = getBatchTextureState(material);
  if (!state) return;
  state.materials.delete(material);
  states.delete(material);
  if (state.materials.size === 0) {
    state.uniform.value?.dispose();
    state.uniform.value = null;
  }
}

function ensureState(
  material: Material,
  config: BatchTextureConfig,
): BatchTextureState {
  let state = getBatchTextureState(material);
  if (!state) {
    state = {
      layout: new BatchTextureLayout(),
      uniform: { value: null },
      supported: new Set(config.scalars),
      supportedVec3s: new Set(config.vec3s ?? ["color"]),
      batchLength: 0,
      width: 0,
      groups: 0,
      materials: new Set([material]),
    };
    states.set(material, state);
    material.addEventListener("dispose", () => releaseBatchMaterial(material));
  }
  // Every call, not just creation: a later customProgramCacheKey assignment
  // (e.g. a second glTF mesh node sharing this material) must be re-wrapped
  // or the batch defines drop out of the program cache key.
  wrapProgramCacheKey(material);
  if (state.batchLength === 0 && config.batchLength > 0) {
    state.batchLength = config.batchLength;
    state.width = Math.min(config.batchLength, MAX_BATCH_TEXTURE_WIDTH);
    state.groups = Math.ceil(config.batchLength / state.width);
  }
  return state;
}

/**
 * Enhancer programCacheKey implementations only cover their own state flags,
 * and three.js does not include onBeforeCompile-injected defines in its
 * program cache key. The dynamically allocated row/component defines vary per
 * material instance (allocation order follows first writes), so append them —
 * and the USE_BATCH_* toggles — to the key so two materials with different
 * layouts never share a compiled program.
 */
function wrapProgramCacheKey(material: Material): void {
  // Identity check against the stored wrapper (not a boolean flag): it stays
  // correct when the key is reassigned after wrapping, and a Material.clone()
  // (a new instance, so a WeakMap miss) re-wraps its own key.
  if (material.customProgramCacheKey === wrappedCacheKeys.get(material)) {
    return;
  }
  const original = material.customProgramCacheKey.bind(material);
  const wrapped = () => {
    const defines = material.userData.defines ?? {};
    let key = original();
    for (const name of Object.keys(defines).sort()) {
      if (
        name.startsWith("BATCHED_TEXTURE_") ||
        name.startsWith("USE_BATCH_")
      ) {
        key += `|${name}=${defines[name]}`;
      }
    }
    return key;
  };
  wrappedCacheKeys.set(material, wrapped);
  material.customProgramCacheKey = wrapped;
}

/**
 * Register the material for batched styling and, once `config.batchLength`
 * is non-zero, record the batch count. No texture rows are allocated here:
 * slots (and the texture itself) are allocated lazily on the first write of
 * each attribute, so only styles actually used occupy texture rows.
 * `batchLength` is fixed once set — dynamically increasing the batch count
 * is not supported; callers must know the total number of batches up front.
 */
export function initBatchedMaterial(
  material: Material,
  config: BatchTextureConfig,
): void {
  ensureState(material, config);
}

/**
 * One-call registration for per-feature styling: {@link initBatchedMaterial}
 * plus {@link setBatchTextureRenderer} (the claim must precede the first
 * write — flushing is per-view over module-global queues), returning the
 * shared texture uniform ref for the mesh's enhancer. Texture creation and
 * growth swap the ref's `.value` in place, so no re-wiring is needed
 * afterwards. Must run after the enhancer's customProgramCacheKey
 * assignment so the batch defines get appended to the final key.
 */
export function registerBatchedMaterial(
  material: Material,
  config: BatchTextureConfig,
  renderer: WebGLRenderer,
): BatchTextureUniform {
  const state = ensureState(material, config);
  state.renderer = renderer;
  return state.uniform;
}

/**
 * Attach `target` so it samples `source`'s batch data texture (e.g. a
 * PolygonOutline sharing its polygon mesh's texture). From then on slot
 * allocations stamp the layout defines onto `target` too, and texture growth
 * propagates through the shared uniform.
 */
export function attachBatchedMaterial(
  source: Material,
  target: Material,
): void {
  const state = getBatchTextureState(source);
  if (!state || getBatchTextureState(target) === state) return;
  state.materials.add(target);
  states.set(target, state);
  target.addEventListener("dispose", () => releaseBatchMaterial(target));
  wrapProgramCacheKey(target);
  stampLayoutDefines(state);
}

/** Set a define on the material, returning whether it actually changed. */
function setDefine(
  material: Material,
  key: string,
  value: string | boolean,
): boolean {
  const defines = (material.userData.defines ??= {});
  if (defines[key] === value) return false;
  defines[key] = value;
  return true;
}

/**
 * Stamp the current layout (row indices, components, row count) onto every
 * attached material. Called after each allocation and on attach;
 * `needsUpdate` is only bumped when a define actually changes, so repeated
 * writes don't trigger program rebuilds.
 */
export function stampLayoutDefines(state: BatchTextureState): void {
  const layout = state.layout;
  if (layout.rows === 0) return;
  for (const material of state.materials) {
    let changed = setDefine(
      material,
      "BATCHED_TEXTURE_ROW_COUNT",
      `${layout.rows}.0`,
    );
    for (const [key, row] of layout.vec3s) {
      const suffix = VEC3_DEFINE_SUFFIX[key];
      changed =
        setDefine(material, `BATCHED_TEXTURE_ROW_${suffix}`, `${row}.0`) ||
        changed;
    }
    for (const [key, slot] of layout.scalars) {
      const suffix = SCALAR_DEFINE_SUFFIX[key];
      changed =
        setDefine(material, `BATCHED_TEXTURE_ROW_${suffix}`, `${slot.row}.0`) ||
        changed;
      changed =
        setDefine(material, `BATCHED_TEXTURE_COMP_${suffix}`, `${slot.comp}`) ||
        changed;
    }
    if (state.uniform.value) {
      changed = setDefine(material, "USE_BATCH_TEXTURE", true) || changed;
    }
    if (changed) material.needsUpdate = true;
  }
}

/** Set a define only when it actually changes, to avoid needless program rebuilds. */
export function enableDefine(material: Material, key: string): void {
  if (setDefine(material, key, true)) {
    material.needsUpdate = true;
  }
}

/** Enable the batch color path: sourcing vColor requires vertexColors. */
export function enableBatchColor(material: Material): void {
  if (material.userData.defines?.USE_BATCH_COLOR) return;
  material.vertexColors = true;
  enableDefine(material, "USE_BATCH_COLOR");
}
