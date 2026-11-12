import type {
  FrameTiming,
  MemoryStats,
  Source,
  SourceDescription,
  WorkerMemoryStats,
} from "@navaramap/three";
import type { WebGLRenderer } from "three";

import { DevtoolPlugin, type DevtoolPluginOptions } from "../DevtoolPlugin";
import { formatBytes, formatCount, formatMs, hostOf } from "../util/format";
import { addGraph } from "../util/graph";
import {
  addHtmlBlock,
  bar,
  esc,
  hint,
  meter,
  type HtmlBlock,
} from "../util/html";
import { describeJob, describePass, describeSourceType } from "../util/names";
import { Ticker } from "../util/ticker";

import { BufferViewer } from "./contentViewer";
import { FrameStats } from "./frameStats";
import {
  NetworkMeter,
  sourceUrlMatcher,
  type NetworkSourceMatcher,
  type NetworkSourceStats,
} from "./networkMeter";
import { PassProfiler, type PassSample } from "./passProfiler";

export type ProfilerPluginOptions = DevtoolPluginOptions;

/** Tables are rebuilt at this cadence; graphs read their state directly. */
const UI_INTERVAL_MS = 250;
/** `memoryStats()` crosses the WASM boundary; keep it off the hot path. */
const MEMORY_INTERVAL_MS = 1000;
/** Window for "shader programs compiled recently". */
const PROGRAM_WINDOW_MS = 5000;
/** One display frame at 60 Hz; frames slower than this drop frames. */
const FRAME_BUDGET_MS = 1000 / 60;
const OTHER_SOURCE = "(other)";

/** One recorded drawn frame of a capture. */
export type CapturedFrame = FrameTiming & {
  passes: PassSample[];
  calls: number;
  triangles: number;
};

type SourceInfo = { label: string; hint: string };

/** `<tr>` with a hover hint. */
function row(title: string, cells: string, cls = ""): string {
  return `<tr title="${esc(title)}"${cls ? ` class="${cls}"` : ""}>${cells}</tr>`;
}

function td(content: string, cls = ""): string {
  return `<td${cls ? ` class="${cls}"` : ""}>${content}</td>`;
}

function msClass(ms: number | undefined): string {
  if (ms === undefined) return "num";
  return ms > 2 * FRAME_BUDGET_MS
    ? "num bad"
    : ms > FRAME_BUDGET_MS
      ? "num warn"
      : "num";
}

/**
 * Performance readouts for a running view: frame rate and frame time, where
 * each frame's time goes (per render pass, CPU and GPU), engine memory
 * against its budget, downloads per source, background work, and a buffer
 * viewer. Everything is sampled only while enabled. Hover any row for what
 * it means.
 */
export class ProfilerPlugin extends DevtoolPlugin {
  readonly title = "Profiler";

  private renderer!: WebGLRenderer;
  private readonly frames = new FrameStats();
  private passes!: PassProfiler;
  private readonly network = new NetworkMeter();
  private viewer!: BufferViewer;
  private readonly matchers: NetworkSourceMatcher[] = [];
  private readonly sources = new Map<string, SourceInfo>();
  /** Pass costs of the latest drawn frame. */
  private passRows: PassSample[] = [];
  private drawnCalls = { calls: 0, triangles: 0, points: 0, lines: 0 };
  private memory: MemoryStats | undefined;
  private workers: WorkerMemoryStats | undefined;
  private jsHeapBytes: number | undefined;
  private readonly programHistory: { at: number; count: number }[] = [];
  private capture: CapturedFrame[] | undefined;
  /** Resolves the pending `record()`, if any. */
  private captureDone: ((frames: CapturedFrame[]) => void) | undefined;

  private readonly graphs = { frameMs: 0, kbPerSecond: 0 };
  private readonly captureState = { frames: 300, status: "not recording" };
  private readonly graphRefreshers: (() => void)[] = [];
  private summary!: HtmlBlock;
  private breakdown!: HtmlBlock;
  private memoryBlock!: HtmlBlock;
  private downloads!: HtmlBlock;
  private background!: HtmlBlock;
  private drawBlock!: HtmlBlock;
  private targets!: HtmlBlock;

