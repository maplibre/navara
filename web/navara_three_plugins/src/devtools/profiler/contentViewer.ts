import type ThreeView from "@navaramap/three";
import type { ViewContext } from "@navaramap/three";
import type { Texture } from "three";

import type { DevtoolContainer } from "../DevtoolPlugin";
import { addHtmlBlock, esc, hint, type HtmlBlock } from "../util/html";

import { DebugBlitPass, type BlitCorner, type BlitMode } from "./DebugBlitPass";

/** One thing the viewer can show. */
type BufferView = {
  name: string;
  /** What the picture means, in plain words. */
  description: string;
  mode: BlitMode;
  channel?: number;
  /** The texture, or why there is none right now. */
  resolve: (ctx: ViewContext) => Texture | string;
};

/** Optional G-buffers exist only while an effect asks for them. */
function optional(texture: Texture | undefined, why: string): Texture | string {
  return texture ?? why;
}

/** A copy target kept at 1×1 until something needs it. */
function sized(texture: Texture, why: string): Texture | string {
  const image = texture.image as { width?: number } | undefined;
  return (image?.width ?? 0) > 1 ? texture : why;
}

const VIEWS: BufferView[] = [
  {
    name: "Scene color",
    description:
      "The scene as drawn into the G-buffer, before atmosphere, tone mapping and anti-aliasing. Raise the brightness if it looks black: values are HDR.",
    mode: "color",
    resolve: (ctx) => ctx.getRenderTarget().texture,
  },
  {
    name: "Surface normals",
    description:
      "Which way each surface faces, relative to the camera: red = right, green = up, blue = toward you. Terrain without vertex normals shows black.",
    mode: "normal",
    resolve: (ctx) =>
      optional(ctx.getNormalTexture(), "The normal buffer is not allocated."),
  },
  {
    name: "Roughness",
    description:
      "Material roughness per pixel: black = mirror-smooth, white = fully rough (most terrain and imagery).",
    mode: "channel",
    channel: 3,
    resolve: (ctx) =>
      optional(ctx.getNormalTexture(), "The normal buffer is not allocated."),
  },
  {
    name: "Reflectance",
    description:
      "How strongly each surface reflects (F0): black = not reflective. Water and metallic models show up bright.",
    mode: "channel",
    channel: 2,
    resolve: (ctx) =>
      optional(ctx.getNormalTexture(), "The normal buffer is not allocated."),
  },
  {
    name: "Depth",
    description:
      "Distance from the camera: black at the camera's height above the ground or nearer, white 50× farther or more (logarithmic).",
    mode: "depth",
    resolve: (ctx) =>
      ctx.getRenderTarget().depthTexture ??
      "The G-buffer has no depth texture.",
  },
  {
    name: "Terrain depth",
    description:
      "Distance to the terrain alone, without layers or meshes, shaded like Depth. Draped data and ground-clamped lines are placed with it.",
    mode: "packedDepth",
    resolve: (ctx) => ctx.getGlobeDepthTexture(),
  },
  {
    name: "Terrain normals",
    description:
      "Surface direction of the terrain alone (colors as in Surface normals). Draped meshes are shaded with it.",
    mode: "normal",
    resolve: (ctx) =>
      sized(
        ctx.getGlobeNormalTexture(),
        "Only kept while a draped mesh or an effect needs terrain normals.",
      ),
  },
  {
    name: "Shadows",
    description: "Shadow amount per pixel: white = in shadow, black = lit.",
    mode: "channel",
    channel: 0,
    resolve: (ctx) =>
      optional(
        ctx.getShadowTexture(),
        "Only kept while an effect needs it (deferred lighting with shadows).",
      ),
  },
  {
    name: "Selective effects",
    description:
      "Pixels of meshes marked for a selective effect, one color per effect slot (red, green, blue, …).",
    mode: "bitmask",
    resolve: (ctx) =>
      optional(
        ctx.getEffectIdsTexture(),
        "Only kept while a selective effect (bloom, outline) is active.",
      ),
  },
  {
    name: "Emissive",
    description:
      "Glow color written by emissive materials, which bloom spreads.",
    mode: "color",
    resolve: (ctx) =>
      optional(
        ctx.getEmissiveTexture(),
        "Only kept while an effect that uses it (bloom) is active.",
      ),
  },
];

const PASS_NAME = "debugBlit";
const CORNERS: Record<string, BlitCorner> = {
  "bottom left": "bottom-left",
  "bottom right": "bottom-right",
  "top left": "top-left",
  "top right": "top-right",
};

/**
 * Picture-in-picture view of the G-buffer and the terrain copies, drawn on
 * the GPU into a corner of the frame. Each view decodes its buffer for you
 * (normals as colors, depth as gray), so there is nothing to configure but
 * what to look at and how bright.
 */
