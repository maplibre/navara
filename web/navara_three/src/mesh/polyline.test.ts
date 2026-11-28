import type { PolylineMaterial } from "@navaramap/engine";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  hasBatchScalarSlot,
  initBatchedMaterial,
  POLYLINE_BATCH_SUPPORT,
  readBatchScalar,
} from "../batchTexture";
import { createPolylineMaterialEnhancer } from "../material/enhancer";
import { TileScene } from "../scene";

import { BatchedFeatureMesh } from "./batchedFeature";
import { PolylineMesh } from "./polyline";

// Mock worker module to avoid os.cpus() error in test environment
vi.mock("@navaramap/worker", () => ({}));

afterEach(() => {
  vi.restoreAllMocks();
});

/** A draped polyline mesh with its enhancer mounted, as `init` leaves it. */
const drapedPolyline = (blur = 0) => {
  const mesh = new PolylineMesh({
    viewContext: {},
  } as unknown as PolylineMesh["ctx"]);
  const enhancer = createPolylineMaterialEnhancer(mesh.material);
  enhancer.mount({ base: { isTexturized: true, blur } });
  (
    mesh as unknown as { _enhancedMaterial: typeof enhancer }
  )._enhancedMaterial = enhancer;
  return { mesh, enhancer };
};

/** Batch writes always land: the texture write is tested in batchTexture. */
const landAllBatchWrites = () =>
  vi
    .spyOn(BatchedFeatureMesh.prototype, "_updateBatchAttribute")
    .mockImplementation(function (this: BatchedFeatureMesh) {
      this.needsUpdate();
      return true;
    });

/** Gives the mesh a real batch texture of `batchLength` features. */
const withBatchTexture = (mesh: PolylineMesh, batchLength: number) => {
  mesh.batchLength = batchLength;
  initBatchedMaterial(mesh.material, {
    ...POLYLINE_BATCH_SUPPORT,
    batchLength,
  });
};

const materialWithBlur = (blur: number) =>
  ({ blur, width: 6, maxWidth: 1000 }) as unknown as PolylineMaterial;