  private readonly uiTicker = new Ticker(UI_INTERVAL_MS, () =>
    this.refreshUi(),
  );
  private readonly memoryTicker = new Ticker(MEMORY_INTERVAL_MS, () => {
    void this.refreshMemory();
  });

  constructor(options: ProfilerPluginOptions = {}) {
    super(options);
  }

  protected onInit(): void {
    this.renderer = this.ctx.getRenderer();
    this.passes = new PassProfiler(this.ctx, this.renderer);
    this.viewer = new BufferViewer(this.view, this.ctx);
    this.view.on("sourceAdded", this.onSourceAdded);

    const ui = this.ui;
    this.summary = addHtmlBlock(ui);
    this.graphRefreshers.push(
      addGraph(ui, this.graphs, "frameMs", {
        min: 0,
        max: 33,
        label: "frame time",
        unit: "ms",
      }),
    );

    const breakdown = ui.addFolder({ title: "Where the frame time goes" });
    hint(
      breakdown,
      "The latest drawn frame, step by step. CPU is JavaScript and WASM time on the main thread; GPU is the graphics card's time for that render pass.",
    );
    this.breakdown = addHtmlBlock(breakdown);

    const memory = ui.addFolder({ title: "Memory", expanded: false });
    this.memoryBlock = addHtmlBlock(memory);

    const downloads = ui.addFolder({ title: "Downloads", expanded: false });
    this.graphRefreshers.push(
      addGraph(downloads, this.graphs, "kbPerSecond", {
        min: 0,
        max: 4096,
        digits: 0,
        label: "speed",
        unit: "KB/s",
      }),
    );
    this.downloads = addHtmlBlock(downloads);
    downloads
      .addButton({ title: "Reset counts" })
      .on("click", () => this.network.reset());

    const background = ui.addFolder({
      title: "Background work",
      expanded: false,
    });
    this.background = addHtmlBlock(background);

    const draws = ui.addFolder({ title: "Draw details", expanded: false });
    this.drawBlock = addHtmlBlock(draws);

    const targets = ui.addFolder({ title: "Screen buffers", expanded: false });
    hint(
      targets,
      "Render targets sized to the screen: the G-buffer and post-processing buffers. Their memory grows with the canvas size and pixel ratio.",
    );
    this.targets = addHtmlBlock(targets);

    this.viewer.buildUi(ui);

    const capture = ui.addFolder({ title: "Record frames", expanded: false });
    hint(
      capture,
      "Records the timings of the next drawn frames and downloads them as JSON, to compare two runs.",
    );
    capture.addBinding(this.captureState, "frames", {
      min: 10,
      max: 5000,
      step: 10,
    });
    capture.addBinding(this.captureState, "status", { readonly: true });
    capture
      .addButton({ title: "Record" })
      .on("click", () => this.startCapture());
    capture
      .addButton({ title: "Download JSON" })
      .on("click", () => this.downloadCapture());
  }

  protected onEnable(): void {
    this.view.on("frame", this.onFrame);
    this.passes.enable();
    this.network.enable();
    this.viewer.enable();
    this.uiTicker.start();
    this.memoryTicker.start();
  }

  protected onDisable(): void {
    this.view.off("frame", this.onFrame);
    this.passes.disable();
    this.network.disable();
    this.viewer.disable();
    this.uiTicker.stop();
    this.memoryTicker.stop();
    this.finishCapture();
    this.capture = undefined;
    this.captureState.status = "not recording";
  }

  protected onDispose(): void {
    this.view.off("sourceAdded", this.onSourceAdded);
    this.passes.dispose();
    this.viewer.dispose();
  }

  /** Whether GPU timings are available (`EXT_disjoint_timer_query_webgl2`). */
  get gpuTimingSupported(): boolean {
    return this.passes.gpu.supported;
  }

