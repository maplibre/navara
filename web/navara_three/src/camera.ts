import {
  EventHandler,
  type CameraOrientation,
  type LatLngHeight,
  type NormalizeWASMClass,
  type XYZ,
} from "@navaramap/core";
import {
  Core,
  CameraStatus,
  CameraStatusType,
  CameraControlUpdateEvent,
} from "@navaramap/engine";
import { radianToDegree } from "@navaramap/three-api";
import { PerspectiveCamera } from "three";
import invariant from "tiny-invariant";

export type CameraEvent = {
  movestart: () => void;
  move: () => void;
  moveend: () => void;
  frustumChanged: () => void;
};

export type CameraOptions = NormalizeWASMClass<CameraControlUpdateEvent>;

export class ThreeViewCamera extends EventHandler<CameraEvent> {
  raw: PerspectiveCamera;

  private _core: Core | undefined;
  private _status: CameraStatus | undefined;

  constructor(cam?: PerspectiveCamera) {
    super();
    if (cam instanceof PerspectiveCamera) {
      this.raw = cam;
    } else {
      this.raw = new PerspectiveCamera();
    }
  }

  set core(core: Core | undefined) {
    this._core = core;
  }

  /**
   * Translates the engine's per-frame `CameraStatus` list into `movestart` /
   * `move` / `moveend`.
   *
   * The engine can report several statuses for one frame (an instantaneous
   * change that also terminates an in-flight gesture, or spin + zoom + translate
   * inertia all expiring together), so the statuses are first folded into flags
   * and each public event is emitted at most once per frame.
   *
   * Instantaneous programmatic changes -- `setCamera` (`Change`), `lookAt` and
   * `rotateAroundAxis` -- complete the whole movement within a single frame, so
   * they emit both `move` and `moveend`. Without the `move`, listeners that only
   * track continuous motion would never see a programmatic jump.
   *
   * `movestart` stays driven solely by the engine's `MoveStart`: an
   * instantaneous change has no movement to open, and synthesising one here
   * would fire a second `movestart` in the middle of an active drag.
   */
  updateStatus() {
    this._status = this._core?.getCameraStatus();
    if (!this._status) {
      return;
    }

    let movestart = false;
    let move = false;
    let moveend = false;

    for (const val of this._status.status) {
      switch (val) {
        case CameraStatusType.MoveStart:
          movestart = true;
          break;
        case CameraStatusType.Moving:
          move = true;
          break;
        case CameraStatusType.MoveEnd:
          moveend = true;
          break;
        case CameraStatusType.Change:
        case CameraStatusType.LookAt:
        case CameraStatusType.Rotate:
          move = true;
          moveend = true;
          break;
        default:
          break;
      }
    }

    if (movestart) {
      this.emit("movestart");
    }
    if (move) {
      this.emit("move");
    }
    if (moveend) {
      this.emit("moveend");
    }
  }

  get positionECEF(): XYZ {
    const pos = this._core?.getCameraPositionECEF();
    invariant(pos);
    return {
      x: pos[0],
      y: pos[1],
      z: pos[2],
    };
  }

  get positionGeographic(): LatLngHeight {
    const pos = this._core?.getCameraPositionLLE();
    invariant(pos);
    return {
      lng: pos[0],
      lat: pos[1],
      height: pos[2],
    };
  }

  get orientation(): CameraOrientation {
    const orientation = this._core?.getCameraOrientation();
    invariant(orientation);
    return {
      heading: orientation.heading,
      pitch: orientation.pitch,
      roll: orientation.roll,
    };
  }

  /**
   * Effective Web Mercator zoom level the camera is viewing the surface at
   * (fractional). Computed engine-side from the camera's ellipsoid height (not
   * terrain), FOV and viewport.
   */
  get zoom(): number | undefined {
    return this._core?.getZoomLevel();
  }

  /**
   * The vertical field of view in degrees; the horizontal extent follows
   * from the viewport aspect ratio.
   * Reading returns `undefined` until the engine camera exists.
   */
  get fov(): number | undefined {
    const fov = this._core?.getCameraFOV();
    return fov === undefined ? undefined : radianToDegree(fov);
  }

  set fov(val: number) {
    if (val < 1 || val > 180) {
      return;
    }

    this._core?.setFrustum(val, undefined, undefined);
  }

  set near(val: number) {
    if (val <= 0) {
      return;
    }

    this._core?.setFrustum(undefined, val, undefined);
  }

  get near() {
    return this.raw.near;
  }

  set far(val: number) {
    if (val <= this.raw.near) {
      return;
    }

    this._core?.setFrustum(undefined, undefined, val);
  }

  get far() {
    return this.raw.far;
  }

  set options(options: CameraOptions) {
    const event = new CameraControlUpdateEvent();
    if (options.autoAdjustNearFar !== undefined) {
      event.autoAdjustNearFar = options.autoAdjustNearFar;
    }
    if (options.minimumZoomDistance !== undefined) {
      event.minimumZoomDistance = options.minimumZoomDistance;
    }
    if (options.maximumZoomDistance !== undefined) {
      event.maximumZoomDistance = options.maximumZoomDistance;
    }
    if (options.spinSpeed !== undefined) {
      event.spinSpeed = options.spinSpeed;
    }
    if (options.zoomSpeed !== undefined) {
      event.zoomSpeed = options.zoomSpeed;
    }
    if (options.spinDuration !== undefined) {
      event.spinDuration = options.spinDuration;
    }
    if (options.zoomDuration !== undefined) {
      event.zoomDuration = options.zoomDuration;
    }
    if (options.translateDuration !== undefined) {
      event.translateDuration = options.translateDuration;
    }
    if (options.enableSpin !== undefined) {
      event.enableSpin = options.enableSpin;
    }
    if (options.enableZoom !== undefined) {
      event.enableZoom = options.enableZoom;
    }
    if (options.enableTilt !== undefined) {
      event.enableTilt = options.enableTilt;
    }
    this._core?.setCameraControl(event);
  }
}
