import { mergeQuery } from "./mergeQuery";

type BufferRef = { buffer: number; byteOffset?: number };

type GltfBuffer = { uri?: string; byteLength: number };

type GltfJson = {
  buffers?: GltfBuffer[];
  bufferViews?: (BufferRef & {
    extensions?: { EXT_meshopt_compression?: BufferRef };
  })[];
};

const GLB_MAGIC = 0x46546c67; // "glTF"
const CHUNK_JSON = 0x4e4f534a; // "JSON"
const CHUNK_BIN = 0x004e4942; // "BIN\0"

const align4 = (n: number) => (n + 3) & ~3;

/**
 * Packs a JSON glTF fetched from `url` into a GLB, since the engine reads
 * `EXT_mesh_features` / `EXT_structural_metadata` from GLB only.
 *
 * Buffers with a `uri` are fetched with `init`, resolved against `url` with
 * its query merged like other glTF resources, and concatenated into the BIN
 * chunk. Buffers without one (`EXT_meshopt_compression` fallbacks) follow it
 * as is. Images keep their `uri`.
 */
export async function packGltf(
  json: Uint8Array,
  url: string,
  init?: RequestInit,
): Promise<Uint8Array<ArrayBuffer>> {
  const gltf = JSON.parse(new TextDecoder().decode(json)) as GltfJson;
  const buffers = gltf.buffers ?? [];
  const resolve = mergeQuery(new URL(url).search);
  const fetched = await Promise.all(
    buffers.map(async ({ uri }) => {
      if (uri === undefined) return undefined;
      const res = await fetch(resolve(new URL(uri, url).href), init);
      if (!res.ok) {
        throw new Error(`Request failed with ${res.status} ${res.statusText}`);
      }
      return new Uint8Array(await res.arrayBuffer());
    }),
  );

  const bin = { byteLength: 0 };
  const packed: GltfBuffer[] = fetched.some(Boolean) ? [bin] : [];
  const remap = fetched.map((data, i) => {
    if (!data) {
      return { buffer: packed.push(buffers[i]) - 1, offset: 0 };
    }
    const offset = bin.byteLength;
    bin.byteLength = align4(offset + data.byteLength);
    return { buffer: 0, offset };
  });
  const rebase = (ref: BufferRef) => {
    const { buffer, offset } = remap[ref.buffer];
    ref.byteOffset = (ref.byteOffset ?? 0) + offset;
    ref.buffer = buffer;
  };
  for (const view of gltf.bufferViews ?? []) {
    rebase(view);
    const meshopt = view.extensions?.EXT_meshopt_compression;
    if (meshopt) rebase(meshopt);
  }
  gltf.buffers = packed;

  const jsonChunk = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonLength = align4(jsonChunk.byteLength);
  const binStart = 20 + jsonLength;
  const glb = new Uint8Array(
    binStart + (packed[0] === bin ? 8 + bin.byteLength : 0),
  );
  const view = new DataView(glb.buffer);
  view.setUint32(0, GLB_MAGIC, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, glb.byteLength, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, CHUNK_JSON, true);
  glb.set(jsonChunk, 20);
  // The JSON chunk is padded with spaces.
  glb.fill(0x20, 20 + jsonChunk.byteLength, binStart);
  if (packed[0] === bin) {
    view.setUint32(binStart, bin.byteLength, true);
    view.setUint32(binStart + 4, CHUNK_BIN, true);
    fetched.forEach((data, i) => {
      if (data) glb.set(data, binStart + 8 + remap[i].offset);
    });
  }
  return glb;
}
