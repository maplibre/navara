// Ref: https://github.com/takram-design-engineering/geovanni/blob/ee91f675ba2558ee3099f635dfa30bbe3adfe103/libs/core/src/utils.ts

import { isNotNullish } from "@navaramap/core";
import { pick } from "lodash-es";
import { Box3, BufferAttribute, BufferGeometry, Sphere, Vector3 } from "three";

export type BufferGeometryLike = Pick<
  BufferGeometry,
  "attributes" | "index" | "boundingBox" | "boundingSphere"
>;

export function toBufferGeometryLike(
  geometry: BufferGeometry,
): [BufferGeometryLike, ArrayBuffer[]] {
  return [
    pick(geometry, ["attributes", "index", "boundingBox", "boundingSphere"]),
    (
      [
        ...Object.values(geometry.attributes).map(
          (attribute) => attribute.array.buffer,
        ),
        geometry.index?.array.buffer,
      ] as ArrayBuffer[]
    ).filter(isNotNullish),
  ];
}

export function fromBufferGeometryLike(
  input: BufferGeometryLike,
  result = new BufferGeometry(),
): BufferGeometry {
  for (const [name, attribute] of Object.entries(input.attributes)) {
    result.setAttribute(
      name,
      new BufferAttribute(
        attribute.array,
        attribute.itemSize,
        attribute.normalized,
      ),
    );
  }
  result.index =
    input.index != null
      ? new BufferAttribute(
          input.index.array,
          input.index.itemSize,
          input.index.normalized,
        )
      : null;
  result.boundingBox = input.boundingBox;
  result.boundingSphere = input.boundingSphere;
  return result;
}

/** Bounding sphere of RTE positions split into high and low parts. */
export function boundingSphereOfRte(
  high: Float32Array,
  low: Float32Array,
): Sphere {
  const box = new Box3();
  const point = new Vector3();
  for (let i = 0; i < high.length; i += 3) {
    point.set(
      high[i] + low[i],
      high[i + 1] + low[i + 1],
      high[i + 2] + low[i + 2],
    );
    box.expandByPoint(point);
  }
  return box.getBoundingSphere(new Sphere());
}
