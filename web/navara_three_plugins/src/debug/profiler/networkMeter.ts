export type NetworkEntry = {
  url: string;
  /** `performance.now()` when the fetch was issued. */
  start: number;
  /** When the response headers arrived (or the fetch failed). */
  end: number | undefined;
  status: number | undefined;
  failed: boolean;
  /** `Content-Length` of the response (compressed bytes), when sent. */
  bytes: number | undefined;
  /** Bytes on the wire from resource timing, when the origin allows it. */
  transferBytes: number | undefined;
  /** Decoded body bytes from resource timing, when the origin allows it. */
  decodedBytes: number | undefined;
  /** The matched source id, or `undefined` for unattributed requests. */
  sourceId: string | undefined;
};

export type NetworkSourceStats = {
  sourceId: string;
  requests: number;
  inFlight: number;
  failed: number;
  bytes: number;
  transferBytes: number;
  /** Mean headers-arrival latency of finished requests, in ms. */
  meanMs: number;
};

export type NetworkRates = {
  inFlight: number;
  requestsPerSecond: number;
  /** Content-Length bytes per second over the last second. */
  bytesPerSecond: number;
  /** Over the last ten seconds. */
  bytesPerSecond10: number;
  totalRequests: number;
  totalBytes: number;
};

/** Matches request URLs to a source id. */
export type NetworkSourceMatcher = {
  id: string;
  /**
   * How closely an absolute request URL matches the source: 0 is no match,
   * higher is closer. A request goes to the matcher scoring highest, so a
   * source's own URL beats another source's enclosing directory.
   */
  score: (url: string) => number;
};

const MAX_ENTRIES = 4000;

/**
 * Counts and attributes the page's `fetch` traffic while enabled: `fetch` is
 * wrapped on `globalThis` (every engine request goes through it) and resource
 * timing entries fill in wire and decoded sizes where the server sends
 * `Timing-Allow-Origin`. `Content-Length` is read as the compressed size,
 * which is what most tile servers send; a chunked response has none.
 */
export class NetworkMeter {
  readonly entries: NetworkEntry[] = [];
  private active = false;
  /** The `fetch` this meter wrapped, while its wrapper is installed. */
  private originalFetch: typeof fetch | undefined;
  /** Our wrapper; it stays in place (passing through) while another wraps it. */
  private wrapper: typeof fetch | undefined;
  private observer: PerformanceObserver | undefined;
  private matchers: NetworkSourceMatcher[] = [];
  private inFlight = 0;
  private totalRequests = 0;
  private totalBytes = 0;

  get enabled(): boolean {
    return this.active;
  }

  enable(): void {
    if (this.active) return;
    this.active = true;
    if (!this.wrapper) this.installWrapper();

    if (typeof PerformanceObserver !== "undefined") {
      this.observer = new PerformanceObserver((list) => {
        for (const item of list.getEntries()) {
          this.applyTiming(item as PerformanceResourceTiming);
        }
      });
      this.observer.observe({ type: "resource", buffered: false });
    }
  }

  /**
   * Stops counting. `fetch` is restored only when our wrapper is still the
   * outermost one: putting the original back would also remove whatever
   * wrapped `fetch` after us (another meter, the app, a mock). Otherwise the
   * wrapper stays and passes requests through until re-enabled.
   */
  disable(): void {
    if (!this.active) return;
    this.active = false;
    if (this.originalFetch && globalThis.fetch === this.wrapper) {
      globalThis.fetch = this.originalFetch;
      this.originalFetch = undefined;
      this.wrapper = undefined;
    }
    this.observer?.disconnect();
    this.observer = undefined;
  }

  private installWrapper(): void {
    const original = globalThis.fetch;
    this.originalFetch = original;
    const isActive = () => this.active;
    const begin = (url: string) => this.begin(url);
    const finish = (
      entry: NetworkEntry,
      status: number | undefined,
      headers: Headers | undefined,
    ) => this.finish(entry, status, headers);
    this.wrapper = globalThis.fetch = function (
      this: unknown,
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> {
      if (!isActive()) return original.call(this, input, init);
      const entry = begin(urlOf(input));
      return original.call(this, input, init).then(
        (response) => {
          finish(entry, response.status, response.headers);
          return response;
        },
        (error: unknown) => {
          finish(entry, undefined, undefined);
          throw error;
        },
      );
    };
  }

  /** Replaces the source matchers; existing entries are re-attributed. */
  setMatchers(matchers: NetworkSourceMatcher[]): void {
    this.matchers = matchers;
    for (const entry of this.entries) entry.sourceId = this.match(entry.url);
  }

  reset(): void {
    this.entries.length = 0;
    this.totalRequests = 0;
    this.totalBytes = 0;
  }

  rates(now = performance.now()): NetworkRates {
    let requests1 = 0;
    let bytes1 = 0;
    let bytes10 = 0;
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const entry = this.entries[i];
      const age = now - entry.start;
      if (age > 10_000) break;
      const bytes = entry.bytes ?? 0;
      bytes10 += bytes;
      if (age <= 1000) {
        requests1++;
        bytes1 += bytes;
      }
    }
    return {
      inFlight: this.inFlight,
      requestsPerSecond: requests1,
      bytesPerSecond: bytes1,
      bytesPerSecond10: bytes10 / 10,
      totalRequests: this.totalRequests,
      totalBytes: this.totalBytes,
    };
  }

