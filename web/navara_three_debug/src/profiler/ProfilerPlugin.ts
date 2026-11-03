import type { FrameTiming, Source, SourceDescription } from "@navaramap/three";
import type { WebGLRenderer } from "three";

import {
  DebugPlugin,
  type DebugContainer,
  type DebugPluginOptions,
} from "../DebugPlugin";
import { formatBytes, formatMs, padLeft, padRight } from "../util/format";
import { addGraph } from "../util/graph";
import { addTable } from "../util/table";
import { Ticker } from "../util/ticker";

import { ContentViewer } from "./contentViewer";
import { FrameStats } from "./frameStats";
import {
  NetworkMeter,
  sourceUrlMatcher,
  type NetworkSourceMatcher,
} from "./networkMeter";
import { PassProfiler, type PassSample } from "./passProfiler";

export type ProfilerPluginOptions = DebugPluginOptions;

const MB = 1024 * 1024;
/** Text tables are rebuilt at this cadence; graphs read their state directly. */
const UI_INTERVAL_MS = 250;
/** `memoryStats()` crosses the WASM boundary; keep it off the hot path. */
const MEMORY_INTERVAL_MS = 1000;

type PassRow = PassSample & { gpuMs: number | undefined };

/** One recorded tick of a capture. */
export type CapturedFrame = FrameTiming & {
  passes: PassRow[];
  calls: number;
  triangles: number;
};

/**
 * Frame, pass, draw, memory, scheduler and network readouts, plus a
 * picture-in-picture viewer of the pipeline's textures. Everything is
 * sampled only while enabled; see the package README for what each row means.
 */
export class ProfilerPlugin extends DebugPlugin {
  readonly title = "Profiler";

  private renderer!: WebGLRenderer;
  private readonly frames = new FrameStats();
  private passes!: PassProfiler;
  private readonly network = new NetworkMeter();
  private viewer!: ContentViewer;
  private readonly matchers: NetworkSourceMatcher[] = [];
  private passRows: PassRow[] = [];
  private lastRendered: (FrameTiming & { calls: number }) | undefined;

  private programCount = 0;
  private capture: CapturedFrame[] | undefined;

  private readonly frame = {
    fps: 0,
    renderedFps: 0,
    totalMs: 0,
    updateMs: 0,
    eventsMs: 0,
    renderMs: 0,
    avgMs: 0,
    p99Ms: 0,
    maxMs: 0,
  };
  private readonly draws = {
    calls: 0,
    triangles: 0,
    points: 0,
    lines: 0,
    geometries: 0,
    textures: 0,
    programs: 0,
    programDelta: 0,
  };
  private readonly passText = { table: "" };
  private readonly memory = {
    wasmMB: 0,
    jsBufMB: 0,
    attrMB: 0,
    gpuEstMB: 0,
    fixedGpuMB: 0,
    reservedMB: 0,
    jsHeapMB: 0,
    workerMB: 0,
    fontMB: 0,
    budget: "",
    retained: "",
    evicted: 0,
    sseX: 1,
  };
  private readonly scheduler = { jobs: "", workers: "" };
  private readonly net = {
    inFlight: 0,
    reqPerSec: 0,
    kbPerSec: 0,
    kbPerSec10: 0,
    total: "",
    perSource: "",
  };
  private readonly resources = { table: "" };
  private readonly captureState = { frames: 300, status: "idle" };

  private readonly graphRefreshers: (() => void)[] = [];

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
    this.viewer = new ContentViewer(this.ctx, () => this.view.forceUpdate());
    this.view.on("sourceAdded", this.onSourceAdded);

    const ui = this.ui;
    const frame = ui.addFolder({ title: "Frame" });
    this.graph(frame, this.frame, "fps", 0, 120, 0);
    this.graph(frame, this.frame, "renderedFps", 0, 120, 0);
    this.graph(frame, this.frame, "totalMs", 0, 33, 2);
    this.graph(frame, this.frame, "updateMs", 0, 16, 2);
    this.graph(frame, this.frame, "eventsMs", 0, 16, 2);
    this.graph(frame, this.frame, "renderMs", 0, 33, 2);
    frame.addBinding(this.frame, "avgMs", {
      readonly: true,
      format: (v) => v.toFixed(2),
    });
    frame.addBinding(this.frame, "p99Ms", {
      readonly: true,
      format: (v) => v.toFixed(2),
    });
    frame.addBinding(this.frame, "maxMs", {
      readonly: true,
      format: (v) => v.toFixed(2),
    });
    frame.addButton({ title: "Reset history" }).on("click", () => {
      this.frames.clear();
      this.frame.maxMs = 0;
    });

