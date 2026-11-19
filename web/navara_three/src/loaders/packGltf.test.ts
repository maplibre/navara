import { afterEach, describe, expect, it, vi } from "vitest";

import { packGltf } from "./packGltf";

const readGlb = (glb: Uint8Array) => {
  const view = new DataView(glb.buffer, glb.byteOffset);
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(
    new TextDecoder().decode(glb.subarray(20, 20 + jsonLength)),
  );
  const binStart = 20 + jsonLength + 8;
  return {
    magic: new TextDecoder().decode(glb.subarray(0, 4)),
    length: view.getUint32(8, true),
    json,
    bin: glb.subarray(binStart, binStart + view.getUint32(binStart - 8, true)),
  };
};

describe("packGltf", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("packs external buffers into the BIN chunk and remaps buffer views", async () => {
    const files: Record<string, number[]> = {
      "https://example.com/t/a.bin?key=1": [1, 2, 3],
      "https://example.com/t/b.bin?v=2&key=1": [4, 5, 6, 7, 8],
    };
    vi.stubGlobal("fetch", async (url: string) => {
      const data = files[url];
      return data
        ? new Response(new Uint8Array(data))
        : new Response(null, { status: 404 });
    });
    const gltf = {
      buffers: [
        { uri: "a.bin", byteLength: 3 },
        // An EXT_meshopt_compression fallback buffer has no uri.
        { byteLength: 16 },
        { uri: "b.bin?v=2", byteLength: 5 },
      ],
      bufferViews: [
        { buffer: 0, byteLength: 3 },
        {
          buffer: 1,
          byteLength: 16,
          extensions: {
            EXT_meshopt_compression: {
              buffer: 2,
              byteOffset: 1,
              byteLength: 4,
            },
          },
        },
        { buffer: 2, byteOffset: 2, byteLength: 3 },
      ],
      images: [{ uri: "tex.png" }],
    };

    const glb = await packGltf(
      new TextEncoder().encode(JSON.stringify(gltf)),
      "https://example.com/t/tile.gltf?key=1",
    );
    const { magic, length, json, bin } = readGlb(glb);

    expect(magic).toBe("glTF");
    expect(length).toBe(glb.byteLength);
    expect(json.buffers).toEqual([{ byteLength: 12 }, { byteLength: 16 }]);
    // b.bin starts at 4, after a.bin padded to 4 bytes.
    expect(json.bufferViews).toEqual([
      { buffer: 0, byteOffset: 0, byteLength: 3 },
      {
        buffer: 1,
        byteOffset: 0,
        byteLength: 16,
        extensions: {
          EXT_meshopt_compression: { buffer: 0, byteOffset: 5, byteLength: 4 },
        },
      },
      { buffer: 0, byteOffset: 6, byteLength: 3 },
    ]);
    expect(json.images).toEqual([{ uri: "tex.png" }]);
    expect([...bin]).toEqual([1, 2, 3, 0, 4, 5, 6, 7, 8, 0, 0, 0]);
  });
});
