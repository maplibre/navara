import { Matrix4, OrthographicCamera, PerspectiveCamera, Vector3 } from "three";
import { describe, expect, it, vi } from "vitest";

import { effectiveRange } from "./math";
import { FogLightTileGrid } from "./tileGrid";

const TILE_SIZE = 32;
const WIDTH = 320; // 10 x 6 tiles
const HEIGHT = 192;
const FOG_DENSITY = 2;
const HALO_FALLOFF = 0.1;

type TestLight = {
  position: Vector3;
  intensity: number;
  radius: number;
};

/** A camera at the origin looking down -Z, matching the effect's usage. */
function makeCamera(): PerspectiveCamera {
  const camera = new PerspectiveCamera(60, WIDTH / HEIGHT, 1, 1e7);
  camera.position.set(0, 0, 0);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  return camera;
}

function makeBuffers(lights: TestLight[]) {
  const n = lights.length;
  const buf0 = new Float32Array(n * 4);
  const buf1 = new Float32Array(n * 4);
  const userRadii = new Float32Array(n);
  lights.forEach((light, i) => {
    buf0[i * 4 + 0] = 1;
    buf0[i * 4 + 1] = 1;
    buf0[i * 4 + 2] = 1;
    buf0[i * 4 + 3] = light.intensity;
    buf1[i * 4 + 0] = light.position.x;
    buf1[i * 4 + 1] = light.position.y;
    buf1[i * 4 + 2] = light.position.z;
    buf1[i * 4 + 3] = light.radius;
    userRadii[i] = light.radius;
  });
  return { buf0, buf1, userRadii };
}

function populate(
  grid: FogLightTileGrid,
  camera: PerspectiveCamera | OrthographicCamera,
  lights: TestLight[],
  buffers = makeBuffers(lights),
  maxFar = 1e9,
): boolean {
  const viewM = camera.matrixWorld.clone().invert();
  const vpM = new Matrix4().multiplyMatrices(camera.projectionMatrix, viewM);
  return grid.populate({
    camera,
    vpM,
    viewM,
    buf0: buffers.buf0,
    buf1: buffers.buf1,
    userRadii: buffers.userRadii,
    lightCount: lights.length,
    fogDensity: FOG_DENSITY,
    haloFalloff: HALO_FALLOFF,
    extentScale: 1.0,
    maxFar,
  });
}

/** Light indices registered on a tile, read back from the packed index buffer. */
function tileLights(grid: FogLightTileGrid, tx: number, ty: number): number[] {
  const indexBuf = grid["indexBuf"] as Float32Array;
  const strideScalars = Math.max(1, Math.ceil(grid.maxLightsPerTile / 4)) * 4;
  const tileIdx = ty * grid.gridW + tx;
  const count = grid.tileCounts?.[tileIdx] ?? 0;
  const result: number[] = [];
  for (let s = 0; s < count; s++) {
    result.push(indexBuf[tileIdx * strideScalars + s]);
  }
  return result;
}

function residualEnergyAt(
  grid: FogLightTileGrid,
  tx: number,
  ty: number,
): number {
  const residualBuf = grid["residualBuf"] as Float32Array;
  const k = (ty * grid.gridW + tx) * 4;
  return residualBuf[k] + residualBuf[k + 1] + residualBuf[k + 2];
}

/**
 * Exact reference test: does the ray through this tile center pass within the
 * light's effective range? Uses camera unprojection, independently of the
 * grid's own tile-ray math.
 */
function rayReachesLight(
  camera: PerspectiveCamera,
  tx: number,
  ty: number,
  light: TestLight,
  reff: number,
): boolean {
  const ndcX = (((tx + 0.5) * TILE_SIZE) / WIDTH) * 2 - 1;
  const ndcY = (((ty + 0.5) * TILE_SIZE) / HEIGHT) * 2 - 1;
  const dir = new Vector3(ndcX, ndcY, 0.5)
    .unproject(camera)
    .sub(camera.position)
    .normalize();
  const toLight = light.position.clone().sub(camera.position);
  const s = toLight.dot(dir);
  const h =
    s > 0
      ? Math.sqrt(Math.max(toLight.lengthSq() - s * s, 0))
      : toLight.length();
  return h < reff;
}

