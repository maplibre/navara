import type {
  TextMesh as NavaraTextMesh,
  TextMaterial as NavaraTextMaterial,
} from "@navaramap/engine";
import type { ShapeTextResult } from "@navaramap/font";
import { Color, PerspectiveCamera, type ShaderMaterial } from "three";
import { describe, expect, it, vi } from "vitest";

import {
  readBatchScalar,
  readBatchShowOpacity,
  readBatchVec3,
} from "../../batchTexture";
import type { EventContext } from "../../event/context";

import { BatchedSdfTextMesh } from "./batchedSdfText";
import { LabelRow, type LabelDataTexture } from "./labelData";

// `labelVisibility` derives its Earth radius band from the WASM ellipsoid
// getters, which only answer after `view.init()`. Keep the rest of the module
// real and stub just those two with the engine's f32 values.
vi.mock("@navaramap/three-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@navaramap/three-api")>()),
  getWGS84SemiMajorAxis: () => 6_378_137,
  getWGS84SemiMinorAxis: () => 6_356_752.5,
}));

/** Drains chained `.then` callbacks of the async font-preparation path. */
const flushMicrotasks = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

/** One square atlas glyph per character — enough for a non-empty layout. */
function shapeResult(text: string): ShapeTextResult {
  return {
    glyphs: [...text].map((_, i) => ({
      glyphId: i + 1,
      fontIndex: 0,
      compositeKey: BigInt(i + 1),
      xAdvance: 500,
      yAdvance: 0,
      xOffset: 0,
      yOffset: 0,
      charClass: 0,
    })),
    metrics: [...text].map((_, i) => ({
      glyphId: i + 1,
      fontIndex: 0,
      compositeKey: BigInt(i + 1),
      atlasX: i * 32,
      atlasY: 0,
      atlasW: 32,
      atlasH: 32,
      bearingX: 0,
      bearingY: 32,
      isColor: false,
    })),
    unitsPerEm: 1000,
    ascender: 800,
    descender: -200,
    lineGap: 0,
  };
}

function makeFontManager() {
  return {
    onAtlasEvicted: vi.fn(() => () => {}),
    isTextPrepared: vi.fn(() => true),
    prepareText: vi.fn(async () => {}),
    shapeText: vi.fn((_font: string, text: string) => shapeResult(text)),
    retainGlyphs: vi.fn(),
    releaseGlyphs: vi.fn(),
    getAtlasTexture: vi.fn(() => null),
    getColorAtlasTexture: vi.fn(() => null),
    isFamily: vi.fn(() => true),
    loadFont: vi.fn(async () => {}),
    unloadFont: vi.fn(async () => {}),
  };
}

/** A layer material with the fields this fix gates on spelled out. */
function material(over: Partial<NavaraTextMaterial> = {}): NavaraTextMaterial {
  return {
    size: 16,
    color: 0xffffff,
    opacity: 1,
    height: 0,
    show: true,
    ...over,
  } as unknown as NavaraTextMaterial;
}

/** A two-feature text mesh event, as the engine hands it over. */
function textMeshEvent(mat: NavaraTextMaterial): NavaraTextMesh {
  return {
    material: mat,
    transform: { tx: 0, ty: 0, tz: 0 },
    batch_length: 2,
    geometry: {
      batch_ids: { data: new Float32Array([0, 1]), size: 1 },
      position: { data: new Float32Array([0, 0, 0, 10, 0, 0]), size: 3 },
    },
  } as unknown as NavaraTextMesh;
}

/** viewContext mock: no real renderer, so the batch texture flushes freely. */
const viewContext = { getRenderer: () => undefined };

function makeMesh(mat = material()) {
  const fontManager = makeFontManager();
  const ctx = {
    buf: { removeF32: (d: Float32Array) => d },
    fontManager,
    renderFlag: { forceUpdate: false },
    viewContext,
  } as unknown as EventContext;
  const mesh = new BatchedSdfTextMesh(ctx, textMeshEvent(mat), "font", {
    layerId: "layer",
  });
  return { mesh, fontManager };
}

