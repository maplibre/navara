# Line Placement

How text labels and sprites are placed along line geometry
(`placement: "line" | "line-center"`, MapLibre's `symbol-placement`): where
the anchors go, how the gap between repeats holds in screen pixels, how a label
is bent along its line, and how each pass decides which labels to show. For the
batched text mesh these labels are drawn with — the label texture, glyph runs,
quad orientation — see [TEXT_BATCHING.md](TEXT_BATCHING.md); for the placement
pass that calls into this one, see [DECLUTTER.md](DECLUTTER.md).

## Overview

The work is split by when each answer can be known:

| Stage | Runs | Decides |
| --- | --- | --- |
| [Parse](#parse-time) | once per tile, Rust | anchors, their scale bands, each text anchor's sampled path |
| [Upload](#upload) | once per batch, TypeScript | the path texture and the `PATH` label row |
| [Per pass](#per-pass) | at the declutter pass's cadence, WASM | in band, fits, flip, max angle, collision box, repeats |
| [Draw](#drawing-along-a-line) | every frame, vertex shader | where each word sits on the path |

## Parse time

`crates/navara_parser/src/line_placement.rs`, called from the MVT and GeoJSON
parsers. `LinePath::anchors` places anchors at **nested levels**: level `l`
repeats every `finest · 2^l` along the line, centred on its midpoint, and each
level's positions are a subset of the finer one's, so zooming out only drops
anchors, never moves them. The midpoint belongs to every level and is the only
anchor of `line-center`. Each anchor carries a **scale band**, the `(min, max]`
ground metres per pixel over which its level is the one shown, so the on-screen
gap stays between one and two `spacing`.

Text anchors are *banded*: a position gets one anchor per level it belongs to
(its "stack-mates", adjacent instances with an identical anchor), each with a
path sized for its own level. Each text anchor also carries `PATH_SAMPLES` (32)
east/north metre offsets from the anchor, neighbours a uniform straight
**chord** `step` apart across twice its level's spacing and extrapolated past
the line's ends, plus `(step, metres of real line either side)`. Plain points in
the same group get a zero step and an always-shown band.

The frame is conformal with y growing southward: MVT tile units, or Web
Mercator for GeoJSON. `finest` is `spacing · extent/512 / 2^FINER_LEVELS` tile
units for MVT, so levels reach two zooms past the tile's own, and
`spacing · 0.15 m/px / cos(lat)` for GeoJSON. Metre conversions use each
anchor's own `meters_per_unit`.

Polygons feed the same emitters. With an along-line placement every ring is
walked as a line, skipping the edges tile clipping cut; otherwise text and
billboards label a polygon once at its pole of inaccessibility
(`navara_geometry::pole_of_inaccessibility`), and point markers take every ring
vertex. An MVT anchor that lands in the tile's buffer is dropped, since the
neighbouring tile labels its own piece of the line.

With the default `"point"` placement a line string is resolved the same way
(`PointPlacement::line_anchors`, mirroring `polygon_anchors`): point markers
take every vertex, while text and billboards label it once at its first vertex,
as MapLibre's `symbol_layout.ts` anchors a point-placed symbol on a LineString.
In an MVT tile that first vertex is where the tile's clipped piece starts, so
it is dropped when it lies in the buffer (`emit_label_point`, shared with the
polygon label point): there the tile cut the line, and the tile holding the
line's real start labels it.

## Upload

The path texture (`uPathData`) is a second `LabelDataTexture` with
`PATH_SAMPLES / 2` texels per slot (two samples per RGBA texel), sized by the
label count like the label texture. A label's own slot addresses its path run, so there is no second
allocator; `PATH.x` is that run's first texel and `PATH.y` the sample step (see
the row table in [TEXT_BATCHING.md](TEXT_BATCHING.md#the-label-data-texture)).
`NVR_LINE_PLACEMENT` and `PATH_SAMPLES` are injected as defines only when the
engine actually sent a path, derived from the data's stride, and both are part
of the program cache key. The batch keeps the path (`_path`) apart from its
positions, since a terrain-height update re-sends positions without it. The
`spacing` the bands were built for is fixed per batch.

## Per pass

`placeLineLabels`, called by `DeclutterManager` before it collects candidates,
whether or not the layer declutters. Only along-line labels that could become
declutter candidates (visible batch, shown, shaped text) are judged; this
filter relies on the same dirty-marking as `collectDeclutterCandidates`, so the
two predicates must stay identical. The Rust kernel
(`crates/navara_wasm_api/src/line_label.rs`) mirrors the vertex shader's sizing
and runs in two phases:

1. `lineLabelFit`, over a compact row with no path samples: the anchor's level
   must be the one on screen (the requested spacing stretches when the label is
   longer than about ¾ of `spacing`, as MapLibre does), and the text's reach
   from the anchor must fit within the real line and the sampled span. Most
   labels on a dense view fail here, so their paths never cross the boundary.
   The reach, the length and the box's ends are all the glyphs' ink
   (`LabelLayout.minXEm`/`maxXEm`) measured from the shader's `-cx·w` origin,
   not the advance width: a glyph can overhang its advance, and it is the ink
   that has to stay on the line and inside the box.
2. `lineLabelPlace`, for the survivors with their paths (a `Straight` label,
   which does not bend, gets only the box of its turned block): the flip, the
   `maxAngle` test (the turn summed over a sliding window of about 1.5 em, at
   least two turns, must stay under the limit), and the rotated screen-axis box
   (`path_box`, built segment by segment the way the shader places words, in
   the font size's units around the anchor). Each corner is projected as a 3D
   point at its own depth (`ViewFrame::project_offset`), as the shader's
   projection draws it, so the end of a word running toward a pitched camera
   claims the larger space it is drawn in. It repeats the fit test rather
   than trusting phase one.

Then `findRepeatedLabels` (in `linePlacement.ts`) drops a label whose text
already has an accepted anchor in the batch closer than half the spacing,
keeping the first in anchor order. It runs last, so a label rejected for its
angle cannot have hidden its neighbour first. Results land in `PATH.z` / `.w`
and in `_lineBoxes`, which `collectDeclutterCandidates` uses in place of the
unrotated block.

## Drawing along a line

How a label with a non-zero `PATH.y` is drawn depends on its resolved facing,
`rotateWithCamera` and `spreadGlyphs`, the three MapLibre folds into
`text-rotation-alignment` and `text-pitch-alignment`. The four layouts are
`LineGlyphMode` in `linePlacement.ts` (`GlyphMode` in the kernel, which reads
it from the label row):

| mode | when | right | up | MapLibre |
| --- | --- | --- | --- | --- |
| `Ground` | flat, `!rotateWithCamera` | path tangent | ground normal (tangent turned 90° left) | `map` / `map` |
| `ScreenTangent` | upright, `!rotateWithCamera` | the segment's direction on screen | its screen perpendicular | `map` / `viewport` |
| `FacesCamera` | `rotateWithCamera` and `spreadGlyphs` | `nvr_quadBasis`, rotation 0 | | `viewport-glyph` |
| `Straight` | `rotateWithCamera`, no `spreadGlyphs` | `nvr_quadBasis` | | `viewport` |

A `Straight` label is not bent at all: the shader sets `nvr_alongLine` false
for it, so it lays out as a point label at its anchor, background and
`rotation` included, while `PATH.w` still culls it until placed. The kernel
judges only its scale band, never flips it, and boxes its block with
`quad_screen_basis`, as `lineAnchorPlace` boxes a sprite.

`rotation` spins each glyph of a bent label about its own pivot: the glyph's
horizontal centre on the label's mid-line (`(minY + maxY) / 2`, from `BOX.zw`
in the shader and the row's y bounds in the kernel), clockwise as
`nvr_quadBasis` turns a whole label. The kernel cannot see the glyphs, only the
widest one's half width (`glyphReach`, from `LabelLayout.maxGlyphHalfEm`), so
each piece's box grows by the exact extent of such a glyph turned by the
angle: `h·|sin θ|` along the line and `g·|sin θ| + h·|cos θ|` across, which at
zero is the unturned box.

The walk is word-rigid. `glyphWordCenter` (the centre of the glyph's word, in
ems, identical for every glyph in the word; filled by `layout.ts`, which closes
a word only at shaper whitespace) gives an arc length `s` from the anchor,
negated when `PATH.z` flips the label. `spreadGlyphs` makes `layout.ts` close a
piece after every drawn glyph instead, so each glyph is its own "word" and the
shader and the kernel run unchanged: the kernel only reads the widest piece's
half length (`wordReach`), which shrinks to half a glyph. It can be set per
feature: the value rides in the batch texture's packed `orientation` (see
[BATCH_TEXTURE.md](BATCH_TEXTURE.md)), each label is laid out with its own
resolved value, and `setFeatureSpreadGlyphsByBatchIndex` lays the feature's
labels out again when it changes.

A `FacesCamera` or `ScreenTangent` piece keeps its place on the path but takes
screen axes, so the kernel builds its box from the same axes
(`quad_screen_basis`, which mirrors `nvr_quadBasis`, or the projected segment):
`wordReach` either side across the screen around each piece's centre on the
path, instead of along the segment. A piece's centre stays at least
`wordReach` inside either end of the text, measured on the screen and walked
to the ground, so a word-rigid label claims its own length and not twice it.

Such a piece also keeps the anchor's on-screen size (flat ones still
foreshorten in height), so walking the ground would bunch glyphs wherever the
line recedes. It is spaced on the screen
instead: `nvr_screenWalk` projects the samples into the view at the anchor's
depth and walks them until `s` metres of screen are covered (a loop of up to
`PATH_SAMPLES` iterations, the one exception to "no loop"), turning the screen
fraction within the last segment into a ground fraction perspective-correctly
(`1/z` interpolates linearly on screen). The glyph's quad is then scaled by its
depth over the anchor's, so every glyph has the anchor's size. The kernel runs
the same walk (`screen_walk`, `ViewFrame`) to turn the label's screen arc into
the ground arc it covers, and uses that arc for the max-angle test, for the
length half of the fit test (`overruns`; the ground length means nothing for
such a label, so `fits` and `lineLabelFit`, told by the fit row's glyph
mode, test only its scale band), and for the box, which projects each
glyph's centre the same way and keeps its quad at the anchor's size. Samples
are a uniform `step` apart, so
the segment is `floor((s + halfSpan) / step)`: two texel fetches, no loop. The
interpolated point plus `uLineOffset` along the ground normal places the word;
its glyphs are then laid along that one segment's tangent from the word's
centre. Per-glyph tangents would splay the letters of a word apart on a tight
bend, and quads are never bent per vertex.

For a flat label the path offset and the glyph's offset within its word are
summed and wrapped **once** by `nvr_wrapOffset` (the wrap step of
`nvr_quadOffset` on its own). Wrapping them separately and adding the results
would leave the path part planar, rising off the globe with its length.

Along-line labels draw no background. A bent ribbon cannot be expressed as
quads, so `BACKGROUND` instances are culled when `PATH.y > 0`. A plain point
sharing the batch (`geometryTypes: ["point", "line"]`) has `PATH.y == 0` and
lays out as an ordinary label, background and all.

## Invariants that keep this flicker-free

- **Culled until placed.** `_writePath` writes `PATH.w = 1`, because an
  unjudged label has no flip yet and would read backwards for a frame. Hiding
  a label (`_recomputeShow`) sets it back to 1, since a hidden label is not
  placed and its last decision is stale by the time it shows again. A rejected
  label is *culled* in the shader, not faded: it is not a contest a pixel of
  drift could win back. An invisible batch is never placed, so `setActive` on a
  batch with a path calls `declutter.markDirty(true)` to lift the throttle.
- **Flip hysteresis.** `should_flip` scores the on-screen reading direction
  against a half-plane tilted slightly off vertical (a near-vertical label
  reads bottom-to-top) with a deadband (`FLIP_HYSTERESIS`). The current flip
  is read back from `PATH.z`, so a label on the boundary keeps its direction.
- **Level handoff.** When a pass newly rejects a label, `_handOffLineLabel`
  copies its declutter hide and target to the stack-mate this pass newly
  accepted. Without the copy, every crossing of a level boundary would snap the
  old label out and fade the new one in along every line on screen.
- **Rejected labels are not incumbents.** The declutter pass never sees a
  rejected label, so `_hideRejectedLineLabel` snaps its declutter state to
  hidden. When it fits again it competes as a fresh candidate, not with a
  stale "shown" claim.

## Sprites

Sprites use the same anchors unbanded (one per position, shown up to its
coarsest level, no path) and only the scale and box half of the kernel,
`lineAnchorPlace`, from `InstancedSpriteMesh.placeLineLabels`. The line's
bearing arrives as the per-instance `instanceBearing` attribute
(`USE_INSTANCE_BEARING`) and is added to the rotation `nvr_quadBasis` spins by.
An out-of-band sprite fades out through its declutter channel, and
`setActive` lifts the throttle the same way text does.

## Key files

| File | Role |
| --- | --- |
| `crates/navara_parser/src/line_placement.rs` | Parse-time anchors: nested levels, scale bands, `PATH_SAMPLES` chord-sampled paths |
| `crates/navara_parser/src/mvt/parse.rs` | MVT emitter: tile-unit spacing, ring walking, buffer drop, polygon label points |
| `crates/navara_geojson/src/geometry/process.rs` | GeoJSON emitter: Mercator projection, per-anchor ground scale |
| `crates/navara_geometry/src/polylabel.rs` | Pole of inaccessibility for polygon labels |
| `crates/navara_wasm_api/src/line_label.rs` | The per-pass kernel: fit, flip, max angle, rotated box; `lineAnchorPlace` for sprites |
| `web/navara_three/src/mesh/sdfText/linePlacement.ts` | Packing for `lineLabelFit` / `lineLabelPlace` (the stride contract with Rust), `takeLinePath`, `findRepeatedLabels` |
| `web/navara_three/src/mesh/sdfText/batchedSdfText.ts` | `placeLineLabels`, the path texture, handoff and culling |
| `web/navara_three/src/mesh/sprite/instancedSprite.ts` | The sprite side of `placeLineLabels` |
| `shaders/glsl/sdfText.vert.glsl` | `nvr_readPath` and the word walk |
