import { execFileSync, spawnSync } from "child_process";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

import type { DevPageMeta } from "../example/helpers/devPageMeta";
import { isGalleryPage, toDashUrlName } from "../example/pageNames";
import { getExamplePages } from "../example-pages";

export const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

export const PAGES_DIR = "web/navara_three/example/pages";

/**
 * Files every page depends on, so a change to them selects no page by itself.
 * A page still matches such a file when one of its `covers` globs lies strictly
 * under the entry's directory (`liesUnder`) or names the file (`namesFile`).
 */
export const CROSS_CUTTING_GLOBS: readonly string[] = [
  "web/navara_three/src/index.ts",
  "web/navara_three/src/core/**",
  "web/navara_three/src/type/**",
  "web/navara_core/**",
  "crates/navara_ecs/src/lib.rs",
  "crates/navara_wasm/src/lib.rs",
  "crates/navara_wasm_types/**",
  "crates/navara_material/**",
  "crates/navara_core/**",
];

export type DevPage = {
  /** Directory under `pages/`, e.g. `debug/3dtiles`. */
  name: string;
  /** Path on the example dev server, e.g. `/examples/debug-3dtiles`. */
  url: string;
  /** Repo-relative directory of the page. */
  dir: string;
  meta: DevPageMeta;
};

export type MatchedFile = { file: string; glob: string };

export type PageMatch = {
  page: DevPage;
  /** Changed files the page matches, each with its most specific glob. */
  files: MatchedFile[];
  /** A changed file is inside the page's own directory. */
  editsPage: boolean;
  /**
   * Sum over the matched files of the specificity of the glob that matched
   * each one.
   */
  score: number;
};

/**
 * How specific a glob is: the number of literal characters it names, with a
 * brace group counted as its shortest alternative. A larger value matches
 * fewer paths.
 */
export const globSpecificity = (glob: string): number =>
  glob
    .replace(/\{([^}]*)\}/g, (_, alts: string) =>
      alts.split(",").reduce((a, b) => (b.length < a.length ? b : a)),
    )
    .replace(/\[[^\]]*\]/g, "")
    .replace(/[*?]/g, "").length;

// `path.matchesGlob` never lets a wildcard match a leading dot. Replacing
// the dot that starts a segment, in both the path and the glob, with a
// character that no path holds makes wildcards match dot files too.
const hideLeadingDots = (s: string) => s.replace(/(^|\/)\./g, "$1\u0001");

/**
 * Whether the path matches the glob, dot files included. A glob ending in
 * `/**` also matches the directory it names.
 */
export const matchGlob = (p: string, glob: string): boolean => {
  const target = hideLeadingDots(p);
  const pattern = hideLeadingDots(glob);
  return (
    path.matchesGlob(target, pattern) ||
    (pattern.endsWith("/**") && path.matchesGlob(target, pattern.slice(0, -3)))
  );
};

/** Whether the glob matches the file or one of its ancestor directories. */
export const globMatches = (file: string, glob: string): boolean =>
  pathAndAncestors(file).some((p) => matchGlob(p, glob));

/** The path followed by each of its ancestor directories. */
export const pathAndAncestors = (file: string): string[] => {
  const paths: string[] = [];
  for (let p = file; p !== "" && p !== ".";) {
    paths.push(p);
    const parent = path.posix.dirname(p);
    if (parent === p) break;
    p = parent;
  }
  return paths;
};

