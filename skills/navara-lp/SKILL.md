---
name: navara-lp
description: >
  How the Navara marketing landing page is built and maintained: file layout,
  the config/copy/image split, theming, i18n, reveal-on-scroll, reusable
  components, and build/verify. Use when editing the LP (docs/src/components/
  LandingPage.astro), its copy or images, or adding LP sections/visuals.
---

# Navara landing page

The marketing LP is a single Astro component with a global `<style>` block, driven
by data files for theme/config, copy, and images. Design reference:
`design_handoff_navara_landing_page`.

## Files & the three-way split

- `docs/src/components/LandingPage.astro` — the whole page (markup + `<style is:global>` + reveal/showcase scripts). Rendered per locale by pages that do `<LandingPage locale="..." />`.
- `docs/src/components/LpHeader.astro` — the site header, **shared with the docs site and the brand assets page**: `variant="lp"` (fixed/transparent, frosts via `lp-header-solid` toggled by LandingPage's script, carries the `?color` switcher markup — its behavior script stays in LandingPage), `variant="site"` (the same fixed header, frosted from the start, for other site-root pages; pass `sitePath` so the language switcher lands on the same page) and `variant="docs"` (Starlight `Header` override wraps it, inside Starlight's header shell, with a `search` slot; its LP vars are pinned from `--nv-navy`/`--nv-cream` set in `docs/src/styles/theme.css`). Header markup/styles/lang-select script live here, not in LandingPage. **The brand logo always links to the LP** (`/` or `/<locale>/`) in every variant; on the LP the link itself is `visibility: hidden` until `lp-header-solid`, so it stays out of the tab order while the hero lockup carries the branding. The examples gallery mirrors the same design in React (`web/navara_three/example/components/SiteHeader.tsx`, logo linking to the LP via `siteUrl(lang)`).
- `docs/src/components/LpFooter.astro` — the site footer (Docs / GitHub / Discord / Brand Assets + license credit), **shared by the LP and the brand assets page**. Transparent and unpositioned by itself: the LP lays it over the closing globe still (`.lp-close .lp-footer { position: absolute }` in LandingPage), the brand assets page sits it on its primary canvas under a `--line-dark` hairline. The examples get the same links (and hairline) from `web/navara_three/example/components/SiteFooter.tsx`; the docs site links to the brand page from the guide instead (`guides/Community/brand-assets.md`, en + ja), not from its footer.
- `docs/src/components/lp-shared.ts` — what the LP, brand assets page, header and footer all need: `ROOT_LOCALE`/`DOCS_LOCALES`, `DOCS_BASE`, the `lp-locales` loader (`getLpLocale`), `docsHref(locale, href)` (docs-internal links: base + locale segment), `siteHref(locale, path)` (site-root pages that exist per locale: the LP is `""`, the brand page `"brand-assets/"`) and `lpRootStyle` (the theme as the `<html>` inline style). `docs/src/styles/lp-base.css` holds the theme-derived custom properties (`--ink*`, `--on-dark*`, `--line*`, `--on-band*`, `--lp-safe-*`), the `body` canvas, `.lp a` link defaults and `.lp-container`; both pages import it, the LP's own `<style is:global>` starts after it.
- `docs/src/data/lp.json` — **theme colors, image slots, external links** (not copy). Colors: `primary`/`accent`/`sub`/`maplibre` (fed as CSS vars `--pri`/`--acc`/`--sub`/`--ml`; the derived `--ink*`/`--on-dark*`/`--line*` vars come from these). `themeVariants` lists candidate primary/sub/accent sets (verbatim from the design palette sheet) for the header preview switcher, revealed only by `?color` in the URL (`?color=<name>` preselects one). Switching rewrites `--pri`/`--sub`/`--acc` at runtime; roles a candidate can't fill without losing contrast fall back to plain black/white via `--pri-ink` (always-dark ink/scrim source, = `--pri` normally), `--on-band` (text on `--pri` bands) and `--on-acc` — and a synthetic resize re-samples the adaptive gallery inks. `images.<slot>.src` is a **repo-root-relative** path into `docs/src/assets` or `web/navara_three/example/public/screenshots`, resolved by `resolveImage`.
- `docs/src/data/lp-locales/<locale>.json` — **all copy**, per locale. `en` is `ROOT_LOCALE` (served at `/`, others under `/<locale>/`). Image **alt text lives here**, in `imageAlts` keyed by the lp.json slot id (a missing alt throws at build).

