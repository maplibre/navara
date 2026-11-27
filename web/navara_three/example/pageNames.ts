// Page-name rules shared by the Vite config, the scripts and the dev
// launcher, so this module must not import Node built-ins.

/** Whether a page is a curated gallery example, with an `ExampleMeta`. */
export const isGalleryExample = (name: string) => name.startsWith("examples/");

/**
 * Whether a page belongs to the curated gallery: its examples and the gallery
 * index. Every other page is a development or verification page with a
 * `DevPageMeta`.
 */
export const isGalleryPage = (name: string) =>
  name === "index" || isGalleryExample(name);

/**
 * URL name of a page outside `examples/`: dash-separated, with a trailing
 * "/index" collapsed to its parent ("dev/index" -> "dev").
 */
export const toDashUrlName = (name: string) =>
  name.replace(/\/index$/, "").replace(/\//g, "-");
