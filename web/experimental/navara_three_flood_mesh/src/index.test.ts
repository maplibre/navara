import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { describe, expect, it } from "vitest";

// Modules only the CLI may reach.
const NODE_ONLY = /^(node:|sharp$|@zarrita\/storage\/fs$)/;

// Type-only imports are erased from the build.
const importsOf = (file: string) =>
  [
    ...readFileSync(file, "utf8").matchAll(
      /\b(?:import|export)\s+(?!type\b)[^"]*?from\s+"([^"]+)"|\bimport\s*\(\s*"([^"]+)"/g,
    ),
  ].map((match) => match[1] ?? match[2]);

const reach = (entry: string) => {
  const seen = new Set<string>();
  const packages = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const specifier of importsOf(file)) {
      if (specifier.startsWith(".")) {
        // A query, such as a worker's `?worker&url`, names the module too.
        visit(`${resolve(dirname(file), specifier.replace(/\?.*$/, ""))}.ts`);
      } else {
        packages.add(specifier);
      }
    }
  };
  visit(resolve(__dirname, entry));
  return { files: [...seen], packages: [...packages].sort() };
};

describe("the browser entry", () => {
  it("reaches no Node module or converter", () => {
    const { files, packages } = reach("index.ts");
    expect(files.filter((file) => file.includes("/convert/"))).toEqual([]);
    expect(packages).toEqual(["@navaramap/three", "three", "zarrita"]);
  });
});

describe("the convert entry", () => {
  it("reaches no Node module, so it runs in a browser too", () => {
    const { packages } = reach("convert/index.ts");
    expect(packages.filter((name) => NODE_ONLY.test(name))).toEqual([]);
  });

  it("reaches neither three nor Navara, so converting needs neither", () => {
    const { packages } = reach("convert/index.ts");
    expect(packages.filter((name) => /three/.test(name))).toEqual([]);
  });
});
