/**
 * Records one example page as a video clip for the release promotion video
 * (see skills/navara-release-video/SKILL.md).
 *
 *   pnpm navara_three record-clip <page-path> --out <file.mp4>
 *     [--duration 3.5] [--settle 5] [--move <preset>] [--no-attribution]
 *
 * <page-path> is a dev-server path below SERVER_URL, e.g.
 * "/demo/terrain/exaggeration" or "/release-video-water".
 */
import { execFileSync } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";

import { type Page, chromium } from "playwright";

const SERVER_URL = process.env.SERVER_URL || "http://localhost:5173/examples";
const WIDTH = 1920;
const HEIGHT = 1080;
const FPS = 30;

/** Message posted to the page when frame capture starts; scenes start their camera motion on it. */
const RECORD_START_MESSAGE = "navara-record:start";
const SCENE_LOADED_MESSAGE = "navara-example:scene-loaded";

/** Marks the map canvases; set on canvases covering at least this share of the viewport. */
const KEEP_ATTR = "data-nvr-rec-keep";
const MIN_CANVAS_AREA_RATIO = 0.1;

const ATTRIBUTION_UI =
  ":not(.navara-attr-dock):not(.navara-attr-dock *):not(.navara-attr-logoframe):not(.navara-attr-logoframe *):not(:has(.navara-attr-dock, .navara-attr-logoframe))";

/**
 * Hides everything but the map canvas and the attribution UI, and turns the
 * attribution popover into a black band in the bottom-right corner. The
 * popover has to stay open: the plugin only refreshes per-feature credits
 * (e.g. Google Photorealistic 3D Tiles data providers) while it is open.
 * Small canvases (stats panels, previews) are hidden once the map canvases are
 * marked with KEEP_ATTR.
 */
const RECORDING_CSS = `
body :not(canvas):not(:has(canvas))${ATTRIBUTION_UI},
html[${KEEP_ATTR}] body :not([${KEEP_ATTR}]):not(:has([${KEEP_ATTR}]))${ATTRIBUTION_UI} {
  display: none !important;
}
.navara-attr-dock, .navara-attr-dock--left {
  left: auto !important;
  right: 0 !important;
  bottom: 0 !important;
}
.navara-attr-toggle, .navara-attr-head, .navara-attr-bullet {
  display: none !important;
}
.navara-attr-logoframe, .navara-attr-logoframe--left {
  left: 8px !important;
}
.navara-attr-card {
  width: auto !important;
  max-width: 62vw !important;
  max-height: none !important;
  overflow: hidden !important;
  border-radius: 0 !important;
  box-shadow: none !important;
  background: #000 !important;
  color: #fff !important;
  padding: 4px 10px !important;
}
.navara-attr-list, .navara-attr-related, .navara-attr-item, .navara-attr-name,
.navara-attr-related li, .navara-attr-card a {
  display: inline !important;
  margin: 0 !important;
  padding: 0 !important;
  font: 400 13px/1.5 system-ui, sans-serif !important;
  color: #fff !important;
  text-decoration: none !important;
}
.navara-attr-related::before { content: ": "; }
.navara-attr-related li + li::before { content: ", "; }
.navara-attr-item + .navara-attr-item::before { content: " · "; }
`;

/**
 * Camera move driven through real pointer input during capture, for pages
 * that do not animate the camera themselves. Left drag spins the globe, right
 * drag rotates around the screen center, the wheel zooms.
 */
type Move =
  | { kind: "none" }
  | { kind: "orbit"; px: number }
  | { kind: "tilt"; px: number }
  | { kind: "pan"; dx: number; dy: number }
  | { kind: "push"; delta: number };

type Options = {
  pagePath: string;
  out: string;
  duration: number;
  settle: number;
  move: Move;
  requireAttribution: boolean;
};

function parseMove(spec: string | undefined): Move {
  if (!spec) return { kind: "none" };
  const [kind, arg = ""] = spec.split(":");
  const nums = arg.split(",").filter(Boolean).map(Number);
  switch (kind) {
    case "orbit":
      return { kind, px: nums[0] ?? 300 };
    case "tilt":
      return { kind, px: nums[0] ?? 150 };
    case "pan":
      return { kind, dx: nums[0] ?? 300, dy: nums[1] ?? 0 };
    case "push":
      return { kind, delta: nums[0] ?? 1500 };
    default:
      throw new Error(`Unknown --move "${spec}" (orbit|tilt|pan|push)`);
  }
}

