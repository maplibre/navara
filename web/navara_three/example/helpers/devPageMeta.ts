/**
 * What a development or verification page (any page outside the curated
 * gallery) exercises, written as `export default { … } satisfies DevPageMeta`
 * in the page's `meta.ts`. `pnpm pages:for <paths...>` reads it to list the
 * pages for a change.
 */
export type DevPageMeta = {
  /**
   * Repo-relative globs of the code the page exercises. A glob that matches a
   * directory covers everything below it. A file that every page depends on
   * (`CROSS_CUTTING_GLOBS` in `scripts/devPages.ts`, e.g. `src/core/**`)
   * selects the page only through a glob whose literal part (before its first
   * wildcard) lies strictly below that entry's directory, or one that names
   * the file itself: the glob matches the file, and its last segment keeps a
   * literal character once wildcards and every extension are removed (a last
   * segment `*SelectiveEffect*` names `src/core/SelectiveEffectRegistry.ts`;
   * `*.ts`, `*.test.ts` and `**` name nothing).
   */
  covers: readonly string[];
  /** What to look for on the page, in one or two sentences. */
  lookFor: string;
  /** The query parameters the page reads, by name, with their meaning. */
  params: Readonly<Record<string, string>>;
  /** Issue or PR numbers that use the page as evidence. */
  evidenceFor: readonly number[];
};
