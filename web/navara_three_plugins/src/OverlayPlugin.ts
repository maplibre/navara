/**
 * OverlayPlugin — Navara Plugin for world-to-screen overlay projection.
 *
 * Tracks a set of world positions (lat/lng/alt) and projects them to
 * screen coordinates on every render frame. UI components subscribe via
 * `onUpdate()` to render HTML overlays at the projected positions.
 *
 * ## Usage
 *
 * ```ts
 * import ThreeView from "@navaramap/three";
 * import { DefaultPlugin } from "@navaramap/three-default-plugin";
 * import { OverlayPlugin, moveOverlayElement } from "@navaramap/three-plugins";
 *
 * const view = new ThreeView({ container, animation: true });
 * const overlayPlugin = new OverlayPlugin({ maxDistance: 100_000 });
 *
 * view.addPlugin(overlayPlugin);
 * await view.init();
 *
 * overlayPlugin.setPositions([
 *   { id: "marker-1", lng: 139.77, lat: 35.68, alt: 0 },
 * ]);
 *
 * const unsub = overlayPlugin.onUpdate(({ projected }) => {
 *   for (const [id, pos] of projected) {
 *     const el = document.getElementById(id);
 *     if (el) moveOverlayElement(el, pos.x, pos.y);
 *   }
 * });
 *
 * unsub();
 * overlayPlugin.dispose();
 * ```
 */
import ThreeView, {
  Plugin,
  geodeticToVector3,
  convertWorldToScreen,
  type ViewContext,
  type Window,
} from "@navaramap/three";
import type { DefaultDescriptions } from "@navaramap/three-default-plugin";

type View = ThreeView<DefaultDescriptions>;

export type WorldPosition = {
  id: string;
  lng: number;
  lat: number;
  alt: number;
};

export type ProjectedPosition = {
  x: number;
  y: number;
  /** Distance from the camera in meters (ECEF euclidean). */
  distance: number;
};

export type CameraPosition = {
  lng: number;
  lat: number;
  height: number;
  heading: number;
  pitch: number;
};

export type OverlayState = {
  projected: Map<string, ProjectedPosition>;
};

export type OverlayConfig = {
  /** Positions farther than this (in meters) are skipped. @defaultValue `100_000` (100 km) */
  maxDistance?: number;
};

type UpdateListener = (state: OverlayState) => void;

/**
 * Position an absolutely-positioned HTML element using a GPU-accelerated
 * CSS `translate()` transform.
 */
export function moveOverlayElement(
  el: HTMLElement,
  x: number,
  y: number,
): void {
  el.style.transform = `translate(${x}px, ${y}px)`;
  el.style.willChange = "transform";
}

const DEFAULT_MAX_DISTANCE = 100_000;

/**
 * Projects geographic positions to screen coordinates on every render frame.
 *
 * Register via `view.addPlugin(overlayPlugin)` **before** `view.init()`.
 * The `preUpdate` and `preRender` hooks are attached automatically during
 * initialization.
 */
export class OverlayPlugin extends Plugin<View, ViewContext> {
  private view?: View;
  private maxDistance: number;

  private positions: WorldPosition[] = [];
  private projected = new Map<string, ProjectedPosition>();

  private listeners = new Set<UpdateListener>();
  /**
   * Set when the projection must be recomputed although the view may have
   * nothing else to render. Turned into a frame request in `preUpdate`,
   * which runs on every tick before the view decides whether to render; a
   * `forceUpdate()` made during a frame instead is cleared by the view right
   * after that frame.
   */
  private needsProjection = false;
  private boundPreUpdate: () => void;
  private boundHandler: () => void;

  constructor(config?: OverlayConfig) {
    super();
    this.maxDistance = config?.maxDistance ?? DEFAULT_MAX_DISTANCE;
    this.boundPreUpdate = this.handlePreUpdate.bind(this);
    this.boundHandler = this.handlePreRender.bind(this);
  }

  async init(view: View, _ctx: ViewContext): Promise<void> {
    this.view = view;
    view.on("preUpdate", this.boundPreUpdate);
    view.on("preRender", this.boundHandler);
  }

  /**
   * Replace the set of world positions to track. The next frame projects
   * them and calls the `onUpdate` listeners, and a frame is rendered for
   * this even when the map is idle. Calls made within one frame are
   * projected together on the next.
   */
  setPositions(positions: WorldPosition[]): void {
    this.positions = positions;
    this.needsProjection = true;
  }

  /**
   * Subscribe to projection updates, called on every rendered frame.
   * A new listener receives the current projection on the next frame,
   * which is rendered for this even when the map is idle.
   */
  onUpdate(fn: UpdateListener): () => void {
    this.listeners.add(fn);
    this.needsProjection = true;
    return () => this.listeners.delete(fn);
  }

  dispose(): void {
    if (this.view) {
      this.view.off("preUpdate", this.boundPreUpdate);
      this.view.off("preRender", this.boundHandler);
      this.view = undefined;
    }
    this.needsProjection = false;
    this.listeners.clear();
    this.positions = [];
    this.projected.clear();
  }

  private worldToScreen(
    lng: number,
    lat: number,
    alt: number,
  ): { x: number; y: number } | null {
    if (!this.view) return null;

    const ecef = geodeticToVector3({ lng, lat, height: alt });

    const win: Window = {
      width: this.view.screenSize.x,
      height: this.view.screenSize.y,
      pixelRatio: this.view.pixelRatio,
    };

    const result = convertWorldToScreen(win, this.view.camera.raw, ecef);
    if (!result) return null;

    return { x: result.x, y: result.y };
  }

  private handlePreUpdate(): void {
    if (this.needsProjection) this.view?.forceUpdate();
  }

  private handlePreRender(): void {
    if (!this.view) return;
    // Cleared before the listeners run, so one that calls `setPositions`
    // gets its positions projected on the next frame.
    this.needsProjection = false;

    const geo = this.view.camera.positionGeographic;
    const cameraEcef = geodeticToVector3({
      lng: geo.lng,
      lat: geo.lat,
      height: geo.height,
    });

    const next = new Map<string, ProjectedPosition>();
    for (const pos of this.positions) {
      const markerEcef = geodeticToVector3({
        lng: pos.lng,
        lat: pos.lat,
        height: pos.alt,
      });
      const distance = cameraEcef.distanceTo(markerEcef);
      if (distance > this.maxDistance) continue;

      const screen = this.worldToScreen(pos.lng, pos.lat, pos.alt);
      if (screen) {
        next.set(pos.id, { ...screen, distance });
      }
    }
    this.projected = next;

    const state: OverlayState = {
      projected: this.projected,
    };
    for (const fn of this.listeners) fn(state);
  }
}
