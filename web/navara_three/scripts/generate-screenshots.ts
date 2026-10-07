import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

import { Browser, Page, chromium } from "playwright";
import sharp from "sharp";
import invariant from "tiny-invariant";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type ScreenshotConfig = {
  viewport: { width: number; height: number };
  outputDir: string;
  serverUrl: string;
  timeout: number;
  retries: number;
  parallel: number;
};

type PageScreenshotResult = {
  page: string;
  path: string;
  timestamp: number;
  duration: number;
  success: boolean;
  error?: string;
};

type PageConfig = {
  waitTime?: number;
};

/** A discovered example page: its screenshot key and the demo URL to capture. */
type ExamplePage = {
  /**
   * Screenshot key — also the output filename (sans extension) and the id the
   * gallery references. Curated examples use the nested demo path
   * ("getting-started/hello-world"); legacy pages use the dash form
   * ("styling-geojson-billboard").
   */
  name: string;
  /** Dev-server path of the raw full-screen demo, e.g. "/demo/getting-started/hello-world". */
  url: string;
};

/**
 * Map an example directory (relative to `example/pages`, slash form) to its
 * screenshot key and demo URL. Mirrors the MPA routing in
 * `vite.config.example.ts` so captured screenshots line up with the URLs the
 * gallery renders.
 */
