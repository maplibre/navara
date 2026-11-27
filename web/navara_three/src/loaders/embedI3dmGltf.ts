import { mergeQuery } from "./mergeQuery";
import { packGltf } from "./packGltf";

const HEADER_LENGTH = 32;
const GLB_MAGIC = 0x46546c67; // "glTF"
const CHUNK_JSON = 0x4e4f534a; // "JSON"
// A URI with a scheme (`data:`, `https:`) is not relative.
// ref: https://www.rfc-editor.org/rfc/rfc3986#section-3.1
const HAS_SCHEME = /^[a-z][a-z\d+.-]*:/i;

type UriRef = { uri?: string };

/**
 * Embeds the glTF an I3DM references by URI (`gltfFormat: 0`) into the tile,
 * since the engine reads an embedded glTF only. A `.gltf` is packed into a
 * GLB. Relative image and buffer URIs in it are rewritten to absolute URLs,
 * since the engine resolves them against the tile's URL instead of the glTF's.
 * Other tiles are returned as is.
 *
 * ref: https://github.com/CesiumGS/3d-tiles/blob/main/specification/TileFormats/Instanced3DModel/README.adoc#gltf
 * ref: https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#uris
 */
export async function embedI3dmGltf(
  tile: Uint8Array<ArrayBuffer>,
  url: string,
  init?: RequestInit,
): Promise<Uint8Array<ArrayBuffer>> {
  if (tile.byteLength < HEADER_LENGTH) return tile;
  const view = new DataView(tile.buffer, tile.byteOffset, tile.byteLength);
  if (view.getUint32(28, true) !== 0) return tile;

  // The glTF follows the feature and batch tables.
  let gltfStart = HEADER_LENGTH;
  for (let offset = 12; offset < 28; offset += 4) {
    gltfStart += view.getUint32(offset, true);
  }
  // The URI is padded with spaces to an 8-byte boundary.
  const uri = new TextDecoder()
    .decode(tile.subarray(gltfStart))
    .replace(/[\s\0]+$/, "");
  const gltfUrl = mergeQuery(new URL(url).search)(new URL(uri, url).href);
  const res = await fetch(gltfUrl, init);
  if (!res.ok) {
    throw new Error(`Request failed with ${res.status} ${res.statusText}`);
  }
  let glb = new Uint8Array(await res.arrayBuffer());
  if (
    glb.byteLength < 4 ||
    new DataView(glb.buffer).getUint32(0, true) !== GLB_MAGIC
  ) {
    glb = await packGltf(glb, gltfUrl, init);
  }
  glb = absolutizeGlbUris(glb, gltfUrl);

  const embedded = new Uint8Array(gltfStart + glb.byteLength);
  embedded.set(tile.subarray(0, gltfStart));
  embedded.set(glb, gltfStart);
  const header = new DataView(embedded.buffer);
  header.setUint32(8, embedded.byteLength, true);
  header.setUint32(28, 1, true);
  return embedded;
}

/** Resolves the relative image and buffer URIs of a GLB against `url`. */
function absolutizeGlbUris(
  glb: Uint8Array<ArrayBuffer>,
  url: string,
): Uint8Array<ArrayBuffer> {
  const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  const jsonEnd = 20 + view.getUint32(12, true);
  const gltf = JSON.parse(
    new TextDecoder().decode(glb.subarray(20, jsonEnd)),
  ) as { images?: UriRef[]; buffers?: UriRef[] };
  const resolve = mergeQuery(new URL(url).search);
  let changed = false;
  for (const ref of [...(gltf.images ?? []), ...(gltf.buffers ?? [])]) {
    if (ref.uri === undefined || HAS_SCHEME.test(ref.uri)) continue;
    ref.uri = resolve(new URL(ref.uri, url).href);
    changed = true;
  }
  if (!changed) return glb;

  const json = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonLength = (json.byteLength + 3) & ~3;
  const rest = glb.subarray(jsonEnd);
  const out = new Uint8Array(20 + jsonLength + rest.byteLength);
  out.set(glb.subarray(0, 12));
  const header = new DataView(out.buffer);
  header.setUint32(8, out.byteLength, true);
  header.setUint32(12, jsonLength, true);
  header.setUint32(16, CHUNK_JSON, true);
  out.set(json, 20);
  // The JSON chunk is padded with spaces.
  out.fill(0x20, 20 + json.byteLength, 20 + jsonLength);
  out.set(rest, 20 + jsonLength);
  return out;
}
