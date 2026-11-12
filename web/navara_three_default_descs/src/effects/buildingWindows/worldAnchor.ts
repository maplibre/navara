import { eastNorthUpToFixedFrame } from "@navaramap/three";
import { Matrix4, Vector3 } from "three";

/** Re-anchor beyond this distance so float32 local coordinates stay precise. */
export const REANCHOR_DISTANCE = 50_000;

/** East/north/up frame at an ECEF position, as `eastNorthUpToFixedFrame`. */
export type FrameAt = (origin: Vector3) => Matrix4;

/**
 * A fixed east/north/up frame at a point on the ellipsoid under the camera.
 * Screen-space effects reconstruct camera-relative positions; adding
 * `cameraFromOrigin` turns them into coordinates that stay put in the world
 * while the camera moves.
 */
export class WorldAnchor {
  readonly east = new Vector3();
  readonly north = new Vector3();
  readonly up = new Vector3();
  /** Camera position relative to the anchor origin, in world orientation. */
  readonly cameraFromOrigin = new Vector3();

  private readonly origin = new Vector3();
  private readonly frame = new Matrix4();
  private readonly frameAt: FrameAt;
  private anchored = false;

  constructor(frameAt: FrameAt = eastNorthUpToFixedFrame) {
    this.frameAt = frameAt;
  }

  /**
   * Follows the camera. `cameraHeight` (meters above the ellipsoid) is only
   * read when the anchor moves. Returns whether it moved.
   */
  update(cameraPosition: Vector3, cameraHeight: () => number): boolean {
    this.cameraFromOrigin.subVectors(cameraPosition, this.origin);
    if (this.anchored && this.cameraFromOrigin.length() < REANCHOR_DISTANCE) {
      return false;
    }

    // Drop the camera onto the ellipsoid along the geodetic up, then take the
    // frame at that point.
    this.frame.copy(this.frameAt(cameraPosition));
    this.up.setFromMatrixColumn(this.frame, 2);
    this.origin.copy(cameraPosition).addScaledVector(this.up, -cameraHeight());
    this.frame.copy(this.frameAt(this.origin));
    this.east.setFromMatrixColumn(this.frame, 0);
    this.north.setFromMatrixColumn(this.frame, 1);
    this.up.setFromMatrixColumn(this.frame, 2);
    this.cameraFromOrigin.subVectors(cameraPosition, this.origin);
    this.anchored = true;
    return true;
  }
}
