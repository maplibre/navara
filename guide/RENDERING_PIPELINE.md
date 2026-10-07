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

| key           | pass                   | role                                                                                             |
| ------------- | ---------------------- | ------------------------------------------------------------------------------------------------ |
| `skyEnvMap`   | `SkyEnvMapPass`        | renders the sky to a cube map for reflections (before `mrt`)                                     |
| `mrt`         | `CustomRenderPass`     | the G-buffer pass — everything in section 2                                                      |
| `transparent` | transparent-scene pass | renders the `transparent` scene after every depth-based screen-space effect, before tone mapping |
| `final`       | `FinalCopyEffectDesc`  | copies the result out                                                                            |

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

| scene         | rendered by                                                | writes G-buffer?                               |
| ------------- | ---------------------------------------------------------- | ---------------------------------------------- |
| `globe`       | `CustomRenderPass`                                         | **yes** — terrain/basemap tiles                |
| `mrt`         | `CustomRenderPass`                                         | **yes** — meshes participating in the G-buffer |
| `draped`      | `CustomRenderPass` (stencil draping)                       | **yes**                                        |
| `opaque`      | `CustomRenderPass`, but _after_ the G-buffer copy          | no — composer input only                       |
| `transparent` | the `transparent` pass, after depth-based effects          | no                                             |
| `light`       | added temporarily to whichever scene is being lit-rendered | —                                              |
| `skyEnvMap`   | `SkyEnvMapPass`                                            | no                                             |

A mesh desc chooses its scene via `MeshDesc.getPassKey()` (default
`"opaque"`). `MeshDescWithSelectiveEffect` overrides it: SE-capable meshes go
to `"mrt"` when **either** a selective effect is registered
(`selectiveEffectRegistry.slotCount > 0`) **or** any optional G-buffer is
allocated (`view.buffers`). The second condition matters: a mesh outside the
MRT pass leaves the G-buffer holding whatever is _behind_ it, so
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

| attachment  | content                                                                        | type               | when                      |
| ----------- | ------------------------------------------------------------------------------ | ------------------ | ------------------------- |
| 0 `color`   | forward color (or albedo — see `lit`)                                          | HalfFloat          | always                    |
| 1 `normal`  | RG = octahedral view-space normal, B = F0, A = roughness _(and blend factor!)_ | HalfFloat          | always                    |
| packed next | `effectIds` — R = selective-effect bitmask                                     | HalfFloat, Nearest | `buffers.selectiveEffect` |
| packed next | `emissive` — RGB = HDR emissive                                                | HalfFloat          | `buffers.emissive`        |
| packed next | `shadow` — R = shadow amount (0 = lit .. 1 = shadowed), G = albedo-output flag | UnsignedByte       | `buffers.shadow`          |

Because indices shift, shader `layout(location = …)` values are delivered per
material as defines (`GBUFFER_EFFECT_ID_LOCATION` etc.,
`computeGBufferDefines`). **Never hardcode an optional attachment index** —
read `CustomRenderPass.textureIndex`, the `MRTPassEffectDesc` getters, or the
`ViewContext` accessors (`getNormalTexture`, `getEffectIdsTexture`,
`getEmissiveTexture`, `getShadowTexture`), which return `undefined` for
disabled buffers. Fetch them **every frame** — a configuration change rebuilds
the render target with new texture objects.

**The normal buffer's B is read as the reflectance at normal incidence (F0),
and A as the roughness.** Writers store their material's own reflectance input
there unconverted, so a model's metalness reaches readers as its F0 as is:

