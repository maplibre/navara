import { overtureDatasets } from "./constants";

/**
 * Overture's STAC root catalog. Its `latest` field names the current release
 * (`YYYY-MM-DD.N`); Overture documents it as the pointer that always tracks the
 * latest release, and it is served with `Access-Control-Allow-Origin: *`.
 * Ref: https://docs.overturemaps.org/getting-data/
 */
export const OVERTURE_STAC_CATALOG_URL =
  "https://stac.overturemaps.org/catalog.json";

/**
 * Release used when the catalog cannot be fetched (offline dev, outage). It
 * expires with the ~60-day retention window like any pinned date, so bump it
 * when the fallback path starts 410ing.
 */
export const OVERTURE_FALLBACK_RELEASE = "2026-10-21.0";

const RELEASE_PATTERN = /^\d{4}-\d{2}-\d{2}\.\d+$/;

/** Resolves the current Overture release id from the STAC catalog. */
export const fetchLatestOvertureRelease = async (): Promise<string> => {
  try {
    const response = await fetch(OVERTURE_STAC_CATALOG_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const { latest } = (await response.json()) as { latest?: unknown };
    if (typeof latest !== "string" || !RELEASE_PATTERN.test(latest)) {
      throw new Error(`unexpected \`latest\`: ${JSON.stringify(latest)}`);
    }
    return latest;
  } catch (error) {
    console.warn(
      `Overture release lookup failed; using ${OVERTURE_FALLBACK_RELEASE}`,
      error,
    );
    return OVERTURE_FALLBACK_RELEASE;
  }
};

/** Overture PMTiles datasets for the current release. */
export const resolveOvertureDatasets = async () =>
  overtureDatasets(await fetchLatestOvertureRelease());