  /** The latest drawn frame's per-pass costs, in pipeline order. */
  get passSamples(): readonly PassSample[] {
    return this.passRows;
  }

  /** Frame statistics over the recent history. */
  get frameStats(): FrameStats {
    return this.frames;
  }

  /** The network meter, for per-request detail. */
  get networkMeter(): NetworkMeter {
    return this.network;
  }

  /** Download counts per source id (requests outside any source are absent). */
  networkBySource(): Map<string, NetworkSourceStats> {
    return new Map(this.network.perSource().map((s) => [s.sourceId, s]));
  }

  /**
   * Records the next `count` drawn frames; resolves with them. Frames are
   * drawn on demand, so on an idle map it waits until something redraws.
   * Disabling the profiler, or starting another recording, resolves it early
   * with the frames recorded so far; while disabled it resolves with none.
   */
  record(count = this.captureState.frames): Promise<CapturedFrame[]> {
    this.captureState.frames = count;
    if (!this.startCapture()) return Promise.resolve([]);
    return new Promise((resolve) => {
      this.captureDone = resolve;
    });
  }

  private readonly onFrame = (timing: FrameTiming): void => {
    this.frames.push(timing);
    const info = this.renderer.info;
    if (timing.rendered) {
      this.passRows = Array.from(this.passes.samples.values(), (s) => ({
        ...s,
      }));
      this.drawnCalls = {
        calls: info.render.calls,
        triangles: info.render.triangles,
        points: info.render.points,
        lines: info.render.lines,
      };
      if (this.capture && this.capture.length < this.captureState.frames) {
        this.capture.push({
          ...timing,
          passes: this.passRows,
          calls: info.render.calls,
          triangles: info.render.triangles,
        });
        this.captureState.status = `${this.capture.length} / ${this.captureState.frames} frames`;
        if (this.capture.length >= this.captureState.frames) {
          this.finishCapture();
        }
      }
    }
    this.passes.beginTick(timing.tick + 1);
  };

  private readonly onSourceAdded = (
    source: Source,
    description: SourceDescription,
  ): void => {
    const url = (description as { url?: string }).url;
    const kind = describeSourceType(description.type ?? "");
    this.sources.set(source.id, {
      label: `${kind} · ${hostOf(url) || "inline data"}`,
      hint: `${kind} source ${source.id}${url ? `\n${url}` : ""}`,
    });
    if (!url) return;
    this.matchers.push({ id: source.id, score: sourceUrlMatcher(url) });
    this.network.setMatchers(this.matchers);
  };

  private refreshUi(): void {
    const now = performance.now();
    for (const refresh of this.graphRefreshers) refresh();
    this.refreshSummary(now);
    this.refreshBreakdown();
    this.refreshMemoryBlock();
    this.refreshDownloads(now);
    this.refreshBackground();
    this.refreshDraws(now);
    this.refreshTargets();
    this.viewer.refresh();
  }

  private gpuTotal(): number | undefined {
    if (!this.passes.gpu.supported) return undefined;
    let sum = 0;
    for (const p of this.passRows) if (p.ran) sum += p.gpuMs ?? 0;
    return sum;
  }

