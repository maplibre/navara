import type { ButtonApi, NumberInputParams } from "tweakpane";

import { DevtoolPlugin, type DevtoolPluginOptions } from "../DevtoolPlugin";
import { hint } from "../util/html";
import { Ticker } from "../util/ticker";

import {
  formatCameraSnippet,
  parseCameraSnippet,
  type CameraSnapshot,
} from "./cameraSnippet";

export type CameraInspectorPluginOptions = DevtoolPluginOptions;

const FLASH_MS = 1200;
const COPY_TITLE = "Copy as JS object";
const PASTE_TITLE = "Paste JS object";

const degrees = (decimals: number) => ({
  format: (v: number) => v.toFixed(decimals),
});

/**
 * The camera rows: key, tweakpane binding options, hover hint. A range here
 * only limits what can be entered: refreshing a binding clamps its value in
 * `params`, so an edit reads the camera again and sends only its own key.
 */
const ROWS: [keyof CameraSnapshot, NumberInputParams, string][] = [
  ["lng", { min: -180, max: 180, ...degrees(6) }, "Longitude in degrees."],
  ["lat", { min: -89.999, max: 89.999, ...degrees(6) }, "Latitude in degrees."],
  [
    "height",
    degrees(1),
    "Height above the ellipsoid in meters; negative below it. Drag the label or type a value.",
  ],
  ["heading", degrees(2), "Degrees clockwise from north."],
  ["pitch", degrees(2), "Degrees up from the horizon; negative looks down."],
  ["roll", degrees(2), "Degrees of tilt around the view direction."],
  [
    "fov",
    { min: 1, max: 179, step: 0.1 },
    "Vertical field of view in degrees.",
  ],
];

/** How often a hidden-then-shown or not-yet-read panel catches up. */
const CATCH_UP_MS = 250;

/**
 * Devtool for the camera: shows its position, orientation and field of
 * view while it moves, sets them from the sliders, and copies or pastes
 * them as a JS object. Works alone (own pane) or as the `"camera"` tab of
 * `DevtoolsPlugin`. The controls are greyed out while the tool is disabled
 * and until the engine camera exists (the first engine update).
 */
export class CameraInspectorPlugin extends DevtoolPlugin {
  readonly title = "Camera";

  /** What the bindings show; written only from the camera. */
  private readonly params: CameraSnapshot = {
    lng: 0,
    lat: 0,
    height: 0,
    heading: 0,
    pitch: 0,
    roll: 0,
    fov: 45,
  };
  private readonly controls: { disabled: boolean }[] = [];
  private readonly bindings: { refresh(): void; disabled: boolean }[] = [];
  /** Set while the bindings are refreshed from the camera, so their change events do not set it back. */
  private syncing = false;
  /** Between `onEnable` and `onDisable`. */
  private active = false;
  /** Whether the engine camera has been read once; it exists from then on. */
  private hasCamera = false;
  /** The camera changed since the bindings last showed it. */
  private stale = true;
  private flushQueued = false;
  /** Shows a camera that changed while the panel could not be seen. */
  private readonly ticker = new Ticker(CATCH_UP_MS, () => this.flush());

  constructor(options: CameraInspectorPluginOptions = {}) {
    super(options);
  }

  /**
   * The camera, read from the view now. `undefined` until the engine camera
   * exists (the first engine update after `init`).
   */
  snapshot(): CameraSnapshot | undefined {
    return this.readCamera();
  }

  /**
   * Sets the camera; keys left out keep their current value. Valid after
   * `init`. Before the engine camera exists there is no current value, so
   * only the keys given are sent: the position moves only when `lng`, `lat`
   * and `height` are all given.
   */
  apply(camera: Partial<CameraSnapshot>): void {
    const { fov, ...pose } = camera;
    const current = this.readCamera();
    this.view.setCamera(current ? { ...current, ...pose } : pose);
    if (fov !== undefined) this.view.camera.fov = fov;
  }

