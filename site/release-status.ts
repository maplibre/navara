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

const parseVersion = (version: string): number[] => {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) {
    throw new Error(`Expected a version like "0.3.2", got "${version}"`);
  }
  return match.slice(1).map(Number);
};

/**
 * Whether a feature marked `since` (the latest release + 0.0.1 when it
 * landed, e.g. "0.3.2") is newer than {@link RELEASED_VERSION}, i.e.
 * available only in nightly builds. Any later release counts as shipping it.
 */
export const isNightlyOnly = (since: string): boolean => {
  const planned = parseVersion(since);
  const latest = parseVersion(RELEASED_VERSION);
  for (let i = 0; i < 3; i++) {
    if (planned[i] !== latest[i]) return planned[i] > latest[i];
  }
  return false;
};

/** Tooltip of the "Nightly" badge, per docs language. */
export const NIGHTLY_TOOLTIP = {
  en: "Available only in nightly builds until the next release",
  ja: "次のリリースまでは nightly ビルドでのみ利用できます",
};
