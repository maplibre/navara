// @vitest-environment node
// The zstd decoder rejects the Node buffers FileSystemStore reads as
// Uint8Arrays of another realm under jsdom.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import FileSystemStore from "@zarrita/storage/fs";
import { afterAll, describe, expect, it } from "vitest";
import * as zarr from "zarrita";

import { writeFloodZarr } from "./zarr";

const dir = mkdtempSync(join(tmpdir(), "flood-zarr-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const decode = async (path: string, name: string) => {
  const array = await zarr.open.v3(
    zarr.root(new FileSystemStore(path)).resolve(name),
    { kind: "array" },
  );
  const { data } = await zarr.get(array);
  const scale =
    typeof array.attrs.scale_factor === "number" ? array.attrs.scale_factor : 1;
  const offset =
    typeof array.attrs.add_offset === "number" ? array.attrs.add_offset : 0;
  const values = Array.from(data as ArrayLike<number>, (v) =>
    v === array.fillValue ? NaN : v * scale + offset,
  );
  return { array, values };
};

describe("writeFloodZarr", () => {
  it("writes the properties, packed and without time when constant", async () => {
    const output = join(dir, "series.zarr");
    // Two frames over a 2 × 1 grid: cell 0 wet in both, cell 1 in the second.
    await writeFloodZarr(new FileSystemStore(output), {
      grid: { lngStep: 0.001, latStep: 0.001, lngOffset: 0, latOffset: 0 },
      times: Float64Array.from([0, 3600]),
      frames: [
        {
          x: Int32Array.from([0]),
          y: Int32Array.from([0]),
          level: Float32Array.from([10]),
          properties: {
            ground: Float32Array.from([9]),
            speed: Float32Array.from([0.25]),
          },
        },
        {
          x: Int32Array.from([0, 1]),
          y: Int32Array.from([0, 0]),
          level: Float32Array.from([11, 10.5]),
          properties: {
            ground: Float32Array.from([9, 9.5]),
            speed: Float32Array.from([0.5, NaN]),
          },
        },
      ],
      attributes: { source: "test" },
      precision: { ground: 0.1, speed: 0.001 },
    });

    const group = await zarr.open.v3(zarr.root(new FileSystemStore(output)), {
      kind: "group",
    });
    expect(group.attrs).toMatchObject({
      source: "test",
      signed_distance: "signed_distance",
      properties: ["ground", "speed"],
    });

    const level = await decode(output, "water_level");
    // A 1 m range at 0.01 m fits a byte.
    expect(level.array.dtype).toBe("uint8");
    // The window pads the wet cells by one dry cell on each side.
    expect(level.array.shape).toEqual([2, 3, 4]);
    expect(level.values[1 * 12 + 1 * 4 + 1]).toBeCloseTo(11, 5);
    expect(level.values[1 * 12 + 1 * 4 + 2]).toBeCloseTo(10.5, 5);
    expect(level.values[0 * 12 + 1 * 4 + 2]).toBeNaN();

    const ground = await decode(output, "ground");
    expect(ground.array.shape).toEqual([3, 4]);
    expect(ground.array.dtype).toBe("uint8");
    expect(ground.values[1 * 4 + 1]).toBeCloseTo(9, 5);
    expect(ground.values[1 * 4 + 2]).toBeCloseTo(9.5, 5);

    const speed = await decode(output, "speed");
    expect(speed.array.shape).toEqual([2, 3, 4]);
    expect(speed.array.dtype).toBe("uint8");
    expect(speed.values[0 * 12 + 1 * 4 + 1]).toBeCloseTo(0.25, 5);
    expect(speed.values[1 * 12 + 1 * 4 + 1]).toBeCloseTo(0.5, 5);
    expect(speed.values[1 * 12 + 1 * 4 + 2]).toBeNaN();
    // The range of the values, for a reader to take as is.
    expect(speed.array.attrs.actual_range).toEqual([0.25, 0.5]);
    expect(speed.array.attrs.robust_range).toEqual([0.25, 0.5]);
  });

  it("writes to an in-memory store, as a browser does", async () => {
    const store = new Map<string, Uint8Array>();
    await writeFloodZarr(store, {
      grid: { lngStep: 0.001, latStep: 0.001, lngOffset: 0, latOffset: 0 },
      times: Float64Array.from([0]),
      frames: [
        {
          x: Int32Array.from([0]),
          y: Int32Array.from([0]),
          level: Float32Array.from([10]),
        },
      ],
      attributes: {},
    });
    expect([...store.keys()]).toContain("/water_level/zarr.json");
    const array = await zarr.open.v3(zarr.root(store).resolve("water_level"), {
      kind: "array",
    });
    // The level is the offset, so it packs to 0.
    expect(await zarr.get(array, [0, 1, 1])).toBe(0);
  });

  it("refuses frames without a wet cell", async () => {
    const empty = {
      x: new Int32Array(0),
      y: new Int32Array(0),
      level: new Float32Array(0),
    };
    await expect(
      writeFloodZarr(new Map(), {
        grid: { lngStep: 0.001, latStep: 0.001, lngOffset: 0, latOffset: 0 },
        times: Float64Array.from([0]),
        frames: [empty],
        attributes: {},
      }),
    ).rejects.toThrow("No wet cells.");
  });
});