    const passes = ui.addFolder({ title: "Passes" });
    addTable(passes, this.passText, "table", 13);

    const draws = ui.addFolder({ title: "Draws", expanded: false });
    this.graph(draws, this.draws, "calls", 0, 2000, 0);
    draws.addBinding(this.draws, "triangles", {
      readonly: true,
      format: (v) => String(Math.round(v)),
    });
    draws.addBinding(this.draws, "points", {
      readonly: true,
      format: (v) => String(Math.round(v)),
    });
    draws.addBinding(this.draws, "lines", {
      readonly: true,
      format: (v) => String(Math.round(v)),
    });
    draws.addBinding(this.draws, "geometries", {
      readonly: true,
      format: (v) => String(Math.round(v)),
    });
    draws.addBinding(this.draws, "textures", {
      readonly: true,
      format: (v) => String(Math.round(v)),
    });
    draws.addBinding(this.draws, "programs", {
      readonly: true,
      format: (v) => String(Math.round(v)),
    });
    // A steady non-zero delta means something recompiles every frame.
    this.graph(draws, this.draws, "programDelta", -5, 5, 0);

    const memory = ui.addFolder({ title: "Memory", expanded: false });
    for (const key of [
      "wasmMB",
      "jsBufMB",
      "attrMB",
      "gpuEstMB",
      "fixedGpuMB",
      "reservedMB",
      "jsHeapMB",
      "workerMB",
      "fontMB",
    ] as const) {
      this.graph(memory, this.memory, key, 0, 1024, 1);
    }
    memory.addBinding(this.memory, "budget", { readonly: true });
    memory.addBinding(this.memory, "retained", { readonly: true });
    memory.addBinding(this.memory, "evicted", {
      readonly: true,
      format: (v) => String(Math.round(v)),
    });
    memory.addBinding(this.memory, "sseX", {
      readonly: true,
      format: (v) => v.toFixed(2),
    });

    const scheduler = ui.addFolder({ title: "Scheduler", expanded: false });
    addTable(scheduler, this.scheduler, "jobs", 6);

    scheduler.addBinding(this.scheduler, "workers", { readonly: true });

    const network = ui.addFolder({ title: "Network", expanded: false });
    this.graph(network, this.net, "inFlight", 0, 64, 0);
    this.graph(network, this.net, "reqPerSec", 0, 64, 0);
    this.graph(network, this.net, "kbPerSec", 0, 4096, 0);
    this.graph(network, this.net, "kbPerSec10", 0, 4096, 0);
    network.addBinding(this.net, "total", { readonly: true });
    addTable(network, this.net, "perSource", 8);

    network
      .addButton({ title: "Reset counters" })
      .on("click", () => this.network.reset());

    const resources = ui.addFolder({
      title: "Render targets",
      expanded: false,
    });
    addTable(resources, this.resources, "table", 12);

    this.viewer.buildUi(ui);

