import type { ViewContext } from "@navaramap/three";
import type { Texture } from "three";

import type { DebugContainer } from "../DebugPlugin";

import { DebugBlitPass, type BlitCorner, type BlitMode } from "./DebugBlitPass";

type TextureSource = {
  label: string;
  get: () => Texture | undefined;
  /** The mode that reads the texture's encoding. */
  mode: BlitMode;
  range?: [number, number];
};

const PASS_NAME = "debugBlit";

/**
 * Picture-in-picture viewer for the pipeline's textures: the G-buffer
 * attachments, the depth copies and every render target of the fixed stack.
 * The blit pass stays registered while the viewer exists and is disabled
 * when nothing is shown.
 */
export class ContentViewer {
  private readonly pass = new DebugBlitPass();
  private sources: TextureSource[] = [];
  private readonly state = {
    show: false,
    source: "",
    mode: "rgb" as BlitMode,
    channel: 0,
    rangeMin: 0,
    rangeMax: 1,
    corner: "bottom-left" as BlitCorner,

    scale: 0.3,
  };
  private sourceBinding: ReturnType<DebugContainer["addBinding"]> | undefined;
  private folder: ReturnType<DebugContainer["addFolder"]> | undefined;
  private registered = false;

  constructor(
    private readonly ctx: ViewContext,
    /** Asks the view for a frame so a setting change shows at once. */
    private readonly requestRender: () => void,
  ) {
    this.pass.enabled = false;
  }

  buildUi(ui: DebugContainer): void {
    const folder = ui.addFolder({ title: "Content viewer", expanded: false });
    this.folder = folder;
    folder.addBinding(this.state, "show").on("change", () => this.apply());
    this.rebuildSources();
    folder
      .addBinding(this.state, "mode", {
        options: {
          rgb: "rgb",
          channel: "channel",
          normal: "normal",
          packedDepth: "packedDepth",
          bitmask: "bitmask",
        },
      })
      .on("change", () => this.apply());
    folder
      .addBinding(this.state, "channel", {
        options: { R: 0, G: 1, B: 2, A: 3 },
      })
      .on("change", () => this.apply());
    folder
      .addBinding(this.state, "rangeMin", { min: 0, max: 1, step: 0.001 })
      .on("change", () => this.apply());
    folder
      .addBinding(this.state, "rangeMax", { min: 0, max: 1, step: 0.001 })
      .on("change", () => this.apply());
    folder
      .addBinding(this.state, "corner", {
        options: {
          "top-left": "top-left",
          "top-right": "top-right",
          "bottom-left": "bottom-left",
          "bottom-right": "bottom-right",
        },
      })
      .on("change", () => this.apply());
    folder
      .addBinding(this.state, "scale", { min: 0.1, max: 1, step: 0.05 })
      .on("change", () => this.apply());
    folder.addButton({ title: "Refresh sources" }).on("click", () => {
      this.rebuildSources();
    });
  }

  enable(): void {
    if (!this.registered) {
      this.ctx.insertPassBefore("final", PASS_NAME, this.pass);
      this.registered = true;
    }
    this.ctx.on("passesChanged", this.onPassesChanged);
    this.apply();
  }

  disable(): void {
    this.ctx.off("passesChanged", this.onPassesChanged);
    this.pass.enabled = false;
  }

  dispose(): void {
    this.disable();
    if (this.registered) {
      this.ctx.removePass(PASS_NAME);
      this.registered = false;
    }
    this.pass.dispose();
  }

  private readonly onPassesChanged = (): void => {
    // Our own insertion fires this too; rebuilding is cheap.
    this.rebuildSources();
  };

  private rebuildSources(): void {
    const ctx = this.ctx;
    const sources: TextureSource[] = [
      {
        label: "G-buffer color",
        get: () => ctx.getRenderTarget().texture,
        mode: "rgb",
      },
      {
        label: "G-buffer normal (octahedral)",
        get: () => ctx.getNormalTexture(),
        mode: "normal",
      },
      {
        label: "G-buffer effect ids",
        get: () => ctx.getEffectIdsTexture(),
        mode: "bitmask",
      },
      {
        label: "G-buffer emissive",
        get: () => ctx.getEmissiveTexture(),
        mode: "rgb",
      },
      {
        label: "G-buffer shadow (R)",
        get: () => ctx.getShadowTexture(),
        mode: "channel",
      },
      {
        label: "G-buffer depth",
        get: () => ctx.getRenderTarget().depthTexture ?? undefined,
        mode: "channel",
        range: [0.9, 1],
      },
      {
        label: "Globe depth copy (packed)",
        get: () => ctx.getGlobeDepthTexture(),
        mode: "packedDepth",
        range: [0.9, 1],
      },
      {
        label: "Globe normal copy (octahedral)",
        get: () => ctx.getGlobeNormalTexture(),
        mode: "normal",
      },
    ];
    for (const entry of ctx.getRenderTargets()) {
      if (entry.owner === PASS_NAME) continue;
      const { target } = entry;
      target.textures.forEach((_, index) => {
        sources.push({
          label: `${entry.owner}: ${target.width}×${target.height}${
            target.textures.length > 1 ? ` [${index}]` : ""
          }`,
          get: () => target.textures[index],
          mode: "rgb",
        });
      });
      if (target.depthTexture) {
        sources.push({
          label: `${entry.owner}: depth`,
          get: () => target.depthTexture ?? undefined,
          mode: "channel",
          range: [0.9, 1],
        });
      }
    }
    this.sources = sources;
    if (!sources.some((s) => s.label === this.state.source)) {
      this.state.source = sources[0]?.label ?? "";
    }
    this.sourceBinding?.dispose();
    const options: Record<string, string> = {};
    for (const source of sources) options[source.label] = source.label;
    this.sourceBinding = this.folder
      ?.addBinding(this.state, "source", { options, index: 1 })
      .on("change", () => {
        const source = this.sources.find((s) => s.label === this.state.source);
        if (source) {
          this.state.mode = source.mode;
          [this.state.rangeMin, this.state.rangeMax] = source.range ?? [0, 1];
        }
        this.apply();
      });
    this.apply();
  }

  private apply(): void {
    const source = this.sources.find((s) => s.label === this.state.source);
    this.pass.source = source?.get;
    this.pass.mode = this.state.mode;
    this.pass.channel = this.state.channel;
    this.pass.setRange(this.state.rangeMin, this.state.rangeMax);
    this.pass.corner = this.state.corner;
    this.pass.scale = this.state.scale;
    this.pass.enabled = this.state.show && source !== undefined;
    this.requestRender();
  }
}
