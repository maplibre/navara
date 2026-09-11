import {
  Color,
  DataTexture,
  FloatType,
  Material,
  RGBAFormat,
  type WebGLRenderer,
} from "three";
import invariant from "tiny-invariant";

import { batchBaseIndex } from "./layout";
import {
  SCALAR_DEFINE_SUFFIX,
  enableBatchColor,
  enableDefine,
  getBatchTextureState,
  stampLayoutDefines,
  type BatchTextureState,
} from "./material";
import type {
  BatchScalarKey,
  BatchScalarSlotKey,
  BatchSlot,
  BatchVec3Key,
  BatchedAttributeName,
} from "./types";

/** Materials whose color was already reset to white for the batch color path. */
const batchColorTouched = new WeakSet<Material>();

/**
 * Per-scalar fixed default, backfilled on slot allocation and written when a
 * value is not finite.
 */
function scalarDefault(key: BatchScalarKey): number {
  switch (key) {
    case "height":
      return 0.0;
    case "extrudedHeight":
      return 0.0;
    // Negative value indicates shader should fall back to minMaxHeightAndWidth.z
    case "lineWidth":
      return -1.0;
    // Negative value indicates shader should fall back to the material size
    case "size":
      return -1.0;
  }
}

/**
 * Pack show and opacity into a single float: `sign(show) * (1 + opacity)`.
 * The magnitude stays in [1, 2] so the sign is never ambiguous and opacity
 * keeps full float precision.
 */
export function packShowOpacity(show: number, opacity: number): number {
  const clamped = Math.max(0, Math.min(1, opacity));
  return (show > 0.5 ? 1 : -1) * (1 + clamped);
}

/**
 * Unpack show and opacity from a packed value (see {@link packShowOpacity}).
 */
export function unpackShowOpacity(packed: number): {
  show: number;
  opacity: number;
} {
  return {
    show: packed > 0 ? 1 : 0,
    opacity: Math.max(0, Math.min(1, Math.abs(packed) - 1)),
  };
}

type RowSpan = { min: number; max: number };

/**
 * Dirty column spans per physical texture row, per texture. Written by
 * {@link updateBatchAttribute}, drained once per frame by
 * {@link flushBatchTextureUpdates} (called between event processing and
 * render in the main loop) so a burst of per-feature writes becomes a few
 * `texSubImage2D` row uploads instead of a full-texture upload per write.
 */
const dirtySpans = new Map<DataTexture, Map<number, RowSpan>>();

/**
 * Textures created since the last flush, awaiting their first GPU upload.
 * The first upload must be full (never partial): the WebGL2 `texStorage2D`
 * allocation is zero-filled, and the defaults written at init (packed
 * show/opacity, lineWidth sentinel) are not zero. The flush uploads these
 * synchronously via `renderer.initTexture` before applying partial ranges.
 */
const pendingFirstUpload = new Set<DataTexture>();

/** Owning state per texture, for the per-view upload claim in the flush. */
const textureOwners = new WeakMap<DataTexture, BatchTextureState>();

/** Whether this renderer may upload the texture (see BatchTextureState.renderer). */
function ownedBy(texture: DataTexture, renderer: WebGLRenderer): boolean {
  const owner = textureOwners.get(texture)?.renderer;
  return owner === undefined || owner === renderer;
}

function markTexelDirty(texture: DataTexture, baseIndex: number): void {
  const texel = baseIndex / 4;
  const texWidth = texture.image.width;
  const row = Math.floor(texel / texWidth);
  const col = texel % texWidth;

  let rows = dirtySpans.get(texture);
  if (!rows) {
    rows = new Map();
    dirtySpans.set(texture, rows);
  }
  const span = rows.get(row);
  if (!span) {
    rows.set(row, { min: col, max: col });
  } else {
    if (col < span.min) span.min = col;
    if (col > span.max) span.max = col;
  }
}

/**
 * Upload pending textures and accumulated dirty spans to the GPU. Called once
 * per frame by the view's main loop, after event processing (which performs
 * the writes) and before rendering.
 */
export function flushBatchTextureUpdates(renderer: WebGLRenderer): void {
  // New textures get their initial full upload right away; writes since
  // creation are part of the image data, so their spans are dropped below.
  // Foreign textures are left for their own view's flush.
  for (const texture of pendingFirstUpload) {
    if (!ownedBy(texture, renderer)) continue;
    renderer.initTexture(texture);
    dirtySpans.delete(texture);
    pendingFirstUpload.delete(texture);
  }

  for (const [texture, rows] of dirtySpans) {
    if (!ownedBy(texture, renderer)) continue;
    const texWidth = texture.image.width;
    for (const [row, span] of rows) {
      texture.addUpdateRange(
        (row * texWidth + span.min) * 4,
        (span.max - span.min + 1) * 4,
      );
    }
    texture.needsUpdate = true;
    dirtySpans.delete(texture);
  }
}