  protected onInit(): void {
    for (const [key, options, text] of ROWS) {
      const binding = this.ui
        .addBinding(this.params, key, options)
        .on("change", (ev) => {
          if (this.syncing || !this.hasCamera) return;
          this.apply({ [key]: ev.value });
        });
      hint(binding, text);
      this.bindings.push(binding);
    }

    const copy = this.ui.addButton({ title: COPY_TITLE });
    hint(copy, "Copies the camera to the clipboard.");
    copy.on("click", () => {
      const camera = this.snapshot();
      const clipboard = getClipboard();
      if (!camera || !clipboard) {
        flash(copy, camera ? NO_CLIPBOARD : "No camera yet", COPY_TITLE);
        return;
      }
      clipboard.writeText(formatCameraSnippet(camera)).then(
        () => flash(copy, "Copied!", COPY_TITLE),
        (error: unknown) => {
          console.error("[devtools] Clipboard write failed:", error);
          flash(copy, "Copy failed", COPY_TITLE);
        },
      );
    });

    const paste = this.ui.addButton({ title: PASTE_TITLE });
    hint(
      paste,
      "Sets the camera from the clipboard: a JS object, JSON or a setCamera() call with lng, lat and height. heading, pitch, roll and fov are optional.",
    );
    paste.on("click", () => {
      const clipboard = getClipboard();
      if (!clipboard) {
        flash(paste, NO_CLIPBOARD, PASTE_TITLE);
        return;
      }
      clipboard.readText().then(
        (text) => {
          const parsed = parseCameraSnippet(text);
          if ("error" in parsed) {
            flash(paste, parsed.error, PASTE_TITLE);
            return;
          }
          this.apply(parsed.camera);
          flash(paste, "Pasted!", PASTE_TITLE);
        },
        (error: unknown) => {
          console.error("[devtools] Clipboard read failed:", error);
          flash(paste, "Read failed", PASTE_TITLE);
        },
      );
    });

    this.controls.push(...this.bindings, copy, paste);
    this.updateControls();
  }

  protected onEnable(): void {
    this.active = true;
    // `move` covers position and orientation (a programmatic change also
    // sends `moveend` in the same frame); `frustumChanged` covers fov.
    this.view.camera.on("move", this.onCameraChange);
    this.view.camera.on("frustumChanged", this.onCameraChange);
    this.ticker.start();
    this.stale = true;
    this.flush();
  }

  protected onDisable(): void {
    this.active = false;
    this.view.camera.off("move", this.onCameraChange);
    this.view.camera.off("frustumChanged", this.onCameraChange);
    this.ticker.stop();
    this.updateControls();
  }

  /**
   * Marks the bindings out of date and refreshes them once, after every
   * camera event of this frame (`move` and `frustumChanged` often come
   * together).
   */
  private readonly onCameraChange = (): void => {
    this.stale = true;
    if (this.flushQueued) return;
    this.flushQueued = true;
    queueMicrotask(() => {
      this.flushQueued = false;
      this.flush();
    });
  };

  /** Refreshes the bindings when out of date and visible. */
  private flush(): void {
    if (!this.active || !this.stale || !this.shown) return;
    const camera = this.readCamera();
    if (!camera) return;
    this.stale = false;
    Object.assign(this.params, camera);
    this.syncing = true;
    try {
      for (const binding of this.bindings) binding.refresh();
    } finally {
      this.syncing = false;
    }
    this.updateControls();
  }

  /**
   * The camera now, or `undefined` before the first engine update (plugin
   * `init` runs earlier), when there is no engine camera yet and `fov`
   * reports `undefined`.
   */
  private readCamera(): CameraSnapshot | undefined {
    const camera = this.view.camera;
    const fov = camera.fov;
    if (fov === undefined) return undefined;
    this.hasCamera = true;
    // The getter fills all three; the type is `Partial` for setCamera.
    const { heading = 0, pitch = 0, roll = 0 } = camera.orientation;
    return { ...camera.positionGeographic, heading, pitch, roll, fov };
  }

  private updateControls(): void {
    const disabled = !this.active || !this.hasCamera;
    for (const control of this.controls) control.disabled = disabled;
  }
}

const NO_CLIPBOARD = "Clipboard needs HTTPS";

/**
 * `navigator.clipboard`, which exists only in a secure context (https or
 * localhost); `undefined` with a warning elsewhere, such as a dev server
 * opened by its LAN address.
 */
function getClipboard(): Clipboard | undefined {
  const clipboard = (navigator as Partial<Navigator>).clipboard;
  if (!clipboard) {
    console.warn(
      "[devtools] navigator.clipboard needs a secure context (https or localhost).",
    );
  }
  return clipboard;
}

/** Shows `text` as the button title for a moment, then `title` again. */
function flash(button: ButtonApi, text: string, title: string): void {
  button.title = text;
  setTimeout(() => {
    button.title = title;
  }, FLASH_MS);
}
