import { afterEach, describe, expect, it, vi } from "vitest";

import { embedI3dmGltf } from "./embedI3dmGltf";

/** An I3DM with an 8-byte feature table JSON and `gltf` after it. */
const i3dm = (gltfFormat: number, gltf: Uint8Array) => {
  const tile = new Uint8Array(32 + 8 + gltf.byteLength);
  const view = new DataView(tile.buffer);
  tile.set(new TextEncoder().encode("i3dm"));
  view.setUint32(4, 1, true);
  view.setUint32(8, tile.byteLength, true);
  view.setUint32(12, 8, true);
  view.setUint32(28, gltfFormat, true);
  tile.set(new TextEncoder().encode('{"a":1} '), 32);
  tile.set(gltf, 40);
  return tile;
};

describe("embedI3dmGltf", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("embeds the glb a URI references", async () => {
    const glb = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0]);
    const fetch = vi.fn(async () => new Response(glb));
    vi.stubGlobal("fetch", fetch);

    const tile = await embedI3dmGltf(
      i3dm(0, new TextEncoder().encode("box.glb ")),
      "https://example.com/t/tile.i3dm?key=1",
    );

    expect(fetch).toHaveBeenCalledWith(
      "https://example.com/t/box.glb?key=1",
      undefined,
    );
    const view = new DataView(tile.buffer);
    expect(view.getUint32(8, true)).toBe(tile.byteLength);
    expect(view.getUint32(28, true)).toBe(1);
    expect(new TextDecoder().decode(tile.subarray(32, 40))).toBe('{"a":1} ');
    expect([...tile.subarray(40)]).toEqual([...glb]);
  });

  it("returns an embedded glTF as is", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const tile = i3dm(1, new Uint8Array(8));

    expect(await embedI3dmGltf(tile, "https://example.com/t.i3dm")).toBe(tile);
    expect(fetch).not.toHaveBeenCalled();
  });
});
