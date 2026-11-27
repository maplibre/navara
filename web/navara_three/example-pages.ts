import { existsSync, readdirSync } from "fs";
import { resolve } from "path";

/**
 * Directories under `example/pages` that hold a shared entrypoint (a `main.tsx`
 * reused by other pages) rather than a standalone page. They must not be
 * registered as their own MPA page or listed in the launchers. `detail` is the
 * shared React presentation template rendered at `/<section>/<slug>` for each
 * curated example.
 */
export const SHARED_ENTRY_DIRS = new Set(["detail"]);

export type ExamplePage = { name: string; path: string };

/**
 * Recursively discover example pages in nested directories.
 * A directory is considered a page if it contains a main.ts file.
 * Otherwise, it's treated as a category directory.
 */
export function getExamplePages(baseDir: string, prefix = ""): ExamplePage[] {
  const entries = readdirSync(baseDir, { withFileTypes: true });
  const pages: ExamplePage[] = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!prefix && SHARED_ENTRY_DIRS.has(entry.name)) {
        // Shared entrypoint, not a page of its own.
        continue;
      }
      const fullPath = resolve(baseDir, entry.name);
      const mainFile = resolve(fullPath, "main.ts");
      const mainTsxFile = resolve(fullPath, "main.tsx");

      if (existsSync(mainFile) || existsSync(mainTsxFile)) {
        // This is a page directory
        const pageName = prefix ? `${prefix}/${entry.name}` : entry.name;
        pages.push({ name: pageName, path: fullPath });
      } else {
        // This is a category directory, recurse
        const nestedPages = getExamplePages(
          fullPath,
          prefix ? `${prefix}/${entry.name}` : entry.name,
        );
        pages.push(...nestedPages);
      }
    }
  }

  return pages;
}