export class BufferViewer {
  private readonly pass = new DebugBlitPass();
  private readonly state = {
    show: false,
    view: VIEWS[1].name,
    brightness: 1,
    corner: "bottom left",
    size: 0.3,
    shadowMaps: false,
  };
  private status: HtmlBlock | undefined;
  private brightnessBinding: { hidden: boolean } | undefined;
  private registered = false;
  /** What the shown view resolved to at the last `apply`. */
  private shown: Texture | string | undefined;

  constructor(
    private readonly view: ThreeView,
    private readonly ctx: ViewContext,
  ) {
    this.pass.enabled = false;
  }

  buildUi(ui: DevtoolContainer): void {
    const folder = ui.addFolder({ title: "Buffer viewer", expanded: false });
    hint(
      folder,
      "Shows one of the renderer's internal images in a corner of the map.",
    );
    folder
      .addBinding(this.state, "show", { label: "show" })
      .on("change", () => this.apply());
    folder
      .addBinding(this.state, "view", {
        options: Object.fromEntries(VIEWS.map((v) => [v.name, v.name])),
      })
      .on("change", () => this.apply());
    const brightness = folder
      .addBinding(this.state, "brightness", { min: 0.05, max: 10 })
      .on("change", () => this.apply());
    hint(brightness, "Multiplies the shown values.");
    this.brightnessBinding = brightness;
    folder
      .addBinding(this.state, "corner", {
        options: Object.fromEntries(Object.keys(CORNERS).map((c) => [c, c])),
      })
      .on("change", () => this.apply());
    folder
      .addBinding(this.state, "size", { min: 0.15, max: 0.9, step: 0.05 })
      .on("change", () => this.apply());
    this.status = addHtmlBlock(folder);
    const shadowMaps = folder
      .addBinding(this.state, "shadowMaps", { label: "sun shadow maps" })
      .on("change", () => {
        this.view.shadowMapViewersEnabled = this.state.shadowMaps;
        this.view.forceUpdate();
      });
    hint(
      shadowMaps,
      "Draws each sun shadow cascade's depth map at the left edge of the screen.",
    );
    this.apply();
  }

  enable(): void {
    if (!this.registered) {
      this.ctx.insertPassBefore("final", PASS_NAME, this.pass);
      this.registered = true;
    }
    // `disable` turned them off without clearing the checkbox.
    if (this.state.shadowMaps) this.view.shadowMapViewersEnabled = true;
    this.apply();
  }

  disable(): void {
    this.pass.enabled = false;
    if (this.state.shadowMaps) this.view.shadowMapViewersEnabled = false;
  }

  dispose(): void {
    this.disable();
    if (this.registered) {
      this.ctx.removePass(PASS_NAME);
      this.registered = false;
    }
    this.pass.dispose();
  }

  /**
   * Re-evaluates availability: optional buffers come and go with effects.
   * Called on the profiler's UI tick, so it redraws only when the buffer
   * appeared, went away or was replaced; an idle map stays idle.
   */
  refresh(): void {
    if (!this.state.show) return;
    if (this.currentView().resolve(this.ctx) !== this.shown) this.apply();
  }

  private currentView(): BufferView {
    return VIEWS.find((v) => v.name === this.state.view) ?? VIEWS[0];
  }

  /** Shades depth from the camera's height above the ground (black) outward. */
  private updateDepthScale(): void {
    const camera = this.view.camera;
    this.pass.setDepthScale(
      this.ctx.getRenderer().capabilities.logarithmicDepthBuffer,
      camera.far,
      Math.abs(camera.positionGeographic.height),
    );
  }

  private apply(): void {
    const view = this.currentView();
    const resolved = view.resolve(this.ctx);
    this.shown = resolved;
    const texture = typeof resolved === "string" ? undefined : resolved;
    const depth = view.mode === "depth" || view.mode === "packedDepth";
    this.pass.source = () => {
      const r = view.resolve(this.ctx);
      if (typeof r === "string") return undefined;
      // Per render, so the shading follows the camera height. The engine
      // camera exists from the first update on, which precedes any render.
      if (depth) this.updateDepthScale();
      return r;
    };
    this.pass.mode = view.mode;
    this.pass.channel = view.channel ?? 0;
    this.pass.brightness = this.state.brightness;
    this.pass.corner = CORNERS[this.state.corner];
    this.pass.scale = this.state.size;
    this.pass.enabled = this.state.show && texture !== undefined;
    if (this.brightnessBinding) {
      this.brightnessBinding.hidden =
        view.mode === "normal" || view.mode === "bitmask";
    }
    const status =
      typeof resolved === "string"
        ? `<span class="warn">Not available:</span> ${esc(resolved)}`
        : esc(view.description);
    this.status?.render(`<div class="note">${status}</div>`);
    this.view.forceUpdate();
  }
}
