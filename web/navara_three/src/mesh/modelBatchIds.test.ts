import {
  BufferAttribute,
  BufferGeometry,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  InterleavedBuffer,
  InterleavedBufferAttribute,
  Mesh,
  type Object3D,
} from "three";
import { describe, expect, it } from "vitest";

import {
  featureIdTextureSet,
  featureIndexAttribute,
  shareAttributes,
  vertexGlobalBatchIds,
} from "./modelBatchIds";

describe("vertexGlobalBatchIds", () => {
  const globalBatchIds = [100, 200, 300];

  it("maps each vertex's feature index to its global batch id", () => {
    const featureIndices = new BufferAttribute(new Uint16Array([2, 0, 1]), 1);

    expect(
      Array.from(vertexGlobalBatchIds(featureIndices, globalBatchIds)),
    ).toEqual([300, 100, 200]);
  });

  it("reads 1-byte indices padded to a 4-byte stride", () => {
    // The padding bytes are not indices.
    const bytes = new Uint8Array([2, 9, 9, 9, 0, 9, 9, 9, 1, 9, 9, 9]);
    const featureIndices = new InterleavedBufferAttribute(
      new InterleavedBuffer(bytes, 4),
      1,
      0,
    );

    expect(
      Array.from(vertexGlobalBatchIds(featureIndices, globalBatchIds)),
    ).toEqual([300, 100, 200]);
  });

  it("gives 0 to an index without a global batch id", () => {
    const featureIndices = new BufferAttribute(new Uint8Array([5]), 1);

    expect(
      Array.from(vertexGlobalBatchIds(featureIndices, globalBatchIds)),
    ).toEqual([0]);
  });
});

describe("featureIndexAttribute", () => {
  const gltf = { propertyTable: undefined };

  const geometry = () => {
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(9), 3));
    return g;
  };

  const withFeatureIds = <T extends Object3D>(
    object: T,
    extension: "EXT_instance_features" | "EXT_mesh_features",
    set: object,
  ) => {
    object.userData.gltfExtensions = { [extension]: { featureIds: [set] } };
    return object;
  };

  it("reads the named instance attribute, not the vertex one", () => {
    const g = geometry();
    const instance = new InstancedBufferAttribute(new Float32Array([1, 0]), 1);
    g.setAttribute("_FEATURE_ID_1", instance);
    g.setAttribute(
      "_feature_id_1",
      new BufferAttribute(new Float32Array(3), 1),
    );
    const mesh = withFeatureIds(
      new InstancedMesh(g, undefined, 2),
      "EXT_instance_features",
      { attribute: 1 },
    );

    expect(featureIndexAttribute(mesh, gltf)).toBe(instance);
  });

  it("numbers instances for implicit instance feature IDs of a group node", () => {
    const mesh = new InstancedMesh(geometry(), undefined, 3);
    withFeatureIds(new Group(), "EXT_instance_features", {}).add(mesh);

    const indices = featureIndexAttribute(mesh, gltf);
    expect(indices).toBeInstanceOf(InstancedBufferAttribute);
    expect(Array.from(indices?.array ?? [])).toEqual([0, 1, 2]);
  });

  it("numbers vertices for implicit vertex feature IDs", () => {
    const mesh = withFeatureIds(new Mesh(geometry()), "EXT_mesh_features", {});

    const indices = featureIndexAttribute(mesh, gltf);
    expect(indices).not.toBeInstanceOf(InstancedBufferAttribute);
    expect(Array.from(indices?.array ?? [])).toEqual([0, 1, 2]);
  });

  it("reads the vertex feature IDs of a mesh next to instanced ones", () => {
    const g = geometry();
    const vertex = new BufferAttribute(new Float32Array(3), 1);
    g.setAttribute("_feature_id_0", vertex);
    const mesh = withFeatureIds(new Mesh(g), "EXT_mesh_features", {
      attribute: 0,
    });
    withFeatureIds(new Group(), "EXT_instance_features", {}).add(mesh);

    expect(featureIndexAttribute(mesh, gltf)).toBe(vertex);
  });

  it("gives no feature IDs for a set of another property table", () => {
    const g = geometry();
    g.setAttribute(
      "_feature_id_0",
      new BufferAttribute(new Float32Array(3), 1),
    );
    const mesh = withFeatureIds(new Mesh(g), "EXT_mesh_features", {
      attribute: 0,
      propertyTable: 1,
    });

    expect(featureIndexAttribute(mesh, { propertyTable: 0 })).toBeUndefined();
  });

  it("gives no feature IDs for IDs in a texture", () => {
    const mesh = withFeatureIds(new Mesh(geometry()), "EXT_mesh_features", {
      texture: { index: 0 },
    });

    expect(featureIndexAttribute(mesh, gltf)).toBeUndefined();
  });

  describe("featureIdTextureSet", () => {
    it("gives the default set when it reads a texture", () => {
      const mesh = withFeatureIds(new Mesh(geometry()), "EXT_mesh_features", {
        featureCount: 4,
        texture: { index: 1, channels: [0] },
        propertyTable: 0,
      });

      expect(featureIdTextureSet(mesh)).toMatchObject({
        featureCount: 4,
        texture: { index: 1 },
      });
    });

    it("gives none for an attribute set", () => {
      const mesh = withFeatureIds(new Mesh(geometry()), "EXT_mesh_features", {
        attribute: 0,
      });

      expect(featureIdTextureSet(mesh)).toBeUndefined();
    });

    it("gives none when the node's instance set takes precedence", () => {
      const mesh = withFeatureIds(
        new InstancedMesh(geometry(), undefined, 2),
        "EXT_mesh_features",
        { texture: { index: 0 } },
      );
      withFeatureIds(new Group(), "EXT_instance_features", {}).add(mesh);

      expect(featureIdTextureSet(mesh)).toBeUndefined();
    });
  });
});

describe("shareAttributes", () => {
  it("shares the attributes but not their set", () => {
    const source = new BufferGeometry();
    const position = new BufferAttribute(new Float32Array(9), 3);
    source.setAttribute("position", position);

    const shared = shareAttributes(source);
    shared.setAttribute("batchId", new BufferAttribute(new Float32Array(3), 1));

    expect(shared.attributes.position).toBe(position);
    expect(source.attributes.batchId).toBeUndefined();
  });
});
