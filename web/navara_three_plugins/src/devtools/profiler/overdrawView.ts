import type ThreeView from "@navaramap/three";
import type { ViewContext } from "@navaramap/three";
import { Pass } from "postprocessing";
import {
  Color,
  NormalBlending,
  ShaderMaterial,
  type WebGLRenderTarget,
  type WebGLRenderer,
} from "three";

import type { DevtoolContainer } from "../DevtoolPlugin";
import { formatCount } from "../util/format";
import { addHtmlBlock, esc, hint, type HtmlBlock } from "../util/html";

import { OverdrawCounter, type OverdrawMode } from "./overdrawCounter";

/** One color band of the heat map: counts from `min` up to the next band. */
type Band = { min: number; color: string };

/** Cold (one layer) to hot (many), in sRGB. */
const BANDS: Band[] = [
  { min: 0, color: "#000000" },
  { min: 1, color: "#1d4ed8" },
  { min: 2, color: "#0891b2" },
  { min: 3, color: "#16a34a" },
  { min: 4, color: "#84cc16" },
  { min: 6, color: "#facc15" },
  { min: 9, color: "#f97316" },
  { min: 16, color: "#dc2626" },
  { min: 32, color: "#c026d3" },
  { min: 64, color: "#ffffff" },
];

function bandLabel(index: number): string {
  const min = BANDS[index].min;
  const next = (BANDS[index + 1] as Band | undefined)?.min;
  if (next === undefined) return `${min}+`;
  return next - 1 === min ? String(min) : `${min}–${next - 1}`;
}

const MODES: Record<string, OverdrawMode> = {
  "shaded fragments": "shaded",
  "every fragment": "all",
  "depth-test passes": "depthTest",
};

const MODE_NOTES: Record<OverdrawMode, string> = {
  shaded:
    "Fragments the GPU shades. A shader that writes gl_FragDepth (the logarithmic depth buffer) turns off the early depth test, so hidden fragments are shaded too.",
  all: "Every fragment the scene draws, hidden or not: the cost when nothing is culled early.",
  depthTest:
    "Only fragments in front of what was already drawn: the cost when the early depth test works.",
};