/**
 * Ensure the texture has one physical row block per allocated attribute row,
 * creating or growing it as needed. The planar layout makes growth a plain
 * append: the old data copies to the head of the new array unchanged. The new
 * texture does a full first upload on the next flush; the old one is disposed
 * (its pending spans die with it).
 */
function ensureTextureRows(state: BatchTextureState): Float32Array {
  const old = state.uniform.value;
  const height = state.groups * state.layout.rows;
  if (old && old.image.height >= height) {
    return old.image.data as Float32Array;
  }

  invariant(state.batchLength > 0);
  const data = new Float32Array(state.width * 4 * height);
  if (old) {
    data.set(old.image.data as Float32Array);
    old.dispose();
  }
  const texture = new DataTexture(
    data,
    state.width,
    height,
    RGBAFormat,
    FloatType,
  );
  texture.needsUpdate = true;
  pendingFirstUpload.add(texture);
  textureOwners.set(texture, state);
  texture.addEventListener("dispose", () => {
    dirtySpans.delete(texture);
    pendingFirstUpload.delete(texture);
  });
  state.uniform.value = texture;
  return data;
}

const WHITE = new Color(1, 1, 1);
const BLACK = new Color(0, 0, 0);

/** Fixed vec3 default: color → white (multiplier identity), emissive → black. */
function vec3Default(key: BatchVec3Key): Color {
  return key === "color" ? WHITE : BLACK;
}

/**
 * Row index of a vec3 attribute, allocating it on first use. Returns
 * undefined for attributes outside the mesh type's capability list (the
 * write is then silently ignored). Allocation fills components 0-2 with the
 * fixed default for every batch. Component 3 belongs to whichever scalar
 * claims it.
 */
function ensureVec3Row(
  state: BatchTextureState,
  key: BatchVec3Key,
): number | undefined {
  if (!state.supportedVec3s.has(key)) return undefined;
  const existing = state.layout.getVec3Row(key);
  if (existing != null) return existing;

  const defaultColor = vec3Default(key);
  const row = state.layout.allocateVec3(key);
  // A vec3 always opens a fresh row, so the texture was just (re)created and
  // does a full first upload — no dirty marking needed for the fill.
  const data = ensureTextureRows(state);
  for (let batchId = 0; batchId < state.batchLength; batchId++) {
    const baseIndex = batchBaseIndex(state.width, state.groups, batchId, row);
    data[baseIndex] = defaultColor.r;
    data[baseIndex + 1] = defaultColor.g;
    data[baseIndex + 2] = defaultColor.b;
  }
  stampLayoutDefines(state);
  return row;
}

/**
 * Slots for emissive styling. The vec3 row and the intensity scalar are
 * allocated together — the shader folds them into one varying
 * (`emissive × intensity`) in the vertex stage, so both must hold valid
 * per-feature values as soon as either attribute is written. The defaults
 * (black, 1) keep untouched features dark while giving emissive-only styling
 * an identity intensity multiplier.
 */
function ensureEmissiveSlots(
  state: BatchTextureState,
): { row: number; intensity: BatchSlot } | undefined {
  const row = ensureVec3Row(state, "emissive");
  if (row == null) return undefined;
  const intensity =
    state.layout.getScalarSlot("emissiveIntensity") ??
    allocateScalarSlot(state, "emissiveIntensity", 1);
  return { row, intensity };
}

/**
 * Allocate a scalar slot and backfill a non-zero default for every batch.
 * The slot may land in an already-uploaded row (a free component of an
 * existing row), so the affected physical rows are marked dirty.
 */
function allocateScalarSlot(
  state: BatchTextureState,
  key: BatchScalarSlotKey,
  fallback: number,
): BatchSlot {
  const slot = state.layout.allocateScalar(key);
  const data = ensureTextureRows(state);
  if (fallback !== 0) {
    const texture = state.uniform.value;
    invariant(texture);
    for (let batchId = 0; batchId < state.batchLength; batchId++) {
      data[
        batchBaseIndex(state.width, state.groups, batchId, slot.row) + slot.comp
      ] = fallback;
    }
    for (let group = 0; group < state.groups; group++) {
      const rowBase = (slot.row * state.groups + group) * state.width * 4;
      markTexelDirty(texture, rowBase);
      markTexelDirty(texture, rowBase + (state.width - 1) * 4);
    }
  }
  stampLayoutDefines(state);
  return slot;
}