    const capture = ui.addFolder({ title: "Capture", expanded: false });
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
    this.programCount = this.renderer.info.programs?.length ?? 0;
  }

  protected onDisable(): void {
    this.view.off("frame", this.onFrame);
    this.passes.disable();
    this.network.disable();
    this.viewer.disable();
    this.uiTicker.stop();
    this.memoryTicker.stop();
    this.capture = undefined;
    this.captureState.status = "idle";
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

  /** The latest per-pass costs, in pipeline order. */
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

  /** Records the next `count` ticks; resolves with the frames. */
  record(count = this.captureState.frames): Promise<CapturedFrame[]> {
    this.captureState.frames = count;
    this.startCapture();
    return new Promise((resolve) => {
      const check = () => {
        if (this.capture && this.capture.length >= count) {
          resolve(this.capture);
        } else if (this.capture) {
          setTimeout(check, 100);
        } else {
          resolve([]);
        }
      };
      check();
    });
  }

  private readonly onFrame = (timing: FrameTiming): void => {
    this.frames.push(timing);
    const info = this.renderer.info;
    // Pass rows describe the last rendered frame; an idle tick runs none.
    if (timing.rendered) {
      this.passRows = Array.from(this.passes.samples.values(), (s) => ({
        ...s,
      }));
      this.lastRendered = { ...timing, calls: info.render.calls };
    }
    this.passes.beginTick(timing.tick + 1);

    this.draws.calls = info.render.calls;
    this.draws.triangles = info.render.triangles;
    this.draws.points = info.render.points;
    this.draws.lines = info.render.lines;
    this.draws.geometries = info.memory.geometries;
    this.draws.textures = info.memory.textures;
    const programs = info.programs?.length ?? 0;
    this.draws.programDelta = programs - this.programCount;
    this.draws.programs = programs;
    this.programCount = programs;

    this.frame.totalMs = timing.totalMs;
    this.frame.updateMs = timing.updateMs;
    this.frame.eventsMs = timing.eventsMs;
    this.frame.renderMs = timing.renderMs;

    if (this.capture && this.capture.length < this.captureState.frames) {
      this.capture.push({
        ...timing,
        passes: this.passRows,
        calls: info.render.calls,
        triangles: info.render.triangles,
      });
      this.captureState.status = `${this.capture.length} / ${this.captureState.frames}`;
    }
  };

  private readonly onSourceAdded = (
    source: Source,
    description: SourceDescription,
  ): void => {
    const url = (description as { url?: string }).url;
    if (!url) return;
    let host = url;
    try {
      host = new URL(url, window.location.href).host;
    } catch {
      // A relative or templated URL that does not parse keeps the raw text.
    }
    this.matchers.push({
      id: `${source.type} ${host}`,
      test: sourceUrlMatcher(url),
    });

    this.network.setMatchers(this.matchers);
  };

  private graph<O extends Record<K, number>, K extends string>(
    container: DebugContainer,
    object: O,
    key: K,
    min: number,
    max: number,
    digits: number,
  ): void {
    this.graphRefreshers.push(
      addGraph(container, object, key, { min, max, digits }),
    );
  }

  private refreshUi(): void {
    const now = performance.now();
    this.frame.fps = this.frames.ticksPerSecond(now);
    this.frame.renderedFps = this.frames.framesPerSecond(now);
    this.frame.avgMs = this.frames.total.average();
    this.frame.p99Ms = this.frames.total.percentile(0.99);
    this.frame.maxMs = Math.max(this.frame.maxMs, this.frames.total.max());
    for (const refresh of this.graphRefreshers) refresh();

    const gpu = this.passes.gpu.supported;
    const lines = [
      `${padRight("pass", 18)}${padLeft("cpu", 7)}${padLeft(gpu ? "gpu" : "gpu(n/a)", 9)}${padLeft("calls", 7)}${padLeft("tris", 10)}`,
    ];
    let cpu = 0;
    let gpuSum = 0;
    let calls = 0;
    for (const row of this.passRows) {
      if (!row.ran) {
        lines.push(`${padRight(row.name, 18)}   (skipped)`);
        continue;
      }
      cpu += row.cpuMs;
      gpuSum += row.gpuMs ?? 0;
      calls += row.calls;
      lines.push(
        `${padRight(row.name, 18)}${padLeft(formatMs(row.cpuMs), 7)}${padLeft(formatMs(row.gpuMs), 9)}${padLeft(row.calls, 7)}${padLeft(row.triangles, 10)}`,
      );
    }
    const last = this.lastRendered;
    if (last) {
      lines.push(
        `${padRight("Σ passes", 18)}${padLeft(formatMs(cpu), 7)}${padLeft(gpu ? formatMs(gpuSum) : "-", 9)}${padLeft(calls, 7)}`,
      );
      lines.push(
        `${padRight("other (tick − Σ)", 18)}${padLeft(formatMs(Math.max(0, last.totalMs - cpu)), 7)}${padLeft("", 9)}${padLeft(Math.max(0, last.calls - calls), 7)}`,
      );
      lines.push(`last rendered tick #${last.tick}`);
    }

    this.passText.table = lines.join("\n");

    const jobs = this.ctx.getJobStats();
    this.scheduler.jobs = jobs
      .map(
        (j) =>
          `${padRight(j.name, 20)}${padLeft(j.inFlight, 5)} in flight / ${j.jobs} live`,
      )
      .join("\n");
    const cm = this.ctx.concurrencyManager;
    this.scheduler.workers = `${cm.actives} active / ${cm.idles} idle / ${cm.total} total`;

    const rates = this.network.rates(now);
    this.net.inFlight = rates.inFlight;
    this.net.reqPerSec = rates.requestsPerSecond;
    this.net.kbPerSec = rates.bytesPerSecond / 1024;
    this.net.kbPerSec10 = rates.bytesPerSecond10 / 1024;
    this.net.total = `${rates.totalRequests} requests, ${formatBytes(rates.totalBytes)}`;
    this.net.perSource = this.network
      .perSource()
      .map(
        (s) =>
          `${padRight(s.sourceId, 26)}${padLeft(s.requests, 5)} req ${padLeft(formatBytes(s.bytes), 10)} ${padLeft(Math.round(s.meanMs), 5)} ms${s.failed ? ` ${s.failed} failed` : ""}${s.inFlight ? ` ${s.inFlight} in flight` : ""}`,
      )
      .join("\n");

    this.resources.table = this.ctx
      .getRenderTargets()
      .map((e) => {
        const { target } = e;
        const kinds =
          target.textures.length > 1 ? `×${target.textures.length}` : "";
        const flags = `${target.depthTexture ? " depthTex" : target.depthBuffer ? " depth" : ""}${target.samples > 0 ? ` msaa${target.samples}` : ""}${e.allocated ? "" : " (unallocated)"}`;
        return `${padRight(e.owner, 16)}${padLeft(`${target.width}×${target.height}`, 11)}${kinds.padStart(3)}${padLeft(formatBytes(e.bytes), 10)}${flags}`;
      })
      .join("\n");
  }

  private async refreshMemory(): Promise<void> {
    const stats = this.view.memoryStats();
    if (stats) {
      this.memory.wasmMB = stats.bufferTotalBytes / MB;
      this.memory.jsBufMB = stats.externalBufferBytes / MB;
      this.memory.attrMB = stats.externalCpuBytes / MB;
      this.memory.gpuEstMB = stats.gpuBytesEst / MB;
      this.memory.fixedGpuMB = stats.fixedGpuBytes / MB;
      this.memory.reservedMB = stats.reservedBytes / MB;
      this.memory.budget =
        stats.budgetBytes === undefined
          ? "no budget"
          : `budget ${formatBytes(stats.budgetBytes)}, ${stats.bufferCount} buffers`;
      this.memory.retained = `vector ${stats.retainedVector}, terrain ${stats.retainedTerrain}, raster ${stats.retainedRaster}, 3d ${stats.retainedTiles3d}`;
      this.memory.evicted = stats.evictedCount;
      this.memory.sseX = stats.sseMultiplier;
    }
    const heap = (
      performance as Performance & { memory?: { usedJSHeapSize: number } }
    ).memory;
    if (heap) this.memory.jsHeapMB = heap.usedJSHeapSize / MB;
    const workers = await this.view.workerMemoryStats();
    if (!this.enabled || !workers) return;
    this.memory.workerMB = (workers.tileWorkers?.totalBytes ?? 0) / MB;
    this.memory.fontMB = workers.fontWorker
      ? (workers.fontWorker.heapBytes +
          workers.fontWorker.atlasBytes +
          workers.fontWorker.colorAtlasBytes) /
        MB
      : 0;
  }

  private startCapture(): void {
    this.capture = [];
    this.captureState.status = `0 / ${this.captureState.frames}`;
  }

  private downloadCapture(): void {
    if (!this.capture || this.capture.length === 0) return;
    const blob = new Blob(
      [
        JSON.stringify(
          {
            capturedAt: new Date().toISOString(),
            gpuTiming: this.passes.gpu.supported,
            frames: this.capture,
          },
          null,
          0,
        ),
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
