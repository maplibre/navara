// ref: https://github.com/google/draco/blob/main/javascript/example/DRACOLoader.js

import { registerWasmMemoryProbe, transfer } from "@navaramap/worker";
import type {
  Attribute,
  Decoder,
  DecoderBuffer,
  DecoderModule,
  Mesh,
  PointCloud,
  Status,
} from "draco3d";
import dracoWasmUrl from "draco3d/draco_decoder.wasm?url&no-inline";

import type {
  DecodedDracoAttribute,
  DecodedDracoGeometry,
  DracoAttributeArray,
  DracoAttributeArrayType,
  DracoDecodeConfig,
} from "../../loaders/dracoGeometry";

import createDracoDecoderModule from "./dracoDecoderModule";

let dracoModule: Promise<DecoderModule> | undefined;

function loadDracoModule() {
  dracoModule ??= createDracoDecoderModule({
    locateFile: () => dracoWasmUrl,
  }).then((draco) => {
    registerWasmMemoryProbe(() => draco.HEAPF32.buffer.byteLength);
    return draco;
  });
  return dracoModule;
}

export async function decodeDraco(
  buffer: ArrayBuffer,
  config: DracoDecodeConfig,
): Promise<DecodedDracoGeometry> {
  const draco = await loadDracoModule();
  const decoder = new draco.Decoder();
  const decoderBuffer = new draco.DecoderBuffer();
  try {
    decoderBuffer.Init(new Int8Array(buffer), buffer.byteLength);
    const geometry = decodeGeometry(draco, decoder, decoderBuffer, config);
    const buffers: ArrayBuffer[] = [];
    for (const attribute of geometry.attributes) {
      buffers.push(attribute.array.buffer as ArrayBuffer);
    }
    if (geometry.index) {
      buffers.push(geometry.index.buffer as ArrayBuffer);
    }
    return transfer(geometry, buffers);
  } finally {
    draco.destroy(decoderBuffer);
    draco.destroy(decoder);
  }
}

function decodeGeometry(
  draco: DecoderModule,
  decoder: Decoder,
  decoderBuffer: DecoderBuffer,
  config: DracoDecodeConfig,
): DecodedDracoGeometry {
  const geometryType = decoder.GetEncodedGeometryType(decoderBuffer);
  let dracoGeometry: PointCloud;
  let status: Status;
  if (geometryType === draco.TRIANGULAR_MESH) {
    dracoGeometry = new draco.Mesh();
    status = decoder.DecodeBufferToMesh(decoderBuffer, dracoGeometry as Mesh);
  } else if (geometryType === draco.POINT_CLOUD) {
    dracoGeometry = new draco.PointCloud();
    status = decoder.DecodeBufferToPointCloud(decoderBuffer, dracoGeometry);
  } else {
    throw new Error("Draco: unexpected geometry type.");
  }

  try {
    if (!status.ok() || dracoGeometry.ptr === 0) {
      throw new Error(`Draco: decoding failed: ${status.error_msg()}`);
    }

    const attributes: DecodedDracoAttribute[] = [];
    for (const name in config.attributeIDs) {
      const attribute = decoder.GetAttributeByUniqueId(
        dracoGeometry,
        config.attributeIDs[name],
      );
      attributes.push(
        decodeAttribute(
          draco,
          decoder,
          dracoGeometry,
          name,
          config.attributeTypes[name],
          attribute,
        ),
      );
    }

    const index =
      geometryType === draco.TRIANGULAR_MESH
        ? decodeIndex(draco, decoder, dracoGeometry as Mesh)
        : null;

    return { index, attributes };
  } finally {
    draco.destroy(dracoGeometry);
  }
}

function decodeIndex(
  draco: DecoderModule,
  decoder: Decoder,
  mesh: Mesh,
): Uint32Array {
  const count = mesh.num_faces() * 3;
  const byteLength = count * 4;
  const ptr = draco._malloc(byteLength);
  try {
    decoder.GetTrianglesUInt32Array(mesh, byteLength, ptr);
    return new Uint32Array(draco.HEAPF32.buffer, ptr, count).slice();
  } finally {
    draco._free(ptr);
  }
}

const TYPED_ARRAYS = {
  Float32Array,
  Int8Array,
  Int16Array,
  Int32Array,
  Uint8Array,
  Uint16Array,
  Uint32Array,
};

function decodeAttribute(
  draco: DecoderModule,
  decoder: Decoder,
  dracoGeometry: PointCloud,
  name: string,
  type: DracoAttributeArrayType,
  attribute: Attribute,
): DecodedDracoAttribute {
  const TypedArray = TYPED_ARRAYS[type];
  const count = dracoGeometry.num_points();
  const itemSize = attribute.num_components();

  // glTF requires each vertex row to be 4-byte aligned.
  // ref: https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#data-alignment
  const srcByteStride = itemSize * TypedArray.BYTES_PER_ELEMENT;
  const dstByteStride = Math.ceil(srcByteStride / 4) * 4;
  const stride = dstByteStride / TypedArray.BYTES_PER_ELEMENT;
  const srcByteLength = count * srcByteStride;

  const ptr = draco._malloc(srcByteLength);
  try {
    decoder.GetAttributeDataArrayForAllPoints(
      dracoGeometry,
      attribute,
      dracoDataType(draco, type),
      srcByteLength,
      ptr,
    );
    const src = new TypedArray(
      // The Emscripten heap is never shared.
      draco.HEAPF32.buffer as ArrayBuffer,
      ptr,
      srcByteLength / TypedArray.BYTES_PER_ELEMENT,
    );

    let array: DracoAttributeArray;
    if (stride === itemSize) {
      array = src.slice();
    } else {
      array = new TypedArray(count * stride);
      for (let i = 0; i < count; i++) {
        for (let j = 0; j < itemSize; j++) {
          array[i * stride + j] = src[i * itemSize + j];
        }
      }
    }

    return { name, array, itemSize, stride };
  } finally {
    draco._free(ptr);
  }
}

function dracoDataType(draco: DecoderModule, type: DracoAttributeArrayType) {
  switch (type) {
    case "Float32Array":
      return draco.DT_FLOAT32;
    case "Int8Array":
      return draco.DT_INT8;
    case "Int16Array":
      return draco.DT_INT16;
    case "Int32Array":
      return draco.DT_INT32;
    case "Uint8Array":
      return draco.DT_UINT8;
    case "Uint16Array":
      return draco.DT_UINT16;
    case "Uint32Array":
      return draco.DT_UINT32;
  }
}