/**
 * Slot of a scalar attribute, allocating it on first use. Returns undefined
 * for attributes outside the mesh type's capability list (the write is then
 * silently ignored).
 */
function ensureScalarSlot(
  state: BatchTextureState,
  key: BatchScalarKey,
): BatchSlot | undefined {
  if (!state.supported.has(key)) return undefined;
  return (
    state.layout.getScalarSlot(key) ??
    allocateScalarSlot(state, key, scalarDefault(key))
  );
}

/**
 * Slot of the packed show/opacity component, allocating it on first use with
 * `packShowOpacity(material.visible, 1)` backfilled for every batch.
 */
function ensureShowOpacitySlot(
  state: BatchTextureState,
  material: Material,
): BatchSlot {
  return (
    state.layout.getScalarSlot("showOpacity") ??
    allocateScalarSlot(
      state,
      "showOpacity",
      packShowOpacity(material.visible ? 1 : 0, 1),
    )
  );
}

export function getBatchDataTexture(
  material: Material,
): DataTexture | undefined {
  return getBatchTextureState(material)?.uniform.value ?? undefined;
}

/**
 * Read one batch's scalar attribute back from the CPU-side texture data.
 * Returns undefined when the slot was never allocated (no write happened) —
 * callers fall back to their material-level default, mirroring the shader.
 */
export function readBatchScalar(
  material: Material,
  batchId: number,
  key: BatchScalarKey,
): number | undefined {
  const state = getBatchTextureState(material);
  const slot = state?.layout.getScalarSlot(key);
  const data = state?.uniform.value?.image.data as Float32Array | undefined;
  if (!state || !slot || !data) return undefined;
  return data[
    batchBaseIndex(state.width, state.groups, batchId, slot.row) + slot.comp
  ];
}

/**
 * Read one batch's vec3 attribute back from the CPU-side texture data into
 * `target`. Returns undefined when the row was never allocated.
 */
export function readBatchVec3(
  material: Material,
  batchId: number,
  key: BatchVec3Key,
  target: Color,
): Color | undefined {
  const state = getBatchTextureState(material);
  const row = state?.layout.getVec3Row(key);
  const data = state?.uniform.value?.image.data as Float32Array | undefined;
  if (!state || row == null || !data) return undefined;
  const base = batchBaseIndex(state.width, state.groups, batchId, row);
  return target.setRGB(data[base], data[base + 1], data[base + 2]);
}

/**
 * Read one batch's packed show/opacity back from the CPU-side texture data.
 * Returns undefined when the slot was never allocated.
 */
export function readBatchShowOpacity(
  material: Material,
  batchId: number,
): { show: number; opacity: number } | undefined {
  const state = getBatchTextureState(material);
  const slot = state?.layout.getScalarSlot("showOpacity");
  const data = state?.uniform.value?.image.data as Float32Array | undefined;
  if (!state || !slot || !data) return undefined;
  return unpackShowOpacity(
    data[
      batchBaseIndex(state.width, state.groups, batchId, slot.row) + slot.comp
    ],
  );
}

/** The texture and its CPU-side data. Only valid right after an ensure* call. */
function textureData(state: BatchTextureState): {
  texture: DataTexture;
  data: Float32Array;
} {
  const texture = state.uniform.value;
  invariant(texture);
  return { texture, data: texture.image.data as Float32Array };
}

/**
 * Write one attribute of one batch into the material's batch data texture.
 * Returns whether the write actually landed — callers must not stamp any
 * batch define or enhancer flag for a rejected write (wrong value type,
 * unsupported attribute, or no texture yet).
 */