const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`;

const fragmentShader = /* glsl */ `
uniform sampler2D tCount;
uniform float uMin[${BANDS.length}];
uniform vec3 uColor[${BANDS.length}];
uniform float uOpacity;
varying vec2 vUv;
void main() {
  float count = floor(texture2D(tCount, vUv).r * 255.0 + 0.5);
  int band = 0;
  for (int i = 1; i < ${BANDS.length}; i++) {
    if (count >= uMin[i]) band = i;
  }
  gl_FragColor = vec4(uColor[band], uOpacity);
}
`;

/** Histogram and totals of one frame's counts. */
export type OverdrawSummary = {
  pixels: number;
  /** Pixels with at least one fragment. */
  covered: number;
  fragments: number;
  max: number;
  /** Pixels per band. */
  bands: number[];
};

/** Summarizes counts read back as RGBA bytes (red = count). */
export function summarize(rgba: Uint8Array): OverdrawSummary {
  const bands = new Array<number>(BANDS.length).fill(0);
  const perCount = new Uint32Array(256);
  for (let i = 0; i < rgba.length; i += 4) perCount[rgba[i]]++;
  let fragments = 0;
  let max = 0;
  let band = 0;
  for (let count = 0; count < 256; count++) {
    const n = perCount[count];
    while (band + 1 < BANDS.length && count >= BANDS[band + 1].min) band++;
    if (n === 0) continue;
    bands[band] += n;
    fragments += n * count;
    max = count;
  }
  const pixels = rgba.length / 4;
  return { pixels, covered: pixels - perCount[0], fragments, max, bands };
}

/** Resolves the counts and paints the heat map into the composer input. */
class OverdrawPass extends Pass {
  /** The composer buffers seen at the last render. */
  buffers: WebGLRenderTarget[] = [];
  /** Frames resolved so far, to tell when new counts can be read. */
  frames = 0;

  private readonly material: ShaderMaterial;

  constructor(private readonly counter: OverdrawCounter) {
    super("OverdrawPass");
    this.needsSwap = false;
    this.material = new ShaderMaterial({
      uniforms: {
        tCount: { value: null },
        uMin: { value: BANDS.map((b) => b.min) },
        uColor: { value: BANDS.map((b) => new Color(b.color)) },
        uOpacity: { value: 1 },
      },
      vertexShader,
      fragmentShader,
      blending: NormalBlending,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
    });
    this.fullscreenMaterial = this.material;
  }

  set opacity(value: number) {
    this.material.uniforms.uOpacity.value = value;
  }

  render(
    renderer: WebGLRenderer,
    inputBuffer: WebGLRenderTarget | null,
    outputBuffer: WebGLRenderTarget | null,
  ): void {
    if (!inputBuffer) return;
    this.buffers = outputBuffer ? [inputBuffer, outputBuffer] : [inputBuffer];
    this.counter.resolve(inputBuffer.width, inputBuffer.height);
    this.frames++;
    this.material.uniforms.tCount.value = this.counter.texture ?? null;
    renderer.setRenderTarget(this.renderToScreen ? null : inputBuffer);
    renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.material.dispose();
    super.dispose();
  }
}

const PASS_NAME = "overdraw";
/** New counts are read back at most this often. */
const READ_INTERVAL_MS = 500;

const LEGEND_CSS = `
position: absolute; left: 8px; bottom: 8px; z-index: 999;
padding: 6px 8px; border-radius: 4px; pointer-events: none;
background: rgba(0, 0, 0, 0.72); color: #fff;
font: 11px/1.45 system-ui, sans-serif; font-variant-numeric: tabular-nums;
`;

/**
 * Overdraw heat map: how many fragments the scene draws produced at each
 * pixel of the last frame, from blue (one) to white (64 or more), with a
 * legend on the map and the mean and maximum in the panel. Counting replays
 * every scene draw (see {@link OverdrawCounter}), so it roughly doubles the
 * scene's GPU time while shown and nothing while hidden.
 */
export class OverdrawView {
  private readonly counter: OverdrawCounter;
  private readonly pass: OverdrawPass;
  private readonly state = {
    show: false,
    count: "shaded fragments",
    opacity: 1,
  };
  private status: HtmlBlock | undefined;
  private legend: HTMLDivElement | undefined;
  private registered = false;
  private active = false;
  private summary: OverdrawSummary | undefined;
  private readFrame = -1;
  private lastRead = 0;
  private reading = false;
  private pixels: Uint8Array | undefined;

  constructor(
    private readonly view: ThreeView,
    private readonly ctx: ViewContext,
  ) {
    this.counter = new OverdrawCounter(
      ctx.getRenderer(),
      () => view.camera.raw,
      (target) =>
        target === ctx.getRenderTarget() || this.pass.buffers.includes(target),
    );
    this.pass = new OverdrawPass(this.counter);
    this.pass.enabled = false;
  }

  buildUi(ui: DevtoolContainer): void {
    const folder = ui.addFolder({ title: "Overdraw", expanded: false });
    hint(
      folder,
      "Paints how many fragments were drawn at each pixel: blue for one layer, red and white for many. Counting doubles the scene's GPU time, so turn it off before timing frames.",
    );
    folder
      .addBinding(this.state, "show", { label: "show" })
      .on("change", () => this.apply());
    folder
      .addBinding(this.state, "count", {
        options: Object.fromEntries(Object.keys(MODES).map((m) => [m, m])),
      })
      .on("change", () => this.apply());
    folder
      .addBinding(this.state, "opacity", { min: 0, max: 1, step: 0.05 })
      .on("change", () => this.apply());
    this.status = addHtmlBlock(folder);
    this.renderStatus();
  }

  enable(): void {
    this.active = true;
    this.apply();
  }

  disable(): void {
    if (!this.active) return;
    this.active = false;
    this.apply();
  }

  dispose(): void {
    this.disable();
    if (this.registered) {
      this.ctx.removePass(PASS_NAME);
      this.registered = false;
    }
    this.counter.dispose();
    this.pass.dispose();
  }

  /** Reads the newest counts back for the legend and the panel. */
  refresh(): void {
    if (!this.counter.installed || this.reading) return;
    const now = performance.now();
    if (this.pass.frames === this.readFrame) return;
    if (now - this.lastRead < READ_INTERVAL_MS) return;
    const target = this.counter.renderTarget;
    if (!target) return;
    const size = target.width * target.height * 4;
    if (this.pixels?.length !== size) this.pixels = new Uint8Array(size);
    const pixels = this.pixels;
    const frame = this.pass.frames;
    this.reading = true;
    this.lastRead = now;
    this.ctx
      .getRenderer()
      .readRenderTargetPixelsAsync(
        target,
        0,
        0,
        target.width,
        target.height,
        pixels,
      )
      .then(() => {
        if (!this.counter.installed) return;
        this.readFrame = frame;
        this.summary = summarize(pixels);
        this.renderLegend();
        this.renderStatus();
      })
      .catch((error: unknown) => {
        console.warn("Overdraw: reading the counts failed:", error);
      })
      .finally(() => {
        this.reading = false;
      });
  }

  private get on(): boolean {
    return this.active && this.state.show;
  }

  private apply(): void {
    const on = this.on;
    this.counter.mode = MODES[this.state.count];
    this.pass.opacity = this.state.opacity;
    if (on && !this.counter.installed) {
      if (!this.registered) {
        this.ctx.insertPassBefore("final", PASS_NAME, this.pass);
        this.registered = true;
      }
      const input = this.ctx.getInputBuffer();
      this.counter.install(input.width, input.height);
      this.pass.buffers = [input];
      this.showLegend();
    } else if (!on && this.counter.installed) {
      this.counter.uninstall();
      this.hideLegend();
      this.summary = undefined;
    }
    this.pass.enabled = on;
    this.renderStatus();
    this.view.forceUpdate();
  }

  private showLegend(): void {
    if (this.legend) return;
    const parent = this.ctx.getRenderer().domElement.parentElement;
    if (!parent) return;
    const legend = document.createElement("div");
    legend.style.cssText = LEGEND_CSS;
    parent.appendChild(legend);
    this.legend = legend;
    this.renderLegend();
  }

  private hideLegend(): void {
    this.legend?.remove();
    this.legend = undefined;
  }

  private renderLegend(): void {
    if (!this.legend) return;
    const s = this.summary;
    const rows = BANDS.map((band, i) => {
      const share = s ? `${((100 * s.bands[i]) / s.pixels).toFixed(1)}%` : "";
      return `<div style="display:flex;gap:6px;align-items:center">
