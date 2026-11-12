import type { ViewContext } from "@navaramap/three";
import {
  FloatType,
  HalfFloatType,
  InstancedMesh,
  Material,
  Mesh,
  type BufferAttribute,
  type BufferGeometry,
  type InterleavedBufferAttribute,
  type Object3D,
  Texture,
} from "three";

/** Resident cost of one layer's objects in the main scenes. */
export type LayerCost = {
  /** The layer id, or a bucket name for untagged objects. */
  key: string;
  objects: number;
  visible: number;
  /** Instances summed over instanced meshes (1 per plain mesh). */
  instances: number;
  triangles: number;
  geometryBytes: number;
  textureBytes: number;
};

const TERRAIN_BUCKET = "(terrain tiles)";
const UNTAGGED_BUCKET = "(mesh descriptors, other)";
const MIPMAP_FACTOR = 1.33;

function bytesPerElement(
  attribute: BufferAttribute | InterleavedBufferAttribute,
): number {
  // The CPU array is released after upload (`releaseGeometryArrays`), so the
  // element size is read from it only while it is still there.
  const array = (attribute as { array?: ArrayBufferView | null }).array;
  return array
    ? (array as unknown as { BYTES_PER_ELEMENT: number }).BYTES_PER_ELEMENT
    : 4;
}

function geometryBytes(geometry: BufferGeometry): number {
  let bytes = 0;
  for (const attribute of Object.values(geometry.attributes)) {
    bytes += attribute.count * attribute.itemSize * bytesPerElement(attribute);
  }
  if (geometry.index) {
    bytes +=
      geometry.index.count *
      geometry.index.itemSize *
      bytesPerElement(geometry.index);
  }
  return bytes;
}

function geometryTriangles(geometry: BufferGeometry): number {
  const count = geometry.index
    ? geometry.index.count
    : (geometry.attributes.position?.count ?? 0);
  return Math.floor(count / 3);
}

function textureBytes(texture: Texture): number {
  const image = texture.image as
    { width?: number; height?: number; data?: ArrayBufferView } | undefined;
  if (!image?.width || !image.height) return 0;
  const perTexel =
    texture.type === FloatType ? 16 : texture.type === HalfFloatType ? 8 : 4;
  let bytes = image.width * image.height * perTexel;
  if (texture.generateMipmaps) bytes = Math.floor(bytes * MIPMAP_FACTOR);
  return bytes;
}

function collectUniformTextures(
  uniforms: Record<string, unknown> | undefined,
  out: Set<Texture>,
): void {
  if (!uniforms) return;
  for (const uniform of Object.values(uniforms)) {
    const value = (uniform as { value?: unknown } | null)?.value;
    if (value instanceof Texture) out.add(value);
  }
}

/**
 * Textures a material samples: its map properties, `ShaderMaterial`
 * uniforms, and the uniforms the built-in materials attach through
 * `userData` for `onBeforeCompile` (the tile atlases, the batch textures).
 */
function materialTextures(material: Material, out: Set<Texture>): void {
  for (const value of Object.values(material)) {
    if (value instanceof Texture) out.add(value);
  }
  collectUniformTextures(
    (material as { uniforms?: Record<string, unknown> }).uniforms,
    out,
  );
  collectUniformTextures(material.userData as Record<string, unknown>, out);
}

/**
 * Sums the resident cost of every object under the tagged roots of the
 * main scenes (`mrt`, `opaque`, `transparent`), grouped by `userData.layerId`.
 * Terrain tiles (the `globe` scene) and untagged roots fall into their own
 * buckets. Geometries and textures shared between objects count once per
 * group. Draped layers bake into tile textures and own no objects here.
 */
export function collectLayerCosts(ctx: ViewContext): Map<string, LayerCost> {
  const costs = new Map<string, LayerCost>();
  const seenGeometry = new Map<string, Set<string>>();
  const seenTexture = new Map<string, Set<string>>();

  const cost = (key: string): LayerCost => {
    let c = costs.get(key);
    if (!c) {
      c = {
        key,
        objects: 0,
        visible: 0,
        instances: 0,
        triangles: 0,
        geometryBytes: 0,
        textureBytes: 0,
      };
      costs.set(key, c);
      seenGeometry.set(key, new Set());
      seenTexture.set(key, new Set());
    }
    return c;
  };

  const account = (key: string, root: Object3D, rootVisible: boolean) => {
    const c = cost(key);
    const geometries = seenGeometry.get(key) as Set<string>;
    const textures = seenTexture.get(key) as Set<string>;
    root.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      c.objects++;
      const visible = rootVisible && object.visible;
      if (visible) c.visible++;
      const instances = object instanceof InstancedMesh ? object.count : 1;
      c.instances += instances;
      const geometry = object.geometry as BufferGeometry;
      c.triangles += geometryTriangles(geometry) * instances;
      if (!geometries.has(geometry.uuid)) {
        geometries.add(geometry.uuid);
        c.geometryBytes += geometryBytes(geometry);
      }
      const materials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      const found = new Set<Texture>();
      for (const material of materials) materialTextures(material, found);
      for (const texture of found) {
        if (textures.has(texture.uuid)) continue;
        textures.add(texture.uuid);
        c.textureBytes += textureBytes(texture);
      }
    });
  };

  const { scenes } = ctx;
  for (const scene of [scenes.mrt, scenes.opaque, scenes.transparent]) {
    for (const root of scene.children) {
      const layerId = root.userData.layerId as string | undefined;
      account(layerId ?? UNTAGGED_BUCKET, root, root.visible);
    }
  }
  for (const root of scenes.globe.children) {
    account(TERRAIN_BUCKET, root, root.visible);
  }
  return costs;
}