  private refreshSummary(now: number): void {
    const fps = this.frames.framesPerSecond(now);
    const cpuAvg = this.frames.cpu.average();
    const cpuWorst = this.frames.cpu.max();
    this.graphs.frameMs = this.frames.latest?.totalMs ?? 0;
    const gpu = this.gpuTotal();
    const rates = this.network.rates(now);
    const cm = this.ctx.concurrencyManager;
    const budget = this.memory?.budgetBytes;
    const used = this.memory ? engineBytes(this.memory) : undefined;

    const fpsCell =
      fps === 0
        ? `0 <span class="muted">· idle, nothing changed</span>`
        : `${fps} <span class="muted">fps</span>`;
    const timeCell =
      this.frames.cpu.length === 0
        ? `<span class="muted">no frame drawn yet</span>`
        : `<span class="${msClass(cpuAvg)}">${formatMs(cpuAvg)} ms</span> CPU` +
          (gpu === undefined
            ? ` <span class="muted">· GPU n/a</span>`
            : ` · <span class="${msClass(gpu)}">${formatMs(gpu)} ms</span> GPU`) +
          ` <span class="muted">· worst ${formatMs(cpuWorst)}</span>`;
    const memCell =
      used === undefined
        ? `<span class="muted">…</span>`
        : budget
          ? `${meter(used / budget)} ${formatBytes(used)} <span class="muted">of ${formatBytes(budget)}</span>`
          : `${formatBytes(used)} <span class="muted">(no budget set)</span>`;
    const failed = this.network.perSource().reduce((n, s) => n + s.failed, 0);

    this.summary.render(`<table>
${row(
  "Frames drawn per second. Navara draws only when something changes (camera, data, animation), so this drops to 0 while the map is still.",
  td("Frame rate") + td(fpsCell, "num"),
)}
${row(
  "Average time per drawn frame over the last few seconds. CPU is the whole tick on the main thread; GPU is the sum of the render passes. Above 16.7 ms a 60 Hz display drops frames.",
  td("Frame time") + td(timeCell, "num"),
)}
${row(
  "Draw calls and triangles of the latest drawn frame. Many small draw calls cost CPU time; many triangles cost GPU time.",
  td("Draws") +
    td(
      `${this.drawnCalls.calls} calls · ${formatCount(this.drawnCalls.triangles)} triangles`,
      "num",
    ),
)}
${row(
  "Memory the engine counts against its budget: tile data, feature attributes, estimated GPU memory and screen buffers. Past the budget it evicts cached tiles and then lowers detail.",
  td("Engine memory") + td(memCell, "num"),
)}
${row(
  "Downloads currently in progress and the transfer speed over the last second.",
  td("Downloads") +
    td(
      `${rates.inFlight} active · ${formatBytes(rates.bytesPerSecond)}/s` +
        (failed ? ` · <span class="warn">${failed} failed</span>` : ""),
      "num",
    ),
)}
${row(
  "Worker threads parse tiles and build geometry off the main thread.",
  td("Workers") + td(workerText(cm), "num"),
)}
</table>`);
  }

  private refreshBreakdown(): void {
    const last = this.frames.latest;
    if (!last) {
      this.breakdown.render(
        `<div class="note">No frame drawn yet. Move the camera to draw one.</div>`,
      );
      return;
    }
    const gpuOn = this.passes.gpu.supported;
    const ran = this.passRows.filter((p) => p.ran);
    const passCpu = ran.reduce((n, p) => n + p.cpuMs, 0);
    const passCalls = ran.reduce((n, p) => n + p.calls, 0);
    const other = Math.max(
      0,
      last.totalMs - last.updateMs - last.eventsMs - passCpu,
    );
    const gpu = this.gpuTotal();
    const max = Math.max(
      last.totalMs,
      gpu ?? 0,
      ...ran.map((p) => Math.max(p.cpuMs, p.gpuMs ?? 0)),
      0.01,
    );
    const line = (
      name: string,
      title: string,
      cpu: number | undefined,
      gpuMs: number | undefined,
      calls: number | undefined,
      cls = "",
    ) =>
      row(
        title,
        td(esc(name), "name") +
          td(formatMs(cpu), msClass(cpu)) +
          td(gpuOn ? formatMs(gpuMs) : "–", "num") +
          td(calls === undefined ? "" : String(calls), "num") +
          td(bar(Math.max(cpu ?? 0, gpuMs ?? 0) / max)),
        cls,
      );

    const rows = [
      line(
        "Engine update",
        "Tile selection, level of detail, memory budget and scheduling in the Rust/WASM core (Core.update).",
        last.updateMs,
        undefined,
        undefined,
      ),
      line(
        "Loading & building",
        "Handling the engine's events: starting downloads and worker jobs, building and updating meshes.",
        last.eventsMs,
        undefined,
        undefined,
      ),
      ...ran.map((p) => {
        const d = describePass(p.name);
        return line(d.name, d.hint, p.cpuMs, p.gpuMs, p.calls);
      }),
      line(
        "Other",
        "Everything else in the tick: feature style updates, picking, label placement and this panel.",
        other,
        undefined,
        undefined,
      ),
      line(
        "Total",
        "The whole tick on the CPU, and the sum of the render passes on the GPU.",
        last.totalMs,
        gpu,
        passCalls,
        "total",
      ),
    ];
    const note = gpuOn
      ? "GPU times arrive a few frames late. Hover a row for what it does."
      : "GPU times need the EXT_disjoint_timer_query_webgl2 extension (Chrome on desktop). Hover a row for what it does.";
    this.breakdown.render(`<table>
<tr><th>Step</th><th class="num">CPU ms</th><th class="num">GPU ms</th><th class="num">Draws</th><th></th></tr>
${rows.join("\n")}
</table><div class="note">${note}</div>`);
  }

