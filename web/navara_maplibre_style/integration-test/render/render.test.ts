import fs from "node:fs";
import path from "node:path";

import { test, type Page } from "@playwright/test";

import { classifyStyle } from "../lib/classify";
import { compareToExpected, toPng } from "../lib/compare";
import {
  ASSETS_DIR,
  RENDER_TESTS_DIR,
  listCaseIds,
  readCaseStyle,
  readSupportTable,
  type CaseResult,
} from "../lib/config";

// Defaults from maplibre-gl-js test/integration/render/render.test.ts.
const DEFAULT_SIZE = 512;
const DEFAULT_THRESHOLD = 0.1285;

/**
 * maplibre-gl-js serves its assets from this port, and some TileJSON fixtures
 * (`assets/tilesets/*.json`) hard-code it in their tile URLs.
 */
const UPSTREAM_ASSET_ORIGIN = "http://localhost:2900/";

const GENERATED_FILES = ["actual.png", "diff.png", "result.json"];

const QUIET_MS = 500;
const POLL_MS = 100;
const MAX_CAPTURES = 5;
/** Leaves room for the comparison and result.json within the test timeout. */
const CAPTURE_TIMEOUT_MS = 40_000;

/** Also renders cases using features supported.json does not cover. */
const INCLUDE_UNSUPPORTED = !!process.env.RENDER_INCLUDE_UNSUPPORTED;

const support = readSupportTable();

for (const id of listCaseIds()) {
  const caseDir = path.join(RENDER_TESTS_DIR, id);
  const style = readCaseStyle(id);
  const { reasons, tags: tag } = classifyStyle(style, support);
  if (reasons.length > 0) tag.push("@unsupported");

  test(id, { tag }, async ({ browser }) => {
    test.skip(
      reasons.length > 0 && !INCLUDE_UNSUPPORTED,
      `unsupported: ${reasons.join(", ")}`,
    );
    const started = Date.now();
    const meta = style.metadata?.test ?? {};
    const width = meta.width ?? DEFAULT_SIZE;
    const height = meta.height ?? DEFAULT_SIZE;
    const pixelRatio = meta.pixelRatio ?? 1;

    // Outputs sit next to the fixtures, as in maplibre-gl-js.
    for (const f of GENERATED_FILES) {
      fs.rmSync(path.join(caseDir, f), { force: true });
    }

    const result: CaseResult = {
      id,
      width,
      height,
      pixelRatio,
      console: [],
      durationMs: 0,
      finishedAt: 0,
    };

    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: pixelRatio,
    });
    const page = await context.newPage();
    // Counted here rather than in the page so that worker and image requests
    // count too, until their bodies have been read.
    const network: NetworkActivity = { inflight: 0, lastActivity: Date.now() };
    const settle = () => {
      network.inflight--;
      network.lastActivity = Date.now();
    };
    page.on("request", () => {
      network.inflight++;
      network.lastActivity = Date.now();
    });
    page.on("requestfinished", settle);
    page.on("requestfailed", (req) => {
      settle();
      const reason = req.failure()?.errorText ?? "";
      // Cancelled on purpose, e.g. a tile request dropped when the view moves.
      if (reason.includes("ERR_ABORTED")) return;
      result.console.push(`[request failed] ${req.url()}: ${reason}`);
    });
    page.on("console", (msg) => {
      // Failed fetches are logged with their URL by the response handler.
      if (msg.text().startsWith("Failed to load resource")) return;
      if (msg.type() === "warning" || msg.type() === "error") {
        result.console.push(`[${msg.type()}] ${msg.text()}`);
      }
    });
    // Serve maplibre-gl-js's asset port from the checkout instead.
    await page.route(`${UPSTREAM_ASSET_ORIGIN}**`, (route) => {
      const file = resolveUpstreamAsset(route.request().url());
      return file
        ? route.fulfill({ path: file })
        : route.fulfill({ status: 404 });
    });
    page.on("response", (res) => {
      if (res.status() >= 400) {
        result.console.push(
          `[http ${res.status()}] ${readablePath(res.url())}`,
        );
      }
    });
    page.on("pageerror", (err) => {
      result.console.push(`[pageerror] ${err.message}`);
    });

    try {
      await page.goto("/lib/test-page.html");
      await page.evaluate((s) => window.harness.run(s), style);
      const { png, status } = await captureStableFrame(page, network);
      if (status === "busy") {
        result.console.push(
          `[harness] page was still loading or rendering after ${CAPTURE_TIMEOUT_MS} ms`,
        );
      } else if (status === "unstable") {
        result.console.push(
          `[harness] frame did not stabilize after ${MAX_CAPTURES} captures`,
        );
      }
      fs.writeFileSync(path.join(caseDir, "actual.png"), png);

      const expectedPaths = fs
        .readdirSync(caseDir)
        .filter((f) => /^expected.*\.png$/.test(f))
        .map((f) => path.join(caseDir, f));
      const comparison = await compareToExpected(
        png,
        expectedPaths,
        meta.threshold ?? DEFAULT_THRESHOLD,
      );
      result.diffRatio = comparison.diffRatio;
      result.expected = path.basename(comparison.expectedPath);
      result.sizeMismatch = comparison.sizeMismatch;

      fs.writeFileSync(
        path.join(caseDir, "diff.png"),
        await toPng(comparison.diff),
      );
      test.info().annotations.push({
        type: "diffRatio",
        description: comparison.diffRatio.toFixed(4),
      });
    } catch (err) {
      result.error = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      result.finishedAt = Date.now();
      result.durationMs = result.finishedAt - started;
      fs.writeFileSync(
        path.join(caseDir, "result.json"),
        `${JSON.stringify(result, null, 2)}\n`,
      );
      await context.close();
    }
  });
}