export const checkDevPageMeta = (
  name: string,
  meta: DevPageMeta,
  paths: ReadonlySet<string>,
): string[] => {
  const problems: string[] = [];
  const m = meta as Partial<DevPageMeta>;
  const covers: readonly string[] = Array.isArray(m.covers) ? m.covers : [];
  if (!Array.isArray(m.covers)) {
    problems.push(`${name}: covers must list globs`);
  } else if (covers.length === 0) {
    problems.push(`${name}: covers is empty`);
  }
  if (typeof m.lookFor !== "string" || m.lookFor.trim() === "") {
    problems.push(`${name}: lookFor is empty`);
  }
  if (typeof m.params !== "object" || m.params === null) {
    problems.push(`${name}: params is missing`);
  } else {
    for (const [key, meaning] of Object.entries(m.params)) {
      if (typeof meaning !== "string" || !meaning.trim()) {
        problems.push(`${name}: ?${key} has no meaning`);
      }
    }
  }
  if (
    !Array.isArray(m.evidenceFor) ||
    !m.evidenceFor.every((n) => Number.isInteger(n) && n > 0)
  ) {
    problems.push(`${name}: evidenceFor must list issue or PR numbers`);
  }
  for (const glob of covers) {
    if (typeof glob !== "string" || /^(\.\.?\/|\/)/.test(glob)) {
      problems.push(`${name}: ${glob} is not repo-relative`);
    }
  }
  for (const glob of findStaleGlobs(
    covers.filter((glob) => typeof glob === "string"),
    paths,
  )) {
    problems.push(`${name}: ${glob} matches no file in the checkout`);
  }
  return problems;
};

/**
 * Whether the glob names the file itself: it matches the file (not only one
 * of its directories), and its last segment keeps a literal character once
 * the wildcards and every extension are removed (`*SelectiveEffect*`, not
 * `*.ts`, `*.test.ts` or `**`).
 */
const namesFile = (glob: string, file: string): boolean =>
  matchGlob(file, glob) &&
  globSpecificity(
    path.posix.basename(glob).replace(/(\.(\w+|\{[^}]*\}))+$/, ""),
  ) > 0;

/** The part of a glob before its first wildcard. */
const literalPrefix = (glob: string) => glob.slice(0, glob.search(/[*?[{]|$/));

/**
 * Whether the glob only matches paths strictly below the directory of a
 * cross-cutting entry: its literal prefix goes deeper than that directory.
 */
const liesUnder = (glob: string, entry: string): boolean => {
  const dir = literalPrefix(entry).replace(/\/$/, "");
  const prefix = literalPrefix(glob);
  return prefix.startsWith(`${dir}/`) && prefix.length > dir.length + 1;
};

const ownGlob = (page: DevPage) => `${page.dir}/**`;

/**
 * Pages for the changed files, best first: each file adds the specificity of
 * the page's most specific glob matching it, so a page that matches more
 * files, or matches them more specifically, ranks higher. A file inside a
 * page's own directory ranks that page ahead of every page it does not edit.
 * A file that a cross-cutting entry matches counts only for page globs that
 * lie strictly under the entry's directory (`liesUnder`) or name the file
 * itself (`namesFile`).
 */
export const selectPages = (
  pages: readonly DevPage[],
  files: readonly string[],
  crossCutting: readonly string[] = CROSS_CUTTING_GLOBS,
): PageMatch[] => {
  const matches = new Map<DevPage, PageMatch>();
  for (const file of files) {
    const entries = crossCutting.filter((entry) => globMatches(file, entry));
    for (const page of pages) {
      let best: { glob: string; specificity: number } | undefined;
      const own = globMatches(file, ownGlob(page));
      if (own) {
        best = {
          glob: ownGlob(page),
          specificity: globSpecificity(ownGlob(page)),
        };
      } else {
        for (const glob of page.meta.covers) {
          const specificity = globSpecificity(glob);
          if (
            (!best || specificity > best.specificity) &&
            globMatches(file, glob) &&
            (entries.every((entry) => liesUnder(glob, entry)) ||
              namesFile(glob, file))
          ) {
            best = { glob, specificity };
          }
        }
      }
      if (!best) continue;
      const match = matches.get(page) ?? {
        page,
        files: [],
        editsPage: false,
        score: 0,
      };
      match.files.push({ file, glob: best.glob });
      match.editsPage ||= own;
      match.score += best.specificity;
      matches.set(page, match);
    }
  }
  return [...matches.values()].sort(
    (a, b) =>
      Number(b.editsPage) - Number(a.editsPage) ||
      b.score - a.score ||
      b.files.length - a.files.length ||
      a.page.name.localeCompare(b.page.name),
  );
};

/** The files and every directory above them, for `findStaleGlobs`. */
export const checkoutPaths = (files: readonly string[]): ReadonlySet<string> =>
  new Set(files.flatMap(pathAndAncestors));

/** The globs a glob's brace groups expand to (`a/{b,c}` -> `a/b`, `a/c`). */
export const expandBraces = (glob: string): string[] => {
  const group = /\{([^{}]*)\}/.exec(glob);
  if (!group) return [glob];
  const [before, after] = [
    glob.slice(0, group.index),
    glob.slice(group.index + group[0].length),
  ];
  return [
    ...new Set(
      group[1].split(",").flatMap((alt) => expandBraces(before + alt + after)),
    ),
  ];
};

/**
 * The globs, with each brace group expanded, that match none of `paths`
 * (from `checkoutPaths`).
 */
export const findStaleGlobs = (
  globs: readonly string[],
  paths: ReadonlySet<string>,
): string[] =>
  globs.flatMap(expandBraces).filter((glob) => {
    // Only paths starting with the glob's literal prefix can match it.
    const prefix = literalPrefix(glob).replace(/\/$/, "");
    for (const p of paths) {
      if (p.startsWith(prefix) && matchGlob(p, glob)) return false;
    }
    return true;
  });

/** The files in the checkout: tracked ones and untracked ones git does not ignore. */
export const listCheckoutFiles = (repoRoot = REPO_ROOT): string[] =>
  execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard"],
    {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 1 << 26,
    },
  )
    .split("\n")
    .filter(Boolean);

/** The repo-relative paths among `paths` that git ignores. */
const findIgnored = (paths: readonly string[], repoRoot: string) => {
  const result = spawnSync("git", ["check-ignore", "--stdin"], {
    cwd: repoRoot,
    input: paths.join("\n"),
    encoding: "utf8",
  });
  // Exit status 1 means that no path is ignored.
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(`git check-ignore failed: ${result.stderr}`);
  }
  return new Set(result.stdout.split("\n").filter(Boolean));
};