function toExamplePage(relPath: string): ExamplePage {
  // Curated examples: presentation at /<section>/<slug>, raw demo at
  // /demo/<section>/<slug>. Screenshots are keyed by that same demo path.
  if (relPath.startsWith("examples/")) {
    const rest = relPath.replace(/^examples\//, "");
    return { name: rest, url: `/demo/${rest}` };
  }
  // Everything else: dash URLs, a trailing "/index" collapsed to its parent.
  const urlName = relPath.replace(/\/index$/, "").replace(/\//g, "-");
  return { name: urlName, url: `/${urlName}` };
}

/**
 * Match a user-supplied target against a discovered page. Accepts the screenshot
 * key ("getting-started/hello-world", "atmosphere") as well as URL paths
 * ("/demo/getting-started/hello-world", "demo/getting-started/hello-world").
 */
function matchesTarget(page: ExamplePage, target: string): boolean {
  const norm = (s: string) =>
    s
      .replace(/^\//, "")
      .replace(/\.html$/, "")
      .replace(/\/$/, "");
  const t = norm(target);
  const url = norm(page.url);
  return page.name === t || url === t || url.replace(/^demo\//, "") === t;
}

/**
 * Directories under `example/pages` that hold a shared entrypoint reused by
 * other pages rather than a standalone page. Mirrors `SHARED_ENTRY_DIRS` in
 * `vite.config.example.ts`; these must not be captured as their own page.
 */
const SHARED_ENTRY_DIRS = new Set(["detail"]);

const DEFAULT_CONFIG: ScreenshotConfig = {
  viewport: { width: 400 * 3, height: 250 * 3 },
  outputDir: path.join(__dirname, "../example/public/screenshots"),
  serverUrl: process.env.SERVER_URL || "http://localhost:5173/examples",
  timeout: 300000,
  retries: 2,
  parallel: 1,
};

const PAGE_CONFIGS: Record<string, PageConfig> = {
  atmosphere: {
    waitTime: 10000,
  },
  "geodetic-placement": {
    // Terrain sampling plus two glTF assets, each added twice.
    waitTime: 20000,
  },
  "cloud-fog": {
    waitTime: 10000,
  },
  "debug-deferred-lighting": {
    // Quantized-mesh terrain plus the PLATEAU building tileset.
    waitTime: 20000,
  },
  "custom-shader": {
    waitTime: 10000,
  },
  night: {
    waitTime: 10000,
  },
  "lp-tiers": {
    waitTime: 20000,
  },
  weather: {
    waitTime: 40000,
  },
  "water-reflection": {
    waitTime: 10000,
  },
  "ssr-puddle": {
    waitTime: 50000,
  },
  "use-cases-photorealistic": {
    waitTime: 50000,
  },
  "use-cases-interior-explore": {
    waitTime: 60000,
  },
  "mesh/arcline": {
    waitTime: 12000,
  },
  "mesh/gltf-animation": {
    waitTime: 15000,
  },
  "mesh/instanced": {
    waitTime: 15000,
  },
  "mesh/smoothline": {
    waitTime: 15000,
  },
  "mesh/glow-globe": {
    waitTime: 10000,
  },
  // The scene-loaded signal already waits for the splat to finish loading;
  // the extra wait only covers post-load sort refinement.
  "mesh/splat": {
    waitTime: 5000,
  },
  "plugin/person-view": {
    waitTime: 15000,
  },
  "effect/selective-bloom": {
    waitTime: 8000,
  },
  "effect/selective-outline": {
    waitTime: 8000,
  },
  // Google Photorealistic 3D Tiles refine slowly under software GL.
  "effect/color-grading-lut": {
    waitTime: 60000,
  },
  "effect/depth-of-field": {
    waitTime: 15000,
  },
  "effect/fog-light": {
    waitTime: 10000,
  },
  "effect/ssr": {
    waitTime: 60000,
  },
};

class ScreenshotGenerator {
  private config: ScreenshotConfig;
  private browser: Browser | null = null;
  private targetPages: string[] | null = null;

  constructor(config: Partial<ScreenshotConfig> = {}, targetPages?: string[]) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.targetPages = targetPages || null;
  }

  async initialize(): Promise<void> {
    // Check if server is running
    try {
      const response = await fetch(`${this.config.serverUrl}/index.html`);
      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }
    } catch (_err) {
      console.error(`❌ Dev server is not running at ${this.config.serverUrl}`);
      console.error("Please start the dev server with: pnpm run dev");
      process.exit(1);
    }

    // Create output directory
    await fs.mkdir(this.config.outputDir, { recursive: true });

    // Launch browser with WebGL support
    this.browser = await chromium.launch({
      args: ["--ignore-gpu-blocklist", "--use-gl=angle"],
    });
  }

  /**
   * Recursively discover example pages in nested directories, returning each
   * page's directory path relative to `example/pages` (slash form). A directory
   * is a page if it contains a `main.ts` / `main.tsx`; otherwise it is a
   * category directory and we recurse. Non-directory entries (e.g. loose
   * `sections.ts`) are skipped.
   */
  async discoverPagesRecursive(
    baseDir: string,
    prefix = "",
  ): Promise<string[]> {
    const entries = await fs.readdir(baseDir, { withFileTypes: true });
    const paths: string[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      if (!prefix && SHARED_ENTRY_DIRS.has(entry.name)) {
        // Shared entrypoint, not a page of its own.
        continue;
      }

      const fullPath = path.join(baseDir, entry.name);
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const subEntries = await fs.readdir(fullPath, { withFileTypes: true });
      const isPage = subEntries.some(
        (e) => e.isFile() && (e.name === "main.ts" || e.name === "main.tsx"),
      );

      if (isPage) {
        paths.push(relPath);
      } else {
        // This is a category directory, recurse.
        paths.push(...(await this.discoverPagesRecursive(fullPath, relPath)));
      }
    }

    return paths;
  }

  async discoverPages(): Promise<ExamplePage[]> {
    const pagesDir = path.join(__dirname, "../example/pages");
    const relPaths = (await this.discoverPagesRecursive(pagesDir)).sort();
    const pages = relPaths.map(toExamplePage);

    // If specific pages are requested, resolve and return them.
    if (this.targetPages && this.targetPages.length > 0) {
      const matched: ExamplePage[] = [];
      const seen = new Set<string>();
      const invalid: string[] = [];
      for (const target of this.targetPages) {
        const page = pages.find((p) => matchesTarget(p, target));
        if (!page) {
          invalid.push(target);
          continue;
        }
        // Different targets can resolve to the same page (e.g. "/demo/" and ""
        // for one curated demo); keep it once so optimizeScreenshots() doesn't
        // stat/convert/delete the same PNG twice.
        if (seen.has(page.name)) continue;
        seen.add(page.name);
        matched.push(page);
      }

      if (invalid.length > 0) {
        console.error(`❌ Invalid page(s): ${invalid.join(", ")}`);
        console.log(
          `Available pages:\n${pages.map((p) => `  ${p.name}  →  ${p.url}`).join("\n")}`,
        );
        process.exit(1);
      }

      console.log(
        `📂 Targeting ${matched.length} specific page(s): ${matched
          .map((p) => p.name)
          .join(", ")}`,
      );
      return matched;
    }

    console.log(`📂 Found ${pages.length} WebGL example pages to capture`);
    return pages;
  }

  /**
   * Page chrome (buttons, panels, attribution, loading overlay) is for
   * visitors, not thumbnails — hide everything except the canvas (and its
   * ancestors) so screenshots show only the rendered scene, whatever UI a
   * page happens to add.
   */
  async hidePageUI(page: Page): Promise<void> {
    await page.addStyleTag({
      content:
        "body :not(canvas):not(:has(canvas)) { display: none !important; }",
    });
  }

  async waitForWebGL(
    page: Page,
    config: PageConfig = {},
    expectSceneLoadedSignal = false,
  ): Promise<void> {
    try {
      // Wait for canvas element to appear with longer timeout
      await page.waitForSelector("canvas", { timeout: 100000 });
      console.log("✓ Canvas found");

      // Curated examples post SCENE_LOADED_MESSAGE (helpers/initialize.ts) once
      // the engine first settles; standalone /demo/ pages post it to their own
      // window, where the init script records it. Legacy pages never post it
      // and rely on the fixed waits alone.
      if (expectSceneLoadedSignal) {
        try {
          await page.waitForFunction("window.__navaraSceneLoaded === true", {
            timeout: 120000,
          });
          console.log("✓ Scene loaded signal received");
        } catch {
          console.log("⚠️  No scene loaded signal, proceeding anyway");
        }
      }

      // Give WebGL time to initialize
      await page.waitForTimeout(3000);

      // Try to wait for WebGL context and content
      try {
        await page.waitForFunction(
          () => {
            const canvas = document.querySelector("canvas");
            if (!canvas) return false;

            // Check if canvas has reasonable dimensions
            const hasSize = canvas.width > 0 && canvas.height > 0;

            // Try to check if there's actual WebGL rendering
            const gl =
              canvas.getContext("webgl") || canvas.getContext("webgl2");
            const hasContext = gl !== null;

            return hasSize && hasContext;
          },
          { timeout: 10000 },
        );
        console.log("✓ WebGL context ready");
      } catch {
        // Canvas exists but might not be fully initialized yet
        console.log("⚠️  WebGL context check timed out, proceeding anyway");
      }
    } catch (_err) {
      console.log("⚠️  No canvas found, page might use different rendering");
      // Still wait a bit for page to stabilize
      await page.waitForTimeout(2000);
    }

    // Apply page-specific wait time if configured
    if (config.waitTime) {
      await page.waitForTimeout(config.waitTime);
    } else {
      // Default wait for rendering to stabilize
      await page.waitForTimeout(3000);
    }
  }

  async captureScreenshot(
    examplePage: ExamplePage,
  ): Promise<PageScreenshotResult> {
    const startTime = Date.now();
    const pageName = examplePage.name;
    const pageConfig = PAGE_CONFIGS[pageName] || {};
    const viewport = this.config.viewport;

    let attempts = 0;
    let lastError: Error | null = null;

    invariant(this.browser);

    while (attempts < this.config.retries) {
      attempts++;

      try {
        const context = await this.browser.newContext({
          viewport,
          deviceScaleFactor: 1,
        });

        const page = await context.newPage();

        // Record the demo's scene-loaded signal (posted to its own window when
        // not embedded in the detail page) before any page script runs.
        await page.addInitScript(`
          window.addEventListener("message", (event) => {
            if (event.data?.type === "navara-example:scene-loaded") {
              window.__navaraSceneLoaded = true;
            }
          });
        `);

        // Set longer default timeout for this page
        page.setDefaultTimeout(this.config.timeout);

        // Navigate to the example page (raw full-screen demo).
        const url = `${this.config.serverUrl}${examplePage.url}`;
        console.log(
          `📸 Capturing ${pageName} (attempt ${attempts}/${this.config.retries})...`,
        );

        await page.goto(url, { waitUntil: "networkidle" });

        await this.hidePageUI(page);

        // Wait for WebGL content to load
        await this.waitForWebGL(
          page,
          pageConfig,
          examplePage.url.startsWith("/demo/"),
        );

        // Re-hide page chrome right before capture: a dev-server dependency
        // re-optimization (e.g. a page's first dynamic import) reloads the
        // page, which drops the style tag injected after goto.
        await this.hidePageUI(page);

        // Capture screenshot. Curated example keys are nested paths
        // ("getting-started/hello-world"), so ensure the parent dir exists.
        const screenshotPath = path.join(
          this.config.outputDir,
          `${pageName}.png`,
        );
        await fs.mkdir(path.dirname(screenshotPath), { recursive: true });
        await page.screenshot({
          path: screenshotPath,
          fullPage: false, // Use viewport size
        });

        await context.close();

        const duration = Date.now() - startTime;
        console.log(`✅ ${pageName} captured successfully (${duration}ms)`);

        return {
          page: pageName,
          path: screenshotPath,
          timestamp: Date.now(),
          duration,
          success: true,
        };
      } catch (error) {
        lastError = error as Error;
        console.warn(
          `⚠️  ${pageName} failed (attempt ${attempts}): ${lastError.message}`,
        );

        if (attempts < this.config.retries) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
    }

    const duration = Date.now() - startTime;
    console.error(`❌ ${pageName} failed after ${attempts} attempts`);

    return {
      page: pageName,
      path: "",
      timestamp: Date.now(),
      duration,
      success: false,
      error: lastError?.message,
    };
  }

  async optimizeScreenshots(results: PageScreenshotResult[]): Promise<void> {
    const successfulResults = results.filter((r) => r.success);
    if (successfulResults.length === 0) return;

    console.log(
      `\n🖼️  Optimizing ${successfulResults.length} screenshots to AVIF (quality: 50)...`,
    );

    let totalOriginalSize = 0;
    let totalOptimizedSize = 0;

    for (const result of successfulResults) {
      const pngPath = result.path;
      const avifPath = pngPath.replace(/\.png$/, ".avif");

      const originalStat = await fs.stat(pngPath);
      totalOriginalSize += originalStat.size;

      await sharp(pngPath).avif({ quality: 50 }).toFile(avifPath);

      const optimizedStat = await fs.stat(avifPath);
      totalOptimizedSize += optimizedStat.size;

      await fs.unlink(pngPath);

      const reduction = (
        ((originalStat.size - optimizedStat.size) / originalStat.size) *
        100
      ).toFixed(1);
      console.log(
        `  ✅ ${path.basename(pngPath)} → ${formatBytes(originalStat.size)} → ${formatBytes(optimizedStat.size)} (${reduction}% smaller)`,
      );
    }

    const totalReduction =
      totalOriginalSize > 0
        ? (
            ((totalOriginalSize - totalOptimizedSize) / totalOriginalSize) *
            100
          ).toFixed(1)
        : "0";
    console.log(
      `  Total: ${formatBytes(totalOriginalSize)} → ${formatBytes(totalOptimizedSize)} (${totalReduction}% smaller)`,
    );
  }

  async run(): Promise<void> {
    console.log("🚀 Starting screenshot generation...");

    await this.initialize();
    const pages = await this.discoverPages();

    // Process pages in batches for parallel execution
    const results: PageScreenshotResult[] = [];

    for (let i = 0; i < pages.length; i += this.config.parallel) {
      const batch = pages.slice(i, i + this.config.parallel);
      const batchResults = await Promise.all(
        batch.map((page) => this.captureScreenshot(page)),
      );
      results.push(
        ...batchResults.filter((v): v is PageScreenshotResult => !!v),
      );
    }

    // Clean up
    if (this.browser) {
      await this.browser.close();
    }

    // Optimize screenshots to AVIF
    await this.optimizeScreenshots(results);

    // Summary
    const successful = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    console.log("\n📊 Screenshot generation complete!");
    console.log(`✅ Successful: ${successful}`);
    if (failed > 0) {
      console.log(`❌ Failed: ${failed}`);
    }
    console.log(`📁 Output: ${this.config.outputDir}`);

    // Exit with error if any failures
    if (failed > 0) {
      process.exit(1);
    }
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

// Parse command-line arguments
function parseArgs(): { pages: string[] | null; forceHeavy?: boolean } {
  const args = process.argv.slice(2);

  // Check for help
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
📸 Screenshot Generator for Navara WebGL Examples

Usage:
  pnpm run screenshots                    # Capture all pages
  pnpm run screenshots [target1] [target2]  # Capture specific pages
  pnpm run screenshots --help             # Show this help

A target is either a legacy page name or a curated example's demo path:
  pnpm run screenshots atmosphere                       # legacy page
  pnpm run screenshots atmosphere night                 # multiple legacy pages
  pnpm run screenshots /demo/getting-started/hello-world  # curated example (demo path)
  pnpm run screenshots getting-started/hello-world        # same, path shorthand

Environment variables:
  SERVER_URL=http://localhost:5173/examples  # Override dev server URL (including the /examples base)
    `);
    process.exit(0);
  }

  // Filter out flags and their values to get page names
  const pages: string[] = [];
  for (const arg of args) {
    pages.push(arg);
  }

  return {
    pages: pages.length > 0 ? pages : null,
  };
}

// Run the generator
const { pages } = parseArgs();
const generator = new ScreenshotGenerator({}, pages || undefined);
generator.run().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
