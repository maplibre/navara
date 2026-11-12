// Shared by the docs and the examples to mark features that only nightlies
// ship. `released-version.json` holds the version under the npm `latest`
// dist-tag; `cargo make changelog vX.Y.Z` rewrites it.
import released from "./released-version.json";

export const RELEASED_VERSION: string = released.version;

/**
 * Docs-site path, per docs language, of the section explaining how to install
 * nightly builds. The anchors are the slugs of that section's headings.
 */
export const NIGHTLY_DOCS_PATH = {
  en: "three/introduction/install#nightly-builds",
  ja: "three/introduction/install#nightly-ビルド",
};

/**
 * `since` of a feature that no release is planned to ship yet, such as a
 * package under web/experimental: nightly-only until it is replaced with a
 * version.
 */
export const NIGHTLY_ONLY = "nightly";

const parseVersion = (version: string): number[] => {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) {
    throw new Error(
      `Expected a version like "0.3.2" or "${NIGHTLY_ONLY}", got "${version}"`,
    );
  }
  return match.slice(1).map(Number);
};

/**
 * Whether a feature marked `since` (the latest release + 0.0.1 when it
 * landed, e.g. "0.3.2", or {@link NIGHTLY_ONLY}) is newer than
 * {@link RELEASED_VERSION}, i.e. available only in nightly builds. Any later
 * release counts as shipping it.
 */
export const isNightlyOnly = (since: string): boolean => {
  if (since === NIGHTLY_ONLY) return true;
  const planned = parseVersion(since);
  const latest = parseVersion(RELEASED_VERSION);
  for (let i = 0; i < 3; i++) {
    if (planned[i] !== latest[i]) return planned[i] > latest[i];
  }
  return false;
};

/** Tooltip of the "Nightly" badge of a feature marked `since`. */
export const nightlyTooltip = (since: string, lang: "en" | "ja"): string =>
  since === NIGHTLY_ONLY
    ? { en: "Available only in nightly builds", ja: "nightly ビルドでのみ利用できます" }[lang]
    : {
        en: "Available only in nightly builds until the next release",
        ja: "次のリリースまでは nightly ビルドでのみ利用できます",
      }[lang];
