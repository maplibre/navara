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

/** A GLB with a JSON chunk and a 4-byte BIN chunk. */
const glb = (json: object) => {
  const text = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = (text.byteLength + 3) & ~3;
  const out = new Uint8Array(20 + jsonLength + 12);
  const view = new DataView(out.buffer);
  out.set(new TextEncoder().encode("glTF"));
  view.setUint32(4, 2, true);
  view.setUint32(8, out.byteLength, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.set(text, 20);
  out.fill(0x20, 20 + text.byteLength, 20 + jsonLength);
  view.setUint32(20 + jsonLength, 4, true);
  view.setUint32(24 + jsonLength, 0x004e4942, true);
  out.set([9, 8, 7, 6], 28 + jsonLength);
  return out;
};

/** The JSON and BIN chunks of the GLB embedded by `i3dm`. */
const readEmbedded = (tile: Uint8Array) => {
  const glb = tile.subarray(40);
  const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  const jsonLength = view.getUint32(12, true);
  return {
    length: view.getUint32(8, true),
    byteLength: glb.byteLength,
    jsonLength,
    json: JSON.parse(
      new TextDecoder().decode(glb.subarray(20, 20 + jsonLength)),
    ),
    bin: [...glb.subarray(20 + jsonLength)],
  };
};

describe("embedI3dmGltf", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("embeds the glb a URI references", async () => {
    const box = glb({ asset: { version: "2.0" } });
    const fetch = vi.fn(async () => new Response(box));
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
    expect([...tile.subarray(40)]).toEqual([...box]);
  });

  // standard: glTF 2.0 §2.8 URIs — relative paths are relative to the glTF,
  // not to the I3DM that references it.
  // ref: https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#uris
  it("resolves relative URIs inside a referenced glb against the glb's URL", async () => {
    const dataUri = "data:image/png;base64,AAAA";
    const absolute = "https://cdn.example.com/x.png";
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            glb({
              asset: { version: "2.0" },
              images: [
                { uri: "bricks.jpg" },
                { uri: dataUri },
                { uri: absolute },
                { bufferView: 0, mimeType: "image/png" },
              ],
              buffers: [{ byteLength: 4 }, { uri: "../extra.bin?v=2" }],
            }),
          ),
      ),
    );

    const tile = await embedI3dmGltf(
      i3dm(0, new TextEncoder().encode("models/box.glb?v=1 ")),
      "https://example.com/t/tile.i3dm?key=1",
    );

    const embedded = readEmbedded(tile);
    expect(embedded.json.images).toEqual([
      { uri: "https://example.com/t/models/bricks.jpg?v=1&key=1" },
      { uri: dataUri },
      { uri: absolute },
      { bufferView: 0, mimeType: "image/png" },
    ]);
    expect(embedded.json.buffers).toEqual([
      { byteLength: 4 },
      { uri: "https://example.com/t/extra.bin?v=2&key=1" },
    ]);
    expect(embedded.jsonLength % 4).toBe(0);
    expect(embedded.length).toBe(embedded.byteLength);
    expect(embedded.bin).toEqual([4, 0, 0, 0, 0x42, 0x49, 0x4e, 0, 9, 8, 7, 6]);
    expect(new DataView(tile.buffer).getUint32(8, true)).toBe(tile.byteLength);
  });

  it("resolves image URIs inside a referenced .gltf against the .gltf's URL", async () => {
    const files: Record<string, Uint8Array<ArrayBuffer>> = {
      "https://example.com/t/models/box.gltf?key=1": new TextEncoder().encode(
        JSON.stringify({
          asset: { version: "2.0" },
          images: [{ uri: "tex/bricks.jpg" }],
          buffers: [{ uri: "box.bin", byteLength: 4 }],
          bufferViews: [{ buffer: 0, byteLength: 4 }],
        }),
      ),
      "https://example.com/t/models/box.bin?key=1": new Uint8Array([
        1, 2, 3, 4,
      ]),
    };
    vi.stubGlobal("fetch", async (url: string) =>
      files[url]
        ? new Response(files[url])
        : new Response(null, { status: 404 }),
    );

    const tile = await embedI3dmGltf(
      i3dm(0, new TextEncoder().encode("models/box.gltf ")),
      "https://example.com/t/tile.i3dm?key=1",
    );

    const { json } = readEmbedded(tile);
    expect(json.images).toEqual([
      { uri: "https://example.com/t/models/tex/bricks.jpg?key=1" },
    ]);
    expect(json.buffers).toEqual([{ byteLength: 4 }]);
  });

  it("returns an embedded glTF as is", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const tile = i3dm(1, new Uint8Array(8));

    expect(await embedI3dmGltf(tile, "https://example.com/t.i3dm")).toBe(tile);
    expect(fetch).not.toHaveBeenCalled();
  });
});