<span style="width:12px;height:12px;background:${band.color};border:1px solid #fff4;border-radius:2px"></span>
<span style="width:40px">${bandLabel(i)}</span>
<span style="width:44px;text-align:right;opacity:.8">${share}</span></div>`;
    }).join("");
    const totals = s
      ? `<div style="margin-top:4px">mean <b>${(s.fragments / Math.max(s.covered, 1)).toFixed(2)}</b> · max <b>${s.max === 255 ? "255+" : s.max}</b></div>`
      : "";
    this.legend.innerHTML = `<div style="font-weight:600;margin-bottom:3px">${esc(
      this.state.count,
    )} per pixel</div>${rows}${totals}`;
  }

  private renderStatus(): void {
    if (!this.status) return;
    const mode = MODES[this.state.count];
    const s = this.summary;
    const draws = this.counter.stats;
    const lines = [`<div class="note">${esc(MODE_NOTES[mode])}</div>`];
    if (this.on && s) {
      const kv = (k: string, v: string, title: string) =>
        `<div class="k" title="${esc(title)}">${k}</div><div class="num">${v}</div>`;
      lines.unshift(
        `<div class="kv">${[
          kv(
            "Mean per pixel",
            (s.fragments / Math.max(s.covered, 1)).toFixed(2),
            "Fragments per pixel, over the pixels that have at least one.",
          ),
          kv(
            "Mean, whole frame",
            (s.fragments / s.pixels).toFixed(2),
            "Fragments per pixel, over every pixel of the frame.",
          ),
          kv(
            "Max",
            s.max === 255 ? "255+" : String(s.max),
            "The most fragments at one pixel. Counts stop at 255.",
          ),
          kv(
            "Fragments",
            formatCount(s.fragments),
            "Fragments counted in the frame.",
          ),
          kv(
            "Draws counted",
            formatCount(draws.counted),
            "Scene draw calls replayed into the counter.",
          ),
        ].join("")}</div>`,
      );
      if (draws.skipped > 0) {
        lines.push(
          `<div class="note warn">${draws.skipped} draws not counted: their target has no stencil buffer.</div>`,
        );
      }
      if (draws.stencilTested > 0) {
        lines.push(
          `<div class="note warn">${draws.stencilTested} draws not counted: they use the stencil test, which counting cannot replay.</div>`,
        );
      }
      if (draws.unknownPrograms > 0) {
        lines.push(
          `<div class="note warn">${draws.unknownPrograms} draws used a shader whose source could not be read; counted as writing gl_FragDepth.</div>`,
        );
      }
    }
    this.status.render(lines.join(""));
  }
}
