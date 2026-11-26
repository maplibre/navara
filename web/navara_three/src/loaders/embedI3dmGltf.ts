import { mergeQuery } from "./mergeQuery";
import { packGltf } from "./packGltf";

const HEADER_LENGTH = 32;
const GLB_MAGIC = 0x46546c67; // "glTF"

/**
 * Embeds the glTF an I3DM references by URI (`gltfFormat: 0`) into the tile,
 * since the engine reads an embedded glTF only. A `.gltf` is packed into a
 * GLB. Other tiles are returned as is.
 *
 * ref: https://github.com/CesiumGS/3d-tiles/blob/main/specification/TileFormats/Instanced3DModel/README.adoc#gltf
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

  const embedded = new Uint8Array(gltfStart + glb.byteLength);
  embedded.set(tile.subarray(0, gltfStart));
  embedded.set(glb, gltfStart);
  const header = new DataView(embedded.buffer);
  header.setUint32(8, embedded.byteLength, true);
  header.setUint32(28, 1, true);
  return embedded;
}