  /** Per-source aggregates over the retained entries, busiest first. */
  perSource(): NetworkSourceStats[] {
    const stats = new Map<string, NetworkSourceStats & { latency: number }>();
    for (const entry of this.entries) {
      const id = entry.sourceId ?? "(other)";
      let s = stats.get(id);
      if (!s) {
        s = {
          sourceId: id,
          requests: 0,
          inFlight: 0,
          failed: 0,
          bytes: 0,
          transferBytes: 0,
          meanMs: 0,
          latency: 0,
        };
        stats.set(id, s);
      }
      s.requests++;
      if (entry.end === undefined) s.inFlight++;
      else s.latency += entry.end - entry.start;
      if (entry.failed) s.failed++;
      s.bytes += entry.bytes ?? 0;
      s.transferBytes += entry.transferBytes ?? 0;
    }
    return Array.from(stats.values())
      .map(({ latency, ...s }) => ({
        ...s,
        meanMs:
          s.requests - s.inFlight > 0 ? latency / (s.requests - s.inFlight) : 0,
      }))
      .sort((a, b) => b.bytes - a.bytes || b.requests - a.requests);
  }

  private begin(url: string): NetworkEntry {
    const entry: NetworkEntry = {
      url,
      start: performance.now(),
      end: undefined,
      status: undefined,
      failed: false,
      bytes: undefined,
      transferBytes: undefined,
      decodedBytes: undefined,
      sourceId: this.match(url),
    };
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) this.entries.shift();
    this.inFlight++;
    this.totalRequests++;
    return entry;
  }

  private finish(
    entry: NetworkEntry,
    status: number | undefined,
    headers: Headers | undefined,
  ): void {
    entry.end = performance.now();
    entry.status = status;
    entry.failed = status === undefined || status >= 400;
    this.inFlight--;
    const length = headers?.get("content-length");
    if (length !== null && length !== undefined) {
      entry.bytes = Number(length);
      this.totalBytes += entry.bytes;
    }
  }

  private applyTiming(timing: PerformanceResourceTiming): void {
    if (timing.transferSize === 0 && timing.decodedBodySize === 0) return;
    // Newest entry for the URL that has no timing yet.
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const entry = this.entries[i];
      if (entry.url !== timing.name || entry.transferBytes !== undefined) {
        continue;
      }
      entry.transferBytes = timing.transferSize;
      entry.decodedBytes = timing.decodedBodySize;
      if (entry.bytes === undefined && timing.encodedBodySize > 0) {
        entry.bytes = timing.encodedBodySize;
        this.totalBytes += entry.bytes;
      }
      return;
    }
  }

  private match(url: string): string | undefined {
    let best: string | undefined;
    let bestScore = 0;
    for (const matcher of this.matchers) {
      const score = matcher.score(url);
      if (score > bestScore) {
        best = matcher.id;
        bestScore = score;
      }
    }
    return best;
  }
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return absoluteUrl(input);
  if (input instanceof URL) return input.href;
  return input.url;
}

/** Resolves a relative URL against the page, as `fetch` does. */
function absoluteUrl(url: string): string {
  try {
    return new URL(url, globalThis.location?.href).href;
  } catch {
    return url;
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Builds a URL scorer (see `NetworkSourceMatcher.score`) from a source URL,
 * resolved against the page:
 * - a tile template (`{z}/{x}/{y}` or any other `{…}` placeholder) matches
 *   one path segment per placeholder, scored by its literal prefix;
 * - a plain URL (a tileset, a PMTiles archive, a GeoJSON file) matches itself
 *   best, then anything under its directory (where a tileset's content
 *   lives), scored by the directory's length so the deepest source wins. A
 *   directory that is a host root matches nothing, since it would claim the
 *   host's unrelated requests (fonts, sprites, other sources).
 */
export function sourceUrlMatcher(url: string): (candidate: string) => number {
  const absolute = absoluteUrl(url);
  if (url.includes("{")) {
    // Resolving percent-encodes the braces; split the raw URL instead.
    const parts = url.split(/\{[^}]*\}/);
    if (parts[0]) parts[0] = absoluteUrl(parts[0]);
    const re = new RegExp("^" + parts.map(escapeRegExp).join("[^/?#]+"));
    const score = parts[0].length + 1;
    return (candidate) => (re.test(candidate) ? score : 0);
  }
  const exact = Number.MAX_SAFE_INTEGER;
  const path = absolute.split(/[?#]/)[0];
  const directory = path.slice(0, path.lastIndexOf("/") + 1);
  const root = /^[a-z][a-z0-9+.-]*:\/\/[^/]*\/$/i.test(directory);
  return (candidate) =>
    candidate === absolute
      ? exact
      : !root && directory && candidate.startsWith(directory)
        ? directory.length
        : 0;
}