  private refreshMemoryBlock(): void {
    const m = this.memory;
    if (!m) {
      this.memoryBlock.render(
        `<div class="note">Waiting for the engine…</div>`,
      );
      return;
    }
    const used = engineBytes(m);
    const budget = m.budgetBytes;
    const item = (name: string, title: string, bytes: number | undefined) =>
      row(
        title,
        td(name) +
          td(bytes === undefined ? "–" : formatBytes(bytes), "num") +
          td(budget && bytes ? bar(bytes / budget, 50) : ""),
      );
    const retained =
      m.retainedVector +
      m.retainedTerrain +
      m.retainedRaster +
      m.retainedTiles3d;
    const font = this.workers?.fontWorker;
    const detail =
      m.sseMultiplier > 1.01
        ? `<span class="warn">reduced ×${m.sseMultiplier.toFixed(1)}</span> to stay within the budget`
        : `full`;
    this.memoryBlock.render(`<table>
${row(
  "Everything below, against the budget the engine evicts and degrades to stay under.",
  td("Engine total", "") +
    td(
      budget
        ? `${formatBytes(used)} <span class="muted">/ ${formatBytes(budget)}</span>`
        : formatBytes(used),
      "num",
    ) +
    td(budget ? meter(used / budget) : `<span class="muted">no budget</span>`),
  "total",
)}
${item("Tile data (WASM)", "Downloaded tile payloads, decoded geometry and elevation data held by the Rust core.", m.bufferTotalBytes)}
${item("Tile data (JS)", "Vector tile data and worker-built geometry kept on the JS side, outside WASM memory.", m.externalBufferBytes)}
${item("Feature attributes", "Properties of vector features (MVT attribute tables). Large for attribute-rich data.", m.externalCpuBytes)}
${item("GPU, tiles (estimate)", "Estimated graphics memory of loaded terrain, imagery, vector and 3D Tiles content.", m.gpuBytesEst)}
${item("GPU, screen buffers", "Render targets sized to the screen (G-buffer, post-processing). Grows with canvas size.", m.fixedGpuBytes)}
${item("Reserved for downloads", "Estimated size of tiles still downloading, reserved so the budget holds before they land.", m.reservedBytes)}
<tr class="group"><td colspan="3">Outside the budget</td></tr>
${item("Worker heaps", "WASM memory of the tile worker threads.", this.workers?.tileWorkers?.totalBytes)}
${item("Font worker", "Font worker heap and glyph atlases (only once text is used).", font ? font.heapBytes + font.atlasBytes + font.colorAtlasBytes : undefined)}
${item("JS heap", "JavaScript heap of the page (Chrome only). With the Layers tool's wireframe support on, it includes a copy of every terrain and polygon geometry.", this.jsHeapBytes)}
</table>
<div class="note" title="Tiles that left the view stay cached so panning back needs no download; the oldest are evicted when memory runs short.">Cached for reuse: ${retained} tiles (terrain ${m.retainedTerrain}, imagery ${m.retainedRaster}, vector ${m.retainedVector}, 3D ${m.retainedTiles3d}) · evicted so far: ${m.evictedCount}</div>
<div class="note" title="When the visible tiles alone exceed the budget, far tiles are kept coarser.">Detail level: ${detail}</div>`);
  }

