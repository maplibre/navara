/**
 * Lists the development and verification pages for changed files.
 *
 *   pnpm pages:for <files...>                       pages for these files
 *   pnpm pages:for $(git diff --name-only main...)  pages for a branch
 *   pnpm pages:for --all                            every page
 *
 * Pass file paths relative to the repo root, the form `git diff --name-only`
 * prints from any directory.
 */
import { existsSync } from "fs";
import path from "path";

import {
  type DevPage,
  PAGES_DIR,
  REPO_ROOT,
  loadDevPages,
  selectPages,
} from "./devPages";

const USAGE = "usage: pnpm pages:for <files...> | pnpm pages:for --all";

const MAX_FILES_SHOWN = 3;

const describe = (page: DevPage) => {
  const lines = [
    `${page.name}  ${page.url}`,
    `  look for: ${page.meta.lookFor}`,
  ];
  for (const [name, meaning] of Object.entries(page.meta.params)) {
    lines.push(`  ?${name}: ${meaning}`);
  }
  if (page.meta.evidenceFor.length > 0) {
    lines.push(
      `  evidence for: ${page.meta.evidenceFor.map((n) => `#${n}`).join(" ")}`,
    );
  }
  return lines;
};

const main = async () => {
  const args = process.argv.slice(2);
  const all = args.includes("--all");
  if (args.length === 0 || (all && args.length > 1)) {
    console.error(args.length === 0 ? `no files given\n${USAGE}` : USAGE);
    process.exitCode = 2;
    return;
  }

  const { pages, missingMeta, loadErrors } = await loadDevPages();
  for (const name of missingMeta) {
    console.error(`warning: ${PAGES_DIR}/${name} has no meta.ts`);
  }
  for (const error of loadErrors) {
    console.error(`warning: ${PAGES_DIR}/${error}`);
  }

  if (all) {
    for (const page of pages) {
      console.log(
        [...describe(page), `  covers: ${page.meta.covers.join(" ")}`].join(
          "\n",
        ),
      );
    }
    return;
  }

  for (const file of args) {
    // A file the change deletes is legitimately missing.
    if (!existsSync(path.join(REPO_ROOT, file))) {
      console.error(
        `warning: ${file} is not in the checkout (paths are relative to the repo root)`,
      );
    }
  }
  const matches = selectPages(pages, args);
  if (matches.length === 0) {
    console.log(
      "No page covers these files. Search every page with `pnpm pages:for --all`.",
    );
    return;
  }
  for (const { page, files: matched } of matches) {
    const [header, ...rest] = describe(page);
    console.log(
      [
        header,
        ...matched
          .slice(0, MAX_FILES_SHOWN)
          .map(({ file, glob }) => `  matches ${file} (${glob})`),
        ...(matched.length > MAX_FILES_SHOWN
          ? [`  and ${matched.length - MAX_FILES_SHOWN} more files`]
          : []),
        ...rest,
      ].join("\n"),
    );
  }
};

await main();
