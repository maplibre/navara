# Picking and input events

- `picking: true` (constructor, default on) is required for the `featureClick` (click or touch tap) and `featureHover`/`featureEnter`/`featureLeave` (pointermove) events and pickable meshes. Hover picking activates only while a hover-family listener is registered.

```typescript
view.on("featureClick", (info) => info?.properties?.["gml:name"]);   // requires picking: true (default)
view.on("featureHover", (info) => { ... });   // fires when the hovered feature changes; null = nothing hovered
view.on("featureEnter", (info) => { ... });   // enter/leave pair synthesized by diffing hover picks
view.on("featureLeave", (info) => { ... });   // receives the feature that was left
const ecef = view.pickTerrainPosition(x, y);                  // terrain only
const ecef2 = view.pickDepthPosition(x, y);                   // anything in the depth buffer
```

**Picking is lazy and throttled:** the GPU pick runs only while someone listens for the result — the click/tap pick needs a `featureClick` listener, the hover pick at least one of `featureHover`/`featureEnter`/`featureLeave` (at most one hover pick per frame, suppressed while a button or finger is down — so touch never hover-picks). The pick searches a window around the pointer and takes the nearest non-zero hit (exported `PICK_RADIUS` = 3 CSS px, `TOUCH_PICK_RADIUS` = 10), so small points and thin lines don't need pixel-perfect aim. Each hover pick forces a main re-render to restore draped vector atlases, so it costs more on scenes heavy with clamped-to-ground vectors. `featureHover` fires only on change (feature-level, unlike MapLibre's layer-level enter/leave). For cursor styling use `view.canvas.style.cursor`. Runnable reference: `example/pages/debug/picking-layers`.

Raw view input is a single `pointer*` family — `pointerdown`/`pointerenter`/`pointerleave`/`pointermove`/`pointerup` deliver `MapPointerEvent` for **every input type** (`event.pointerType` tells mouse/touch/pen apart; `pointercancel` delivers a plain `PointerEvent`). There are **no `mouse*` view events** — `view.on("mousemove")` silently never fires. `click` is a gesture: a primary-pointer press and release within the exported `CLICK_PIXEL_TOLERANCE`/`TAP_PIXEL_TOLERANCE`, so camera drags never fire it and no drag guard is needed. Map events deliver `.clientX/Y` and `.map` (ECEF coords). The `idle` event fires after `idleThreshold` ms without tile/data activity. `.map` does not follow the rendered terrain surface — from a tilted camera, clicks on ridgelines/slopes land wrong or not at all; for click-to-place on terrain use `view.pickTerrainPosition(event.clientX, event.clientY)` (returns `null` past the globe) and `vector3ToGeodetic` the result.

Related: restyling the picked feature (hover/click highlight, `layer.forceUpdate()`) → [feature-evaluator.md](feature-evaluator.md); terrain height sampling → [placement-and-math.md](placement-and-math.md); picking for custom meshes → [custom-desc.md](custom-desc.md); camera events → [view-and-camera.md](view-and-camera.md); layer feature events → [declarative-api.md](declarative-api.md).
