// @vitest-environment node
import { execFileSync, spawnSync } from "child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";

import { afterEach, describe, expect, it } from "vitest";

import type { DevPageMeta } from "../example/helpers/devPageMeta";

import {
  CROSS_CUTTING_GLOBS,
  type DevPage,
  PAGES_DIR,
  REPO_ROOT,
  checkDevPageMeta,
  checkoutPaths,
  discoverDevPages,
  findStaleGlobs,
  globMatches,
  globSpecificity,
  listCheckoutFiles,
  loadDevPages,
  pathAndAncestors,
  selectPages,
} from "./devPages";

const page = (name: string, covers: string[]): DevPage => ({
  name,
  url: `/examples/${name}`,
  dir: `${PAGES_DIR}/${name}`,
  meta: { covers, lookFor: "x", params: {}, evidenceFor: [] },
});

const names = (matches: { page: DevPage }[]) => matches.map((m) => m.page.name);

describe("globSpecificity", () => {
  it("ranks a file over its directory over a basename pattern", () => {
    const file = globSpecificity("web/navara_three/src/mesh/sdfText/a.ts");
    const dir = globSpecificity("web/navara_three/src/mesh/sdfText/**");
    const parent = globSpecificity("web/navara_three/src/mesh/**");
    const basename = globSpecificity("**/*ater*");
    expect(file).toBeGreaterThan(dir);
    expect(dir).toBeGreaterThan(parent);
    expect(parent).toBeGreaterThan(basename);
  });

  it("counts a brace group as its shortest alternative", () => {
    expect(globSpecificity("a/{bb,c}.ts")).toBe(globSpecificity("a/c.ts"));
  });
});

describe("globMatches", () => {
  it("covers everything below a matched directory", () => {
    expect(
      globMatches("crates/navara_pnts/src/lib.rs", "crates/navara_pnts"),
    ).toBe(true);
    expect(globMatches("web/navara_three/src/water/a.ts", "**/*ater*")).toBe(
      true,
    );
    expect(globMatches("web/navara_three/src/mesh/a.ts", "**/*ater*")).toBe(
      false,
    );
  });

  it("matches dot files and the directory a `/**` glob names", () => {
    expect(
      globMatches(
        "crates/navara_pnts/.cargo/config.toml",
        "crates/navara_pnts/**",
      ),
    ).toBe(true);
    expect(globMatches(".github/workflows/ci.yml", ".github/**")).toBe(true);
    expect(globMatches("crates/navara_pnts", "crates/navara_pnts/**")).toBe(
      true,
    );
    expect(globMatches("crates/navara_pnts_x", "crates/navara_pnts/**")).toBe(
      false,
    );
  });
});

describe("pathAndAncestors", () => {
  it("ends at the root of an absolute or a relative path", () => {
    expect(pathAndAncestors("/a/b.ts")).toEqual(["/a/b.ts", "/a", "/"]);
    expect(pathAndAncestors("a/b.ts")).toEqual(["a/b.ts", "a"]);
    expect(globMatches("/abs/x.ts", "crates/**")).toBe(false);
  });
});

describe("pages:for", () => {
  const run = (...args: string[]) =>
    spawnSync(
      path.join(REPO_ROOT, "web/navara_three/node_modules/.bin/tsx"),
      [path.join(REPO_ROOT, "web/navara_three/scripts/pages-for.ts"), ...args],
      { cwd: REPO_ROOT, encoding: "utf8" },
    );

  it("warns about a path missing from the checkout and still matches it", () => {
    const { status, stdout, stderr } = run(
      "web/navara_three/src/pick/deleted.ts",
    );
    expect(status).toBe(0);
    expect(stderr).toContain(
      "web/navara_three/src/pick/deleted.ts is not in the checkout",
    );
    expect(stdout).toContain("matches web/navara_three/src/pick/deleted.ts");
  }, 30_000);

  it("prints the usage when no files are given", () => {
    const { status, stdout, stderr } = run();
    expect(status).not.toBe(0);
    expect(stderr).toContain("no files given");
    expect(stderr).toContain("usage:");
    expect(stdout).toBe("");
  }, 30_000);

  it("rejects --all together with files", () => {
    const { status, stderr } = run("--all", "web/navara_three/src/index.ts");
    expect(status).not.toBe(0);
    expect(stderr).toContain("usage:");
  }, 30_000);
});

