import {
  PointColorsFormat,
  PointPositionsFormat,
  type DracoAttributeId,
  type PointCloudLayout,
  type Vec3,
} from "@navaramap/engine";
import { BufferAttribute, BufferGeometry, Vector3 } from "three";

import type { DracoDecodeConfig } from "../../loaders/dracoGeometry";
import { decodeDracoAsync } from "../../tasks/decodeDracoAsync";

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

export type PntsGeometry = {
  geometry: BufferGeometry;
  /** Scale of the points node; `POSITION_QUANTIZED` is normalized to the quantized volume. */
  scale?: Vector3;
};

/**
 * Builds the geometry of a PNTS tile from its bin at the places `layout`
 * gives. Copies only the point data out of `bin`, a short-lived view into
 * WASM memory, and does so before any call that may grow that memory: an
 * await, or a getter of a WASM object (`Vec3` fields, `dracoAttributes`).
 */
export async function createPntsGeometry(
  bin: Uint8Array,
  layout: PointCloudLayout,
  dracoAttributes: DracoAttributeId[] | undefined,
): Promise<PntsGeometry> {
  const color = readColors(bin, layout);
  const slice = (offset: number, length: number) =>
    bin.slice(offset, offset + length);
  const positions = slice(
    layout.positionsByteOffset,
    layout.positionsByteLength,
  );
  const draco = slice(layout.dracoByteOffset, layout.dracoByteLength);

  // A Draco blob without `POSITION` leaves the positions raw.
  const geometry =
    draco.length > 0
      ? await decodeDracoAsync(
          draco.buffer,
          pntsDracoDecodeConfig(dracoAttributes ?? []),
        )
      : new BufferGeometry();
  let scale: Vector3 | undefined;
  switch (layout.positionsFormat) {
    case PointPositionsFormat.Draco:
      break;
    case PointPositionsFormat.Uint16: {
      geometry.setAttribute(
        "position",
        new BufferAttribute(new Uint16Array(positions.buffer), 3, true),
      );
      const { x, y, z } = layout.quantizedVolumeScale;
      scale = new Vector3(x, y, z);
      break;
    }
    case PointPositionsFormat.Float32:
      geometry.setAttribute(
        "position",
        new BufferAttribute(
          subtractOrigin(
            new Float32Array(positions.buffer),
            layout.positionsOrigin,
          ),
          3,
        ),
      );
      break;
  }
  if (color) {
    geometry.setAttribute("color", color);
  }
  return { geometry, scale };
}

/** `undefined` without per-point colors; `CONSTANT_RGBA` tints the material instead. */
function readColors(
  bin: Uint8Array,
  layout: PointCloudLayout,
): BufferAttribute | undefined {
  const offset = layout.colorsByteOffset;
  const count = layout.pointCount;
  switch (layout.colorsFormat) {
    case PointColorsFormat.Rgba8:
      return new BufferAttribute(
        bin.slice(offset, offset + count * 4),
        4,
        true,
      );
    case PointColorsFormat.Rgb8:
      return new BufferAttribute(
        bin.slice(offset, offset + count * 3),
        3,
        true,
      );
    case PointColorsFormat.Rgb565:
      return new BufferAttribute(
        decodeRgb565(bin.subarray(offset, offset + count * 2)),
        3,
        true,
      );
    default:
      return undefined;
  }
}

/** Expands little-endian RGB565 to RGB8, rounding to nearest. */
export function decodeRgb565(rgb565: Uint8Array): Uint8Array {
  const rgb = new Uint8Array((rgb565.length / 2) * 3);
  for (let i = 0, j = 0; i + 1 < rgb565.length; i += 2, j += 3) {
    const c = rgb565[i] | (rgb565[i + 1] << 8);
    rgb[j] = Math.round((((c >> 11) & 0x1f) * 255) / 31);
    rgb[j + 1] = Math.round((((c >> 5) & 0x3f) * 255) / 63);
    rgb[j + 2] = Math.round(((c & 0x1f) * 255) / 31);
  }
  return rgb;
}

/**
 * Re-centers `positions` on `origin` in place. The subtraction runs in
 * float64, so the small results keep the precision the absolute float32
 * positions had.
 */
export function subtractOrigin(
  positions: Float32Array,
  origin: Vec3,
): Float32Array {
  const { x, y, z } = origin;
  if (x === 0 && y === 0 && z === 0) {
    return positions;
  }
  for (let i = 0; i + 2 < positions.length; i += 3) {
    positions[i] -= x;
    positions[i + 1] -= y;
    positions[i + 2] -= z;
  }
  return positions;
}