/**
 * Every page outside the gallery that git does not ignore, as discovered by
 * `vite.config.example.ts`.
 */
export const discoverDevPages = (repoRoot = REPO_ROOT) => {
  const pages = getExamplePages(path.join(repoRoot, PAGES_DIR)).filter(
    ({ name }) => !isGalleryPage(name),
  );
  const entryOf = (dir: string) =>
    path
      .relative(
        repoRoot,
        path.join(
          dir,
          existsSync(path.join(dir, "main.tsx")) ? "main.tsx" : "main.ts",
        ),
      )
      .split(path.sep)
      .join("/");
  const ignored = findIgnored(
    pages.map(({ path: dir }) => entryOf(dir)),
    repoRoot,
  );
  return pages.filter(({ path: dir }) => !ignored.has(entryOf(dir)));
};

/**
 * Loads the `meta.ts` of every page outside the gallery. Lists the pages that
 * have none, and those whose `meta.ts` fails to load or has no default export
 * (one line per page, naming it).
 */
export const loadDevPages = async (
  repoRoot = REPO_ROOT,
): Promise<{
  pages: DevPage[];
  missingMeta: string[];
  loadErrors: string[];
}> => {
  const pages: DevPage[] = [];
  const missingMeta: string[] = [];
  const loadErrors: string[] = [];
  for (const { name, path: dir } of discoverDevPages(repoRoot)) {
    const file = path.join(dir, "meta.ts");
    if (!existsSync(file)) {
      missingMeta.push(name);
      continue;
    }
    let meta: DevPageMeta | undefined;
    try {
      meta = (
        (await import(pathToFileURL(file).href)) as { default?: DevPageMeta }
      ).default;
    } catch (error) {
      loadErrors.push(`${name}: meta.ts fails to load: ${String(error)}`);
      continue;
    }
    if (meta === undefined) {
      loadErrors.push(`${name}: meta.ts has no default export`);
      continue;
    }
    pages.push({
      name,
      url: `/examples/${toDashUrlName(name)}`,
      dir: path.relative(repoRoot, dir).split(path.sep).join("/"),
      meta,
    });
  }
  return { pages, missingMeta, loadErrors };
};
