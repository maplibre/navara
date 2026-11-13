# G-buffer — depth, normal and shadow buffer access

For custom materials and effects. Descriptor classes and lifecycle: [custom-desc.md](custom-desc.md). Where an effect that samples these buffers must sit in the pipeline (before the `transparent` pass) and how `insertAfter`/`insertBefore` resolve: [custom-desc.md](custom-desc.md#custom-effect-post-processing-with-pipeline-ordering).

## Writing and reading the buffers

Navara renders into a multi-render-target (MRT) G-buffer, so custom work can both **write to** and **read from** it:

- **Built-in materials are automatic.** Importing `@navaramap/three` monkey-patches every Three.js `ShaderLib` material (`MeshStandard/Basic/Lambert/Phong`, `Sprite`, `Points`) to write the G-buffer — nothing to do for `MeshStandardMaterial` et al.
- **Custom `ShaderMaterial`/`LineMaterial` must opt in** — they bypass `ShaderLib`, so wire them in with one call:
  ```typescript
  import { setupMaterialForMRT } from "@navaramap/three";
  const material = new ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
  });
  setupMaterialForMRT(material, { normal: "vNormal" }); // name your VIEW-SPACE normal varying (default "normal")
  // LineMaterial (three-stdlib) is detected and routed automatically; the `normal` option is ignored for it:
  setupMaterialForMRT(lineMaterial);
  ```
  `normal` must name a **view-space** normal (it's packed with `packNormalToVec2`). Skipping this makes the mesh write nothing to the normal/id/emissive buffers, so depth/normal-based effects (SSAO, SSR, outlines) and SelectiveEffect (Bloom/Outline) break on it. Idempotent. Reference: `example/pages/custom-shader/` (MarchingCubes), `example/pages/mesh-layers/custom-pickable/` (Navara repo).
- **Read depth/normal in a custom effect** — the canonical pattern (used by the built-in aerial-perspective, SSR and fog-light effects): declare the attachments you sample in `static requiredBuffers`, wire depth once in `createPass()`, and re-fetch the attachments in `update()`. `MRTPassEffectDesc` is exported from `@navaramap/three` and auto-registered by `ThreeView` under the key `"mrt"`:

  ```typescript
  import {
    EffectDesc,
    type GBufferName,
    type MRTPassEffectDesc,
  } from "@navaramap/three";

  class MyDepthEffectDesc extends EffectDesc<Config, Update, MyPass> {
    static key = "myDepthEffect";
    static insertAfter = ["mrt"]; // right after the MRT pass, which is already before `transparent`
    // Without this the normal attachment is not allocated and getNormalTexture() stays undefined:
    static requiredBuffers: readonly GBufferName[] = ["normal"];
    createPass() {
      const mrtPass = this.find<MRTPassEffectDesc>("mrt"); // find() looks up another effect by its static key
      if (!mrtPass?.depthBuffer) throw new Error("MRT pass not ready"); // T | undefined, Texture | undefined
      const pass = new MyPass(this.view.camera.raw, { ... });
      // Depth is wired once: the depth texture object survives a G-buffer rebuild.
      pass.raw.setCustomDepthTexture(mrtPass.depthBuffer, mrtPass.depthBufferPacking);
      return pass;
    }
    update(_time: number) {
      // Attachments are re-fetched every frame: a G-buffer rebuild swaps the texture objects.
      this._instance?.setNormalBuffer(this.ctx.getNormalTexture() ?? null); // your pass's own setter
    }
  }
  ```

  Grabbing `mrtPass.normalBuffer` once in `createPass()` breaks twice: it is `undefined` until some descriptor requires `"normal"`, and stale after the next rebuild. `find<T>(key)` works for any cross-effect communication, not just MRT.

- **Normal attachment layout:** RG = octahedral-packed view-space normal, B = F0 (reflectance at normal incidence), A = roughness (and the blend factor, so it is not free for other data). `NORMAL_PACKING_SHADER` (a GLSL string exported from `@navaramap/three`, defining `packNormalToVec2` / `unpackVec2ToNormal`) is prepended to a fragment source that cannot use `#include`, e.g. a `postprocessing` effect: ``const fragmentShader = `${NORMAL_PACKING_SHADER}\n…unpackVec2ToNormal(texture2D(tNormal, uv).xy)…`;``.
- **Inject a custom geometry buffer into SSR** — `SSREffectDesc` accepts `ssr: { geometryBuffer: Texture | null }` to control where SSR applies (e.g. app-drawn puddles); `null`/unset falls back to the MRT normal buffer. The texture must use the G-buffer encoding `vec4(packNormalToVec2(viewNormal), mask, roughness)` — `.z` is F0 (reflectance at normal incidence: 0.02 water, 1 mirror) — SSR skips pixels with `.z < 0.01` and cone tracing derives the reflection's Fresnel strength from it, so a mask of 1 makes a mirror while 0.02 only reflects strongly at grazing angles; `.w` drives the cone-tracing blur (default path) or multiplies `.z` for GGX jitter (cone tracing off). Texture _contents_ updates need no API call; swapping the texture _object_ goes through `handle.update({ ssr: { geometryBuffer } })`. Runnable reference: `example/pages/ssr-puddle/` (Navara repo). Effects built on the `postprocessing` library can alternatively declare `attributes: EffectAttribute.DEPTH` to receive composer depth in `mainImage` (see `SSREffect`). Real implementations to copy from (Navara repo): `navara_three_default_descs/src/effects/AerialPerspectiveEffectDesc.ts`, `CloudsEffectDesc.ts`, `ssr/SSREffect.ts`.
- **Terrain and the globe do NOT write the main MRT normal buffer** — their normals live in the separate globe copy (`ctx.getGlobeNormalTexture()`, `MRTPassEffectDesc.globeNormalBuffer`), a raw copy of the normal attachment taken right after the globe scene renders: same packing, so decode it with `unpackVec2ToNormal(texture2D(tGlobeNormal, uv).xy)`, and request it with `"globeNormal"` (which implies `"normal"`). In the main normal buffer, terrain pixels keep packed normal `(0, 0)` (which `unpackVec2ToNormal` decodes as `(0, 0, 1)` — a bogus camera-facing normal). Shaders that classify pixels by G-buffer normal must treat `dot(g.xy, g.xy) ≈ 0` as "no normal written", not as a valid normal (verified in `example/pages/ssr-puddle/`).
- **Optional buffers exist only when a descriptor requests them** — the `normal`/`selectiveEffect`/`emissive`/`shadow` attachments and the `globeNormal` copy are allocated from the union of every effect's and mesh's `getRequiredBuffers()`. What an unrequested buffer looks like differs: the attachment getters (`ctx.getNormalTexture()` / `getEffectIdsTexture()` / `getEmissiveTexture()` / `getShadowTexture()`, `MRTPassEffectDesc.normalBuffer` / `effectIdsBuffer` / `emissiveBuffer` / `shadowBuffer`) return `undefined`, while the `globeNormal` copy always returns a texture that stays 1x1, so a shader sampling it reads one stale texel with no error. Effects declare `static requiredBuffers`; meshes override `getRequiredBuffers()` (default: `["globeNormal"]` in the `draped` pass, else `[]`). The result must follow from the config alone (read before `onCreate()`); when an `update()` changes it, emit `this.ctx.emit("gbufferRequirementsChanged")` (moving into/out of the `draped` pass emits it for you).
- **Read via `ViewContext` accessors** — `this.ctx` also exposes buffers directly. Every accessor throws ("CustomRenderPass isn't initialized yet.") before the render pass exists, so call from `createPass()`/`update()`, not the constructor; after that, an unallocated attachment is `undefined`, not a throw:
  - `ctx.getGlobeDepthTexture()` / `ctx.getGlobeNormalTexture()` — globe-only depth/normal copies for post-processing; `ctx.getGlobeDepthTextureUniform()` / `getGlobeNormalTextureUniform()` return uniform refs kept current every frame (bind the ref itself, not its `.value`)
  - `ctx.getRenderTarget()` — the main G-buffer render target; `ctx.getNormalTexture()` / `ctx.getEffectIdsTexture()` / `ctx.getEmissiveTexture()` / `ctx.getShadowTexture()` — its optional attachments (`Texture | undefined`)
  - `ctx.getInputBuffer()` — the effect composer's input buffer; `ctx.getRenderer()` — the `WebGLRenderer`
- **Read the G-buffer back on the CPU** — `BufferView` (from `@navaramap/three`) reads MRT attachments off a render target, e.g. for debug visualization. Use `renderFromPixels()` for HalfFloat attachments (plain `render()` reads `Uint8Array` data only). Reference: `example/pages/debug/selective-effect/debugView.ts` (Navara repo).
- Depth-position queries from app code (no custom descriptor needed): `view.pickDepthPosition(x, y)` returns the ECEF position under a pixel using the full depth buffer.

Gotchas: some effects don't support `logarithmicDepthBuffer` (set it `false` when using them) and `hideUnderground: false` can break effect descriptors.

## Optional buffers: declare, never assume

- **Optional G-buffers: declare, never assume.** They exist only while an active effect or mesh requires them (`static requiredBuffers` / `getRequiredBuffers()`), so read them through the `ViewContext`/`MRTPassEffectDesc` getters (`undefined` when not allocated) and **re-fetch every frame** — a config change rebuilds the attachments. Never hardcode an attachment index; they are packed and shift. Switching the set reallocates attachments and recompiles shaders, so add an effect once and tune via `handle.update()` rather than add/remove per frame. Only MRT-pass fragments write the G-buffer at all — a mesh sitting in the opaque/transparent scene contributes nothing to it.
- **Fixed buffer needs go in `static requiredBuffers`, config-dependent ones in a `getRequiredBuffers()` override.** The view reads the instance method (its default returns the static), and an override replaces the static completely, so never declare both. It is read before `onCreate`, so derive it from the constructor config, and emit `ctx.emit("gbufferRequirementsChanged")` when an `update()` changes the result.
- **Allocating any optional G-buffer silently re-routes meshes into the MRT pass** (so their own normal/shadow/mask is written instead of the terrain's showing through). Expect the first `addEffect` that needs a buffer to recompile and to shift where meshes render. Self-shadow acne (striping) on large mesh faces in the shadow buffer is tamed with `sun: { shadowNormalBias: ~3 }`.

## Decoding normals

- **Never reconstruct a G-buffer normal with `xy * 2 - 1`** — it is octahedral; decode with `unpackVec2ToNormal` from `NORMAL_PACKING_SHADER` (exported from `@navaramap/three`, prepended to the fragment source — see above). The wrong reconstruction looks plausible and costs a long debugging session. Known inconsistency to watch for: `instancedSprite.frag.glsl` / `sdfText.frag.glsl` define a LOCAL `xy*0.5+0.5` packer that does not match.

## Shadow buffer

- **Only materials that run three's lighting chunks write the shadow buffer.** Terrain/raster tiles fall back to `MeshBasicMaterial` without vertex normals (`quantized-mesh` + `requestVertexNormals: true`), a hillshade material or `useNormal: true`, and a basic material never writes a shadow term. Sprites, text, points, `LineMaterial` and custom `ShaderMaterial` write the "no data" value on purpose.
- **The shadow buffer holds PCF output, not penumbra data.** `renderer.shadowMap.type` is fixed to `PCFShadowMap`, so softness is `sun.shadowRadius` widening a 3x3 kernel and reads as stipple past ~2. With no blocker distance in the buffer, a post filter can only smooth the edge at one radius.

Re-lighting from the normal + shadow buffers (`view.lit = false`): [lighting.md](lighting.md#deferred-lighting).
