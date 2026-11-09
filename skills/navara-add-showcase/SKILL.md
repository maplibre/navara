---
name: navara-add-showcase
description: >
  Add a project built with Navara to the showcases page (/showcases): read the
  submission Issue, prepare the AVIF screenshot, transcribe the attribution, and
  insert the entry at the top of docs/src/data/showcases.json. Use when asked to
  add, update or remove a showcase, to handle a "[Showcase]" Issue, or to review
  a showcase Pull Request.
---

# Adding a showcase

The page itself (layout, submit button, issue form) is described in the
`navara-lp` skill, section "Showcases page". The contributor-facing steps live in
`docs/src/content/docs/{,ja/}guides/Community/showcases.md`; keep this skill and
that guide in agreement when the flow changes.

## Inputs: the submission Issue

Every showcase starts with an Issue from `.github/ISSUE_TEMPLATE/showcase.yml`
(label `showcase`). Read it with `gh issue view <n> -R maplibre/navara`.

- **Never add a site without that Issue.** The form's required checkboxes
  (permission to list it, and the project shows its own data attribution) are
  the consent record. A URL from anywhere else is not enough: ask for an Issue.
- **"I will open the Pull Request myself" checked:** the submitter does the work.
  The docs guide points submitters at this skill, so the agent may be working
  for them: then do every step below in their fork and open the PR. Working for
  a maintainer instead, review the submitter's PR against the rules below rather
  than opening a competing one.
- Fields: project name → `title`, URL → `href`, screenshot (required, any
  format), attribution (required, `None` when the project needs none).

## Entry in showcases.json

- **New entries go at the top of the array** (newest first), not the end.
- Shape: `title`, `href`, `image` (`showcases/<slug>.avif`, path under
  `docs/src/assets/`), optional `attributions` (`{ text, href? }[]`), optional
  `logo` (`"google-maps"` when the site uses Google Photorealistic 3D Tiles; the
  keys live in `LOGOS` in `docs/src/components/Showcases.astro`).
- `<slug>`: the repository or path name of the site (e.g.
  `navara-wind-visualization-demo`), lowercase with hyphens.
- `title` is the site's display name as the submitter gave it (or the page's
  `<title>`). It is not localized.
- **Edit the JSON by hand and keep its formatting.** `docs/` is outside the repo's
  `pnpm run format`, and running root prettier on the file reflows every
  existing entry. Short objects stay on one line, longer ones wrap, as in the
  file.

## Attribution

- Attribution `None` → omit `attributions`.
- Otherwise transcribe **verbatim**, and cross-check against the site's own
  attribution UI (`.navara-attr-item` rows inside `.navara-attr-card`; the list
  may only exist in the DOM after its info button is clicked). Where the two
  differ, the site's UI wins and the difference goes in the PR description.
- Drop the Navara self-credit. Split a row carrying several links so each credit
  keeps its own link. A credit sentence the provider prescribes as one unit
  (e.g. EOX's "Sentinel-2 cloudless … by EOX IT Services GmbH (contains modified
  Copernicus Sentinel data …)") stays whole with its primary link.

## Screenshot

Must be **AVIF, 150 KB or less**, square at about 1000×1000 (the largest
tile, the LP's three-per-row grid, is ~480 CSS px, so ~960 px at 2x).
Most scenes land at 30 to 120 KB with `avifenc -q 50`; dense particle or
point scenes run larger, so lower `-q` for those.
`pnpm -C docs showcases:check` (`docs/scripts/check-showcases.mjs`) fails on an
image that is missing, not `.avif`, or over the limit. It only checks the
entries added or changed since `--base <ref>` (default `origin/main`: an image
the base's `showcases.json` does not reference, or a file that differs from the
base, uncommitted edits included); `--all` checks every entry.
`.github/workflows/docs.yml` runs it on pull requests against their base
branch.

- Tiles are square (`object-fit: cover`), so a non-square image loses its
  edges: crop to the center square yourself and check the subject survives.
  Older entries are 16:10 and are center-cropped by the page.
- **From the Issue:** download the attachment (`gh issue view <n> --json body`,
  then `curl -L` the `user-attachments` URL into the scratchpad), crop to a square
  around the subject, resize to about 1000×1000, and encode with `avifenc -q 50` (lower `-q` until it
  is under 150 KB).
- **Capturing it yourself** (when the attached shot shows UI panels or is too
  small): headed Playwright with `--enable-gpu` at 1920×1200 (then crop
  the center square), hide everything
  that is not a canvas or a canvas ancestor
  (`body *:not(:has(canvas)):not(canvas){visibility:hidden}`) and clip to the
  largest canvas. Many sites run a camera tour, so take a burst of frames over
  ~40 s and pick one. Some sites only show a poster until a start button is
  pressed or embed the viewer in an iframe: shoot the viewer URL directly.
- Keep the source PNG in the scratchpad, not in the repo.

## Verify

1. `pnpm -C docs showcases:check`
2. `pnpm -C docs build` (a missing image throws here too).
3. Open `http://localhost:4321/docs/showcases/` under `pnpm dev:docs` (if an
   `astro dev` is already running, the command reuses it). The new tile is
   first, links to the site, its tooltip is the title, and the info icon lists
   the credits. Look at the screenshot: a center crop can cut the subject.

## Pull Request

Commit the AVIF and the JSON change on a branch, link the Issue (`Closes #<n>`),
and note any attribution differences from the Issue. From a submitter's fork,
push to the fork and open the PR against upstream
(`gh pr create -R maplibre/navara`). Before opening it, ask the submitter to
look at their tile on the local page.
