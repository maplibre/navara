/** `EXT_disjoint_timer_query_webgl2`, which lib.dom does not declare. */
type DisjointTimerQueryExt = {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
};

export type GpuTimerResult = {
  label: string;
  /** The tick the query was issued in. */
  tick: number;
  ms: number;
};

type PendingQuery = { query: WebGLQuery; label: string; tick: number };

/** Oldest results are dropped past this many unresolved queries. */
const MAX_PENDING = 256;

/**
 * GPU elapsed-time queries over `EXT_disjoint_timer_query_webgl2`. Only one
 * query may be open at a time (the extension forbids nesting), so callers
 * time disjoint spans and sum them. Results arrive frames later and are
 * collected with `poll()`; a disjoint event (context switch, power change)
 * discards the affected results. `supported` is `false` where the extension
 * is missing (Firefox, Safari), and every method is then a no-op.
 */
export class GpuTimer {
  private readonly ext: DisjointTimerQueryExt | null;
  private readonly pool: WebGLQuery[] = [];
  private readonly pending: PendingQuery[] = [];
  private open = false;

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.ext = gl.getExtension(
      "EXT_disjoint_timer_query_webgl2",
    ) as DisjointTimerQueryExt | null;
  }

  get supported(): boolean {
    return this.ext !== null;
  }

  /** Opens a query; `false` when unsupported or one is already open. */
  begin(label: string, tick: number): boolean {
    if (!this.ext || this.open) return false;
    const query = this.pool.pop() ?? this.gl.createQuery();
    if (!query) return false;
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, query);
    this.pending.push({ query, label, tick });
    this.open = true;
    if (this.pending.length > MAX_PENDING) {
      const dropped = this.pending.shift();
      if (dropped) this.gl.deleteQuery(dropped.query);
    }
    return true;
  }

  end(): void {
    if (!this.ext || !this.open) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.open = false;
  }

  /** Appends every result that became available, oldest first. */
  poll(out: GpuTimerResult[]): void {
    if (!this.ext) return;
    const gl = this.gl;
    // Results resolve in issue order, so stop at the first unresolved one.
    while (this.pending.length > 0) {
      const head = this.pending[0];
      if (this.open && this.pending.length === 1) break;
      const available = gl.getQueryParameter(
        head.query,
        gl.QUERY_RESULT_AVAILABLE,
      ) as boolean;
      if (!available) break;
      const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT) as boolean;
      if (!disjoint) {
        const ns = gl.getQueryParameter(head.query, gl.QUERY_RESULT) as number;
        out.push({ label: head.label, tick: head.tick, ms: ns / 1e6 });
      }
      this.pending.shift();
      this.pool.push(head.query);
    }
  }

  dispose(): void {
    if (this.open) this.end();
    for (const { query } of this.pending) this.gl.deleteQuery(query);
    for (const query of this.pool) this.gl.deleteQuery(query);
    this.pending.length = 0;
    this.pool.length = 0;
  }
}
