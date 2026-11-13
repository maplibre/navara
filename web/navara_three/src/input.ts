import type { Core } from "@navaramap/engine";

// TODO: Need to think about how to propagate these event to worker.
export function registerInputEvents(
  core: Core,
  element: HTMLElement,
  getTerrainDistance?: () => number | null,
  isZoomEnabled?: () => boolean,
): () => void {
  let mouseEvent:
    | {
        type: "mousedown" | "mouseup";
        button: number;
      }
    | undefined;

  let lastTerrainDistance: number | undefined;

  // Mousedown and mousemove must share the same coordinate space: the engine
  // re-anchors its cursor position from the mousedown coordinates so the first
  // drag delta is never computed against a stale position (e.g. after the
  // window lost focus while the OS cursor kept moving).
  const normalizePosition = (event: MouseEvent) => {
    const rect = element.getBoundingClientRect();
    const width = element.clientWidth;
    const height = element.clientHeight;
    const aspectRatio = width / height;
    return {
      x: ((event.clientX - rect.left) / width) * aspectRatio,
      y: (event.clientY - rect.top) / height,
    };
  };

  const mousedown = (event: MouseEvent) => {
    mouseEvent = {
      type: "mousedown",
      button: event.button,
    };
    const terrainDistance = getTerrainDistance?.() ?? undefined;
    lastTerrainDistance = terrainDistance;
    core.input({
      ...mouseEvent,
      ...normalizePosition(event),
      terrain_distance: terrainDistance,
    });
  };
  const mouseup = () => {
    core.input({
      ...(mouseEvent ?? {}),
      type: "mouseup",
    });
    mouseEvent = undefined;
  };

  const mousemove = (event: MouseEvent) => {
    core.input({
      type: "mousemove",
      ...normalizePosition(event),
    });
  };

  const touchstart = (event: TouchEvent) => {
    event.preventDefault();

    lastTerrainDistance = getTerrainDistance?.() ?? undefined;
    for (const touch of event.changedTouches) {
      core.input({
        type: "touchstart",
        x: touch.clientX,
        y: touch.clientY,
        id: touch.identifier,
        terrain_distance: lastTerrainDistance,
      });
    }
  };

  const touchend = (event: TouchEvent) => {
    event.preventDefault();

    for (const touch of event.changedTouches) {
      core.input({
        type: "touchend",
        x: touch.clientX,
        y: touch.clientY,
        id: touch.identifier,
      });
    }
  };

  const touchmove = (event: TouchEvent) => {
    event.preventDefault();

    for (const touch of event.changedTouches) {
      core.input({
        type: "touchmove",
        x: touch.clientX,
        y: touch.clientY,
        id: touch.identifier,
      });
    }
  };

  const wheel = (event: WheelEvent) => {
    // The wheel zooms the map, so keep the page from scrolling with it.
    if (isZoomEnabled?.() ?? true) event.preventDefault();

    lastTerrainDistance = getTerrainDistance?.() ?? undefined;
    core.input({
      type: "wheel",
      x: event.deltaX,
      y: event.deltaY,
      terrain_distance: lastTerrainDistance,
    });
  };

  const keydown = (event: KeyboardEvent) => {
    core.input({
      type: "keydown",
      key_code: event.code,
      key: event.key,
    });
  };

  const keyup = (event: KeyboardEvent) => {
    core.input({
      type: "keyup",
      key_code: event?.code,
      key: event?.key,
    });
  };

  // Releases every pressed button and modifier key. When the window loses
  // focus or visibility the matching mouseup/keyup fires in another window, so
  // without this the engine would keep acting on stale pressed state after the
  // user comes back.
  const releaseInputs = () => {
    for (const button of [0, 1, 2]) {
      core.input({ type: "mouseup", button });
    }
    mouseEvent = undefined;
    core.input({ type: "keyup", key_code: "ControlLeft", key: "Control" });
    core.input({ type: "keyup", key_code: "ControlRight", key: "Control" });
  };
  const visibilitychange = () => {
    if (document.visibilityState === "hidden") {
      releaseInputs();
    }
  };

  element.addEventListener("mousedown", mousedown);
  element.addEventListener("mouseup", mouseup);
  element.addEventListener("mouseleave", releaseInputs);
  element.addEventListener("mousemove", mousemove);
  element.addEventListener("touchstart", touchstart);
  element.addEventListener("touchend", touchend);
  // The browser cancels active touches on app switches and system gestures;
  // treat them as ended so no stale touch stays in the engine.
  element.addEventListener("touchcancel", touchend);
  element.addEventListener("touchmove", touchmove);
  element.addEventListener("wheel", wheel, { passive: false });
  document.addEventListener("keydown", keydown);
  document.addEventListener("keyup", keyup);
  window.addEventListener("blur", releaseInputs);
  document.addEventListener("visibilitychange", visibilitychange);

  return () => {
    element.removeEventListener("mousedown", mousedown);
    element.removeEventListener("mouseup", mouseup);
    element.removeEventListener("mouseleave", releaseInputs);
    element.removeEventListener("mousemove", mousemove);
    element.removeEventListener("touchstart", touchstart);
    element.removeEventListener("touchend", touchend);
    element.removeEventListener("touchcancel", touchend);
    element.removeEventListener("touchmove", touchmove);
    element.removeEventListener("wheel", wheel);
    document.removeEventListener("keydown", keydown);
    document.removeEventListener("keyup", keyup);
    window.removeEventListener("blur", releaseInputs);
    document.removeEventListener("visibilitychange", visibilitychange);
  };
}
