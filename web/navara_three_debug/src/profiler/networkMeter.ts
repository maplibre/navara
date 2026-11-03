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
  test: (url: string) => boolean;
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
  private originalFetch: typeof fetch | undefined;
  private observer: PerformanceObserver | undefined;
  private matchers: NetworkSourceMatcher[] = [];
  private inFlight = 0;
  private totalRequests = 0;
  private totalBytes = 0;

  get enabled(): boolean {
    return this.originalFetch !== undefined;
  }

  enable(): void {
    if (this.originalFetch) return;
    const original = globalThis.fetch;
    this.originalFetch = original;
    const begin = (url: string) => this.begin(url);
    const finish = (
      entry: NetworkEntry,
      status: number | undefined,
      headers: Headers | undefined,
    ) => this.finish(entry, status, headers);
    globalThis.fetch = function (
      this: unknown,
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> {
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

    if (typeof PerformanceObserver !== "undefined") {
      this.observer = new PerformanceObserver((list) => {
        for (const item of list.getEntries()) {
          this.applyTiming(item as PerformanceResourceTiming);
        }
      });
      this.observer.observe({ type: "resource", buffered: false });
    }
  }

  disable(): void {
    if (!this.originalFetch) return;
    globalThis.fetch = this.originalFetch;
    this.originalFetch = undefined;
    this.observer?.disconnect();
    this.observer = undefined;
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
    for (const matcher of this.matchers) {
      if (matcher.test(url)) return matcher.id;
    }
    return undefined;
  }
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Builds a URL matcher from a source URL: a tile template (`{z}/{x}/{y}` or
 * any other `{…}` placeholder) matches one path segment per placeholder; a
 * plain URL (a tileset, a PMTiles archive, a GeoJSON file) matches itself and
 * everything under its directory, which is where a tileset's content lives.
 */
export function sourceUrlMatcher(url: string): (candidate: string) => boolean {
  if (url.includes("{")) {
    const pattern =
      "^" +
      url
        .split(/\{[^}]*\}/)
        .map(escapeRegExp)
        .join("[^/?#]+");
    const re = new RegExp(pattern);
    return (candidate) => re.test(candidate);
  }
  const directory = url.slice(0, url.lastIndexOf("/") + 1);
  return (candidate) => candidate === url || candidate.startsWith(directory);
}