// Read back what the vertex shader would sample, rather than the private
// LabelRecord — these are the writes the fix is about. Style lives in the
// shared batch data texture (keyed by the label's feature index); show stays
// in the label data texture's STATE row.
const store = (mesh: BatchedSdfTextMesh) =>
  (mesh as unknown as { _labelData: LabelDataTexture })._labelData;
const batchMat = (mesh: BatchedSdfTextMesh) => mesh.material as ShaderMaterial;
const batchIndexOf = (mesh: BatchedSdfTextMesh, slot: number) =>
  (mesh as unknown as { _labels: { batchIndex: number }[] })._labels[slot]
    .batchIndex;
const sizeOf = (mesh: BatchedSdfTextMesh, slot: number) =>
  readBatchScalar(batchMat(mesh), batchIndexOf(mesh, slot), "size");
const heightOf = (mesh: BatchedSdfTextMesh, slot: number) =>
  readBatchScalar(batchMat(mesh), batchIndexOf(mesh, slot), "height");
const opacityOf = (mesh: BatchedSdfTextMesh, slot: number) =>
  readBatchShowOpacity(batchMat(mesh), batchIndexOf(mesh, slot))?.opacity;
const _readColor = new Color();
const redOf = (mesh: BatchedSdfTextMesh, slot: number) =>
  readBatchVec3(batchMat(mesh), batchIndexOf(mesh, slot), "color", _readColor)
    ?.r;
const showOf = (mesh: BatchedSdfTextMesh, slot: number) =>
  store(mesh).getComponent(slot, LabelRow.STATE, 2);

// The engine re-sends the whole material on any change event — including ones
// that only moved geometry (terrain heights resolving) or flipped activation.
// Overwriting per-feature values from an unchanged material made every such
// event reset evaluator-set styling to the layer default for a few frames,
// pulsing label sizes until the app's evaluator ran again.
describe("BatchedSdfTextMesh material updates vs per-feature values", () => {
  it("leaves evaluator-set values alone when nothing in the material changed", async () => {
    const { mesh } = makeMesh();
    mesh.setFeatureSizeByBatchIndex(0, 32);
    mesh.setFeatureHeightByBatchIndex(0, 50);
    mesh.setFeatureOpacityByBatchIndex(0, 0.25);
    mesh.setFeatureColorByBatchIndex(0, new Color(0xff0000));

    // A fresh material object carrying identical values (a terrain-height event).
    await mesh._update(textMeshEvent(material()));

    expect(sizeOf(mesh, 0)).toBe(32);
    expect(heightOf(mesh, 0)).toBe(50);
    expect(opacityOf(mesh, 0)).toBe(0.25);
    expect(redOf(mesh, 0)).toBe(1);
  });

  it("keeps an evaluator-set show through an unchanged material", async () => {
    const { mesh } = makeMesh();
    mesh.setTextByBatchIndex(0, "AB");
    expect(showOf(mesh, 0)).toBe(1);
    mesh.setFeatureShowByBatchIndex(0, false);
    expect(showOf(mesh, 0)).toBe(0);

    await mesh._update(textMeshEvent(material()));

    expect(showOf(mesh, 0)).toBe(0);
  });

  it("still applies a genuinely changed material value to every label", async () => {
    const { mesh } = makeMesh();
    mesh.setFeatureSizeByBatchIndex(0, 32);
    mesh.setFeatureSizeByBatchIndex(1, 8);

    // A real `layer.update`: the new default overrides per-feature sizes.
    await mesh._update(textMeshEvent(material({ size: 24 })));

    expect(sizeOf(mesh, 0)).toBe(24);
    expect(sizeOf(mesh, 1)).toBe(24);
  });

  it("applies a changed material show to every label", async () => {
    const { mesh } = makeMesh();
    mesh.setTextByBatchIndex(0, "AB");
    mesh.setFeatureShowByBatchIndex(0, false);

    await mesh._update(textMeshEvent(material({ show: false })));
    expect(showOf(mesh, 0)).toBe(0);

    await mesh._update(textMeshEvent(material({ show: true })));
    expect(showOf(mesh, 0)).toBe(1);
  });

  it("does not reset unrelated per-feature values when one field changes", async () => {
    const { mesh } = makeMesh();
    mesh.setFeatureSizeByBatchIndex(0, 32);
    mesh.setFeatureHeightByBatchIndex(0, 50);

    // Only the colour moved; size and height must survive it.
    await mesh._update(textMeshEvent(material({ color: 0x00ff00 })));

    expect(sizeOf(mesh, 0)).toBe(32);
    expect(heightOf(mesh, 0)).toBe(50);
    expect(redOf(mesh, 0)).toBe(0);
  });

  it("compares against the pre-update material on the async font path", async () => {
    const { mesh, fontManager } = makeMesh();
    mesh.setFeatureSizeByBatchIndex(0, 32);
    // Force the branch that defers _applyUpdate behind prepareText: the
    // comparison must use the material captured before `this._material` was
    // reassigned, or the size change is lost by the time the promise lands.
    fontManager.isTextPrepared.mockReturnValueOnce(false);

    await mesh._update(textMeshEvent(material({ text: "AB", size: 24 })));
    await flushMicrotasks();

    expect(fontManager.prepareText).toHaveBeenCalled();
    expect(sizeOf(mesh, 0)).toBe(24);
  });
});