describe("selectPages", () => {
  const sdf = page("sdf", ["web/navara_three/src/mesh/sdfText/**"]);
  const mesh = page("mesh", ["web/navara_three/src/mesh/**"]);
  const src = page("src", ["web/navara_three/src/**"]);

  it("orders pages by the most specific glob matching a file", () => {
    const matches = selectPages(
      [src, mesh, sdf],
      ["web/navara_three/src/mesh/sdfText/layout.ts"],
    );
    expect(names(matches)).toEqual(["sdf", "mesh", "src"]);
    expect(matches[0].files).toEqual([
      {
        file: "web/navara_three/src/mesh/sdfText/layout.ts",
        glob: "web/navara_three/src/mesh/sdfText/**",
      },
    ]);
  });

  it("ranks a page matching more files higher", () => {
    const a = page("a", ["web/navara_three/src/mesh/**"]);
    const b = page("b", [
      "web/navara_three/src/mesh/**",
      "web/navara_three/src/pick/**",
    ]);
    const matches = selectPages(
      [a, b],
      ["web/navara_three/src/mesh/x.ts", "web/navara_three/src/pick/y.ts"],
    );
    expect(names(matches)).toEqual(["b", "a"]);
  });

  it("puts a page first when the change edits the page itself", () => {
    const own = page("debug/own", ["web/navara_three/src/water/**"]);
    const matches = selectPages(
      [sdf, own],
      [
        `${PAGES_DIR}/debug/own/main.ts`,
        "web/navara_three/src/mesh/sdfText/a.ts",
      ],
    );
    expect(names(matches)).toEqual(["debug/own", "sdf"]);
  });

  it("selects nothing for a cross-cutting file unless a page names it as specifically", () => {
    const selective = page("selective", [
      "web/navara_three/src/core/*SelectiveEffect*",
    ]);
    const index = page("index-page", ["web/navara_three/src/index.ts"]);
    expect(
      selectPages([src, selective], ["web/navara_three/src/core/MeshDesc.ts"]),
    ).toEqual([]);
    expect(
      names(
        selectPages(
          [src, selective],
          ["web/navara_three/src/core/SelectiveEffectDesc.ts"],
        ),
      ),
    ).toEqual(["selective"]);
    expect(
      names(selectPages([src, index], ["web/navara_three/src/index.ts"])),
    ).toEqual(["index-page"]);
    expect(CROSS_CUTTING_GLOBS).toContain("web/navara_three/src/core/**");
  });

  it("does not count a broad glob for a cross-cutting file however long it is", () => {
    const broad = [
      page("tsx", ["web/navara_three/src/**/*.tsx"]),
      page("braces", ["web/navara_three/src/{core,mesh}/**"]),
      page("entry", ["web/navara_three/src/core/**"]),
    ];
    expect(
      selectPages(broad, ["web/navara_three/src/core/EffectDescView.tsx"]),
    ).toEqual([]);
    const under = page("under", ["web/navara_three/src/core/effects/**"]);
    expect(
      names(selectPages([under], ["web/navara_three/src/core/effects/a.ts"])),
    ).toEqual(["under"]);
  });

  it("selects a page for a cross-cutting file whose name its glob names", () => {
    const basename = page("basename", ["**/*SelectiveEffect*"]);
    const anyTs = page("any-ts", ["web/navara_three/src/**/*.ts"]);
    expect(
      names(
        selectPages(
          [src, anyTs, basename],
          ["web/navara_three/src/core/SelectiveEffectRegistry.ts"],
        ),
      ),
    ).toEqual(["basename"]);
  });

  it("does not count an extension-only last segment as naming a file", () => {
    const tests = page("tests", ["web/navara_three/src/core/**/*.test.ts"]);
    expect(
      selectPages([tests], ["web/navara_three/src/core/MeshDesc.test.ts"]),
    ).toEqual([]);
  });

  it("orders two edited pages by what else they match", () => {
    const a = page("a-page", ["web/navara_three/src/mesh/**"]);
    const z = page("z-page", ["web/navara_three/src/mesh/sdfText/**"]);
    const matches = selectPages(
      [a, z],
      [
        `${PAGES_DIR}/a-page/main.ts`,
        `${PAGES_DIR}/z-page/main.ts`,
        "web/navara_three/src/mesh/sdfText/a.ts",
      ],
    );
    expect(names(matches)).toEqual(["z-page", "a-page"]);
  });

  it("returns nothing for a file no glob covers", () => {
    expect(selectPages([sdf, mesh], ["docs/README.md"])).toEqual([]);
  });
});

describe("findStaleGlobs", () => {
  it("reports a glob that matches no file in the checkout", () => {
    const files = ["web/navara_three/src/mesh/polyline.ts"];
    expect(
      findStaleGlobs(
        [
          "web/navara_three/src/mesh/polyline*",
          "web/navara_three/src/mesh/gone/**",
        ],
        checkoutPaths(files),
      ),
    ).toEqual(["web/navara_three/src/mesh/gone/**"]);
  });

  it("reports each brace alternative that matches nothing", () => {
    const files = ["web/navara_three_default_descs/src/meshes/RainMeshDesc.ts"];
    expect(
      findStaleGlobs(
        ["web/navara_three_default_descs/src/meshes/{Rain,Snow}MeshDesc.ts"],
        checkoutPaths(files),
      ),
    ).toEqual(["web/navara_three_default_descs/src/meshes/SnowMeshDesc.ts"]);
  });
});