| writer                                                               | B                                                                        | A                                                              |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------- |
| model / 3D Tiles glTF (`MeshStandard`/`Physical`)                    | real `metalnessFactor`                                                   | real `roughnessFactor`                                         |
| polygon                                                              | `reflectivity` ref, **default 0**                                        | `roughness` ref, **default `GBUFFER_PHONG_ROUGHNESS`**         |
| terrain tile, `useNormal` on                                         | `tileReflectivity`, **default 0**                                        | draped slot's roughness, **default `GBUFFER_PHONG_ROUGHNESS`** |
| terrain watermask ocean                                              | 0.02 (water's F0)                                                        | 0.4 (Cox-Munk wave slopes)                                     |
| terrain tile, `useNormal` off (`MeshBasicMaterial`)                  | 0                                                                        | 1.0, and **RG is NaN** (no `normal` attribute)                 |
| polyline, outline, sprite, SDF text, points, custom `ShaderMaterial` | 0                                                                        | 1.0                                                            |
| any other Lambert/Basic/Phong                                        | 0 (three's `reflectivity` is an env-map weight, not an F0)               | 1.0                                                            |
| any `transparent` material                                           | unchanged                                                                | **forced 1.0** (`NVR_BLENDED`)                                 |

B is a scalar and nothing derives a dielectric's 0.04 or a metal's tint from
it: metalness 0 does not reflect and 1 is an untinted mirror. B below 0.01
means "not reflective"; `ssr.frag.glsl`, `coneTracing.frag.glsl` and the
aerial perspective's specular term all skip it, and feed B into a Schlick
Fresnel term otherwise. SSR also skips A = 1, where its roughness fade is
already zero, so the default glTF roughness costs no rays.

A can be read at face value, and 0 means a mirror. That holds only because
every writer without a real roughness defaults to a meaningful one CPU-side:
polygons and tile slots default to `GBUFFER_PHONG_ROUGHNESS`, the microfacet
width matching the shininess 50 they actually shade with, so an explicit
`roughness: 0` still reaches the buffer. The rest write 1.0, and `NVR_BLENDED`
forces 1.0 on transparent materials because the slot doubles as the blend
factor. **Resolve the default in TypeScript, not in the shader.** A shader
branch on 0 cannot tell "unset" from "mirror", and a reader that patches the
hole with its own floor only hides it from itself.

### Derived configuration

There is no user-facing buffers option. The configuration is the **union of
active effects' and meshes' `getRequiredBuffers()`** (`selectiveBloom` →
`["selectiveEffect", "emissive"]`, `selectiveOutline` → `["selectiveEffect"]`,
`aerialPerspective` with a lighting term → `["normal", "shadow"]`, a draped
`box`/`cylinder`/`polygon` mesh or a `polyline` mesh with `useGroundNormals` →
`["globeNormal"]`). For effects the
instance method defaults to the class's `static requiredBuffers`; for meshes it
defaults to `["globeNormal"]` in the draped pass and `[]` elsewhere, since the
render pass shades a draped lit material with the globe normal (§7). A
descriptor whose needs depend on its own configuration overrides it instead
(the override shadows the static, so it declares no static) and emits
`gbufferRequirementsChanged` on the `ViewContext` whenever an update changes
the result. `MeshDesc.onPassKeyChange()` emits it for a mesh moving into or
out of the draped pass. The result must follow from the config alone,
because `addEffect`/`addMesh` read it for the `MAX_DRAW_BUFFERS` check before
`onCreate()`.

`ThreeView._syncGBuffers()` re-derives on `addEffect`, on effect deletion, on
`addMesh` and mesh deletion when that mesh has requirements, and on that
event, then pushes the result to `CustomRenderPass.setBuffers()`. That
rebuilds the render target **as a fresh object** (reconfiguring a live target
in place leaves the renderer's cached GL state sampling a texture the
framebuffer no longer writes) while keeping the color/normal/depth `Texture`
identities, which effects like SSR capture at creation. `addEffect` and
`addMesh` throw for a descriptor whose buffers would exceed the device's
`gl.MAX_DRAW_BUFFERS`. A requirement that grows later (an `update()`) is
logged with `console.error` and the previous configuration is kept, rather
than producing an incomplete framebuffer; the next re-derivation that fits
applies.

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
`transparent: true`** (for depth consistency), and WebGL2 blends _each_
attachment with **that attachment's own output alpha**. Therefore, on every
attachment, A is the blend factor, not a data channel:

- `effectIds` / `emissive` / `shadow`: selective writes use A = 1.0 ("replace
  what's behind"), non-selective writes use A = 0.0 ("keep what's behind").
  One attachment can carry at most three data channels (RGB). This is why
  emissive could not be merged into the effectIds attachment.
- `normal`: A carries roughness _data_, which historically violated the
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

| Scenes                                 | Stamped defines                                                                                                                                                                      |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `globe`, `mrt`, `draped` (G-buffer)    | buffer enable/location (`USE_GBUFFER_*`, `*_LOCATION`), blended flag (`NVR_BLENDED`, synced from `material.transparent` on every visit), scene-level lit default (`NVR_UNLIT_SCENE`) |
| `opaque`, `transparent` (forward-only) | scene-level lit default (`NVR_UNLIT_SCENE`) only                                                                                                                                     |

`NVR_UNLIT_SCENE` is a _lighting_ define, not a G-buffer one, so it must reach
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
  It also adds three's `#include <packing>` to the lit fragment shaders
  (lambert/phong/basic/standard/physical), which three omits. Patches to these
  materials can call `unpackRGBAToDepth` and friends, and must not include
  `<packing>` again: a second copy fails to compile. A custom
  `ShaderMaterial` includes it itself.
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
delegates to the previous one _before_ looking for that anchor finds nothing
and silently does nothing — no error, no warning, just unlit-looking output.

When wrapping `onBeforeCompile`, do your own replacement **first**, then
delegate, and keep the anchor line in your output so the next handler can still
find it. `setupMaterialForDrape` does exactly this; `DrapedMesh.test.ts` pins
the ordering.

## 7. Draping (`DrapedMesh`)

`DrapedMesh.process()` paints a volume onto the terrain with a three-pass
stencil test (depth-fail counting, then a final pass with
`stencilFunc = NotEqual`, `side = BackSide`, `depthTest = false`). The volume
must be closed with outward-facing triangles: the counting relies on every
view ray leaving through a back face.

The back face a ray leaves through can lie far beyond the far plane, which
drops to 1000 km near the ground: a wide clamp-to-ground volume reaches
hundreds of kilometres below it (see `navara_geometry::ground_volume`). A
clipped back face is never counted, and the drape vanishes around the camera.
`setupMaterialForDrape` therefore clamps every draped material's depth to the
far plane (`chunks/drape_depth_clamp_*`, after `<logdepthbuf_vertex>` /
`<logdepthbuf_fragment>`): `gl_Position.z` is capped at `w` so nothing is
clipped, and the depth is written per fragment, from the log depth's `w` or
from the unclamped window depth, saturating at the far plane, which is still
behind the terrain.

The consequence that governs everything else: **the final pass has no depth
test, so one pixel can be covered by several back faces** where the volume
folds over a peak or the shape is non-convex. Only the first one in triangle
order is drawn, since it zeroes the stencil and the rest fail the test, and
which one that is is arbitrary. The drape therefore only looks like a flat
decal while its shading is a pure function of screen position.
`setupMaterialForDrape` (in `mesh/DrapedMesh.ts`) makes it one by shading at
the ground point under the pixel, reconstructed from the globe-depth copy along
the fragment's view ray.

It patches lit materials shaped like three's `ShaderLib` ones (the anchors are
listed on the function) and leaves the rest shaded on the volume:
`chunks/drape_ground_pars_fragment` goes right before `main`, and
`chunks/drape_ground_fragment` right after `#include <normal_fragment_begin>`,
so everything that reads `normal` or `vViewPosition` afterwards sees the
ground: normal maps, the polygon enhancer's `origNormal` snapshot (its G-buffer
normal and specular), and the lighting. The depth-to-eye-distance inverse,
including the logarithmic depth case, is `chunks/globe_depth_pars_fragment`,
shared with the ground `PolylineMeshDesc`. The drape binds the render pass's
own refs to its copy targets, and the polyline binds the view's
(`ViewContext.getGlobeDepthTextureUniform()`/`getGlobeNormalTextureUniform()`).
Both are pointed at the copy targets every frame.

- **Normal** — the terrain normal, sampled from the globe-normal copy at
  `gl_FragCoord`, used as is. A normal facing away from the camera is a real
  terrain normal (e.g. a steep hillshade slope), not a missing one: an
  unwritten texel decodes to the camera-facing (0, 0, 1). A globe that
  writes no normals leaves the drape shaded with that. With
  `NVR_DRAPE_ELLIPSOID_NORMAL` (set by `setDrapeGroundNormals(material,
  false)`), the ellipsoid normal at the ground point is used instead and the
  globe-normal copy is not read.
- **Position** — `vViewPosition` is redefined to the ground point, so light
  directions and CSM cascade selection use it.
- **Directional shadows** — `chunks/ground_shadow_coord_fragment` computes
  the shadow coordinates in the fragment shader from the ground point and the
  terrain normal (for the normal bias), with the same matrices as
  `<shadowmap_vertex>`: the stock `directionalShadowMatrix`, or
  `nvrCsmShadowMatrixView` where navara_three_csm's view-space patch defines
  `NVR_VIEW_SPACE_SHADOW` in the fragment shader. A program shares uniforms
  between its stages, so no varying is needed. The ground `PolylineMeshDesc`
  uses the same chunk.

`DrapedMesh` reports `castShadow` as `false` while draped (an own accessor),
since the volume would cast its own shape.

Point and spot light *shadows* and an `envMap` still read the volume's
position and reintroduce the artefact. Three's `fog` is unused here
(atmospheric haze is the screen-space `aerialPerspective` effect, which is
per-pixel and therefore safe).

The globe-normal and globe-depth copies are produced right after the globe
render and before `_renderDrapedMesh`, so the ordering already works. The
globe-normal copy is kept at 1x1 unless an effect or mesh requires
`globeNormal`.

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
  the _presence_ of the key decides, not its value — `update({ lit: undefined })`
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