/**
 * The file in the checkout's assets for a request to UPSTREAM_ASSET_ORIGIN, or
 * undefined when it does not exist, is not a file, or lies outside ASSETS_DIR.
 */
function resolveUpstreamAsset(url: string): string | undefined {
  try {
    const relative = decodeURIComponent(new URL(url).pathname.slice(1));
    const file = path.resolve(ASSETS_DIR, relative);
    if (!file.startsWith(ASSETS_DIR + path.sep)) return undefined;
    return fs.statSync(file).isFile() ? file : undefined;
  } catch {
    // A literal `%` that is not an escape, or a missing file.
    return undefined;
  }
}

function readablePath(url: string): string {
  const { pathname } = new URL(url);
  try {
    return decodeURIComponent(pathname);
  } catch {
    // A literal `%` that is not an escape.
    return pathname;
  }
}

type NetworkActivity = { inflight: number; lastActivity: number };

/**
 * Waits until no request is in flight, the view has gone idle at least once,
 * and nothing has loaded or rendered for QUIET_MS. Returns false if that does
 * not happen by `deadline`.
 */
async function waitForQuiet(
  page: Page,
  network: NetworkActivity,
  deadline: number,
): Promise<boolean> {
  while (Date.now() < deadline) {
    const { idleCount, sinceRender } = await page.evaluate(() => {
      const s = window.harness.state;
      return {
        idleCount: s.idleCount,
        sinceRender: performance.now() - s.lastRender,
      };
    });
    if (
      network.inflight === 0 &&
      Date.now() - network.lastActivity > QUIET_MS &&
      idleCount > 0 &&
      sinceRender > QUIET_MS
    ) {
      return true;
    }
    await page.waitForTimeout(POLL_MS);
  }
  return false;
}

/**
 * `idle` alone can fire between tile fetches, so capture until two frames
 * taken a quiet period apart are byte-identical. A page that never goes quiet
 * is still captured, for review.
 */
async function captureStableFrame(
  page: Page,
  network: NetworkActivity,
): Promise<{ png: Buffer; status: "stable" | "unstable" | "busy" }> {
  const deadline = Date.now() + CAPTURE_TIMEOUT_MS;
  const screenshot = () => page.locator("#navara-canvas").screenshot();
  if (!(await waitForQuiet(page, network, deadline))) {
    return { png: await screenshot(), status: "busy" };
  }
  let previous = await screenshot();
  for (let i = 1; i < MAX_CAPTURES; i++) {
    await page.waitForTimeout(QUIET_MS);
    if (!(await waitForQuiet(page, network, deadline))) {
      return { png: await screenshot(), status: "busy" };
    }
    const png = await screenshot();
    if (png.equals(previous)) return { png, status: "stable" };
    previous = png;
  }
  return { png: previous, status: "unstable" };
}
