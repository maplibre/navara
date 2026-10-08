import {
  BufferAttribute,
  BufferGeometry,
  InterleavedBuffer,
  InterleavedBufferAttribute,
} from "three";

export type DracoAttributeArrayType =
  | "Float32Array"
  | "Int8Array"
  | "Int16Array"
  | "Int32Array"
  | "Uint8Array"
  | "Uint16Array"
  | "Uint32Array";

export type DracoAttributeArray =
  | Float32Array
  | Int8Array
  | Int16Array
  | Int32Array
  | Uint8Array
  | Uint16Array
  | Uint32Array;

/** Keyed by three.js attribute name. */
export type DracoDecodeConfig = {
  /** Draco unique attribute id. */
  attributeIDs: Record<string, number>;
  attributeTypes: Record<string, DracoAttributeArrayType>;
};

export type DecodedDracoAttribute = {
  name: string;
  array: DracoAttributeArray;
  itemSize: number;
  /** Elements per vertex; exceeds `itemSize` when rows are padded to 4 bytes. */
  stride: number;
};

export type DecodedDracoGeometry = {
  index: Uint32Array | null;
  attributes: DecodedDracoAttribute[];
};

export function createDracoGeometry(
  decoded: DecodedDracoGeometry,
): BufferGeometry {
  const geometry = new BufferGeometry();

  if (decoded.index) {
    geometry.setIndex(new BufferAttribute(decoded.index, 1));
  }

  for (const { name, array, itemSize, stride } of decoded.attributes) {
    const attribute =
      itemSize === stride
        ? new BufferAttribute(array, itemSize)
        : new InterleavedBufferAttribute(
            new InterleavedBuffer(array, stride),
            itemSize,
            0,
          );
    if (name === "color") {
      attribute.normalized = !(array instanceof Float32Array);
    }
    geometry.setAttribute(name, attribute);
  }

  return geometry;
}
