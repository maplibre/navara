import {
  PointColorsFormat,
  PointPositionsFormat,
  type PointCloudLayout,
} from "@navaramap/engine";
import { BufferAttribute, BufferGeometry } from "three";
import { describe, expect, it, vi } from "vitest";

import { decodeDracoAsync } from "../../tasks/decodeDracoAsync";

import { createPntsGeometry, decodeRgb565 } from "./pnts";

vi.mock("../../tasks/decodeDracoAsync", () => ({ decodeDracoAsync: vi.fn() }));

const layout = (overrides: Partial<PointCloudLayout>) =>
  ({
    pointCount: 2,
    positionsFormat: PointPositionsFormat.Float32,
    positionsByteOffset: 0,
    positionsByteLength: 0,
    positionsOrigin: { x: 0, y: 0, z: 0 },
    quantizedVolumeScale: { x: 0, y: 0, z: 0 },
    dracoByteOffset: 0,
    dracoByteLength: 0,
    colorsFormat: PointColorsFormat.None,
    colorsByteOffset: 0,
    constantColor: 0,
    ...overrides,
  }) as PointCloudLayout;

describe("decodeRgb565", () => {
  it("should scale each channel to 0..=255", () => {
    // r = 16 / 31, g = 32 / 63, b = 31 / 31.
    const rgb565 = (16 << 11) | (32 << 5) | 31;
    expect([
      ...decodeRgb565(new Uint8Array([rgb565 & 0xff, rgb565 >> 8])),
    ]).toEqual([132, 130, 255]);
  });
});

describe("createPntsGeometry", () => {
  it("should re-center absolute positions and copy them out of the bin", async () => {
    const positions = new Float32Array([
      1215010.4, -4736313.5, 4081601.8, 1215011.5, -4736313, 4081602,
    ]);
    const bin = new Uint8Array(4 + positions.byteLength + 6);
    bin.set(new Uint8Array(positions.buffer), 4);
    bin.set([1, 2, 3, 4, 5, 6], 4 + positions.byteLength);
    const [x, y, z] = positions;

    const { geometry, scale } = await createPntsGeometry(
      bin,
      layout({
        positionsByteOffset: 4,
        positionsByteLength: positions.byteLength,
        positionsOrigin: { x, y, z } as PointCloudLayout["positionsOrigin"],
        colorsFormat: PointColorsFormat.Rgb8,
        colorsByteOffset: 4 + positions.byteLength,
      }),
      undefined,
    );
    bin.fill(0);

    expect(scale).toBeUndefined();
    expect([...geometry.getAttribute("position").array]).toEqual([
      0,
      0,
      0,
      Math.fround(1215011.5 - x),
      Math.fround(-4736313 - y),
      Math.fround(4081602 - z),
    ]);
    const color = geometry.getAttribute("color");
    expect(color.itemSize).toBe(3);
    expect(color.normalized).toBe(true);
    expect([...color.array]).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("should scale quantized positions to the volume", async () => {
    const bin = new Uint8Array(new Uint16Array([0, 65535, 0]).buffer);

    const { geometry, scale } = await createPntsGeometry(
      bin,
      layout({
        pointCount: 1,
        positionsFormat: PointPositionsFormat.Uint16,
        positionsByteLength: 6,
        quantizedVolumeScale: {
          x: 10,
          y: 20,
          z: 30,
        } as PointCloudLayout["quantizedVolumeScale"],
      }),
      undefined,
    );

    const position = geometry.getAttribute("position");
    expect(position.normalized).toBe(true);
    expect(position.getY(0)).toBe(1);
    expect(scale?.toArray()).toEqual([10, 20, 30]);
    expect(geometry.hasAttribute("color")).toBe(false);
  });

  it("should keep raw positions beside a Draco blob without them", async () => {
    const decoded = new BufferGeometry();
    decoded.setAttribute(
      "color",
      new BufferAttribute(new Uint8Array([1, 2, 3]), 3, true),
    );
    vi.mocked(decodeDracoAsync).mockResolvedValueOnce(decoded);
    const bin = new Uint8Array(12 + 2);
    bin.set(new Uint8Array(new Float32Array([1, 2, 3]).buffer));
    bin.set([7, 8], 12);

    const { geometry } = await createPntsGeometry(
      bin,
      layout({
        pointCount: 1,
        positionsByteLength: 12,
        dracoByteOffset: 12,
        dracoByteLength: 2,
      }),
      [],
    );

    const [blob] = vi.mocked(decodeDracoAsync).mock.lastCall ?? [];
    expect([...new Uint8Array(blob as ArrayBuffer)]).toEqual([7, 8]);
    expect(geometry).toBe(decoded);
    expect([...geometry.getAttribute("position").array]).toEqual([1, 2, 3]);
  });
});