To add a locale: add its `lp-locales/<code>.json` and a page rendering `<LandingPage locale="code" />`.

## Conventions

- **Never hardcode copy or colors in the component** — copy → locale JSON, theme → `lp.json`. Markup pulls both via `t.*` and the `--pri/--acc/...` vars.
- **Copy style: no dash decorations, no semicolons.** LP copy (and alt text / meta strings) never uses em/en dashes, ` - ` parentheticals, or `;` clause joins — write full sentences with commas, colons, or splits, and avoid stacked "and"s (prefer "from A and B to C and D, then …"). Sole exception: showcase tile names keep an ASCII `-` separator (they are the sites' official display names). The docs site follows the same rule — see `docs/guide/WRITING_RULES.md` ("Prose style").
- **`meta.description` is the hero copy, compressed** — the intro panel's first two sentences (definition + data range), without the third. The hero's third sentence is the extension ladder (declarative → plugins → custom representations), deliberately prefiguring the tier showcase below: keep it an escalation, never a restatement of sentence two. When the hero copy changes, re-derive the description.
- **Images** go through slots: define in `lp.json`, alt in every locale's `imageAlts`, reference with the `src(id)` / `alt(id)` helpers. Prefer AVIF for photos.
- **Reveal-on-scroll:** mark elements `data-reveal` (individually) or a container `data-reveal-group` (staggers children via `--rd`/`--rd-base`). Hidden states only exist under `prefers-reduced-motion: no-preference`, so reduced motion is a no-op. Don't reinvent entrance animation — reuse these hooks. **Never put `loading="lazy"` images inside a reveal element**: the reveal gates on `decode()` of every image inside, which never resolves for a lazy image still outside the viewport (e.g. off to the side in a scroller/marquee) — the element stays invisible forever.
- **Showcase grid (`.lp-showcase-grid`):** the gallery strip's third grid (tutorial → example → showcase), not a section of its own: square tiles, three per row (keep the item count a multiple of three so the full-bleed rows stay even), built from the `showcase-*` slots in `lp.json` (numeric order; `href` = the site's URL) — add/remove slots there plus `imageAlts` in every locale (the alt doubles as the hover title, so it's the site's display name). Screenshots live in `docs/src/assets/showcases/<repo-name>.avif` (PNG originals sit beside them, unreferenced so not bundled). The sticky side label crossfades TUTORIALS → EXAMPLES → SHOWCASES with one IntersectionObserver per grid, deepest intersecting grid wins (the example grid is still partly on screen while the label sits over the showcase grid). The label overlay carries no links ("See more" was dropped) and stays `pointer-events: none` throughout, so clicks fall through to the tile underneath. `.lp-gallery-side`'s `top` clamps the sticky label's start so its BOTTOM first sits one bottom-gap above the first tile's bottom edge and never rides higher: `top: calc(<.lp-tile-wide height> - var(--side-h) - <gap>)`, where `--side-h` is the label block's height, measured by script (vertical text — depends on font and wording; re-measured on webfont load and resize). The tile-height and gap terms must stay in sync with `.lp-tile-wide` and the label's bottom offset at each breakpoint. Showcase tile credits live in `SHOWCASE_ATTRIB` (keyed by slot id, not `TILE_SOURCES`): they are extracted **verbatim from each site's own Navara attribution UI** (scrape `.navara-attr-item` on the live site, drop the Navara self-credits, split rows that carry several links so each credit keeps one link) — re-extract when a site's data changes or a new site is added. `GalleryTile` hides the attribution icon while a tile's credit list is empty.
- **Theme-derived tints:** use `color-mix(in oklab, var(--pri), white NN%)` (matching the existing `--ink*`/`--line*` derivations) rather than raw hex, so a theme change in `lp.json` propagates.
- **Deployment:** the LP builds at `/docs/lp/` (the Astro build uses `base: "/docs"`) and `scripts/assemble-site.mjs` relocates it to the site root of https://navara.world/ (`/` and `/ja/`). In `astro dev`/`preview` it is served at `/docs/lp/`. **Pre-release:** it carries `<meta name="robots" content="noindex,nofollow">`; leave that until release.
- **Code snippets (`.lp-hello` HELLO WORLD section):** the snippet is language-agnostic, so it lives in the component frontmatter (`helloCode`), not the locale JSONs — explanations stay in localized copy, code comments in English. Rendered with Astro's `<Code theme="css-variables">`; the `--astro-code-*` vars on `.lp-hello-code` map Shiki onto the LP palette so a theme change propagates. Every API call must be real (it's a TileJSON-based variant of the docs' Getting Started example — the TileJSON document supplies tile URL, zoom range, and attribution); verify against the docs before editing.
- **Phone gutters are 20px for every band** — keep section padding uniform so
  headings line up down the page; if a visual needs the extra width (the
  `.lp-arch` diagram), let *it* break out with negative margins instead of
  shrinking the section's padding.
