import {
  BufferAttribute,
  BufferGeometry,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  type InterleavedBufferAttribute,
  type Mesh,
  type Object3D,
} from "three";

/**
 * Maps each vertex's feature index (`_batchid`) to its global batch id, 0
 * where the index has none. Read through the attribute rather than its
 * array: a b3dm `_BATCHID` of 1-byte components is padded to a 4-byte
 * stride, which three loads as an interleaved attribute.
 */
export function vertexGlobalBatchIds(
  featureIndices: BufferAttribute | InterleavedBufferAttribute,
  globalBatchIds: ArrayLike<number>,
): Float32Array {
  const ids = new Float32Array(featureIndices.count);
  for (let i = 0; i < ids.length; i++) {
    ids[i] = globalBatchIds[featureIndices.getX(i)] ?? 0;
  }
  return ids;
}

type FeatureIdSet = {
  attribute?: number;
  texture?: unknown;
  propertyTable?: number;
};

/** How a glTF with `EXT_mesh_features` / `EXT_instance_features` maps feature IDs. */
export type GltfFeatureIds = {
  /** The property table the batch IDs index. */
  propertyTable: number | undefined;
};

/** The first feature ID set of a glTF extension `GLTFLoader` kept on `object`. */
function firstFeatureIdSet(
  object: Object3D,
  extension: "EXT_instance_features" | "EXT_mesh_features",
): FeatureIdSet | undefined {
  const extensions = object.userData.gltfExtensions as
    Record<string, { featureIds?: FeatureIdSet[] } | undefined> | undefined;
  return extensions?.[extension]?.featureIds?.[0];
}

/**
 * The first feature ID set of the node's `EXT_instance_features`. A node
 * with several primitives is a group of instanced meshes, which holds the
 * node's extensions.
 */
function instanceFeatureIdSet(mesh: InstancedMesh): FeatureIdSet | undefined {
  const parent = mesh.parent;
  return (
    firstFeatureIdSet(mesh, "EXT_instance_features") ??
    (parent instanceof Group
      ? firstFeatureIdSet(parent, "EXT_instance_features")
      : undefined)
  );
}

export function vertexCount(geometry: BufferGeometry): number {
  const { attributes } = geometry;
  return "position" in attributes ? attributes.position.count : 0;
}

/**
 * The per-vertex or per-instance feature index of a glTF mesh. B3DM content
 * names it `_BATCHID`. A glTF with `gltfFeatureIds` names it with the first
 * feature ID set, as CesiumJS reads by default: that of the node's
 * `EXT_instance_features` for an instanced mesh, else of the primitive's
 * `EXT_mesh_features`. `GLTFLoader` keeps unknown extensions in
 * `userData.gltfExtensions`, and lowercases the names of vertex attributes,
 * not instance attributes. `undefined` when the mesh has none, reads them
 * from a texture, or from a set of another property table.
 */
export function featureIndexAttribute(
  mesh: Mesh,
  gltfFeatureIds: GltfFeatureIds | undefined,
): BufferAttribute | InterleavedBufferAttribute | undefined {
  const attrs = mesh.geometry.attributes;
  if (!gltfFeatureIds) {
    return attrs._batchid ?? attrs._feature_id_0;
  }
  const instanceSet =
    mesh instanceof InstancedMesh ? instanceFeatureIdSet(mesh) : undefined;
  const set = instanceSet ?? firstFeatureIdSet(mesh, "EXT_mesh_features");
  if (
    !set ||
    set.texture !== undefined ||
    set.propertyTable !== gltfFeatureIds.propertyTable
  ) {
    return undefined;
  }
  const perInstance = instanceSet !== undefined;
  const n = set.attribute;
  if (n !== undefined) {
    return attrs[perInstance ? `_FEATURE_ID_${n}` : `_feature_id_${n}`];
  }
  // Implicit IDs are the instance or vertex index.
  const count = perInstance
    ? (mesh as InstancedMesh).count
    : vertexCount(mesh.geometry);
  const indices = new Float32Array(count);
  for (let i = 0; i < count; i++) indices[i] = i;
  return perInstance
    ? new InstancedBufferAttribute(indices, 1)
    : new BufferAttribute(indices, 1);
}

/**
 * A geometry sharing the attributes of `source`, so attributes set on it do
 * not reach the other meshes of `source`.
 */
export function shareAttributes(source: BufferGeometry): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.name = source.name;
  geometry.setIndex(source.index);
  for (const [name, attribute] of Object.entries(source.attributes)) {
    geometry.setAttribute(name, attribute);
  }
  geometry.morphAttributes = { ...source.morphAttributes };
  geometry.morphTargetsRelative = source.morphTargetsRelative;
  for (const { start, count, materialIndex } of source.groups) {
    geometry.addGroup(start, count, materialIndex);
  }
  geometry.boundingBox = source.boundingBox?.clone() ?? null;
  geometry.boundingSphere = source.boundingSphere?.clone() ?? null;
  geometry.setDrawRange(source.drawRange.start, source.drawRange.count);
  geometry.userData = { ...source.userData };
  return geometry;
}
