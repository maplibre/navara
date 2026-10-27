// TypeScript 7 (the native Go compiler) no longer ships the JavaScript Compiler API
// (`require("typescript")` has no `createProgram`, `ModuleKind`, ...). typescript-eslint
// still requires it and declares `typescript: <6.1.0` as a peer, so it would be linked to
// the workspace's TypeScript 7 and crash. Give those packages their own TypeScript 6
// (`@typescript/typescript6` is the official side-by-side package) instead of the peer.
// Remove once typescript-eslint supports TypeScript 7.
const TYPESCRIPT6 = "npm:@typescript/typescript6@6.0.2";

const needsTypeScript6 = (name) =>
  name === "typescript-eslint" ||
  name?.startsWith("@typescript-eslint/") ||
  name === "ts-api-utils";

function readPackage(pkg) {
  if (needsTypeScript6(pkg.name) && pkg.peerDependencies?.typescript) {
    delete pkg.peerDependencies.typescript;
    if (pkg.peerDependenciesMeta) delete pkg.peerDependenciesMeta.typescript;
    pkg.dependencies = { ...pkg.dependencies, typescript: TYPESCRIPT6 };
  }
  return pkg;
}

module.exports = { hooks: { readPackage } };