function parseArgs(argv: string[]): Options {
  const positional: string[] = [];
  const flags = new Map<string, string>();
  let requireAttribution = true;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--no-attribution") {
      requireAttribution = false;
    } else if (arg.startsWith("--")) {
      flags.set(arg.slice(2), argv[++i]);
    } else {
      positional.push(arg);
    }
  }
  const out = flags.get("out");
  if (positional.length !== 1 || !out) {
    console.error(
      "Usage: record-video-clip <page-path> --out <file.mp4> [--duration 3.5] [--settle 5] [--move orbit:300|tilt:150|pan:300,0|push:1500] [--no-attribution]",
    );
    process.exit(1);
  }
  return {
    pagePath: positional[0].startsWith("/")
      ? positional[0]
      : `/${positional[0]}`,
    out: path.resolve(out),
    duration: Number(flags.get("duration") ?? 3.5),
    settle: Number(flags.get("settle") ?? 5),
    move: parseMove(flags.get("move")),
    requireAttribution,
  };
}

/** Plays the move at constant speed over the whole clip, one input step per ~16 ms. */
async function performMove(
  page: Page,
  move: Move,
  duration: number,
): Promise<void> {
  const ms = duration * 1000;
  if (move.kind === "none") {
    await page.waitForTimeout(ms);
    return;
  }
  const cx = WIDTH / 2;
  const cy = HEIGHT / 2;
  await page.mouse.move(cx, cy);

  const start = Date.now();
  const steps = async (apply: (progress: number) => Promise<void>) => {
    for (;;) {
      const progress = Math.min((Date.now() - start) / ms, 1);
      await apply(progress);
      if (progress >= 1) break;
      await page.waitForTimeout(16);
    }
  };

  if (move.kind === "push") {
    let sent = 0;
    await steps(async (p) => {
      const target = move.delta * p;
      await page.mouse.wheel(0, -(target - sent));
      sent = target;
    });
    return;
  }

  const button = move.kind === "pan" ? "left" : "right";
  const [dx, dy] =
    move.kind === "orbit"
      ? [move.px, 0]
      : move.kind === "tilt"
        ? [0, move.px]
        : [move.dx, move.dy];
  await page.mouse.down({ button });
  await steps((p) => page.mouse.move(cx + dx * p, cy + dy * p));
  await page.mouse.up({ button });
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const frameDir = await fs.mkdtemp(path.join(os.tmpdir(), "navara-clip-"));

  // Headful so WebGL runs on the GPU; the throttling flags keep rendering at
  // full rate while the window is behind other windows.
  const browser = await chromium.launch({
    headless: false,
    args: [
      "--ignore-gpu-blocklist",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      `--window-size=${WIDTH},${HEIGHT + 120}`,
    ],
  });

  try {
    const context = await browser.newContext({
      viewport: { width: WIDTH, height: HEIGHT },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    page.on("pageerror", (err) =>
      console.warn(`⚠️  pageerror: ${err.message}`),
    );

    // Injected per document so a dev-server reload keeps the recording style.
    await page.addInitScript(
      ({ css, sceneLoaded }) => {
        window.addEventListener("message", (event) => {
          if (event.data?.type === sceneLoaded) {
            (window as unknown as Record<string, unknown>).__navaraSceneLoaded =
              true;
          }
        });
        document.addEventListener("DOMContentLoaded", () => {
          const style = document.createElement("style");
          style.textContent = css;
          document.head.appendChild(style);
        });
      },
      { css: RECORDING_CSS, sceneLoaded: SCENE_LOADED_MESSAGE },
    );

    const url = `${SERVER_URL}${opts.pagePath}`;
    console.log(`🎬 ${url}`);
    await page.goto(url, { waitUntil: "networkidle", timeout: 120000 });
    await page.waitForSelector("canvas", { timeout: 120000 });
    await page
      .waitForFunction("window.__navaraSceneLoaded === true", undefined, {
        timeout: 60000,
      })
      .catch(() => console.log("⚠️  No scene loaded signal, proceeding"));

    const toggle = page.locator(".navara-attr-toggle");
    if ((await toggle.count()) > 0) {
      const expanded = await toggle.first().getAttribute("aria-expanded");
      if (expanded !== "true") {
        await toggle.first().evaluate((el) => (el as HTMLElement).click());
      }
    }

    const markMapCanvases = () =>
      page.evaluate(
        ({ attr, ratio }) => {
          const minArea = window.innerWidth * window.innerHeight * ratio;
          let marked = 0;
          for (const canvas of document.querySelectorAll("canvas")) {
            const { width, height } = canvas.getBoundingClientRect();
            if (width * height >= minArea) {
              canvas.setAttribute(attr, "");
              marked++;
            }
          }
          if (marked > 0) document.documentElement.setAttribute(attr, "");
        },
        { attr: KEEP_ATTR, ratio: MIN_CANVAS_AREA_RATIO },
      );
    await markMapCanvases();

    await page.waitForTimeout(opts.settle * 1000);
    // Again in case a dev-server reload replaced the DOM during the settle.
    await markMapCanvases();

    const credits = await page.evaluate(
      () =>
        document.querySelector(".navara-attr-list")?.textContent?.trim() ?? "",
    );
    if (opts.requireAttribution && !credits) {
      throw new Error(
        "Attribution band is empty. Register the scene's data sources with the AttributionPlugin, or pass --no-attribution if it uses no external data.",
      );
    }
    console.log(`📝 Attribution: ${credits || "(none)"}`);

    const cdp = await context.newCDPSession(page);
    const frames: { file: string; t: number }[] = [];
    let pending = Promise.resolve();
    cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
      const file = path.join(
        frameDir,
        `${String(frames.length).padStart(6, "0")}.jpg`,
      );
      frames.push({ file, t: metadata.timestamp ?? Date.now() / 1000 });
      pending = pending.then(() =>
        fs.writeFile(file, Buffer.from(data, "base64")),
      );
      cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
    });

    await cdp.send("Page.startScreencast", {
      format: "jpeg",
      quality: 95,
      maxWidth: WIDTH,
      maxHeight: HEIGHT,
      everyNthFrame: 1,
    });
    await page.evaluate(
      (type) => window.postMessage({ type }, "*"),
      RECORD_START_MESSAGE,
    );
    await performMove(page, opts.move, opts.duration);
    await page.waitForTimeout(300);
    await cdp.send("Page.stopScreencast");
    await pending;

    if (frames.length === 0) throw new Error("No frames were captured.");
    const t0 = frames[0].t;
    const end = t0 + opts.duration;
    const kept = frames.filter((f) => f.t < end);
    console.log(
      `🎞️  ${kept.length} frames in ${opts.duration}s (${(kept.length / opts.duration).toFixed(1)} fps captured)`,
    );

    // The screencast only emits a frame when the page repaints, so each frame
    // is held until the next one (concat demuxer durations), then resampled
    // to constant frame rate.
    const lines: string[] = [];
    kept.forEach((f, i) => {
      const next = i + 1 < kept.length ? kept[i + 1].t : end;
      lines.push(`file '${f.file}'`, `duration ${(next - f.t).toFixed(4)}`);
    });
    lines.push(`file '${kept[kept.length - 1].file}'`);
    const listFile = path.join(frameDir, "frames.txt");
    await fs.writeFile(listFile, lines.join("\n"));

    await fs.mkdir(path.dirname(opts.out), { recursive: true });
    execFileSync(
      "ffmpeg",
      [
        "-y",
        "-loglevel",
        "error",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        listFile,
        "-t",
        String(opts.duration),
        "-vf",
        `fps=${FPS},scale=${WIDTH}:${HEIGHT}:flags=lanczos,format=yuv420p`,
        "-c:v",
        "libx264",
        "-preset",
        "slow",
        "-crf",
        "16",
        "-an",
        opts.out,
      ],
      { stdio: "inherit" },
    );
    console.log(`✅ ${opts.out}`);
  } finally {
    await browser.close();
    await fs.rm(frameDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(`❌ ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