describe("PolylineMesh per-feature blur", () => {
  it("blends only once a feature's blur is above 0", () => {
    // Material blur 3, so that a feature's 0 is its own hard edge.
    const { mesh, enhancer } = drapedPolyline(3);
    withBatchTexture(mesh, 2);

    mesh._updateBatchAttribute(0, "lineBlur", 0);
    expect(hasBatchScalarSlot(mesh.material, "lineBlur")).toBe(true);
    expect(enhancer.states().batchBlurEnabled).toBe(false);

    mesh._updateBatchAttribute(1, "lineBlur", 5);
    expect(enhancer.states().batchBlurEnabled).toBe(true);

    // Once on, a later 0 is written like any other value.
    mesh._updateBatchAttribute(1, "lineBlur", 0);
    expect(enhancer.states().batchBlurEnabled).toBe(true);
    expect(readBatchScalar(mesh.material, 1, "lineBlur")).toBe(0);
  });

  it("re-reads the drape scene's translucency after the first blurred feature", () => {
    const { mesh } = drapedPolyline();
    withBatchTexture(mesh, 1);
    landAllBatchWrites();
    const scene = new TileScene("layer", 0);
    scene.add(mesh);
    // event/feature.ts marks the tile's layer scene dirty on `needsUpdate`.
    mesh.addEventListener("needsUpdate" as never, () => {
      scene.revision++;
    });

    expect(scene.hasTransparentMesh).toBe(false);
    mesh._updateBatchAttribute(0, "lineBlur", 0);
    expect(scene.hasTransparentMesh).toBe(false);
    mesh._updateBatchAttribute(0, "lineBlur", 4);
    expect(scene.hasTransparentMesh).toBe(true);
  });

  // A MapLibre style's constant `line-blur: 0` returns 0 for every feature.
  it("allocates no slot and no shader variant for the material's own blur", () => {
    const { mesh, enhancer } = drapedPolyline();
    withBatchTexture(mesh, 3);

    for (let id = 0; id < 3; id++)
      mesh._updateBatchAttribute(id, "lineBlur", 0);

    expect(hasBatchScalarSlot(mesh.material, "lineBlur")).toBe(false);
    expect(mesh.material.userData.defines?.USE_BATCH_LINE_BLUR).toBeUndefined();
    expect(enhancer.states().batchBlurEnabled).toBe(false);
  });

  it("keeps those features at their blur when the material's changes", () => {
    const { mesh, enhancer } = drapedPolyline();
    withBatchTexture(mesh, 3);
    mesh._updateBatchAttribute(0, "lineBlur", 0);
    mesh._updateBatchAttribute(1, "lineBlur", 0);

    mesh._update(materialWithBlur(4), true);

    expect(enhancer.states().blur).toBe(4);
    expect(readBatchScalar(mesh.material, 0, "lineBlur")).toBe(0);
    expect(readBatchScalar(mesh.material, 1, "lineBlur")).toBe(0);
    // Never asked for one: follows the material.
    expect(readBatchScalar(mesh.material, 2, "lineBlur")).toBe(-1);
  });

  it("keeps those features at their blur once another feature takes a slot", () => {
    const { mesh } = drapedPolyline();
    withBatchTexture(mesh, 3);
    mesh._updateBatchAttribute(0, "lineBlur", 0);
    mesh._updateBatchAttribute(1, "lineBlur", 5);

    expect(readBatchScalar(mesh.material, 0, "lineBlur")).toBe(0);
    expect(readBatchScalar(mesh.material, 1, "lineBlur")).toBe(5);
    expect(readBatchScalar(mesh.material, 2, "lineBlur")).toBe(-1);
  });

  it("answers a blur it need not write as the write would", () => {
    const { mesh } = drapedPolyline();
    // No batch texture registered yet.
    expect(mesh._updateBatchAttribute(0, "lineBlur", 0)).toBe(false);

    withBatchTexture(mesh, 2);
    expect(mesh._updateBatchAttribute(2, "lineBlur", 0)).toBe(false);
    expect(mesh._updateBatchAttribute(-1, "lineBlur", 0)).toBe(false);
    expect(mesh._updateBatchAttribute(1, "lineBlur", 0)).toBe(true);
  });

  it("writes a feature again when writing its blur was rejected", () => {
    const { mesh } = drapedPolyline();
    withBatchTexture(mesh, 2);
    mesh._updateBatchAttribute(0, "lineBlur", 0);
    mesh._updateBatchAttribute(1, "lineBlur", 0);

    const write = vi.spyOn(
      BatchedFeatureMesh.prototype,
      "_updateBatchAttribute",
    );
    write.mockImplementationOnce(() => false);
    mesh._update(materialWithBlur(4), true);
    write.mockRestore();
    // The material's blur changes again: the rejected feature is written then.
    mesh._update(materialWithBlur(6), true);

    expect(readBatchScalar(mesh.material, 0, "lineBlur")).toBe(0);
    expect(readBatchScalar(mesh.material, 1, "lineBlur")).toBe(0);
  });

  it("finds a blur equal to the material's after the material's went through f32", () => {
    const { mesh } = drapedPolyline(Math.fround(0.1));
    withBatchTexture(mesh, 1);

    mesh._updateBatchAttribute(0, "lineBlur", 0.1);

    expect(hasBatchScalarSlot(mesh.material, "lineBlur")).toBe(false);
  });

  // standard: MapLibre Style Spec line-blur (minimum 0)
  // ref: https://maplibre.org/maplibre-style-spec/layers/#line-blur
  it("writes a negative blur as a hard edge, not as the material-blur sentinel", () => {
    const { mesh } = drapedPolyline(3);
    withBatchTexture(mesh, 1);

    mesh._updateBatchAttribute(0, "lineBlur", -1);

    expect(readBatchScalar(mesh.material, 0, "lineBlur")).toBe(0);
  });
});