  private refreshDownloads(now: number): void {
    const rates = this.network.rates(now);
    this.graphs.kbPerSecond = rates.bytesPerSecond / 1024;
    const perSource = this.network.perSource();
    const rows = perSource.map((s) => {
      const info =
        s.sourceId === OTHER_SOURCE
          ? {
              label: "Other",
              hint: "Requests not matching any source: fonts, styles, glTF assets and the page's own files.",
            }
          : (this.sources.get(s.sourceId) ?? {
              label: s.sourceId,
              hint: s.sourceId,
            });
      return row(
        info.hint,
        td(esc(info.label), "name") +
          td(
            `${s.requests}${s.inFlight ? ` <span class="muted">(${s.inFlight} active)</span>` : ""}`,
            "num",
          ) +
          td(formatBytes(s.bytes), "num") +
          td(s.meanMs ? `${Math.round(s.meanMs)} ms` : "–", "num") +
          td(s.failed ? `<span class="warn">${s.failed}</span>` : "", "num"),
      );
    });
    this.downloads.render(`<div class="kv">
<span class="k">Active</span><span>${rates.inFlight} requests</span>
<span class="k">Rate</span><span>${rates.requestsPerSecond} requests/s · ${formatBytes(rates.bytesPerSecond)}/s <span class="muted">(10 s avg ${formatBytes(rates.bytesPerSecond10)}/s)</span></span>
<span class="k">Since start</span><span>${rates.totalRequests} requests · ${formatBytes(rates.totalBytes)}</span>
</div>
<table>
<tr><th>Source</th><th class="num">Requests</th><th class="num">Size</th><th class="num">Avg</th><th class="num">Failed</th></tr>
${rows.join("\n") || `<tr><td colspan="5" class="muted">No downloads yet</td></tr>`}
</table>
<div class="note">Sizes are the compressed bytes servers report. A server that reports neither Content-Length nor timing data counts requests only. "Avg" is the time until the response started. Failed includes 404s, which are normal for sparse tile sets such as elevation over the sea.</div>`);
  }

  private refreshBackground(): void {
    const cm = this.ctx.concurrencyManager;
    const rows = this.ctx.getJobStats().map((j) => {
      const d = describeJob(j.name);
      return row(
        d.hint,
        td(d.name) +
          td(j.inFlight ? String(j.inFlight) : "0", "num") +
          td(String(j.jobs - j.inFlight), "num"),
      );
    });
    this.background.render(`<table>
<tr><th>Kind</th><th class="num" title="Work started and not finished yet">In progress</th><th class="num" title="Finished items still alive (on screen or cached)">Done</th></tr>
${rows.join("\n")}
</table>
<div class="note" title="Workers reserved by threads outside the pool (font worker) count as busy.">Worker threads: ${workerText(cm)}</div>`);
  }

  private refreshDraws(now: number): void {
    const info = this.renderer.info;
    const programs = info.programs?.length ?? 0;
    this.programHistory.push({ at: now, count: programs });
    while (
      this.programHistory.length > 1 &&
      now - this.programHistory[0].at > PROGRAM_WINDOW_MS
    ) {
      this.programHistory.shift();
    }
    const recent = programs - this.programHistory[0].count;
    const d = this.drawnCalls;
    const kv = (k: string, v: string, title: string) =>
      `<span class="k" title="${esc(title)}">${k}</span><span class="num" title="${esc(title)}">${v}</span>`;
    this.drawBlock.render(`<div class="kv">
${kv("Draw calls", String(d.calls), "WebGL draw calls in the latest drawn frame, all passes and nested tile bakes included.")}
${kv("Triangles", formatCount(d.triangles), "Triangles drawn in the latest drawn frame.")}
${kv("Lines / points", `${formatCount(d.lines)} / ${formatCount(d.points)}`, "Line segments and points drawn in the latest drawn frame.")}
${kv("Geometries on GPU", String(info.memory.geometries), "Geometry buffers currently uploaded to the GPU.")}
${kv("Textures on GPU", String(info.memory.textures), "Textures currently uploaded to the GPU.")}
${kv("Shader programs", String(programs), "Compiled shader programs. Each distinct material setup needs one.")}
${kv("Compiled in last 5 s", recent > 0 ? `<span class="warn">${recent}</span>` : "0", "New shader programs. Normal while data loads; a count that never settles means something recompiles every frame.")}
</div>`);
  }