// The evaluator applies `show` before `text`. A show:false for a feature with
// no label yet must survive until the text setter creates the label — labels
// stay lazily allocated, so the intent is parked, not applied.
describe("BatchedSdfTextMesh show:false before the first text", () => {
  it("keeps the label hidden when show:false precedes the first text", () => {
    const { mesh } = makeMesh();
    mesh.setFeatureShowByBatchIndex(0, false);
    mesh.setTextByBatchIndex(0, "AB");
    expect(showOf(mesh, 0)).toBe(0);
  });

  it("keeps a parked show:false through an unchanged material", async () => {
    const { mesh } = makeMesh();
    mesh.setFeatureShowByBatchIndex(0, false);

    await mesh._update(textMeshEvent(material()));

    mesh.setTextByBatchIndex(0, "AB");
    expect(showOf(mesh, 0)).toBe(0);
  });

  it("lets a later show:true supersede the parked hide", () => {
    const { mesh } = makeMesh();
    mesh.setFeatureShowByBatchIndex(0, false);
    mesh.setFeatureShowByBatchIndex(0, true);
    mesh.setTextByBatchIndex(0, "AB");
    expect(showOf(mesh, 0)).toBe(1);
  });
});

// A feature owns several anchors for MultiPoint geometry and for labels
// derived from line/polygon vertices via `geometryTypes`. Per-feature setters
// address features (batch indices), so they must fan out to every anchor the
// feature owns via the geometry's per-anchor `batch_index` buffer.
describe("BatchedSdfTextMesh multi-instance fan-out", () => {
  /** Feature 0 owns anchors 0 and 1 (MultiPoint); feature 1 owns anchor 2. */
  function multiInstanceMeshEvent(mat: NavaraTextMaterial): NavaraTextMesh {
    return {
      material: mat,
      transform: { tx: 0, ty: 0, tz: 0 },
      batch_length: 2,
      geometry: {
        batch_ids: { data: new Float32Array([7, 8, 9]), size: 1 },
        batch_index: { data: new Uint32Array([0, 0, 1]), size: 1 },
        position: {
          data: new Float32Array([0, 0, 0, 10, 0, 0, 20, 0, 0]),
          size: 3,
        },
      },
    } as unknown as NavaraTextMesh;
  }

  function makeMultiInstanceMesh() {
    const fontManager = makeFontManager();
    const ctx = {
      buf: {
        removeF32: (d: Float32Array) => d,
        u32: (d: Uint32Array) => d,
      },
      fontManager,
      renderFlag: { forceUpdate: false },
      viewContext,
    } as unknown as EventContext;
    const mesh = new BatchedSdfTextMesh(
      ctx,
      multiInstanceMeshEvent(material()),
      "font",
      { layerId: "layer" },
    );
    return { mesh, fontManager };
  }

  it("applies text and styles to every anchor the feature owns", () => {
    const { mesh } = makeMultiInstanceMesh();
    mesh.setTextByBatchIndex(0, "AB");
    mesh.setFeatureSizeByBatchIndex(0, 32);

    // Feature 0's two anchors got labels (slots 0 and 1), both styled.
    expect(showOf(mesh, 0)).toBe(1);
    expect(showOf(mesh, 1)).toBe(1);
    expect(sizeOf(mesh, 0)).toBe(32);
    expect(sizeOf(mesh, 1)).toBe(32);
  });

  it("does not leak styling into other features' anchors", () => {
    const { mesh } = makeMultiInstanceMesh();
    mesh.setTextByBatchIndex(0, "AB");
    mesh.setTextByBatchIndex(1, "CD");
    mesh.setFeatureShowByBatchIndex(1, false);

    expect(showOf(mesh, 0)).toBe(1);
    expect(showOf(mesh, 1)).toBe(1);
    // Feature 1 = anchor 2 = the third label slot.
    expect(showOf(mesh, 2)).toBe(0);
  });
});