describe("FogLightTileGrid", () => {
  it("computes grid dimensions from the render size", () => {
    const grid = new FogLightTileGrid(TILE_SIZE, 64);
    grid.setSize(WIDTH, HEIGHT);
    expect(grid.gridW).toBe(Math.ceil(WIDTH / TILE_SIZE));
    expect(grid.gridH).toBe(Math.ceil(HEIGHT / TILE_SIZE));
    expect(grid.gridTexture).toBeDefined();
    expect(grid.indexTexture).toBeDefined();
    expect(grid.residualTexture).toBeDefined();
  });

  it("disposes its textures", () => {
    const grid = new FogLightTileGrid(TILE_SIZE, 64);
    grid.setSize(WIDTH, HEIGHT);
    const spies = [grid.gridTexture, grid.indexTexture, grid.residualTexture]
      .filter((t) => t !== undefined)
      .map((t) => vi.spyOn(t, "dispose"));

    grid.dispose();

    expect(spies).toHaveLength(3);
    for (const spy of spies) expect(spy).toHaveBeenCalledOnce();
  });

  it("bakes effective ranges into buf1.w and reports the change once", () => {
    const grid = new FogLightTileGrid(TILE_SIZE, 64);
    grid.setSize(WIDTH, HEIGHT);
    const lights = [
      { position: new Vector3(0, 0, -500), intensity: 1, radius: 1000 },
    ];
    const buffers = makeBuffers(lights);

    expect(populate(grid, makeCamera(), lights, buffers)).toBe(true);
    const expected = effectiveRange(1, FOG_DENSITY, 1000, HALO_FALLOFF);
    // buf1 is Float32, so compare with a float32-appropriate tolerance
    expect(buffers.buf1[3]).toBeCloseTo(expected, 3);

    // Unchanged inputs: nothing to re-bake
    expect(populate(grid, makeCamera(), lights, buffers)).toBe(false);
  });

  it("registers every light the tile's ray can actually reach", () => {
    const grid = new FogLightTileGrid(TILE_SIZE, 64);
    grid.setSize(WIDTH, HEIGHT);
    const camera = makeCamera();
    const lights = [
      { position: new Vector3(0, 0, -800), intensity: 1, radius: 300 },
      { position: new Vector3(400, 100, -1500), intensity: 2, radius: 500 },
      { position: new Vector3(-600, -50, -2000), intensity: 0.5, radius: 400 },
    ];
    const buffers = makeBuffers(lights);
    populate(grid, camera, lights, buffers);

    const missing: string[] = [];
    for (let ty = 0; ty < grid.gridH; ty++) {
      for (let tx = 0; tx < grid.gridW; tx++) {
        const registered = new Set(tileLights(grid, tx, ty));
        lights.forEach((light, i) => {
          const reff = buffers.buf1[i * 4 + 3];
          if (
            rayReachesLight(camera, tx, ty, light, reff) &&
            !registered.has(i)
          ) {
            missing.push(`light ${i} missing on tile ${tx},${ty}`);
          }
        });
      }
    }
    expect(missing).toEqual([]);
  });

  it("culls lights beyond maxFar and outside the frustum", () => {
    const grid = new FogLightTileGrid(TILE_SIZE, 64);
    grid.setSize(WIDTH, HEIGHT);
    const lights = [
      { position: new Vector3(0, 0, -9000), intensity: 1, radius: 100 }, // beyond maxFar
      { position: new Vector3(0, 0, 5000), intensity: 1, radius: 100 }, // behind the camera
    ];
    populate(grid, makeCamera(), lights, makeBuffers(lights), 5000);

    let total = 0;
    for (const c of grid.tileCounts ?? []) total += c;
    expect(total).toBe(0);
  });

  it("registers a light on the whole grid when the camera is inside it", () => {
    const grid = new FogLightTileGrid(TILE_SIZE, 64);
    grid.setSize(WIDTH, HEIGHT);
    const lights = [
      { position: new Vector3(50, 0, -100), intensity: 1, radius: 1000 },
    ];
    populate(grid, makeCamera(), lights);

    for (let ty = 0; ty < grid.gridH; ty++) {
      for (let tx = 0; tx < grid.gridW; tx++) {
        expect(tileLights(grid, tx, ty)).toContain(0);
      }
    }
  });

  it("keeps the strongest lights and folds the rest into the residual", () => {
    const cap = 2;
    const grid = new FogLightTileGrid(TILE_SIZE, cap);
    grid.setSize(WIDTH, HEIGHT);
    const camera = makeCamera();
    // Three lights straight ahead: the two nearest contribute most everywhere
    const lights = [
      { position: new Vector3(0, 0, -400), intensity: 1, radius: 2000 },
      { position: new Vector3(0, 0, -700), intensity: 1, radius: 2000 },
      { position: new Vector3(0, 0, -3000), intensity: 1, radius: 2000 },
    ];
    populate(grid, camera, lights);

    const centerTx = Math.floor(grid.gridW / 2);
    const centerTy = Math.floor(grid.gridH / 2);
    const kept = tileLights(grid, centerTx, centerTy);
    expect(kept).toHaveLength(cap);
    expect(new Set(kept)).toEqual(new Set([0, 1]));

    // The dropped light's energy lands in the residual haze
    expect(residualEnergyAt(grid, centerTx, centerTy)).toBeGreaterThan(0);
  });

  it("never exceeds maxLightsPerTile and reallocates on cap change", () => {
    const grid = new FogLightTileGrid(TILE_SIZE, 4);
    grid.setSize(WIDTH, HEIGHT);
    const lights = Array.from({ length: 12 }, (_, i) => ({
      position: new Vector3((i - 6) * 30, 0, -500),
      intensity: 1,
      radius: 1500,
    }));
    populate(grid, makeCamera(), lights);
    for (const c of grid.tileCounts ?? []) {
      expect(c).toBeLessThanOrEqual(4);
    }

    grid.maxLightsPerTile = 8;
    populate(grid, makeCamera(), lights);
    let maxCount = 0;
    for (const c of grid.tileCounts ?? []) maxCount = Math.max(maxCount, c);
    expect(maxCount).toBeGreaterThan(4);
    expect(maxCount).toBeLessThanOrEqual(8);
  });

  it("supports orthographic cameras", () => {
    const grid = new FogLightTileGrid(TILE_SIZE, 64);
    grid.setSize(WIDTH, HEIGHT);
    const camera = new OrthographicCamera(-500, 500, 300, -300, 1, 1e6);
    camera.position.set(0, 0, 0);
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();

    const lights = [
      { position: new Vector3(0, 0, -1000), intensity: 1, radius: 300 },
    ];
    populate(grid, camera, lights);

    // The light must be registered around the screen center
    const centerTx = Math.floor(grid.gridW / 2);
    const centerTy = Math.floor(grid.gridH / 2);
    expect(tileLights(grid, centerTx, centerTy)).toContain(0);
  });
});
