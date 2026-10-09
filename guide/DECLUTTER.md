# Label Decluttering

How `@navaramap/three` decides which text labels and icon sprites get to stay
visible when they overlap on screen, and how it avoids the classic failure
mode of naive collision systems: labels flickering on and off as the camera
moves. For the broader rendering pipeline this slots into, see
[ARCHITECTURE.md](ARCHITECTURE.md).

## Overview

Map labels are placed in **world space** (an ECEF anchor point), but collision
is a **screen-space** problem: two features far apart on the ground can sit
right next to each other on screen once projected through the camera. A
building's name and a POI icon's name might both want the same patch of
pixels. Something has to decide, every frame, which labels actually get drawn
and which get hidden.

That "something" is split in two. The **orchestration** — collecting
candidates from the meshes, throttling, dirty tracking, and driving the fades —
is the `DeclutterManager`, one shared TypeScript instance per `ThreeView`
(`web/navara_three/src/index.ts`). The **numeric kernel** it calls each pass
— projecting anchors to screen space, sorting, and the greedy grid placement —
lives in Rust: `declutterPlace` in `crates/navara_wasm_api/src/declutter.rs`,
exposed to TypeScript through the `@navaramap/engine-api` WASM bindings. Rust
also carries the two per-material config fields — `declutter: bool` and
`declutter_priority: f32` (`crates/navara_material/src/appearance.rs`) — through
to the bindings. Along-line labels and sprites go through a second kernel,
`crates/navara_wasm_api/src/line_label.rs`, which participants call at the
start of each pass (see [step 0](#0-line-placement)).

The split follows the seam where the work changes character: everything that
touches Three.js objects (meshes, the camera, the render loop) stays in
TypeScript; the per-pass numeric compute — an `O(n log n)` sort plus a grid
sweep over a few hundred labels — is handed to Rust as a single call over flat
typed arrays. The manager packs candidates into a `Float64Array`, calls the
kernel, and applies the returned `hidden` flags; it never sees a collision grid
or a projection matrix multiply. This all still runs once per frame, right
before rendering.

Naively, you could sort labels by priority and hide whichever ones overlap a
higher-priority label already placed. That works for a single frame, but as
soon as the camera moves by a pixel, two near-tied labels can swap places
every frame — a visible flicker. The `DeclutterManager` adds **hysteresis** on
top of the basic algorithm specifically to prevent this. This document covers
both: the base placement algorithm, and the hysteresis mechanism layered onto
it.

## The pipeline

Each placement pass takes every currently-visible, declutter-enabled label as
a **candidate**, and ends with each one marked shown or hidden:

```mermaid
flowchart TD
  Z["<b>0 · Prepare & place along lines</b><br/>promote parked labels; pick each<br/>line anchor's level, fit, flip, box"] --> A
  A["<b>1 · Collect</b><br/>every participant contributes its<br/>visible candidates"] --> B["<b>2 · Project & cull</b><br/>world anchor → screen-pixel AABB<br/>horizon / near-plane culling"]
  B --> C["<b>3 · Sort</b><br/>priority desc, then hysteresis<br/>tiebreak, then deterministic"]
  C --> D["<b>4 · Place greedily</b><br/>walk the sorted list, claim space<br/>in a screen-space grid"]
  D --> E["<b>5 · Fade</b><br/>losers fade out, winners fade in<br/>over DECLUTTER_FADE_MS"]
```

0. **Prepare & place along lines** — participants start font preparation for
   parked labels now in view, and decide along-line placement, so an anchor
   rejected here never competes. → [Line placement](#0-line-placement)
1. **Collect** — every registered participant (a text batch or a sprite mesh)
   appends its candidates. Along-line candidates bring the rotated box line
   placement computed instead of their unrotated one.
   → [Candidates and participants](#1-candidates-and-participants)
2. **Project & cull** — each candidate's world anchor becomes a screen-pixel
   box; labels behind the camera or beyond the horizon are excluded.
   → [Projecting to screen space](#2-projecting-to-screen-space)
3. **Sort** — by priority, then by a hysteresis-aware tiebreak, then
   deterministically. → [Sorting: priority and hysteresis](#3-sorting-priority-and-hysteresis)
4. **Place** — walk the sorted list, greedily claiming space in a uniform
   screen-space grid. → [Placing greedily: the collision grid](#4-placing-greedily-the-collision-grid)
5. **Fade** — the placement result becomes a fade *target*; visibility itself
   animates smoothly toward it. → [Fading, not popping](#5-fading-not-popping)

Steps 2–4 (project, sort, place) run inside the Rust kernel; steps 1 and 5
(collect, fade) stay in TypeScript. Step 0 is driven by each participant, with
its numerics in `line_label.rs`. The whole pass is throttled and only reruns
when something actually changed — see
[Running in the frame loop](#running-in-the-frame-loop).

```mermaid
graph TD
  subgraph ts["TypeScript · web/navara_three/src/declutter/"]
    DM["DeclutterManager.ts<br/>orchestrator + state machine + fades"]
    Kernel["kernel.ts<br/>DeclutterKernel interface (injected)"]
    WasmK["wasmKernel.ts<br/>adapter → declutterPlace"]
    Types["types.ts<br/>DeclutterCandidate / DeclutterParticipant"]
    DM -->|"packs candidates, calls"| Kernel
    DM -->|"candidate shape"| Types
    WasmK -.implements.-> Kernel
  end
  subgraph rs["Rust · crates/navara_wasm_api/src/"]
    Place["declutter.rs · declutterPlace()<br/>project + horizon cull + sort + grid"]
    Line["line_label.rs · lineLabelFit() / lineLabelPlace()<br/>lineAnchorPlace()"]
  end
  WasmK -->|"@navaramap/engine-api (WASM)"| Place
  Text["Text batches<br/>(mesh/sdfText/)"] -->|"register() / collectDeclutterCandidates()"| DM
  Sprites["Instanced sprites"] -->|"register() / collectDeclutterCandidates()"| DM
  DM -->|"placeLineLabels()"| Text
  DM -->|"placeLineLabels()"| Sprites
  Text -->|"lineLabelFit / lineLabelPlace"| Line
  Sprites -->|"lineAnchorPlace"| Line
```

Injecting the kernel through the `DeclutterKernel` interface keeps the manager
free of an import-time WASM dependency: production wires in `wasmDeclutterKernel`
(the `declutterPlace` adapter), while the manager's own unit tests inject a stub
and drive only the orchestration. Placement correctness — projection, the grid,
hysteresis — is covered by Rust `#[cfg(test)]` tests in `declutter.rs`, where
that logic now lives.

## 0. Line placement

Before collecting, `_run` gives every participant two optional hooks, in this
order, with the camera the pass will use:

- `prepareDeferredLabels(camera)` — text batches park font loading and shaping
  for labels whose anchor is out of view; this promotes the ones that came into
  view. Preparation is asynchronous, so they join a *later* pass.
- `placeLineLabels(camera, heightPx)` — decides along-line placement. Which
  level of a line's anchors is on screen, whether a text label fits its line or
  bends too sharply, which way it reads, and the box a turned label covers all
  depend on the camera, so none can be baked at parse time. Running this before
  `collectDeclutterCandidates` means a rejected anchor never claims space.

Both participants are registered whether or not the layer declutters, so line
placement runs for a `declutter: false` layer too; only candidate collection is
gated by `declutter`. Text batches call `lineLabelFit` then `lineLabelPlace`;
sprites call `lineAnchorPlace`, which only picks the level and the box. The
mechanics (nested levels, scale bands, the two-phase kernel, flip hysteresis,
level handoff) are in
[LINE_PLACEMENT.md](LINE_PLACEMENT.md).

## 1. Candidates and participants

A `DeclutterCandidate` (`declutter/types.ts`) is one label or sprite competing
for space in a single pass:

```ts
export type DeclutterCandidate = {
  anchorX: number; anchorY: number; anchorZ: number; // ECEF meters, f64
  addHeight: number;               // surface-normal height offset (meters)
  minX: number; maxX: number; minY: number; maxY: number; // local box, px or meters
  sizeInMeters: boolean;
  priority: number;    // higher wins an overlap
  isShown: boolean;    // currently visible — feeds hysteresis
  owner: DeclutterParticipant;
  handle: number;      // label slot (text) or instance index (sprites)
  contentKey?: string; // label text; feeds the tile-swap handoff
};
```

The local box is anchor-relative, +Y up. For a point label it is the
unrotated block. For an along-line candidate it is the screen-axis box of the
turned label or quad, as step 0 resolved it, in the same units. The kernel
projects and scales both the same way. A text label created since the last
pass has no line box yet and falls back to its unrotated block.

Any mesh type that wants to participate — batched SDF text, instanced sprites
— implements `DeclutterParticipant` (`declutter/types.ts`):

| Method | Called | Purpose |
| --- | --- | --- |
| `prepareDeferredLabels?(camera)` | once, at pass start | start preparation for parked labels now in view |
| `placeLineLabels?(camera, heightPx)` | once, at pass start, before collection | along-line level, fit, flip and box ([step 0](#0-line-placement)) |
| `collectDeclutterCandidates(out)` | once per pass | append this mesh's visible, declutter-enabled labels |
| `applyDeclutter(handle, hidden)` | once per candidate, every pass | set the fade *target* for this label |
| `stepDeclutterFade(deltaMs)` | every `update()` call | advance actual visibility toward the target; returns `true` while still fading |

This keeps the manager itself geometry-agnostic — it never touches a
`BufferGeometry` or a Three.js `Mesh` directly, only these hooks.

**Tile-swap handoff.** After applying results, the manager files every shown
candidate's anchor under its `contentKey`. When a tile swap activates a
replacement batch, `setActive` asks `wasRecentlyShown(text, anchor)` for each
label. A label whose identical text was shown within `HANDOFF_TOLERANCE_M`
starts granted rather than fading in from hidden. Without that, every swap
would blink the tile's labels out for a pass plus a fade.

Once collected, each candidate is flattened into the kernel's packed input: a
`Float64Array` with `CANDIDATE_STRIDE = 11` values per candidate
(`declutter/kernel.ts`), in the field order the Rust side reads — anchor (3),
`addHeight`, the four box edges, `sizeInMeters`, `priority`, `isShown`. Booleans
become `0.0`/`1.0`. The buffer is reused across passes and grown only when the
label count rises. The kernel returns a `Uint8Array` of `hidden` flags, one per
candidate in input order, which the manager feeds straight back to
`applyDeclutter`.

## 2. Projecting to screen space

`project_candidate` in `crates/navara_wasm_api/src/declutter.rs` computes each
candidate's screen-pixel bounding box, deliberately mirroring the vertex shaders
(`sdfText.vert.glsl` / `instancedSprite.vert.glsl`) so the collision box matches
what actually gets drawn. Because it mirrors GLSL, the constants (`WGS84_A`,
`WGS84_B`) are duplicated as literals rather than pulled from `navara_core` —
they must track the shader, not the engine's own ellipsoid:

1. **Height offset** — `addHeight` is applied along the anchor's own
   direction from the ellipsoid center (a cheap stand-in for the true surface
   normal), matching `mvr_getMvHeightOffset` on the GPU side.
2. **View + projection transform** — the anchor is transformed by the camera's
   view and projection matrices by hand (not through Three.js's `Vector3`
   helpers), because this runs every frame for every candidate and needs to
   stay allocation-free.
3. **Near-plane clip** — `vz >= -near` (view space looks down -Z) means the
   anchor is behind the camera; `project_candidate` returns `false` and the
   candidate is excluded rather than placed with garbage coordinates.
4. **Pixel sizing** — when the material uses `sizeInMeters`, the local box is
   scaled by pixels-per-meter at the anchor's view depth
   (`nvr_pxToWorld`, mirrored exactly — including its `|viewZ|` approximation
   of distance, not true range — so the CPU box doesn't drift from the
   rendered quad toward the screen edges).

Separately, `is_beyond_horizon` mirrors `horizon_culling_pars_vertex.glsl`: a
cheap ellipsoid test for whether the anchor is geometrically hidden behind the
Earth from the camera's viewpoint. Like the shader, it shrinks the ellipsoid by
the `nvrHorizonMinHeight` uniform value (never positive, set from the terrain
exaggeration), which `ThreeView` passes to `DeclutterManager.update` and on to
`declutterPlace` every frame. This matters because **a label the GPU will
cull must not claim screen space** — otherwise a label on the far side of the
planet could sit at the same projected pixel as a real, visible label and evict
it.

Both checks feed a per-candidate `placeable` flag inside `declutterPlace`.
Non-placeable candidates skip the grid entirely — they claim no space — and are
marked **hidden**, because a label that isn't on screen has not earned a slot.
See [Hidden by default](#hidden-by-default-why-panning-doesnt-reveal-clutter)
for why that direction matters.

## 3. Sorting: priority and hysteresis

Before placement, `declutterPlace` sorts the candidate indices by:

1. **`priority` descending** — the layer's `declutterPriority` (or a
   per-feature override). Higher always wins an overlap.
2. **`isShown` — currently-shown labels sort first** on an exact priority tie.
   This is the first half of hysteresis: an "incumbent" label keeps its claim
   over a brand-new competitor at equal priority, instead of losing a coin
   flip every frame.
3. **Anchor position** (`anchorX`, then `anchorY`, then `anchorZ`) — a
   deterministic, **camera-independent** tiebreak for genuinely fresh ties.
   Without this, ties would resolve by array order, which reshuffles as tiles
   load asynchronously — an easy way to make labels flicker for a completely
   different reason than the one hysteresis targets.
4. **Candidate index** — a final fallback, never actually reached in practice
   since anchors are distinct.

## 4. Placing greedily: the collision grid

Placement itself is the simplest part: walk the sorted list and greedily
claim space, exactly like MapLibre's symbol placement. What makes it fast is
`ScreenCollisionGrid` (in `declutter.rs`) — a **uniform grid over screen
space**, not an R-tree or quadtree:

```
Screen (CSS px), divided into 64px cells, plus a 128px margin ring:

 ┌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌-┐  ← margin (128px)
 ╎ ┌───┬───┬───┬───┬───┬───┬───┬───┬───┬───┐  ╎
 ╎ │   │███│███│   │   │   │   │   │   │   │  ╎ ███ = cells a 
 ╎ ├───┼───┼───┼───┼───┼───┼───┼───┼───┼───┤  ╎ label's box   
 ╎ │   │███│███│   │▓▓▓│▓▓▓│   │   │   │   │  ╎ overlaps and  
 ╎ ├───┼───┼───┼───┼───┼───┼───┼───┼───┼───┤  ╎ registers into
 ╎ │   │   │   │   │▓▓▓│▓▓▓│   │   │   │   │  ╎               
 ╎ └───┴───┴───┴───┴───┴───┴───┴───┴───┴───┘  ╎ each 64px cell
 ╎                     viewport               ╎
 └╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┘
```

- Each cell holds a list of indices into a flat `boxes` array (4 numbers per
  box: `minX, minY, maxX, maxY`).
- `try_claim(minX, minY, maxX, maxY, testShrinkPx)` is the one operation
  placement needs: test the box against every box already registered in the
  cells it spans; if nothing overlaps, register it into those same cells and
  return `Claim::Claimed`; otherwise return `Claim::Blocked` (collision, don't
  claim) and leave the grid untouched.
- Boxes are tested with **strict inequalities**, so two boxes that exactly
  touch edges do not count as colliding.
- A box entirely outside `viewport ± margin` returns `Claim::OutsideArea`
  **without touching the grid** — nothing it could occlude is on screen anyway,
  so skipping the cell math is a pure win. That third variant exists rather than
  reusing `Claimed` precisely because such a label must not be treated as a
  winner (see [below](#hidden-by-default-why-panning-doesnt-reveal-clutter)).
- The **128px margin** exists so labels just outside the visible viewport
  still compete for space. Without it, panning would let an off-screen label
  "win" the instant it crosses into view, immediately popping out its
  on-screen neighbor — a second, unrelated source of flicker that the margin
  heads off before hysteresis even comes into play.

Each candidate's box is padded by `PADDING_PX = 2` on every side before the
test (the manager passes the constant into the kernel), so two placed labels
never end up sitting pixel-adjacent.

## Hysteresis: why labels don't flicker

This is the mechanism the recent `feat: hysteresis` work added, and the part
worth understanding in the most depth. The problem it solves:

> Two labels have equal (or very close) priority and their boxes just barely
> overlap. As the camera drifts by a sub-pixel amount frame to frame, the
> overlap toggles in and out of existence — and with a naive "first past the
> post" placement, the *winner* toggles with it. The result is visible
> flicker, exactly at the boundary where it's most noticeable.

Hysteresis fixes this with two cooperating rules, both centered on
`isShown` — "is this label's fade target currently visible":

**Rule 1 — incumbents win ties.** Covered above in
[sorting](#3-sorting-priority-and-hysteresis): at equal priority, a
currently-shown label sorts ahead of a not-yet-shown one, so it gets first
claim on the grid.

**Rule 2 — a shown label's collision test shrinks.** This is the subtler
half, and it's what actually damps flicker rather than just biasing a
one-time tiebreak. `DeclutterManager.HYSTERESIS_PX = 6` is threaded through
the kernel call and passed as `try_claim`'s `test_shrink_px` — but **only**
for candidates where
`isShown` is true:

```rust
let claim = grid.try_claim(
    boxes[o] - pad, boxes[o + 1] - pad,
    boxes[o + 2] + pad, boxes[o + 3] + pad,
    if is_shown { hysteresis_px } else { 0.0 },
);
```

Inside `try_claim`, that shrink applies **only to the box used for the
overlap test** — the box actually registered into the grid (what future
candidates collide against) is still the full, unshrunk box:

```
              full box (claimed into grid, still blocks others)
        ┌─────────────────────────────┐
        │   ┌─────────────────────┐   │ ← shrunk test box (6px/side)
        │   │                     │   │   only used for THIS label's
        │   │      "Springfield"  │   │   own overlap check
        │   │                     │   │
        │   └─────────────────────┘   │
        └─────────────────────────────┘
```

So a label that's already shown tolerates a competitor grazing up to 6px into
its padded box without losing its spot — the marginal overlap that camera
drift causes literally cannot flip its own test result. But that same label's
*full* box is still claimed against everyone else, so it doesn't start
stealing extra space from its neighbors. A label that is currently **hidden**
gets `test_shrink_px = 0` — it must clear its entire padded box before it's
allowed to appear, which is the strict, "prove you deserve it" side of the
asymmetry.

Put together: **sticky when shown, strict when hidden.** That asymmetry is
the whole mechanism — no timers, no frame counters, no separately-tracked
"cooldown" state. It falls directly out of one boolean (`isShown`) read twice:
once in the sort comparator, once as the shrink toggle.

## Hidden by default: why panning doesn't reveal clutter

Hysteresis keeps *already-placed* labels stable. A second, independent rule
governs labels the pass can't judge yet — and getting its direction wrong is
what produced the most visible artifact the system ever had:

> On load, every label appeared at once and the clutter then faded away; every
> pan swept a fresh wave of full-opacity labels into view that promptly faded
> back out.

The cause was a "when in doubt, show it" default. Three groups of candidates
never contest on-screen space: those behind the near plane, those beyond the
horizon (both `placeable == false`), and those whose box lands entirely outside
`viewport ± margin` (`Claim::OutsideArea`). All three used to come back
`hidden = 0`. Nothing is drawn for them at that moment — but `hidden = 0` is a
**fade target**, so each one spent 300ms fading in *while invisible*. By the
time the globe turned it past the horizon, or a pan carried it in from beyond
the margin, it was already fully opaque. Only the next pass — up to
`MIN_INTERVAL_MS` (150ms) later — discovered the collision, and the label faded
out over another 300ms. A visible half-second of clutter, on a label that never
had a claim to that space.

So the kernel is **hidden by default**: `hidden[i] = 0` only when
`try_claim` returns `Claim::Claimed`. Both `Blocked` and `OutsideArea`, and
every non-placeable candidate, come back hidden. The invariant is
*a label fades in only after it has actually won screen space*.

This makes the two guards in [the frame loop](#running-in-the-frame-loop) work
*for* smoothness instead of against it: a label entering the viewport waits for
the next pass while hidden (nothing wrong is on screen meanwhile), then fades in
if it wins. The 128px margin ring is the lead time that keeps that fade-in from
starting on screen — labels inside it are placed while still off-screen, so at
normal pan speeds they cross the edge already faded in and correct.

Note the interaction with hysteresis: hidden-by-default also means `isShown`
goes false while a label is off screen, so it re-enters as a *challenger* and
must clear its full padded box (no 6px shrink) to appear. "Prove you deserve
it" applies to every label arriving from off screen, not just to fresh ones.

Along-line anchors extend the rule to step 0. They start undrawn until a pass
has judged them: text through `PATH.w = 1`, sprites through an all-set
out-of-band mask, since every level of a line arrives at once. An anchor that
step 0 rejects is skipped by collection, so the participant drops its fade
state to hidden itself (text snaps it, sprites fade it). When it qualifies
again it re-enters as a challenger, not an incumbent.

## 5. Fading, not popping

A placement decision is applied as a fade **target**, not an instant
visibility flip: `applyDeclutter(handle, hidden)` sets the target, and
`stepDeclutterFade(deltaMs)` advances the actual hide-factor toward it by
`deltaMs / DECLUTTER_FADE_MS` (300ms, `declutter/types.ts`) every call. This runs
through a channel separate from user-driven `show` — the `declutterHide`
channel of the per-label data texture for text (see
[TEXT_BATCHING.md](TEXT_BATCHING.md)), an `instanceDeclutterHide` attribute for
sprites — so a label a user explicitly hid via `evaluate()` and one temporarily
hidden by decluttering are independent and don't fight each other.

Because both participants store the factor per label rather than per material,
a fade step is a handful of float writes regardless of how many glyphs or
instances the label spans.

Fades are stepped on **every** `update()` call, whether or not a placement
pass ran that frame — placement only ever sets *where the fade is heading*;
the animation itself is a separate, continuous process. Both participants
short-circuit the walk entirely once nothing is mid-fade.

## Running in the frame loop

`DeclutterManager.update(camera, widthPx, heightPx, nowMs)` runs from
`ThreeView._render()`, **before** the render passes, so a placement change
lands in the same frame it was decided in (`web/navara_three/src/index.ts`):

```mermaid
sequenceDiagram
  participant Main as _startMainLoop
  participant Render as _render()
  participant DM as DeclutterManager.update()

  Main->>Render: render triggered (dirty, forceUpdate, or animation)
  Render->>DM: update(camera, widthPx, heightPx, now)
  alt dirty or camera/viewport changed, and MIN_INTERVAL_MS elapsed
    DM->>DM: _run() - full placement pass
  else due but throttle window not elapsed
    DM-->>Render: result = throttled
  end
  DM->>DM: step every participant's fade
  DM-->>Render: result = ran, animating, throttled, or idle
  Render-->>Main: schedule follow-up frame if throttled or animating
```

Two guards keep this cheap on an otherwise-idle camera:

- **Change detection** (`_snapshotChanged`) — a pass only reruns when the
  label set changed (`markDirty()` was called — new/removed labels, text
  changes) **or** the camera's `matrixWorld` / `projectionMatrix` / viewport
  size / horizon minimum height differ from a cached snapshot. A perfectly still camera with an
  unchanged label set does no placement work at all.
- **Throttling** — even when something changed, a full pass runs at most
  once per `MIN_INTERVAL_MS = 150`. Fast camera movement (drag, zoom) would
  otherwise trigger a full re-placement every single frame.

`markDirty(true)` also lifts the throttle, so the next `update()` runs a pass
even inside the window. A batch with along-line anchors needs this when a tile
swap activates it: its anchors stay undrawn until judged, and a hidden batch
is never judged, so waiting out the window would leave its line labels missing
right after the swap.
`setActive` on text batches and sprite meshes passes `true` exactly when
activating such a batch.

Both a throttled pass and an active fade need a **guaranteed future frame** —
but the render loop only renders when something requests it
(`_startMainLoop`):

```ts
const updated = this._update(time);
if (updated || this._renderFlag.forceUpdate || this._renderFlag.animation)
  this._render(time);
this._renderFlag.forceUpdate = false;   // cleared immediately, every tick
```

Setting `forceUpdate` synchronously from inside `_render()` is a no-op — it
gets cleared on the very next line after `_render()` returns, before another
tick can observe it. So `_scheduleDeclutterFrame(delayMs)` instead arms a
`setTimeout` that sets the flag *later*, landing between ticks:

- A `"throttled"` result schedules a retry after `remainingThrottleMs()` —
  the rest of the throttle window, not a full `MIN_INTERVAL_MS` from now.
- An `"animating"` result schedules a retry after `16ms` — roughly one frame,
  to keep the fade animating smoothly.
- A pending timer is only replaced by a **shorter** one
  (`if (delayMs >= this._declutterRetryDelay) return;`) — a fade's tight 16ms
  cadence must never be starved by a 150ms throttle retry that got scheduled
  first.

## Public API

Three material types carry the two config fields consumed by this pass —
`text`, `point`, and `billboard` — generated via wasm-bindgen from
`PointMaterial` / `BillboardMaterial` / `TextMaterial`
(`crates/navara_wasm_types/src/appearance.rs`):

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `declutter` | `boolean` | `true` | participate in the shared placement pass; set `false` to draw this label/sprite unconditionally |
| `declutterPriority` | `number` | `0` | layer-level priority; higher wins an overlap |

```ts
const source = view.addSource({
  type: "vector-tile",
  url: someVectorTileUrl,
  maxZoom: 16,
});
const layer = view.addLayer({
  type: "vector",
  source,
  sourceLayers: ["symbol", "label"],
  text: { /* font, color, size, ... */ declutter: true, declutterPriority: 1 },
});
```

`declutterPriority` can be overridden **per feature** through
`FeatureEvaluator.evaluate()` — e.g. ranking city labels above village labels,
or using a POI's confidence score directly as its priority:

```ts
layer.on("featureUpdated", ({ evaluator }) => {
  evaluator.evaluate(({ properties }) => ({
    text: properties?.["name"] as string,
    declutterPriority: TIER_PRIORITY[properties?.["tier"] as number] ?? 0,
  }));
});
```

A few things worth knowing before enabling it:

- **Decluttering only hides at render time** — it never reduces the number of
  features fetched, evaluated, or uploaded to the GPU. It's a screen-space
  visibility decision, not a data-volume optimization.
  (`example/pages/pmtiles-overture/run.ts:172`)
- **An icon and its own name label should not both opt in** if they share an
  anchor: the declutter pass has no notion that two candidates "belong"
  together, so it can't guarantee they stay paired. Typically only the text
  label sets `declutter: true`; the icon renders unconditionally.
  (`example/pages/pmtiles-overture/run.ts:561-563`)

Working examples: `example/pages/styling/mvt-text` (basic per-feature-code
priority), `example/pages/instanced-sprites` (sprite decluttering), and
`example/pages/pmtiles-overture` (tiered name-label priority + POI
confidence-driven priority, at real-world label density).

## Key files

| File | Role |
| --- | --- |
| `crates/navara_wasm_api/src/declutter.rs` | The numeric kernel — `declutterPlace`: projection, horizon cull, sort, `ScreenCollisionGrid`, greedy placement, plus its Rust unit tests |
| `crates/navara_wasm_api/src/line_label.rs` | The step-0 kernel — `lineLabelFit` / `lineLabelPlace` for text, `lineAnchorPlace` for sprites |
| `web/navara_three/src/declutter/DeclutterManager.ts` | Orchestrator — step-0 hooks, collect, pack candidates, call the kernel, apply results, fade, throttling/dirty state, shown-content registry |
| `web/navara_three/src/declutter/kernel.ts` | `DeclutterKernel` interface + `CANDIDATE_STRIDE` (the packed-input contract with the Rust side) |
| `web/navara_three/src/declutter/wasmKernel.ts` | `wasmDeclutterKernel` — adapter binding the interface to `declutterPlace` from `@navaramap/engine-api` |
| `web/navara_three/src/declutter/types.ts` | `DeclutterCandidate`, `DeclutterParticipant`, `DECLUTTER_FADE_MS` |
| `web/navara_three/src/mesh/sdfText/batchedSdfText.ts`, `web/navara_three/src/mesh/sprite/instancedSprite.ts` | The two participants, including their `placeLineLabels` |
| `web/navara_three/src/index.ts` | Registers the shared `DeclutterManager` (wired with `wasmDeclutterKernel`), drives `update()` from `_render()`, `_scheduleDeclutterFrame` / `forceUpdate` scheduling |
| `crates/navara_material/src/appearance.rs` | `declutter` / `declutter_priority` fields on `PointMaterial` / `BillboardMaterial` / `TextMaterial` |
| `crates/navara_wasm_types/src/appearance.rs` | wasm-bindgen mirrors exposed to TypeScript |
