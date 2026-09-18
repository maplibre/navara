import { CameraStatusType } from "@navaramap/engine";
import type { Core } from "@navaramap/engine";
import { describe, expect, it, vi } from "vitest";

import { ThreeViewCamera } from "./camera";

/**
 * Drives `updateStatus` with a canned engine status list and records the public
 * events it emits, in order.
 */
function emitFor(status: CameraStatusType[]): string[] {
  const camera = new ThreeViewCamera();
  camera.core = {
    getCameraStatus: () => ({ status }),
  } as unknown as Core;

  const emitted: string[] = [];
  for (const name of ["movestart", "move", "moveend"] as const) {
    camera.on(name, () => emitted.push(name));
  }
  camera.updateStatus();
  return emitted;
}

describe("ThreeViewCamera.updateStatus", () => {
  it("emits move and moveend for a setCamera change", () => {
    expect(emitFor([CameraStatusType.Change])).toEqual(["move", "moveend"]);
  });

  it("emits move and moveend for lookAt and rotate", () => {
    expect(emitFor([CameraStatusType.LookAt])).toEqual(["move", "moveend"]);
    expect(emitFor([CameraStatusType.Rotate])).toEqual(["move", "moveend"]);
  });

  it("keeps the controller-driven gesture sequence", () => {
    expect(emitFor([CameraStatusType.MoveStart])).toEqual(["movestart"]);
    expect(emitFor([CameraStatusType.Moving])).toEqual(["move"]);
    expect(emitFor([CameraStatusType.MoveEnd])).toEqual(["moveend"]);
  });

  it("emits each event at most once per frame", () => {
    // setCamera during inertia reports Change *and* MoveEnd; three inertia
    // timers expiring together report MoveEnd three times.
    expect(
      emitFor([CameraStatusType.Change, CameraStatusType.MoveEnd]),
    ).toEqual(["move", "moveend"]);
    expect(
      emitFor([
        CameraStatusType.MoveEnd,
        CameraStatusType.MoveEnd,
        CameraStatusType.MoveEnd,
      ]),
    ).toEqual(["moveend"]);
  });

  it("orders movestart before move before moveend", () => {
    expect(
      emitFor([CameraStatusType.MoveEnd, CameraStatusType.MoveStart]),
    ).toEqual(["movestart", "moveend"]);
  });

  it("emits nothing when the engine has no camera yet", () => {
    const camera = new ThreeViewCamera();
    camera.core = { getCameraStatus: () => undefined } as unknown as Core;
    const spy = vi.fn();
    camera.on("moveend", spy);
    camera.updateStatus();
    expect(spy).not.toHaveBeenCalled();
  });
});
