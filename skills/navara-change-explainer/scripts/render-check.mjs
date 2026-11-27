// Parses and renders every Mermaid diagram of an explainer page, and
// screenshots one section of it.
//
//   node render-check.mjs <page.html> [--section <css selector>] [--out <png>]
//
// Prints one line per diagram: its index and "ok" or the parse error. Exits
// with 1 when a diagram fails to parse.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(
  new URL("../../../web/navara_three/package.json", import.meta.url),
);
const { chromium } = require("playwright");

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};
const file = args[0];
if (!file) {
  console.error(
    "usage: render-check.mjs <page.html> [--section <selector>] [--out <png>]",
  );
  process.exit(2);
}
const section = option("--section");
const out = option("--out") ?? "render-check.png";

// The installed Chrome, as Playwright's bundled browsers are often missing.
const browser = await chromium
  .launch({ channel: "chrome" })
  .catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
await page.setContent(
  `<!doctype html><meta charset="utf-8">${readFileSync(file, "utf8")}`,
);
await page.addScriptTag({
  url: "https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.min.js",
});
const results = await page.evaluate(async () => {
  mermaid.initialize({ startOnLoad: false });
  const lines = [];
  let failed = false;
  for (const [index, element] of [
    ...document.querySelectorAll("pre.mermaid"),
  ].entries()) {
    try {
      await mermaid.parse(element.textContent);
      lines.push(`${index}: ok`);
    } catch (error) {
      failed = true;
      lines.push(`${index}: ERROR ${error.message}`);
    }
  }
  await mermaid.run({ querySelector: "pre.mermaid", suppressErrors: true });
  return { lines, failed };
});
console.log(results.lines.join("\n"));

const target = section ? await page.$(section) : undefined;
if (section && !target) console.error(`No element matches ${section}.`);
await (target ?? page).screenshot({ path: out, fullPage: !target });
console.log(`screenshot: ${out}`);
await browser.close();
process.exit(results.failed ? 1 : 0);
