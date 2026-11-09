// Checks the screenshots referenced from src/data/showcases.json: each must
// exist, be AVIF and stay within MAX_BYTES, so the showcases page stays light.
// Only images added or changed since the base ref are checked (an entry whose
// image the base's showcases.json does not reference, or whose file differs
// from the base); `--all` checks every entry.
//
//   node scripts/check-showcases.mjs [--base <ref>] [--all]
//
// The base defaults to origin/main. .github/workflows/docs.yml passes the pull
// request's base branch.
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_BYTES = 300 * 1024;

const args = process.argv.slice(2);
const all = args.includes("--all");
const baseIndex = args.indexOf("--base");
const base = baseIndex >= 0 ? args[baseIndex + 1] : "origin/main";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const jsonPath = join(root, "data", "showcases.json");
const assetsDir = join(root, "assets");
const showcases = JSON.parse(readFileSync(jsonPath, "utf8"));

const git = (...gitArgs) =>
  execFileSync("git", gitArgs, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

let targets = showcases;
if (!all) {
  try {
    git("rev-parse", "--verify", "--quiet", `${base}^{commit}`);
  } catch {
    console.error(`Base ref "${base}" not found. Pass --base <ref>, or --all to check every image.`);
    process.exit(1);
  }
  const top = git("rev-parse", "--show-toplevel").trim();
  const repoPath = (path) => relative(top, path).split("\\").join("/");
  let baseImages = new Set();
  try {
    const baseJson = JSON.parse(git("show", `${base}:${repoPath(jsonPath)}`));
    baseImages = new Set(baseJson.map(({ image }) => image));
  } catch {
    // The base has no showcases.json yet: every entry is new.
  }
  // Compares the working tree with the base, so uncommitted edits count too.
  const changed = new Set(
    git("diff", "--name-only", base, "--", join(assetsDir, "showcases"))
      .split("\n")
      .filter(Boolean),
  );
  targets = showcases.filter(
    ({ image }) => !baseImages.has(image) || changed.has(repoPath(join(assetsDir, image))),
  );
}

const kb = (bytes) => `${Math.round(bytes / 1024)} KB`;
const failures = [];
for (const { title, image } of targets) {
  let size;
  try {
    size = statSync(join(assetsDir, image)).size;
  } catch {
    failures.push(`${image} (${title}): file not found`);
    continue;
  }
  if (!image.endsWith(".avif")) {
    failures.push(`${image} (${title}): not AVIF`);
  }
  if (size > MAX_BYTES) {
    failures.push(`${image} (${title}): ${kb(size)}, over the ${kb(MAX_BYTES)} limit`);
  }
}

if (failures.length > 0) {
  console.error("Showcase images that need fixing:");
  for (const failure of failures) console.error(`  ${failure}`);
  console.error(
    `Convert the screenshot to AVIF of ${kb(MAX_BYTES)} or less, for example with Squoosh (https://squoosh.app/) or avifenc.`,
  );
  process.exit(1);
}
const scope = all ? "" : ` (added or changed since ${base})`;
console.log(`${targets.length} showcase image(s) checked${scope}, all OK`);