// Unprepared text costs a worker round-trip and font-face fetches, and a
// low-zoom tile spans far more world than the screen shows. With declutter on,
// `setTextByBatchIndex` therefore parks preparation until a placement pass
// confirms the anchor could actually appear on screen.
describe("BatchedSdfTextMesh deferred font preparation", () => {
  /** Camera framing the origin, so anchors near it count as in view. */
  function makeCamera(lookAtZ = 0): PerspectiveCamera {
    const cam = new PerspectiveCamera(60, 1, 1, 1e9);
    cam.position.set(0, 0, 100);
    cam.lookAt(0, 0, lookAtZ);
    cam.updateMatrixWorld(true);
    cam.updateProjectionMatrix();
    return cam;
  }

  /**
   * Font manager whose `isTextPrepared` starts false and flips once
   * `prepareText` resolves, as the real one does — a fake that answers false
   * forever would make the re-prepare-on-show path loop.
   */
  function makeLazyFontManager() {
    const prepared = new Set<string>();
    const fontManager = {
      ...makeFontManager(),
      isTextPrepared: vi.fn((_font: string, text: string) =>
        prepared.has(text),
      ),
      prepareText: vi.fn(async (_font: string, text: string) => {
        prepared.add(text);
      }),
    };
    return { fontManager, prepared };
  }

  function makeCtx(fontManager: unknown, declutter?: unknown) {
    return {
      buf: { removeF32: (d: Float32Array) => d },
      fontManager,
      declutter,
      renderFlag: { forceUpdate: false },
      viewContext,
    } as unknown as EventContext;
  }

  /** As `makeMesh`, but with a declutter manager present so parking engages. */
  function makeDeclutteredMesh() {
    const { fontManager, prepared } = makeLazyFontManager();
    const declutter = {
      register: vi.fn(),
      unregister: vi.fn(),
      markDirty: vi.fn(),
      wasRecentlyShown: vi.fn(() => false),
    };
    const mesh = new BatchedSdfTextMesh(
      makeCtx(fontManager, declutter),
      textMeshEvent(material()),
      "font",
      { layerId: "layer" },
    );
    return { mesh, fontManager, prepared };
  }

  const deferredCount = (mesh: BatchedSdfTextMesh) =>
    (mesh as unknown as { _deferredCount: number })._deferredCount;

  it("does not start preparation when declutter is enabled", async () => {
    const { mesh, fontManager } = makeDeclutteredMesh();

    mesh.setTextByBatchIndex(0, "Tokyo");
    await flushMicrotasks();

    expect(fontManager.prepareText).not.toHaveBeenCalled();
    expect(deferredCount(mesh)).toBe(1);
    // Nothing drawable yet, so the label stays hidden.
    expect(showOf(mesh, 0)).toBe(0);
  });

  it("prepares immediately when there is no declutter pass to park on", async () => {
    const { fontManager } = makeLazyFontManager();
    const mesh = new BatchedSdfTextMesh(
      makeCtx(fontManager),
      textMeshEvent(material()),
      "font",
      { layerId: "layer" },
    );

    mesh.setTextByBatchIndex(0, "Tokyo");
    await flushMicrotasks();

    expect(fontManager.prepareText).toHaveBeenCalledTimes(1);
  });

  it("promotes a parked label once its anchor is potentially visible", async () => {
    const { mesh, fontManager } = makeDeclutteredMesh();
    mesh.setActive(true);
    mesh.setTextByBatchIndex(0, "Tokyo");
    await flushMicrotasks();
    expect(fontManager.prepareText).not.toHaveBeenCalled();

    // Anchor 0 sits at the origin; this camera frames it.
    mesh.prepareDeferredLabels(makeCamera());
    await flushMicrotasks();

    expect(fontManager.prepareText).toHaveBeenCalledTimes(1);
    expect(deferredCount(mesh)).toBe(0);
    // The promoted text is applied, so the label becomes drawable.
    expect(showOf(mesh, 0)).toBe(1);
  });

  it("leaves a parked label alone while its anchor is out of view", async () => {
    const { mesh, fontManager } = makeDeclutteredMesh();
    mesh.setActive(true);
    mesh.setTextByBatchIndex(0, "Tokyo");
    await flushMicrotasks();

    // Looking away puts the anchor behind the camera.
    mesh.prepareDeferredLabels(makeCamera(500));
    await flushMicrotasks();

    expect(fontManager.prepareText).not.toHaveBeenCalled();
    // Still parked, so a later pass can promote it.
    expect(deferredCount(mesh)).toBe(1);
  });

  // Promotion requires `this.visible`, which the tile-LOD swap only sets after
  // the batch reports rendered — and that report waits on `whenLabelsSettled`.
  // Counting parked labels as "in flight" would therefore deadlock that cycle
  // until the timeout, stalling every text tile's swap. The gate deliberately
  // covers only started preparations; see whenLabelsSettled's docs.
  it("does not let parked labels hold the render-completion gate", async () => {
    const { mesh } = makeDeclutteredMesh();
    mesh.setTextByBatchIndex(0, "Tokyo");
    await flushMicrotasks();

    let settled = false;
    void mesh.whenLabelsSettled(2000).then(() => (settled = true));
    await flushMicrotasks();

    expect(settled).toBe(true);
  });

  it("holds the gate while a promoted preparation is in flight", async () => {
    const { mesh, fontManager } = makeDeclutteredMesh();
    let finishPrepare!: () => void;
    fontManager.prepareText = vi.fn(
      (_font: string, _text: string) =>
        new Promise<void>((r) => (finishPrepare = r)),
    );

    mesh.setActive(true);
    mesh.setTextByBatchIndex(0, "Tokyo");
    mesh.prepareDeferredLabels(makeCamera());
    await flushMicrotasks();

    let settled = false;
    void mesh.whenLabelsSettled(2000).then(() => (settled = true));
    await flushMicrotasks();
    expect(settled).toBe(false);

    finishPrepare();
    await flushMicrotasks();
    expect(settled).toBe(true);
  });
});
