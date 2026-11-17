import type { ButtonApi, NumberInputParams } from "tweakpane";

import { DevtoolPlugin, type DevtoolPluginOptions } from "../DevtoolPlugin";
import { hint } from "../util/html";

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

/** The camera rows: key, tweakpane binding options, hover hint. */
const ROWS: [keyof CameraSnapshot, NumberInputParams, string][] = [
  ["lng", { min: -180, max: 180, ...degrees(6) }, "Longitude in degrees."],
  ["lat", { min: -89.999, max: 89.999, ...degrees(6) }, "Latitude in degrees."],
  [
    "height",
    { min: 1, ...degrees(1) },
    "Height above the ellipsoid in meters. Drag the label or type a value.",
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

/**
 * Devtool for the camera: shows its position, orientation and field of
 * view while it moves, sets them from the sliders, and copies or pastes
 * them as a JS object. Works alone (own pane) or as the `"camera"` tab of
 * `DevtoolsPlugin`. While disabled, the controls are greyed out.
 */
export class CameraInspectorPlugin extends DevtoolPlugin {
  readonly title = "Camera";

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

  constructor(options: CameraInspectorPluginOptions = {}) {
    super(options);
  }

  /** The camera, read from the view now. Valid after `init`. */
  snapshot(): CameraSnapshot {
    this.readCamera();
    return { ...this.params };
  }

  /** Sets the camera; keys left out keep their current value. Valid after `init`. */
  apply(camera: Partial<CameraSnapshot>): void {
    this.readCamera();
    Object.assign(this.params, camera);
    this.view.setCamera(this.params);
    this.view.camera.fov = this.params.fov;
    this.refreshBindings();
  }

  protected onInit(): void {
    for (const [key, options, text] of ROWS) {
      const binding = this.ui
        .addBinding(this.params, key, options)
        .on("change", () => {
          if (this.syncing) return;
          if (key === "fov") this.view.camera.fov = this.params.fov;
          else this.view.setCamera(this.params);
        });
      hint(binding, text);
      this.bindings.push(binding);
    }

    const copy = this.ui.addButton({ title: COPY_TITLE });
    hint(copy, "Copies the camera to the clipboard.");
    copy.on("click", () => {
      navigator.clipboard.writeText(formatCameraSnippet(this.snapshot())).then(
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
      navigator.clipboard.readText().then(
        (text) => {
          const camera = parseCameraSnippet(text);
          if (!camera) {
            flash(paste, "Needs lng, lat and height", PASTE_TITLE);
            return;
          }
          this.apply(camera);
          flash(paste, "Pasted!", PASTE_TITLE);
        },
        (error: unknown) => {
          console.error("[devtools] Clipboard read failed:", error);
          flash(paste, "Read failed", PASTE_TITLE);
        },
      );
    });

    this.controls.push(...this.bindings, copy, paste);
    this.setControlsDisabled(true);
  }

  protected onEnable(): void {
    this.view.camera.on("move", this.refresh);
    this.view.camera.on("moveend", this.refresh);
    this.setControlsDisabled(false);
    this.refresh();
  }

  protected onDisable(): void {
    this.view.camera.off("move", this.refresh);
    this.view.camera.off("moveend", this.refresh);
    this.setControlsDisabled(true);
  }

  private readonly refresh = (): void => {
    this.readCamera();
    this.refreshBindings();
  };

  private refreshBindings(): void {
    this.syncing = true;
    for (const binding of this.bindings) binding.refresh();
    this.syncing = false;
  }

  /**
   * Copies the camera into `params`. Before the first engine update (plugin
   * `init` runs earlier) there is no engine camera yet, which `fov` reports
   * as `undefined`; the camera's first `move` refreshes the tool then.
   */
  private readCamera(): void {
    const camera = this.view.camera;
    const fov = camera.fov;
    if (fov === undefined) return;
    Object.assign(this.params, camera.positionGeographic, camera.orientation, {
      fov,
    });
  }

  private setControlsDisabled(disabled: boolean): void {
    for (const control of this.controls) control.disabled = disabled;
  }
}

/** Shows `text` as the button title for a moment, then `title` again. */
function flash(button: ButtonApi, text: string, title: string): void {
  button.title = text;
  setTimeout(() => {
    button.title = title;
  }, FLASH_MS);
}
