import type {
  CRS,
  ReturnedTransferablePolygonBatchedFeature,
  TransferablePolygonBatchedFeature,
} from "@navaramap/engine";

import type { RemoveFreeRecursively } from "../../types";

export class TransferablePolygonBatchedFeatureLike implements RemoveFreeRecursively<TransferablePolygonBatchedFeature> {
  batch_ids: Uint32Array;
  batch_indices: Uint32Array;
  crs: CRS;
  expected_winding_orders: Uint8Array;
  holes: Float64Array;
  holes_boundaries: Uint32Array;
  holes_sizes: Uint32Array;
  holes_total_sizes: Uint32Array;
  length: number;
  outer_ring: Float64Array;
  outer_ring_sizes: Uint32Array;
  outline_edges: Uint8Array;

  constructor(t: ReturnedTransferablePolygonBatchedFeature) {
    this.batch_ids = t.transferBatchIds();
    this.batch_indices = t.transferBatchIndices();
    this.crs = t.crs();
    this.expected_winding_orders = t.transferExpectedWindingOrders();
    this.holes = t.transferHoles();
    this.holes_boundaries = t.transferHolesBoundaries();
    this.holes_sizes = t.transferHolesSizes();
    this.holes_total_sizes = t.transferHolesTotalSizes();
    this.length = t.length();
    this.outer_ring = t.transferOuterRing();
    this.outer_ring_sizes = t.transferOuterRingSizes();
    this.outline_edges = t.transferOutlineEdges();
  }

  setBatchIds(_length: number, _f: () => void) {}
  setBatchIndices(_length: number, _f: () => void) {}
  setExpectedWindingOrders(_length: number, _f: () => void) {}
  setOuterRing(_length: number, _f: () => void) {}
  setOuterRingSizes(_length: number, _f: () => void) {}
  setHoles(_length: number, _f: () => void) {}
  setHolesBoundaries(_length: number, _f: () => void) {}
  setHolesSizes(_length: number, _f: () => void) {}
  setHolesTotalSizes(_length: number, _f: () => void) {}
  setOutlineEdges(_length: number, _f: () => void) {}

  transferBatchIds(): Uint32Array {
    throw new Error();
  }
  transferBatchIndices(): Uint32Array {
    throw new Error();
  }
  transferExpectedWindingOrders(): Uint8Array {
    throw new Error();
  }
  transferOuterRing(): Float64Array {
    throw new Error();
  }
  transferOuterRingSizes(): Uint32Array {
    throw new Error();
  }
  transferHoles(): Float64Array {
    throw new Error();
  }
  transferHolesBoundaries(): Uint32Array {
    throw new Error();
  }
  transferHolesSizes(): Uint32Array {
    throw new Error();
  }
  transferHolesTotalSizes(): Uint32Array {
    throw new Error();
  }
  transferOutlineEdges(): Uint8Array {
    throw new Error();
  }
}
