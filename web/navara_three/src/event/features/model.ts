import type {
  DracoAttributeId,
  ModelMesh as NavaraModelMesh,
} from "@navaramap/engine";
import { degreeToRadian } from "@navaramap/three-api";
import {
  BufferGeometry,
  Points,
  Group,
  Float32BufferAttribute,
  PointsMaterial,
  Box3,
  Vector3,
  Box3Helper,
  Mesh,
  Sphere,
} from "three";

import { createGltfLoader } from "../../loaders";
import type { DracoDecodeConfig } from "../../loaders/dracoGeometry";
import { ModelMesh } from "../../mesh/model";
import { decodeDracoAsync } from "../../tasks/decodeDracoAsync";
import { toCreasedNormalsAsync } from "../../tasks/toCreasedNormalsAsync";
import type { EventContext } from "../context";

/**
 * Recompute vertex normals via `toCreasedNormalsAsync` for every Mesh in the
 * loaded scene. Awaited before the `ModelMesh` is constructed so downstream
 * material/shadow setup observes the final geometry.
 */
async function applyCreasedNormals(
  scene: Group,
  creaseAngle: number,
): Promise<void> {
  const geometries = new Set<BufferGeometry>();
  scene.traverse((object) => {
    if (object instanceof Mesh && object.geometry instanceof BufferGeometry) {
      geometries.add(object.geometry);
    }
  });

  await Promise.all(
    [...geometries].map((geometry) =>
      toCreasedNormalsAsync(geometry, creaseAngle),
    ),
  );
}

// ref: https://github.com/CesiumGS/3d-tiles/blob/main/specification/TileFormats/PointCloud/README.adoc#semantics
const PNTS_DRACO_ATTRIBUTES: Record<
  string,
  [name: string, type: DracoDecodeConfig["attributeTypes"][string]]
> = {
  POSITION: ["position", "Float32Array"],
  RGB: ["color", "Uint8Array"],
  RGBA: ["color", "Uint8Array"],
  NORMAL: ["normal", "Float32Array"],
};

/**
 * Maps PNTS feature table semantics to three.js attributes; others are
 * skipped. Frees the given attribute ids.
 */
function pntsDracoDecodeConfig(
  dracoAttributes: DracoAttributeId[],
): DracoDecodeConfig {
  const config: DracoDecodeConfig = { attributeIDs: {}, attributeTypes: {} };
  for (const dracoAttribute of dracoAttributes) {
    const attribute = PNTS_DRACO_ATTRIBUTES[dracoAttribute.semantic];
    if (attribute) {
      const [name, type] = attribute;
      config.attributeIDs[name] = dracoAttribute.uniqueId;
      config.attributeTypes[name] = type;
    }
    dracoAttribute.free();
  }
  return config;
}

export async function renderModel(ctx: EventContext, m: NavaraModelMesh) {
  const { rawScene, credit } = await (async () => {
    if (m.bin) {
      // buf.u8 returns a short-lived view into WASM memory; copy it since the
      // bin is consumed asynchronously (Draco / GLTFLoader) via its `.buffer`.
      const bin = ctx.buf.u8(m.bin)?.slice();
      if (!bin) {
        return {};
      }

      const internal = m.material.__internal__;
      // PNTS legacy bin path: only the PNTS parser sets `pointCloud=true`, and the
      // bin here is the extracted position buffer (Draco blob or raw f32), not glTF.
      // 3D Tiles 1.1 glTF tiles (point cloud or not) take the GLTFLoader path below.
      if (internal?.pointCloud) {
        let geometry: BufferGeometry;
        const material = new PointsMaterial({
          size: m.material.pointSize,
          vertexColors: true,
          sizeAttenuation: false,
        });

        const dracoAttributes = internal.dracoAttributes;
        if (dracoAttributes) {
          geometry = await decodeDracoAsync(
            bin.buffer as ArrayBuffer,
            pntsDracoDecodeConfig(dracoAttributes),
          );
        } else {
          geometry = new BufferGeometry();
          geometry.setAttribute(
            "position",
            new Float32BufferAttribute(new Float32Array(bin.buffer), 3),
          );
        }

        const group = new Group();
        const points: Points = new Points(geometry, material);
        group.add(points);

        // Add bounding box helper using the precomputed AABB
        const aabb_center = new Vector3(
          m.aabb.center.x,
          m.aabb.center.y,
          m.aabb.center.z,
        );
        const aabb_extent = new Vector3(
          m.aabb.extent.x,
          m.aabb.extent.y,
          m.aabb.extent.z,
        );

        geometry.boundingBox = new Box3(
          aabb_center.clone().sub(aabb_extent),
          aabb_center.clone().add(aabb_extent),
        );

        geometry.boundingSphere = new Sphere(aabb_center, aabb_extent.length());

        if (m.material.showBoundingBox) {
          const boxHelper = new Box3Helper(geometry.boundingBox, 0xff0000);
          group.add(boxHelper);
        }
        return { rawScene: group };
      }

      const model = await createGltfLoader().parseAsync(
        bin.buffer as ArrayBuffer,
        "",
      );
      if (m.material.showBoundingBox) {
        model.scene.traverse((child) => {
          if (child instanceof Mesh) {
            const boxHelper = new Box3Helper(
              child.geometry.boundingBox,
              0x0000ff,
            );
            child.add(boxHelper);
          }
        });
      }

      return {
        rawScene: model.scene,
        credit: model.asset.copyright,
      };
    } else {
      if (!m.material.url) {
        return {};
      }
      let model;
      try {
        model = await createGltfLoader().loadAsync(m.material.url);
      } catch (e) {
        console.warn(`Failed to load model: ${m.material.url}`, e);
        return {};
      }
      if (m.material.showBoundingBox) {
        model.scene.traverse((child) => {
          if (child instanceof Mesh) {
            const boxHelper = new Box3Helper(
              child.geometry.boundingBox,
              0x0000ff,
            );
            child.add(boxHelper);
          }
        });
      }
      return { rawScene: model.scene };
    }
  })();

  if (!rawScene) {
    return;
  }

  if (m.material.normals) {
    await applyCreasedNormals(
      rawScene,
      m.material.creaseNormalAngle ?? degreeToRadian(30),
    );
  }

  const scene = new ModelMesh(ctx, { scene: rawScene, credit }, m);

  return scene;
}

export function processModelChanged(
  obj: ModelMesh,
  m: NavaraModelMesh,
  active: boolean,
) {
  obj._update(m.material, active);
}
