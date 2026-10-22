import type { ConstructedPolylineGeometry } from "@navaramap/engine";

import { ExtentRadianF32Like } from "../ExtentRadianF32Like";

export class ConstructedPolylineGeometryLike {
  extent: ExtentRadianF32Like | undefined;
  position: Float32Array;
  position_size: number;
  position_high: Float32Array | undefined;
  position_high_size: number | undefined;
  position_low: Float32Array | undefined;
  position_low_size: number | undefined;
  start: Float32Array | undefined;
  start_size: number | undefined;
  start_high: Float32Array | undefined;
  start_high_size: number | undefined;
  start_low: Float32Array | undefined;
  start_low_size: number | undefined;
  forward_offset: Float32Array | undefined;
  forward_offset_size: number | undefined;
  end_high: Float32Array | undefined;
  end_high_size: number | undefined;
  end_low: Float32Array | undefined;
  end_low_size: number | undefined;
  start_normal_and_length_high: Float32Array | undefined;
  start_normal_and_length_high_size: number | undefined;
  end_normal_and_segment_length: Float32Array | undefined;
  end_normal_and_segment_length_size: number | undefined;
  right_normal_and_line_length: Float32Array;
  right_normal_and_line_length_size: number;
  batch_id: Float32Array | undefined;
  batch_id_size: number | undefined;
  batch_index: Uint32Array | undefined;
  batch_index_size: number | undefined;
  indices: Uint32Array;
  line_segments: Float32Array | undefined;
  line_distance_and_ends: Float32Array | undefined;

  constructor(t: ConstructedPolylineGeometry) {
    const extent = t.extent;
    this.extent = extent ? new ExtentRadianF32Like(extent) : undefined;
    // Need to make a slice to avoid memory leak due to it's transferred.
    this.position = t.position().slice();
    this.position_size = t.position_size();
    this.position_high = t.position_high()?.slice();
    this.position_high_size = t.position_high_size();
    this.position_low = t.position_low()?.slice();
    this.position_low_size = t.position_low_size();
    this.start = t.start()?.slice();
    this.start_size = t.start_size();
    this.start_high = t.start_high()?.slice();
    this.start_high_size = t.start_high_size();
    this.start_low = t.start_low()?.slice();
    this.start_low_size = t.start_low_size();
    this.forward_offset = t.forward_offset()?.slice();
    this.forward_offset_size = t.forward_offset_size();
    this.end_high = t.end_high()?.slice();
    this.end_high_size = t.end_high_size();
    this.end_low = t.end_low()?.slice();
    this.end_low_size = t.end_low_size();
    this.start_normal_and_length_high = t
      .start_normal_and_length_high()
      ?.slice();
    this.start_normal_and_length_high_size =
      t.start_normal_and_length_high_size();
    this.end_normal_and_segment_length = t
      .end_normal_and_segment_length()
      ?.slice();
    this.end_normal_and_segment_length_size =
      t.end_normal_and_segment_length_size();
    this.right_normal_and_line_length = t
      .right_normal_and_line_length()
      .slice();
    this.right_normal_and_line_length_size =
      t.right_normal_and_line_length_size();
    this.batch_id = t.batch_id()?.slice();
    this.batch_id_size = t.batch_id_size();
    this.batch_index = t.batch_index()?.slice();
    this.batch_index_size = t.batch_index_size();
    this.indices = t.indices().slice();
    this.line_segments = t.line_segments()?.slice();
    this.line_distance_and_ends = t.line_distance_and_ends()?.slice();
  }
}
