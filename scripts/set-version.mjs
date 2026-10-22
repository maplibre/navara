// Stamp a single version into every publishable @navaramap/* package.
// All Navara packages are released in lockstep, so the version passed in
// (usually derived from a `vX.Y.Z` git tag) is applied to every package.
// Includes the tracked web/wasm/*/package.json manifests of the WASM packages.
//
// Usage: node scripts/set-version.mjs <version>
import { existsSync, globSync, readFileSync, writeFileSync } from "node:fs";

const version = process.argv[2]?.replace(/^v/, "");
if (!version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z-.]+)?$/.test(version)) {
  console.error(`Usage: node scripts/set-version.mjs <version> (got: ${process.argv[2]})`);
  process.exit(1);
}

const packageJsonPaths = globSync(["web/*/package.json", "web/wasm/*/package.json"]);
let stamped = 0;
for (const path of packageJsonPaths) {
  if (!existsSync(path)) continue;
  const pkg = JSON.parse(readFileSync(path, "utf8"));
  if (!pkg.name?.startsWith("@navaramap/") || pkg.private) continue;
  pkg.version = version;
  writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`);
  console.log(`${pkg.name} -> ${version}`);
  stamped++;
}

if (stamped === 0) {
  console.error("No packages stamped.");
  process.exit(1);
}