describe("discoverDevPages", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });
  /** A git repository holding the given `[page dir, file, content]` entries. */
  const fixture = (entries: [string, string, string?][]) => {
    const root = mkdtempSync(path.join(tmpdir(), "dev-pages-"));
    roots.push(root);
    execFileSync("git", ["init", "-q"], { cwd: root });
    writeFileSync(
      path.join(root, ".gitignore"),
      "*.local\nweb/**/example/pages/release-video\n",
    );
    for (const [dir, file, content = ""] of entries) {
      mkdirSync(path.join(root, PAGES_DIR, dir), { recursive: true });
      writeFileSync(path.join(root, PAGES_DIR, dir, file), content);
    }
    return root;
  };
  const meta = `export default { covers: ["x"], lookFor: "x", params: {}, evidenceFor: [] };`;

  it("leaves out gallery pages, the gallery index and shared entries", () => {
    const root = fixture([
      ["examples/basemap/tilejson", "main.ts"],
      ["examples/basemap/tilejson", "meta.ts"],
      ["index", "main.tsx"],
      ["detail", "main.tsx"],
      ["debug/3dtiles", "main.ts"],
      ["camera", "main.ts"],
    ]);
    expect(
      discoverDevPages(root)
        .map((p) => p.name)
        .sort(),
    ).toEqual(["camera", "debug/3dtiles"]);
  });

  it("leaves out pages that git ignores", async () => {
    const root = fixture([
      ["camera", "main.ts"],
      ["release-video", "main.ts"],
      ["debug/try.local", "main.ts"],
    ]);
    expect(discoverDevPages(root).map((p) => p.name)).toEqual(["camera"]);
    expect((await loadDevPages(root)).missingMeta).toEqual(["camera"]);
  });

  it("reports a meta.ts that fails to load and loads the others", async () => {
    const root = fixture([
      ["good", "main.ts"],
      ["good", "meta.ts", meta],
      ["no-default", "main.ts"],
      ["no-default", "meta.ts", "export const meta = {};"],
      ["broken", "main.ts"],
      ["broken", "meta.ts", "export default {"],
    ]);
    const { pages, loadErrors } = await loadDevPages(root);
    expect(pages.map((p) => p.name)).toEqual(["good"]);
    expect(loadErrors).toHaveLength(2);
    expect(loadErrors).toContain("no-default: meta.ts has no default export");
    expect(loadErrors.find((e) => e.startsWith("broken: "))).toBeDefined();
  });
});

describe("checkDevPageMeta", () => {
  it("reports a param meaning that is not a string", () => {
    const meta = {
      covers: ["web"],
      lookFor: "x",
      params: { a: 1 },
      evidenceFor: [],
    } as unknown as DevPageMeta;
    expect(checkDevPageMeta("p", meta, checkoutPaths(["web/a.ts"]))).toEqual([
      "p: ?a has no meaning",
    ]);
  });

  const withCovers = (covers: unknown) =>
    ({
      covers,
      lookFor: "x",
      params: {},
      evidenceFor: [],
    }) as unknown as DevPageMeta;

  it("reports covers that is not a list", () => {
    expect(
      checkDevPageMeta("p", withCovers("web/**"), checkoutPaths(["web/a.ts"])),
    ).toEqual(["p: covers must list globs"]);
  });

  it("accepts a dot directory and rejects relative and absolute globs", () => {
    const files = checkoutPaths([".github/workflows/ci.yml", "web/a.ts"]);
    expect(checkDevPageMeta("p", withCovers([".github/**"]), files)).toEqual(
      [],
    );
    for (const glob of ["./web/**", "../web/**", "/web/**"]) {
      expect(checkDevPageMeta("p", withCovers([glob]), files)).toContain(
        `p: ${glob} is not repo-relative`,
      );
    }
  });
});

describe("dev page meta.ts", () => {
  const files = checkoutPaths(listCheckoutFiles());

  it("exists for every page outside the gallery", async () => {
    expect(discoverDevPages().length).toBeGreaterThan(0);
    expect((await loadDevPages()).missingMeta).toEqual([]);
  });

  it("fills every field and names files in the checkout", async () => {
    const { pages, loadErrors } = await loadDevPages();
    const problems = [
      ...loadErrors,
      ...pages.flatMap(({ name, meta }) => checkDevPageMeta(name, meta, files)),
    ];
    expect(problems).toEqual([]);
  });

  it("keeps the cross-cutting globs current", () => {
    expect(findStaleGlobs(CROSS_CUTTING_GLOBS, files)).toEqual([]);
  });
});
