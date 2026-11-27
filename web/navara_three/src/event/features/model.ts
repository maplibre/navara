import type { ModelMesh as NavaraModelMesh } from "@navaramap/engine";
import { degreeToRadian } from "@navaramap/three-api";
import {
  BufferGeometry,
  Points,
  Group,
  LoadingManager,
  PointsMaterial,
  Box3,
  Vector3,
  Mesh,
  Sphere,
} from "three";

import {
  createGltfLoader,
  loadFeatureIdTextures,
  mergeQuery,
} from "../../loaders";
import { ModelMesh } from "../../mesh/model";
import { gltfFeatureIdsOf } from "../../mesh/modelBatchIds";
import { toCreasedNormalsAsync } from "../../tasks/toCreasedNormalsAsync";
import type { EventContext } from "../context";

import { createPntsGeometry } from "./pnts";

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

export async function renderModel(ctx: EventContext, m: NavaraModelMesh) {
  const { rawScene, credit, isTiles3d, featureIdTextures } =
    await (async () => {
      // Only 3D Tiles content carries a bin.
      if (m.bin) {
        // Every getter of a WASM object may allocate and grow WASM memory,
        // which detaches the `buf.u8` view below, so read them all first.
        const material = m.material;
        const internal = material.__internal__;
        const layout = internal?.pointCloudLayout;
        const dracoAttributes = internal?.dracoAttributes;
        const batchLength = m.batch_length;
        const query = m.resource_query;
        const resourcePath = m.resource_path ?? "";
        // buf.u8 returns a short-lived view into WASM memory; copy out of it
        // since the bin is consumed asynchronously (Draco / GLTFLoader) via its
        // `.buffer`.
        const view = ctx.buf.u8(m.bin);
        if (!view) {
          return {};
        }

        // PNTS legacy bin path: only the PNTS parser sets a point cloud layout,
        // and the bin here is the whole PNTS tile, not glTF. 3D Tiles 1.1 glTF
        // tiles (point cloud or not) take the GLTFLoader path below.
        if (layout) {
          const { geometry, scale } = await createPntsGeometry(
            view,
            layout,
            dracoAttributes,
          );

          // Without colors, points take the layer color alone.
          const pointsMaterial = new PointsMaterial({
            size: material.pointSize,
            vertexColors: geometry.hasAttribute("color"),
            sizeAttenuation: false,
          });

          const group = new Group();
          const points: Points = new Points(geometry, pointsMaterial);
          group.add(points);

          // Bounding volumes from the precomputed AABB (`ModelMesh` draws the
          // `showBoundingBox` helper from it), in the scaled node's space.
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

          if (scale) {
            points.scale.copy(scale);
          }
          if (scale && (scale.x === 0 || scale.y === 0 || scale.z === 0)) {
            // A flat quantized volume has no node space to map the AABB into.
            geometry.computeBoundingBox();
            geometry.computeBoundingSphere();
          } else {
            if (scale) {
              aabb_center.divide(scale);
              aabb_extent.divide(scale);
            }
            geometry.boundingBox = new Box3(
              aabb_center.clone().sub(aabb_extent),
              aabb_center.clone().add(aabb_extent),
            );
            geometry.boundingSphere = new Sphere(
              aabb_center,
              aabb_extent.length(),
            );
          }
          return { rawScene: group, isTiles3d: true };
        }

        const bin = view.slice();
        const loader = createGltfLoader();
        if (query) {
          loader.manager = new LoadingManager().setURLModifier(
            mergeQuery(query),
          );
        }
        let model;
        try {
          model = await loader.parseAsync(
            bin.buffer as ArrayBuffer,
            resourcePath,
          );
        } catch (e) {
          console.warn(`Failed to load model: ${resourcePath}`, e);
          return {};
        }

        return {
          rawScene: model.scene,
          credit: model.asset.copyright,
          isTiles3d: true,
          featureIdTextures: batchLength
            ? await loadFeatureIdTextures(model, gltfFeatureIdsOf(internal))
            : undefined,
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

  const scene = new ModelMesh(
    ctx,
    { scene: rawScene, credit, isTiles3d, featureIdTextures },
    m,
  );

  return scene;
}

export function processModelChanged(
  obj: ModelMesh,
  m: NavaraModelMesh,
  active: boolean,
) {
  obj._update(m.material, active);
}
