import type {
  CRS,
  ReturnedTransferablePolylineBatchedFeature,
  TransferablePolylineBatchedFeature,
} from "@navaramap/engine";

import type { RemoveFreeRecursively } from "../../types";

export class TransferablePolylineBatchedFeatureLike implements RemoveFreeRecursively<TransferablePolylineBatchedFeature> {
  points: Float64Array;
  points_sizes: Uint32Array;
  batch_ids: Uint32Array;
  batch_indices: Uint32Array;
  /**
   * Per polyline, whether it is a polygon ring (1) or an open line (0). A
   * ring's repeated first vertex is a seam the geometry joins; an open line
   * keeps its end caps even when its endpoints coincide.
   */
  ring_flags: Uint8Array;
  crs: CRS;
  length: number;

  constructor(t: ReturnedTransferablePolylineBatchedFeature) {
    this.points = t.transferPoints();
    this.points_sizes = t.transferPointsSizes();
    this.batch_ids = t.transferBatchIds();
    this.batch_indices = t.transferBatchIndices();
    this.ring_flags = t.transferRingFlags();
    this.crs = t.crs();
    this.length = t.length();
  }

  setPoints(_byte_length: number, _f: () => void): void {}
  setPointsSizes(_byte_length: number, _f: () => void): void {}
  setBatchIds(_byte_length: number, _f: () => void): void {}
  setBatchIndices(_length: number, _f: () => void) {}
  setRingFlags(_byte_length: number, _f: () => void): void {}

  transferPoints(): Float64Array {
    throw new Error();
  }
  transferPointsSizes(): Uint32Array {
    throw new Error();
  }
  transferBatchIds(): Uint32Array {
    throw new Error();
  }
  transferBatchIndices(): Uint32Array {
    throw new Error();
  }
  transferRingFlags(): Uint8Array {
    throw new Error();
  }
}
