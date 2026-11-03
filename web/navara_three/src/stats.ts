import Stats from "stats.js";

type Renderer = {
  endRender: () => {
    calls?: number;
    triangles?: number;
    memGeometries?: number;
  };
};

export type MemorySample = {
  /** WASM BufferStore bytes (WASM-resident only), in MB. */
  wasmMB?: number;
  /** JS-side `InMemoryBufferStore` bytes (WASM `External` entries), in MB. */
  jsBufMB?: number;
  /** JS heap usage (Chrome-only `performance.memory`), in MB. */
  jsHeapMB?: number;
  /** Cache budget for the panel scale, in MB. */
  budgetMB?: number;
};

/** How often the (relatively costly) memory sampler runs. */
const MEMORY_SAMPLE_INTERVAL_MS = 1000;

export class RendererStats {
  stats: Stats;
  renderer: Renderer;
  drawCalls: Stats.Panel;
  numTriangles: Stats.Panel;
  memGeometries: Stats.Panel;
  wasmMemory: Stats.Panel;
  jsMemory: Stats.Panel;
  private memorySampler?: () => MemorySample | undefined;
  private lastMemorySampleAt = 0;
  private maxWasmMB = 1;
  private maxJsHeapMB = 1;
  constructor(r: Renderer, memorySampler?: () => MemorySample | undefined) {
    this.stats = new Stats();
    this.renderer = r;
    this.memorySampler = memorySampler;
    this.drawCalls = this.stats.addPanel(
      new Stats.Panel("Draws", "#0ff", "#002"),
    );
    this.numTriangles = this.stats.addPanel(
      new Stats.Panel("Triangles", "#0fff57", "#013a12"),
    );
    this.memGeometries = this.stats.addPanel(
      new Stats.Panel("Geometries", "#ffa100", "#301e00"),
    );
    this.wasmMemory = this.stats.addPanel(
      new Stats.Panel("WASM MB", "#f08", "#201"),
    );
    this.jsMemory = this.stats.addPanel(
      new Stats.Panel("JS MB", "#f4f", "#210"),
    );
    this.stats.showPanel(0);
  }

  begin() {
    this.stats.begin();
  }

  end() {
    const info = this.renderer.endRender();
    if (info.calls) {
      this.drawCalls.update(info.calls, 500);
    }
    if (info.triangles) {
      this.numTriangles.update(info.triangles, 500);
    }
    if (info.memGeometries) {
      this.memGeometries.update(info.memGeometries, 500);
    }
    this.sampleMemory();
    this.stats.end();
  }

  /** Samples memory at most once per second to keep FFI out of the hot path. */
  private sampleMemory() {
    if (!this.memorySampler) return;
    const now = performance.now();
    if (now - this.lastMemorySampleAt < MEMORY_SAMPLE_INTERVAL_MS) return;
    this.lastMemorySampleAt = now;

    const sample = this.memorySampler();
    if (!sample) return;
    if (sample.wasmMB !== undefined) {
      this.maxWasmMB = Math.max(this.maxWasmMB, sample.wasmMB);
      this.wasmMemory.update(sample.wasmMB, sample.budgetMB ?? this.maxWasmMB);
    }
    if (sample.jsHeapMB !== undefined) {
      this.maxJsHeapMB = Math.max(this.maxJsHeapMB, sample.jsHeapMB);
      this.jsMemory.update(sample.jsHeapMB, this.maxJsHeapMB);
    }
  }

  get dom() {
    return this.stats.dom;
  }
}
