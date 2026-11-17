/**
 * `LoadingManager` URL modifier that fills in the parameters of `query` an
 * http(s) URL lacks, the same rule the engine applies to 3D Tiles content URLs.
 */
export function mergeQuery(query: string): (url: string) => string {
  const params = new URLSearchParams(query);
  return (url) => {
    // Embedded resources arrive as `blob:`/`data:` URLs.
    if (!/^https?:/i.test(url)) {
      return url;
    }
    const merged = new URL(url);
    const missing = new URLSearchParams();
    for (const [key, value] of params) {
      if (!merged.searchParams.has(key)) {
        missing.append(key, value);
      }
    }
    // Appending to `search` keeps the existing query as written; mutating
    // `searchParams` would re-serialize it (e.g. `/` -> `%2F`).
    if (missing.size > 0) {
      merged.search = merged.search
        ? `${merged.search}&${missing}`
        : `${missing}`;
    }
    return merged.href;
  };
}
