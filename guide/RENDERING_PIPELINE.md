# Rendering Pipeline

How a Navara frame is rendered on the TypeScript side (`web/navara_three`): the
pass pipeline, the MRT G-buffer, its encodings and invariants, and how meshes,
materials, and effects plug into it. Read this before touching
`CustomRenderPass`, `gbufferLayout`, `overrideMaterialsForMRT`, the enhancer
shaders, or anything that samples a G-buffer texture.

Single sources of truth referenced throughout:

- `web/navara_three/src/material/gbufferLayout.ts` — TS side of the G-buffer
  layout (attachment indices, defines, write snippets, allocation).
- `shaders/glsl/chunks/gbuffer_pars_fragment.glsl` — GLSL side (output
  declarations, write macros). The two must stay in sync; a layout change is
  designed to be an edit to these two files only.

## 1. Frame overview

Rendering is a [postprocessing](https://github.com/pmndrs/postprocessing)
`EffectComposer` pipeline. Every pass is owned by an `EffectDesc` (built-in or
plugin/user-registered) and ordered declaratively via the descs' static
`insertAfter` / `insertBefore` keys — there is no hardcoded pass list. The
built-ins registered by `ThreeView` are:

| key | pass | role |
|---|---|---|
| `skyEnvMap` | `SkyEnvMapPass` | renders the sky to a cube map for reflections (before `mrt`) |
| `mrt` | `CustomRenderPass` | the G-buffer pass — everything in section 2 |
| `transparent` | transparent-scene pass | renders the `transparent` scene after every depth-based screen-space effect, before tone mapping |
| `final` | `FinalCopyEffectDesc` | copies the result out |

`DefaultPlugin` inserts its effects (aerial perspective, clouds, SSAO, SSR,
selective bloom/outline, tone mapping, SMAA/FXAA, …) into the same ordering
graph. A typical resolved order:

```
SkyEnvMapPass → CustomRenderPass(mrt) → selective effects
→ aerial perspective / clouds / SSAO / SSR / lens flare … → transparent
→ tone mapping → SMAA/FXAA → copy
```

The `transparent` pass is the boundary that matters when placing an effect:
its scene writes no depth and no G-buffer data, so any effect that samples
those buffers and runs after it will composite over that content as if it
weren't there. Custom effects that read G-buffer or depth textures should
therefore use `insertBefore: ["transparent"]` — the pass is a built-in, so the
anchor always resolves. Purely screen-space effects that should cover the
whole frame (vignette, color grading, AA) insert after it instead
(`insertBefore: ["smaa", "fxaa", "final"]`).

## 2. Scenes and pass routing

`Scenes` (`src/scene.ts`) splits renderables by pipeline role:

| scene | rendered by | writes G-buffer? |
|---|---|---|
| `globe` | `CustomRenderPass` | **yes** — terrain/basemap tiles |
| `mrt` | `CustomRenderPass` | **yes** — meshes participating in the G-buffer |
| `draped` | `CustomRenderPass` (stencil draping) | **yes** |
| `opaque` | `CustomRenderPass`, but *after* the G-buffer copy | no — composer input only |
| `transparent` | the `transparent` pass, after depth-based effects | no |
| `light` | added temporarily to whichever scene is being lit-rendered | — |
| `skyEnvMap` | `SkyEnvMapPass` | no |

A mesh desc chooses its scene via `MeshDesc.getPassKey()` (default
`"opaque"`). `MeshDescWithSelectiveEffect` overrides it: SE-capable meshes go
to `"mrt"` when **either** a selective effect is registered
(`selectiveEffectRegistry.slotCount > 0`) **or** any optional G-buffer is
allocated (`view.buffers`). The second condition matters: a mesh outside the
MRT pass leaves the G-buffer holding whatever is *behind* it, so
buffer-reading effects (deferred lighting, SSAO, …) would shade "through" the
mesh. Placement is re-evaluated on the `effectSlotsChanged` and
`gbufferChanged` ViewContext events.

`opaque`/`transparent` scene content is deliberately outside the G-buffer
(cheap path for meshes that don't need it); be aware their pixels contribute
nothing to any G-buffer attachment.

## 3. `CustomRenderPass` — the MRT pass

Per frame, in order:

1. **Shadow maps** — `globe + mrt + opaque` are gathered into a temporary
   `shadowScene` and rendered to a dummy target with
   `renderer.shadowMap.needsUpdate = true`, so CSM shadow maps include casters
   from all three scenes.
2. **G-buffer defines stamping** — see section 5. Runs every frame; the
   per-material work is `WeakSet`-gated, so the steady-state cost is the
   scene traversal alone.
3. **Globe** — rendered into `gbufferRenderTarget` (with the `light` group
   temporarily attached). Globe-only normal and depth are then copied out
   (`globeNormalCopyPass`, `globeDepthCopyPass`) for effects that need
   terrain-only data (e.g. clamped-polygon normals).
4. **Underground / transparency handling** — depending on
   `globe.hideUnderground` / `globe.transparent`, depth is cleared and the
   globe+mrt scenes may be re-rendered together (`combinedScene`) so blending
   against the globe works; draped meshes render via stencil testing in
   between.
5. **MRT scene** — meshes render into the G-buffer (blended meshes included —
   see the A-channel invariant below).
6. **Copy** — `RenderTargetCopyPass` copies G-buffer color (+ depth via
   `gl_FragDepth`) into the composer's input buffer.
7. **Opaque scene** — rendered directly into the composer input (no G-buffer
   writes), then the combined depth is copied for downstream effects
   (`allDepthCopyPass`).

The pass owns `gbufferRenderTarget` (cloned from the composer input, plus a
`DepthTexture` with stencil). Its `textureIndex` property maps buffer names to
attachment indices for the current configuration.

## 4. The G-buffer

### Layout

Attachment indices are **dynamic and packed** — three.js cannot express sparse
MRT attachments, so enabled buffers are packed in a fixed order with no gaps
and no placeholder textures:

| attachment | content | type | when |
|---|---|---|---|
| 0 `color` | forward color (or albedo — see `lit`) | HalfFloat | always |
| 1 `normal` | RG = octahedral view-space normal, B = metalness/reflectivity, A = roughness *(and blend factor!)* | HalfFloat | always |
| packed next | `effectIds` — R = selective-effect bitmask | HalfFloat, Nearest | `buffers.selectiveEffect` |
| packed next | `emissive` — RGB = HDR emissive | HalfFloat | `buffers.emissive` |
| packed next | `shadow` — R = shadow amount (0 = lit .. 1 = shadowed), G = albedo-output flag | UnsignedByte | `buffers.shadow` |

Because indices shift, shader `layout(location = …)` values are delivered per
material as defines (`GBUFFER_EFFECT_ID_LOCATION` etc.,
`computeGBufferDefines`). **Never hardcode an optional attachment index** —
read `CustomRenderPass.textureIndex`, the `MRTPassEffectDesc` getters, or the
`ViewContext` accessors (`getNormalTexture`, `getEffectIdsTexture`,
`getEmissiveTexture`, `getShadowTexture`), which return `undefined` for
disabled buffers. Fetch them **every frame** — a configuration change rebuilds
the render target with new texture objects.

### Derived configuration

There is no user-facing buffers option. The configuration is the **union of
active effects' `static requiredBuffers`** (`selectiveBloom` →
`["selectiveEffect", "emissive"]`, `selectiveOutline` → `["selectiveEffect"]`;
`shadow` has no built-in consumer and is enabled by custom effects).
`ThreeView._syncGBuffers()` re-derives on `addEffect` and on handle deletion
and pushes the result to `CustomRenderPass.setBuffers()`, which rebuilds the
render target **as a fresh object** (reconfiguring a live target in place
leaves the renderer's cached GL state sampling a texture the framebuffer no
longer writes) while keeping the color/normal/depth `Texture` identities
(effects like SSR capture those references at creation). `addEffect` throws if
the prospective attachment count would exceed the device's
`gl.MAX_DRAW_BUFFERS`.

A configuration change reallocates attachments and recompiles shaders — add
effects once and tune them via `update()`, don't add/remove per frame.

### Encodings

- **Normals are octahedral-encoded** (signed, from
  `@takram/three-geospatial`'s packing). Decode with `unpackVec2ToNormal()`;
  the GLSL is exported as `NORMAL_PACKING_SHADER`. A naive `xy * 2 - 1`
  reconstruction produces wrong shading. (Known inconsistency: the raw
  sprite/text shaders use a local `xy * 0.5 + 0.5` packing.)
- **Depth** follows three.js packing conventions — check
  `depthBufferPacking` / `globeDepthBufferPacking` on the MRT desc and use the
  helpers in `DEPTH_PACKING_SHADER` (three's `packing` chunk).
- **Shadow buffer G channel** is the albedo-output flag (see `lit` below) — a
  deferred lighting pass uses it as its "shade this pixel" mask.

### The alpha-channel blending invariant

Selective-effect-capable meshes render into the G-buffer **even when
`transparent: true`** (for depth consistency), and WebGL2 blends *each*
attachment with **that attachment's own output alpha**. Therefore, on every
attachment, A is the blend factor, not a data channel:

- `effectIds` / `emissive` / `shadow`: selective writes use A = 1.0 ("replace
  what's behind"), non-selective writes use A = 0.0 ("keep what's behind").
  One attachment can carry at most three data channels (RGB). This is why
  emissive could not be merged into the effectIds attachment.
- `normal`: A carries roughness *data*, which historically violated the
  invariant — a blended material with low roughness would keep (and leak) the
  normal of whatever lies behind it. Handled by `GBUFFER_NORMAL_ALPHA()`:
  materials stamped `NVR_BLENDED` (from `material.transparent`) write A = 1.0;
  the non-`USE_ROUGHNESS` fallback is 1.0 (fully rough — physically correct
  for diffuse). When adding a normal write, always route the alpha through
  `GBUFFER_NORMAL_ALPHA()`, never a raw constant 0.0.

All G-buffer writes go through the `GBUFFER_WRITE_*` macros from the pars
chunk — never assign `effectIdBuffer` / `emissiveBuffer` / `shadowBuffer`
directly. Disabled buffers compile the macros to nothing, so write sites stay
unconditional. `gbufferLayout.test.ts` enforces macro/branch parity.

## 5. Define stamping

Materials can come from anywhere (built-ins, enhancers, user
`ShaderMaterial`s), so per-desc wiring of G-buffer defines is impossible to
keep complete. Instead `CustomRenderPass.stampGBufferDefines()` traverses the
scenes and stamps every material it finds. Two scene sets, two define sets:

| Scenes | Stamped defines |
| --- | --- |
| `globe`, `mrt`, `draped` (G-buffer) | buffer enable/location (`USE_GBUFFER_*`, `*_LOCATION`), blended flag (`NVR_BLENDED`, synced from `material.transparent` on every visit), scene-level lit default (`NVR_UNLIT_SCENE`) |
| `opaque`, `transparent` (forward-only) | scene-level lit default (`NVR_UNLIT_SCENE`) only |

`NVR_UNLIT_SCENE` is a *lighting* define, not a G-buffer one, so it must reach
the forward-only scenes too — a mesh sits there whenever no selective effect
and no optional buffer routes it to the MRT pass (see section 2), and
`view.lit` has to apply to it all the same. The G-buffer defines must **not**
be stamped there: those materials would declare outputs the single-attachment
target has no room for. The two sets are tracked by separate `WeakSet`s, so a
material first visited in `opaque` still receives the G-buffer defines when it
later moves to `mrt`. The reverse move (a mesh re-routed to `opaque` once its
last selective effect is gone) is reconciled by the forward traversal: a
material that carries G-buffer defines but was not met in any G-buffer scene
during the same traversal has them cleared. A material shared by both scene
sets keeps them — the G-buffer needs the outputs, the forward pass merely
discards them.

Stale defines within the G-buffer set are set to `false` (three's sanctioned
"absent" value). The defines of a material that left the G-buffer scenes are
`delete`d instead: three keys its program cache on every define _name_, so a
leftover `false` would compile a second, identical program rather than share
the one the never-stamped forward materials use. Changes flip
`material.needsUpdate`, and three includes `material.defines` in the program
cache key, so recompiles happen exactly when needed.

The traversal runs **every frame**. There is no O(1) signal that catches
every way a material can appear: added inside a group already in the scene (a
glTF populating its group after load), swapped in place on a mesh
(`mesh.material = ...`), or added in the same frame another mesh was removed —
and it may compile to an already-cached program, so the program count does not
move either. The per-material work is `WeakSet`-gated, so the steady-state
cost is the traversal alone.

## 6. Material patching

- `overrideMaterialsForMRT()` (run at `ThreeView` construction, idempotent)
  patches every three.js `ShaderLib` entry so **all built-in materials** write
  the G-buffer: it injects the pars chunk, the normal/effect/shadow writes at
  the end of `main()`, and the albedo-output override just before
  `#include <opaque_fragment>`.
- Custom `ShaderMaterial` / `LineMaterial` bypass `ShaderLib` and opt in via
  `setupMaterialForMRT(material, { normal })`.
- Raw `.glsl` shaders (`polyline`, `instancedSprite`, `sdfText`, tile chunks)
  include `chunks/gbuffer_pars_fragment.glsl` directly and call the same
  macros.
- The enhancers (polygon/model/polyline/…) and the tile mesh locate injected
  code by **exact string match** on the exported snippets
  (`GBUFFER_NORMAL_WRITE_*`, `GBUFFER_EFFECT_WRITE_BUILTIN`, …). Changing a
  snippet requires updating every replacement string in lockstep — this is why
  the snippets live in `gbufferLayout.ts` as shared constants.

### `onBeforeCompile` ordering

Several systems wrap `material.onBeforeCompile`, and **they compete for the
same anchors**. `navara_three_csm` replaces `#include <lights_fragment_begin>`
with its cascaded-lights chunk (`createFragmentShader.ts`), so a handler that
delegates to the previous one *before* looking for that anchor finds nothing
and silently does nothing — no error, no warning, just unlit-looking output.

When wrapping `onBeforeCompile`, do your own replacement **first**, then
delegate, and keep the anchor line in your output so the next handler can still
find it. `setupMaterialForDrape` does exactly this; `DrapedMesh.test.ts` pins
the ordering.

## 7. Draping (`DrapedMesh`)

`DrapedMesh.process()` paints a volume onto the terrain with a three-pass
stencil test (depth-fail counting, then a final pass with
`stencilFunc = NotEqual`, `side = BackSide`, `depthTest = false`).

The consequence that governs everything else: **the final pass has no depth
test, so one pixel can be covered by several back faces** where the volume
folds over a peak or the shape is non-convex. Every one of them is drawn, and
the last wins. The drape therefore only looks like a flat decal while its
shading is a pure function of screen position:

- **Normal** — `setupMaterialForDrape` (in `mesh/DrapedMesh.ts`) swaps in the
  terrain normal, sampled from the globe-normal copy at `gl_FragCoord`. The
  mesh's own back-face normals describe the volume, not the ground.
- **Shadows** — forced off (`receiveShadow` is an own accessor on `DrapedMesh`
  that reports `false` while draped). The shadow lookup is driven by a
  world-position varying, which is the one lighting input that still differs
  between overlapping faces.

Anything else world-position dependent reintroduces the artefact: point/spot
lights, an `envMap`, or three's `fog` (unused here — atmospheric haze is the
screen-space `aerialPerspective` effect, which is per-pixel and therefore
safe).

The globe-normal copy is produced by `globeNormalCopyPass` right after the
globe render and before `_renderDrapedMesh`, so the ordering already works. It
is kept at 1x1 unless a draped mesh exists or an effect declares
`requiredBuffers: ["globeNormal"]`.

## 8. The `lit` system (deferred-lighting groundwork)

Three-state lighting control, resolved per material by defines:

- `view.lit = false` — scene default: every material outputs **plain albedo**
  (`NVR_UNLIT_SCENE`, stamped) while the lit pipeline still runs, so normals
  and the shadow buffer keep being written. That combination — albedo in
  color, shadow amount + albedo-mask in the shadow buffer, octahedral normals
  — is exactly the input a deferred lighting pass needs.
- material/mesh `lit: true` forces the lit path (`NVR_LIT`), `lit: false`
  forces albedo (`NVR_UNLIT`), `undefined` follows the view. The option lives
  on layer materials (terrain/rasterTile/polygon/model/polyline; Rust side is
  `Option<bool>` end-to-end so "unset" survives merging) and top-level on mesh
  configs (applied by the `MeshDesc` base via `applyLit()`). On mesh updates
  the *presence* of the key decides, not its value — `update({ lit: undefined })`
  resets a mesh to inheriting `view.lit`.
- Shader resolution:
  `#if !defined(NVR_LIT) && (defined(NVR_UNLIT) || defined(NVR_UNLIT_SCENE))`
  → `outgoingLight = diffuseColor.rgb`.

A working minimal deferred-lighting effect (albedo × Lambert × shadow-buffer
shadows, sun/ambient inherited via `ctx.findLight("sun"/"ambient")` and
`view.atmosphere.sunDirection` transformed to view space) lives in
`web/navara_three/example/pages/debug/buffers/run.ts`, together with toggles
for every optional buffer — use that page (`/debug-buffers`) to integration
test pipeline changes. Shadow acne on large mesh faces is tamed with
`sun: { shadowNormalBias: ~3 }`.

## 9. Reading the G-buffer from effects

Custom `EffectDesc`s declare what they need via `static requiredBuffers`, then
read per frame:

```ts
class MyEffectDesc extends EffectDesc<...> {
  static insertBefore = ["transparent"];
  static requiredBuffers: readonly GBufferName[] = ["shadow"];

  update = () => {
    // Re-fetch every frame — never cache at pass creation.
    const normal = this.ctx.getNormalTexture();
    const shadow = this.ctx.getShadowTexture();
    ...
  };
}
```

`ViewContext.findEffect/findLight/findMesh(key)` resolve active descriptors by
registered key (e.g. inherit the sun's intensity/direction);
`_getEffects/_getLights/_getMeshes` iterate them all.

## 10. Lightweight skybox

`SkyBoxMeshDesc` renders a single fullscreen triangle at far depth in the
`opaque` scene with premultiplied normal alpha blending. Its shaders approximate the sky
without atmosphere LUTs, texture fetches, or ray marching. The configured
`dayColor`, `nightColor`, and `sunColor` remain the palette controls.

The vertex shader computes geodetic local up in view space, solar elevation,
and camera altitude. The fragment shader adds a desaturated horizon gradient,
a sun-facing twilight tint, and a small antialiased solar disc with a compact
exponential halo. Disc distance uses the chord between normalized view rays
for precision near the sun; derivative smoothing adapts the edge to resolution.
The solar disc and compact halo remain visible at every altitude; globe depth
occludes them when the planet is in front of them.

Sky opacity stays at 1.0 below 100 km to occlude background stars and smoothly
reaches zero at 190 km. A fixed 0.3 RGB scale preserves the sky brightness.
Stars disable depth writes after material construction (the upstream constructor
overrides that option), allowing the far-depth skybox to cover star pixels.
The shader premultiplies sky RGB by sky opacity and adds the solar disc and halo
independently. The halo is additive and does not increase coverage. Output alpha
combines sky opacity and disc coverage, hiding stars behind the sun even in space
while leaving the surrounding star field visible.
Do not apply another alpha multiplication to the output. Screen-pixel dithering
reduces gradient banding and fades with the sky.