- **Stills bake in the example's own attribution button** (bottom-right). Where
  the LP overlays its own `ImageAttribution` the baked one must be cropped away
  — `.lp-hello-visual img` is oversized (`height: 106%`) so the frame clips that
  band at every aspect ratio; don't crop the shared asset, docs pages use it.
- **MapLibre section is parked** behind `SHOW_MAPLIBRE = false` in the component frontmatter (copy and image slots kept); flip to true to bring it back.
- **`.lp-arch` line-art SVGs are inlined** (`?raw` + the `archSvg` helper, classes land on the `<svg>` so the img-era sizing rules still apply) and re-themed by CSS attribute selectors keyed to their baked hexes (`#F4F3EF` → `--sub`, `#090C11` → `--pri-ink`, `#C9C9C9` graticule). Re-exporting those SVGs must keep exactly those values, or the selectors in `LandingPage.astro` must be updated with them.

## Reusable components

- **`docs/src/components/ImageAttribution.astro`** — data-attribution overlay: an info icon that reveals a per-source credit list on hover/focus (no plate, never overflows). Props: `items: string[]`, `label`, `corner` (`br`/`bl`/`tr`/`tl`), `class`. Drop inside any `position: relative` image wrapper. Use it for **any** credited image, not just the LP. Source the credit strings from `web/navara_three/example/helpers/constants.ts` `attribution` fields (+ a basemap tilejson's own credit).

## Brand logo & favicon

- Logo files live in `docs/public/logo/{svg,png}/{black,white}/<ink>_Navara_{Horizontal,Vertical}_logo.<ext>` (served at `/docs/logo/...`, also the downloads on the brand assets page), mirrored verbatim in `web/navara_three/example/public/logo/`. The SVGs are the delivered Illustrator exports with the `<metadata>` (`<i:aipgf>` round-trip block, ~97% of the file), the `<defs><style>` block, the invisible artboard `<rect>` and the Illustrator root attributes stripped — white variants get `fill="#fff"` inline, black ones carry no fill. **Their viewBox is kept as delivered** (it includes the clear space around the mark, matching the PNGs). If the assets are re-delivered, redo that cleanup (a Playwright script works: strip, then `getBBox()` the result) and re-measure the tight boxes below.
- In-page uses inline the **black** variants and crop them to the mark: `docs/src/components/brand-logo.ts` (`logoSvg("horizontal" | "vertical", className)`) swaps the viewBox for the measured tight content box (`59.5 58.9 681.5 118.7` horizontal, `57.3 57.1 335.9 205` vertical) and adds `role="img"`; since the paths carry no `fill`, CSS `fill: currentColor` re-inks them per surface. `.lp-hero-logo` is the vertical lockup centered over the hero video, `.lp-brand` the horizontal one in the header (inside the `.lp-brand-home` link). The examples header instead points an `<img>` at the delivered **white** horizontal SVG (`web/navara_three/example/components/SiteHeader.tsx`) and cancels the clear space with a negative margin, since that header is always on navy. `.lp-video-blocked` clears the hero lockup so the fallback play button gets the center.
- The favicon is the delivered white-bird-on-black-square mark, present as `favicon.png` (72×72, the referenced one) and `favicon.svg` (cleaned like the logos; kept but unreferenced) in both `docs/public/` and `web/.../example/public/`. Three places point at `/favicon.png`: the LP `<head>`, Starlight's `favicon` option in `docs/astro.config.mjs`, and the example's `template.html` (injected into every generated page).

## Brand assets page

`docs/src/components/BrandAssets.astro` (rendered by `docs/src/pages/{,ja/,az/}brand-assets.astro`, one per LP locale) is the LP-styled page behind the "Brand Assets" footer links, modeled on maplibre.org/brand-assets, on a **single `--pri` canvas** (every text role is an on-band one, `--sec`/`--acc` are set inline from `brand.palette` so links rest in the brand secondary and hover to the accent, cards take the `--line-dark` hairline): a centered title block under the `variant="site"` header (no eyebrow labels anywhere on this page), then one Logos section with the horizontal and vertical lockups as two unlabeled tile rows (the locale's lockup names are alt text only), each on two surfaces (primary / white, no secondary tile, SVG + PNG `download` links per tile), the two typefaces as specimen cards, and the palette swatches captioned with name and hex only (caption ink picked from the swatch luminance), closing with `LpFooter` under a hairline.

- **Data split as on the LP:** the palette (`primary #143c6e`, `secondary #c8ebfa`, `accent #faf0c8`, verbatim from the brand color sheet) and the font list live in `lp.json` under `brand`; every string (meta, headings, format labels, color names, font samples) lives in each locale's `brand` block, the footer label in `footer.brandAssets`. The page throws on a missing name/sample like the LP does on a missing alt. **No captions or notes under headings or tiles** (no "On primary", no "for narrow placements"): the visuals speak, only the lead under the title stays. Note the LP's own `colors.accent` (teal) is a separate, older choice — the brand page shows the brand palette but is themed with the LP theme like every other page.
- **Deployment:** built at `/docs/brand-assets/` (and `/docs/<locale>/brand-assets/`); `scripts/assemble-site.mjs` relocates it to `/brand-assets/` and `/<locale>/brand-assets/` (its `SITE_PAGES` list — add new site-root pages there). Links to it use `siteHref(locale, links.brandAssets)` / `siteUrl(lang, "brand-assets/")`, i.e. production paths (in `astro dev`/`preview` open `/docs/brand-assets/` directly).
- Styles are page-scoped under `.lp-ba-*` (the LP's section CSS is not shared, only `lp-base.css`); the eyebrow/heading pairing repeats the LP's at one step smaller (h1 56/44/36px, h2 40/34/30px across the 960/640 breakpoints), gutters are the LP's 48/28/20px.

## Build & verify

- `cd docs && pnpm build` (whole docs site) — LP copy/image errors surface here (missing alt, missing image, unknown slot).
- Verify interactive bits headlessly (Playwright against `pnpm preview`): reveal-on-scroll, the tier showcase cross-fade + synced list/caption highlight, the attribution tooltip. **Look at the screenshots** — a clean build can still be visually wrong.
- After Rust/WASM-adjacent changes elsewhere, also run repo-root `pnpm run build:example`, `format`, `lint`.

## Hero video

The hero is the looping promo video (assets in `docs/public/promo/`: desktop +
SP H.264 encodes, AVIF posters of the video's first frame; produced per the
`navara-promo-video` skill). Implementation lives in `LandingPage.astro`
(markup near the top, script mid-file, styles by `.lp-hero`). Hard-won
invariants — do not regress these:

- **iOS never fires `loadeddata` (or decodes a frame) until playback starts**,
  so nothing may gate on it. The fade-in-then-play sequence *primes* instead:
  muted `play()` while the video is transparent, first `playing` event →
  pause + rewind + fade the static first frame in over the poster →
  `play()` again on `transitionend` (with a timeout fallback).
- Autoplay is refused in iOS Low Power Mode and cannot be forced; a
  tap-initiated `play()` still works — a centered play button appears via the
  `lp-video-blocked` class whenever the video is stopped unexpectedly.
- Exiting fullscreen pauses the video, and iOS can pause again *after* a
  successful programmatic resume (teardown race) — so the resume path retries
  and then verifies `paused` before falling back to the play button. The
  deliberate priming pause is excluded from that watchdog
  (`fadeRestartPending`).
- SP (≤640px) picks the smaller encode via `matchMedia`, crops center with
  `object-fit: cover`, and shows a bottom-right fullscreen button
  (`webkitEnterFullscreen` fallback for iPhones without
  `video.requestFullscreen`).
- Reduced motion keeps the AVIF poster; no video src is ever set.
- **Video credits are overlaid, not baked, and scene-synced**: the credit line
  baked into the video's bottom ~3.3% is force-cropped at every aspect ratio —
  poster and video are oversized (`height: 104.5%`, clipped by the hero's
  `overflow: hidden`; cover alone only crops vertically on wide windows, so a
  16:10 window would otherwise show the baked line under the overlay) — and
  the hero
  renders one `ImageAttribution` block per scene (`heroScenes` in the
  frontmatter — credits + `end` boundary in seconds, read off the published
  cut's frames) and a `timeupdate` handler swaps them with playback; past the
  last boundary (the loop-closing still = the dive's first frame) it wraps to
  the first block, which is also the no-JS/reduced-motion state matching the
  poster. The Google logo rides only the Photorealistic-3D-Tiles scenes, whose
  credit list transcribes the per-tile copyright line baked into those frames
  (Google / Landsat / Copernicus / Data SIO… / Airbus for the current cut) —
  read it from the frames, not from the shot code, which only registers the
  static baseline. **Re-cutting the promo means re-reading `heroScenes`
  boundaries and credits from the new take** (extract 1 s frames with ffmpeg;
  zoom the bottom strip for the Google line). Generic
  `.lp-hero img` CSS must stay scoped to `picture img`, or it swallows the
  overlay's logo.
- **`.lp-hero` must keep `overflow: hidden`.** The opening animation
  (`nv-hero-in`) holds the full-viewport poster at scale ~1.045 for 3s;
  unclipped, that widens the document's scrollable area and Chromium keeps the
  stale horizontal scrollbar even after the animation ends (it only clears on
  the next relayout, e.g. scrolling into the reveal sections).
- **Verify on a real iPhone** (`pnpm dev:docs --host`), including Low Power
  Mode on/off — desktop Chromium allows muted autoplay everywhere and cannot
  reproduce any of the above.

## Mobile viewport units and page ends

Desktop Chromium has no dynamic toolbar, so none of this reproduces there —
these were all found on an iPhone.

- **Covering elements use `lvh`, content bands use `svh`.** The first scroll on
  iOS is spent collapsing the toolbar, which grows the viewport from `svh` to
  `lvh`: a sticky hero sized `100svh` uncovers a strip of page background under
  the video exactly while that happens. `.lp-hero` is `100lvh` and publishes
  `--lp-toolbar-h: calc(100lvh - 100svh)`, which its bottom-anchored chrome
  (scroll cue, fullscreen button) adds back so it stays inside the smaller,
  toolbar-shown viewport it is first seen in. `min-height` bands (`.lp-hello`,
  `.lp-outro`) keep `svh` — they must fit the *smaller* viewport.
- **A pin line that must hug the bottom edge uses `dvh`.** `.lp-intro` sticks at
  `calc(100dvh - var(--lp-intro-h))`: with `svh` the panel stops a collapsed
  toolbar's height short of the bottom and leaves a strip of bare video under it,
  with `lvh` it is cut off while the toolbar is out. Only `dvh` follows the
  viewport that is actually on screen.
- **`viewport-fit=cover` + `--lp-safe-*`.** The meta viewport opts into the
  full screen so the full-bleed media (hero video, closing globe still) reaches
  the physical edges on notched phones — without it iOS insets the layout
  viewport and the closing band's image stops short of the bottom. `svh`/`lvh`
  then include the safe areas too, which is what makes the `lvh` hero cover the
  home-indicator strip. Everything that hugs an edge pays the inset back through
  `--lp-safe-l/r/b` (`env(safe-area-inset-*, 0px)` named on `:root`): the header
  and `.lp-container` for the landscape notch, `.lp-intro`, `.lp-footer` and the
  hero's bottom chrome for the home indicator. Because they are custom
  properties, a desktop browser can simulate a notch — append
  `:root{--lp-safe-l:47px;--lp-safe-r:47px;--lp-safe-b:34px}` **to `<body>`**
  (the LP's own `<style is:global>` lives there, so a `<head>` tag would lose
  the cascade).
- **The page can never paint iOS Safari's toolbars — only tint them.**
  `viewport-fit=cover` reaches the display's safe areas, not the browser chrome,
  so "extend the closing image under the URL bar" is not achievable; matching the
  color is. Safari tints its bars from `<meta name="theme-color">` (falling back
  to the page background), so both that meta and the canvas are the closing
  band's `--outro-bg` black, and the bottom reads as one surface.
- **`body`'s background is the document canvas** (`html` sets none), so it shows
  through the sub-pixel remainder of a fractional-height page, during overscroll,
  and as that toolbar tint. It is `--outro-bg` (black, hoisted to `:root`) — a
  light canvas showed as a ~1px white hairline under the closing band on iOS, and
  a `--pri` one as a navy seam below it. Every band paints
  its own background (`.lp-main` carries the light one).

## References

- **[references/scene-tiers.md](references/scene-tiers.md)** — the "4 API tiers, 1 engine" showcase (`.lp-api-stage`: cross-fading stills behind a bottom-right editorial open-circle ring — Declarative core, Plugin/API/Shader on the ring): building the fixed-camera, multi-look capture page (`web/navara_three/example/pages/lp-tiers/`), the four look recipes, night FogLight tuning, real OSM street lamps, and the capture→AVIF→slots workflow. Read this before creating or re-shooting those stills.
