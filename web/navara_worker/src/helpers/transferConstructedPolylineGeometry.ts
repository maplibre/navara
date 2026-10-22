import { ConstructedPolylineGeometryLike, isNotNullish } from "@navaramap/core";
import type { ConstructedPolylineGeometry } from "@navaramap/engine-worker";

export function transferConstructedPolylineGeometry(
  r: ConstructedPolylineGeometry,
) {
  const like = new ConstructedPolylineGeometryLike(r);
  return {
    result: like,
    transfers: [
      like.position.buffer,
      like.position_high?.buffer,
      like.position_low?.buffer,
      like.start?.buffer,
      like.start_high?.buffer,
      like.start_low?.buffer,
      like.end_high?.buffer,
      like.end_low?.buffer,
      like.start_normal_and_length_high?.buffer,
      like.forward_offset?.buffer,
      like.end_normal_and_segment_length?.buffer,
      like.right_normal_and_line_length.buffer,
      like.batch_id?.buffer,
      like.batch_index?.buffer,
      like.indices.buffer,
      like.line_segments?.buffer,
      like.line_distance_and_ends?.buffer,
    ].filter(isNotNullish),
  };
}
