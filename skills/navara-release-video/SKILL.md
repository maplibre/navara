---
name: navara-release-video
description: >
  Make the short SNS promotion video for a Navara release: pick the visible
  changes since the previous tag, record one clip per feature from example
  pages, and join them with crossfades ending on the Navara logo. Use when
  asked for a release video, promo clip, or feature reel.
---

# Release promotion video

The video shows pictures only: the release notes and post text carry the
explanation. It is one clip per feature, crossfaded, ending on the Navara logo.

Tools: `pnpm navara_three record-clip` (`web/navara_three/scripts/record-video-clip.ts`)
records a page; [`compose.sh`](compose.sh) joins clips. Both need `ffmpeg`.

## Hard rules

- **No text in the picture.** No title card, captions, feature names, or closing
  call to action. The recorder hides every page UI element (panels, sliders,
  stats). Map labels are fine when labels are the feature; otherwise prefer a
  scene where the basemap labels are not the focus.
- **Start on the first feature, end on the logo.** `compose.sh` appends the
  logo card; add nothing after it.
- **Attribution is always on screen** as the black band in the bottom-right
  corner, rendered live from the page's `AttributionPlugin` (see below).
- **Keep it quick.** 3 to 3.5 s per clip, 0.35 s crossfades, 2 s logo, 30 s or
  less in total. Cut a weak feature rather than lengthen the video.

## 1. Collect the changes

```bash
prev=$(git describe --tags --abbrev=0 HEAD^)   # previous release tag
git log --oneline "$prev"..HEAD
```

Also read that release's section of `CHANGELOG.md`. Keep `feat` items and
`fix` items that change what users see. Drop perf, CI, dependency, test, and
internal changes. Merge related small features into one scene (e.g. letter
spacing, text outline, line height, and anchors become one labels shot).

## 2. Write the shot list

Before recording, write a table: feature, page, kind (**motion** or **look**),
camera move, data sources to credit.

- **motion**: the camera travels or the scene animates (flight, orbit, flowing
  water, animated values).
- **look**: the point is the appearance (styling, colors, labels); camera is
  still or drifts very slowly.

Ordering:

- Open with a strong motion shot.
- Never more than two of the same kind in a row; alternate when possible.
- Treat the clip sequence like the gallery lineup in
  [navara-add-example](../navara-add-example/SKILL.md) "Judging gallery
  thumbnails as a lineup": alternate light and dark stages and avoid
  near-identical compositions next to each other. Two light scenes in a row
  also wash out during the crossfade.
- The last clip before the logo should be a strong shot, not a filler.

## 3. Prepare scenes

**Scene design follows [navara-add-example](../navara-add-example/SKILL.md)
"Gallery visual conventions"**: neutral grayscale stage (dark globe color under
a dark basemap), one vivid accent per state, lights only for lit content with a
fixed UTC `atmosphere.date`, the subject filling the frame, varied camera
angles across the video, and animation advanced by wall-clock time. Frame for
the 1920×1080 video rather than the 1200×750 thumbnail, so screen-space sizes
(labels, pins) may need scaling up.

Prefer existing pages (`/demo/<section>/<name>` for curated examples, dash
URLs for the others) when they already meet those conventions; dev and debug
pages often do not (busy basemaps, debug colors), so rebuild those scenes as
scratch pages. The recorder can move the camera on any page through real
pointer input with `--move`:

| `--move` | Input | Use |
|---|---|---|
| `orbit:<px>` | right drag sideways | turn around the screen center (`-900`..`900`) |
| `tilt:<px>` | right drag vertically | change pitch |
| `pan:<dx>,<dy>` | left drag | slide the globe |
| `push:<delta>` | wheel | zoom in; very sensitive, 50 to 150 for a slow look shot, about 400 for a clear zoom |

The move runs at constant speed for the whole clip.

When a scene needs exact choreography or a page with different data, write a
scratch page in `web/navara_three/example/pages/release-video/<scene>/main.ts`
(gitignored; URL `/release-video-<scene>`). Restart the dev server after adding
one, since pages are discovered at startup. Write it like a gallery example
(the conventions above, `AttributionPlugin` credits, `initializeExample(view)`
as the last line), and start motion when the recorder posts its start message
so the first frame matches the settled scene:

```ts
const shot = { lng: 7.66, lat: 45.98, height: 700_000, heading: 0, pitch: -90, roll: 0 };
view.setCamera(shot);

window.addEventListener("message", (event) => {
  if (event.data?.type !== "navara-record:start") return;
  const start = performance.now();
  const tick = (now: number) => {
    const t = (now - start) / 1000;
    view.setCamera({ ...shot, height: shot.height - 25_000 * t, heading: 2 * t });
    if (t < 6) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
```

Drive the camera per frame from elapsed time as above. Avoid `flyTo` with
easing, which starts and stops visibly inside a 3 s clip.

## 4. Attribution

The recorder opens the attribution popover and restyles it into the band, so
the band shows exactly what the plugin lists at each frame. Never draw credits
in post-production: they would not follow the data that is actually on screen.

- Every external dataset in the scene must be registered with
  `view.attribution?.add(...)`; reuse the entries in
  `example/helpers/constants.ts`. The recorder fails when the band is empty;
  pass `--no-attribution` only for scenes without external data.
- **Google Photorealistic 3D Tiles** need both of these:
  - The Google Maps logo, via `logo: \`${import.meta.env.BASE_URL}credits/GoogleMaps.png\``.
    The plugin shows it in the bottom-left frame and the recorder keeps it
    there. Do not crop, scale, cover, or recolor it, and do not frame the shot
    so that it sits on a busy area.
  - The per-tile data provider credits, via `creditLayerId: tiles.id`. They
    change with the area in view, so the band text changes while the camera
    moves; that is expected. Check the band on the last frame as well as the
    first.
- Basemaps (OpenStreetMap, OpenFreeMap, GSI, PLATEAU, terrain) follow the same
  pattern; the band may wrap to two or three lines when there are many credits.

## 5. Record

Start the dev server (`cargo make web`, release WASM). Then, per shot:

```bash
pnpm navara_three record-clip /demo/terrain/exaggeration \
  --out <dir>/02-terrain.mp4 --duration 3.5 --settle 6 --move orbit:-900
```

- `--settle` waits after the scene-loaded signal for tiles to finish
  streaming; raise it (10 to 30 s) for 3D Tiles and photorealistic scenes.
- Set `SERVER_URL=http://localhost:<port>/examples` when the server is not on
  5173.
- Chromium opens a visible window so WebGL runs on the GPU; leave it alone
  while recording. The log prints the captured frame rate: a still scene shows
  very few frames (it only repaints on change), and a moving scene well below
  30 fps means the scene is too heavy for a smooth clip.

## 6. Compose and review

```bash
skills/navara-release-video/compose.sh -o <dir>/navara-vX.Y.Z.mp4 <dir>/01-*.mp4 <dir>/02-*.mp4 ...
```

Output is 1920×1080, 30 fps, H.264, silent (music is added when posting).
`FADE` and `LOGO_HOLD` env vars override the 0.35 s crossfade and 2 s logo.

Review a contact sheet, not single frames:

```bash
ffmpeg -i <video> -vf "fps=1,scale=480:-1,tile=6x4" -frames:v 1 sheet.png
```

Check that: no text or UI appears outside the band; every clip has its band
(and the Google logo where Google tiles are used); no clip shows blank or
half-loaded tiles; each scene meets the gallery visual conventions; motion
and look alternate, as do light and dark stages; the total is 30 s or less.