export function updateBatchAttribute(
  material: Material,
  batchId: number,
  attribute: BatchedAttributeName,
  value: number | number[] | boolean,
): boolean {
  const state = getBatchTextureState(material);
  // Without a known batchLength the texture cannot exist yet; nothing to write.
  if (!state || state.batchLength === 0) return false;
  // Out-of-range ids would land in another feature's texels.
  if (batchId < 0 || batchId >= state.batchLength) return false;

  switch (attribute) {
    case "color": {
      if (!(value instanceof Array)) return false;
      const row = ensureVec3Row(state, "color");
      if (row == null) return false;
      enableBatchColor(material);

      // When enabling batchTexture color, set material.color to white
      // so that it acts as a multiplier identity (white * any color = that color)
      if (!batchColorTouched.has(material)) {
        if ("color" in material) {
          (material.color as Color).setHex(0xffffff);
        }
        if ("uniforms" in material && material.uniforms) {
          const uniforms = material.uniforms as Record<string, any>;
          if (uniforms.color?.value) {
            uniforms.color.value.set(0xffffff);
          }
        }
        batchColorTouched.add(material);
      }

      const { texture, data } = textureData(state);
      const baseIndex = batchBaseIndex(state.width, state.groups, batchId, row);
      data[baseIndex] = Number.isFinite(value[0]) ? value[0] : WHITE.r;
      data[baseIndex + 1] = Number.isFinite(value[1]) ? value[1] : WHITE.g;
      data[baseIndex + 2] = Number.isFinite(value[2]) ? value[2] : WHITE.b;
      markTexelDirty(texture, baseIndex);
      return true;
    }
    case "show": {
      if (typeof value !== "boolean") return false;
      const slot = ensureShowOpacitySlot(state, material);
      enableDefine(material, "USE_BATCH_SHOW_OPACITY");

      const { texture, data } = textureData(state);
      const baseIndex = batchBaseIndex(
        state.width,
        state.groups,
        batchId,
        slot.row,
      );
      // Update show bit, preserve opacity
      const { opacity } = unpackShowOpacity(data[baseIndex + slot.comp]);
      data[baseIndex + slot.comp] = packShowOpacity(value ? 1 : 0, opacity);
      markTexelDirty(texture, baseIndex);
      return true;
    }
    case "opacity": {
      if (typeof value !== "number") return false;
      const slot = ensureShowOpacitySlot(state, material);
      enableDefine(material, "USE_BATCH_SHOW_OPACITY");

      const { texture, data } = textureData(state);
      const baseIndex = batchBaseIndex(
        state.width,
        state.groups,
        batchId,
        slot.row,
      );
      // Update opacity, preserve show bit
      const { show } = unpackShowOpacity(data[baseIndex + slot.comp]);
      const newOpacity = Number.isFinite(value) ? value : 1.0;
      data[baseIndex + slot.comp] = packShowOpacity(show, newOpacity);
      markTexelDirty(texture, baseIndex);
      return true;
    }
    case "emissive": {
      if (!(value instanceof Array)) return false;
      const slots = ensureEmissiveSlots(state);
      if (!slots) return false;
      enableDefine(material, "USE_BATCH_EMISSIVE");

      const { texture, data } = textureData(state);
      const baseIndex = batchBaseIndex(
        state.width,
        state.groups,
        batchId,
        slots.row,
      );
      // Sanitize like the scalar cases: a NaN texel would poison the HDR
      // emissive G-buffer and grow through the bloom mip chain.
      data[baseIndex] = Number.isFinite(value[0]) ? value[0] : BLACK.r;
      data[baseIndex + 1] = Number.isFinite(value[1]) ? value[1] : BLACK.g;
      data[baseIndex + 2] = Number.isFinite(value[2]) ? value[2] : BLACK.b;
      markTexelDirty(texture, baseIndex);
      return true;
    }
    case "emissiveIntensity": {
      if (typeof value !== "number") return false;
      const slots = ensureEmissiveSlots(state);
      if (!slots) return false;
      enableDefine(material, "USE_BATCH_EMISSIVE");

      const sanitized = Number.isFinite(value) ? value : 1;
      const { texture, data } = textureData(state);
      const baseIndex = batchBaseIndex(
        state.width,
        state.groups,
        batchId,
        slots.intensity.row,
      );
      data[baseIndex + slots.intensity.comp] = sanitized;
      markTexelDirty(texture, baseIndex);
      return true;
    }
    case "height":
    case "extrudedHeight":
    case "lineWidth":
    case "size": {
      if (typeof value !== "number") return false;

      const slot = ensureScalarSlot(state, attribute);
      if (!slot) return false;

      enableDefine(material, `USE_BATCH_${SCALAR_DEFINE_SUFFIX[attribute]}`);

      const sanitized = Number.isFinite(value)
        ? value
        : scalarDefault(attribute);
      const { texture, data } = textureData(state);
      const baseIndex = batchBaseIndex(
        state.width,
        state.groups,
        batchId,
        slot.row,
      );
      data[baseIndex + slot.comp] = sanitized;
      markTexelDirty(texture, baseIndex);
      return true;
    }
  }
  return false;
}