  private refreshTargets(): void {
    const entries = this.ctx.getRenderTargets().filter((e) => e.allocated);
    const total = entries.reduce((n, e) => n + e.bytes, 0);
    const rows = entries
      .sort((a, b) => b.bytes - a.bytes)
      .map((e) => {
        const t = e.target;
        const owner =
          e.owner === "composer"
            ? "Pipeline buffers"
            : describePass(e.owner).name;
        const extra = [
          t.textures.length > 1 ? `${t.textures.length} attachments` : "",
          t.depthTexture || t.depthBuffer ? "depth" : "",
          t.samples > 0 ? `MSAA ×${t.samples}` : "",
        ]
          .filter(Boolean)
          .join(", ");
        return row(
          `${e.owner}${extra ? ` (${extra})` : ""}`,
          td(esc(owner), "name") +
            td(`${t.width}×${t.height}`, "num") +
            td(formatBytes(e.bytes), "num") +
            td(bar(e.bytes / Math.max(total, 1), 40)),
        );
      });
    this.targets.render(`<table>
<tr><th>Used by</th><th class="num">Size</th><th class="num">Memory</th><th></th></tr>
${rows.join("\n")}
<tr class="total"><td>Total</td><td></td><td class="num">${formatBytes(total)}</td><td></td></tr>
</table>`);
  }

  private async refreshMemory(): Promise<void> {
    this.memory = this.view.memoryStats();
    const heap = (
      performance as Performance & { memory?: { usedJSHeapSize: number } }
    ).memory;
    this.jsHeapBytes = heap?.usedJSHeapSize;
    const workers = await this.view.workerMemoryStats();
    if (this.enabled) this.workers = workers;
  }

  /** Starts a recording; false (and nothing recorded) while disabled. */
  private startCapture(): boolean {
    this.finishCapture();
    if (!this.enabled) {
      this.captureState.status = "enable the profiler first";
      return false;
    }
    this.capture = [];
    this.captureState.status = `0 / ${this.captureState.frames} frames`;
    return true;
  }

  /** Settles a pending `record()` with the frames captured so far. */
  private finishCapture(): void {
    const done = this.captureDone;
    this.captureDone = undefined;
    done?.(this.capture ?? []);
  }

  private downloadCapture(): void {
    if (!this.capture || this.capture.length === 0) return;
    const blob = new Blob(
      [
        JSON.stringify({
          capturedAt: new Date().toISOString(),
          gpuTiming: this.passes.gpu.supported,
          frames: this.capture,
        }),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `navara-profile-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
}

/** `3 of 8 busy`, plus the tasks queued behind busy workers. */
function workerText(cm: { total: number; actives: () => number }): string {
  const tasks = cm.actives();
  const busy = Math.min(tasks, cm.total);
  const queued = tasks - busy;
  return `${busy} of ${cm.total} busy${queued > 0 ? ` · ${queued} queued` : ""}`;
}

/** The bytes the engine counts against its budget. */
function engineBytes(m: MemoryStats): number {
  return (
    m.bufferTotalBytes +
    m.externalBufferBytes +
    m.externalCpuBytes +
    m.gpuBytesEst +
    m.fixedGpuBytes +
    m.reservedBytes
  );
}
