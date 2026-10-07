# Custom Descriptors — meshes, effects, depth/normal buffer access

For expression the built-ins can't produce, extend the descriptor base classes from `@navaramap/three`: `MeshDesc`, `InstancedMeshDesc`, `EffectDesc`, `LightDesc` (all extend `BaseDesc`). Register the class, then add instances declaratively — the config object's key selects the class.

## Lifecycle hooks (all descriptor kinds)

- `constructor(view, ctx, config)` — note: the base class stores only `id`/`visible`; declare and assign your own `config` field
- Factory: `createMesh()` (mesh), `createGeometry()`+`createMaterial()` (instanced mesh only), `createPass()` (effect), `createLight()` (light)
- `onUpdateConfig(updates)` — partial updates from `handle.update()`
- `update(time)` — optional per-frame hook; `onDestroy`; `onResize` (MeshDesc only)
- `this.view` — high-level state (camera, atmosphere, globe). `this.ctx` (`ViewContext`, Tier 1) — rendering internals: scenes (opaque/transparent/mrt/skyEnvMap/light/draped), pass management (`getPass`/`addPass`/`insertPassBefore`/`insertPassAfter`/`removePass`), renderer, G-buffer textures, CSM shadow helpers.

## Custom effect (post-processing) with pipeline ordering

```typescript
import { EffectDesc } from "@navaramap/three";

class VignetteEffectDesc extends EffectDesc<VignetteEffectConfig, VignetteEffectUpdate, Vignette> {
  static key = "vignette";
  static insertBefore = ["smaa", "fxaa", "final"];   // declare position in the render pipeline
  static allowDuplication = true;
  private config: VignetteEffectConfig;              // base class keeps only id/visible — store config yourself
  constructor(view: ThreeView, ctx: ViewContext, config: VignetteEffectConfig) {
    super(view, ctx, config);
    this.config = config;
  }
  createPass() {
    return new Vignette(this.view.camera.raw, {
      ...this.config.vignette,
      enabled: this.visible ?? true,
    });
  }
  onUpdateConfig(updates) {
    super.onUpdateConfig(updates);
    // map changed config fields onto this._instance
  }
}

view.registerEffect("vignette", VignetteEffectDesc);
const handle = view.addEffect<VignetteEffectDesc>({ vignette: { offset: 0.5, darkness: 0.5 } });
handle.update({ vignette: { darkness: 0.7 } });      // partial merge
```

Ordering is declared statically via `key` / `insertAfter` / `insertBefore` relative to other effects' keys. Runnable reference: `example/pages/custom-effect/` (Navara repo).

Placement rule: the built-in `transparent` pass renders overlay content that writes no depth/G-buffer data, so an effect that samples depth or G-buffer textures must use `insertBefore: ["transparent"]` (running after it paints over that content). Whole-frame screen effects (vignette, grading) insert after it via `insertBefore: ["smaa", "fxaa", "final"]`. Note that insertion resolves against passes that already exist at `addEffect` time — anchor to built-ins (`mrt`, `transparent`, `final`) when possible.

## Depth & normal buffer access

Navara renders into a multi-render-target (MRT) G-buffer, so custom work can both **write to** and **read from** it:

- **Built-in materials are automatic.** Importing `@navaramap/three` monkey-patches every Three.js `ShaderLib` material (`MeshStandard/Basic/Lambert/Phong`, `Sprite`, `Points`) to write the G-buffer — nothing to do for `MeshStandardMaterial` et al.
- **Custom `ShaderMaterial`/`LineMaterial` must opt in** — they bypass `ShaderLib`, so wire them in with one call:
  ```typescript
  import { setupMaterialForMRT } from "@navaramap/three";
  const material = new ShaderMaterial({ uniforms, vertexShader, fragmentShader });
  setupMaterialForMRT(material, { normal: "vNormal" });   // name your VIEW-SPACE normal varying (default "normal")
  // LineMaterial (three-stdlib) is detected and routed automatically; the `normal` option is ignored for it:
  setupMaterialForMRT(lineMaterial);
  ```
  `normal` must name a **view-space** normal (it's packed with `packNormalToVec2`). Skipping this makes the mesh write nothing to the normal/id/emissive buffers, so depth/normal-based effects (SSAO, SSR, outlines) and SelectiveEffect (Bloom/Outline) break on it. Idempotent. Reference: `example/pages/custom-shader/` (MarchingCubes), `example/pages/mesh-layers/custom-pickable/` (Navara repo).
- **Read depth/normal in a custom effect** — the canonical pattern (used by the built-in aerial-perspective and clouds effects): find the MRT pass from inside your `EffectDesc` via `this.find()` and wire its buffers into your pass. `MRTPassEffectDesc` is exported from `@navaramap/three` and auto-registered by `ThreeView` under the key `"mrt"`:
  ```typescript
  import { EffectDesc, type MRTPassEffectDesc } from "@navaramap/three";

  class MyDepthEffectDesc extends EffectDesc<Config, Update, MyPass> {
    static key = "myDepthEffect";
    static insertAfter = ["mrt"];             // must run after the MRT pass
    createPass() {
      const mrtPass = this.find<MRTPassEffectDesc>("mrt");   // find() looks up another effect by its static key
      // find() returns T | undefined, and the buffers are Texture | undefined — guard before use:
      if (!mrtPass?.normalBuffer || !mrtPass.depthBuffer) throw new Error("MRT pass not ready");
      const pass = new MyPass(this.view.camera.raw, mrtPass.normalBuffer, { ... });
      pass.raw.setCustomDepthTexture(mrtPass.depthBuffer, mrtPass.depthBufferPacking);
      return pass;
    }
  }
  ```
  `find<T>(key)` works for any cross-effect communication, not just MRT.
- **Inject a custom geometry buffer into SSR** — `SSREffectDesc` accepts `ssr: { geometryBuffer: Texture | null }` to control where SSR applies (e.g. app-drawn puddles); `null`/unset falls back to the MRT normal buffer. The texture must use the G-buffer encoding `vec4(packNormalToVec2(viewNormal), mask, roughness)` — `.z` is F0 (reflectance at normal incidence: 0.02 water, 1 mirror) — SSR skips pixels with `.z < 0.01` and cone tracing derives the reflection's Fresnel strength from it, so a mask of 1 makes a mirror while 0.02 only reflects strongly at grazing angles; `.w` drives the cone-tracing blur (default path) or multiplies `.z` for GGX jitter (cone tracing off). Texture *contents* updates need no API call; swapping the texture *object* goes through `handle.update({ ssr: { geometryBuffer } })`. Runnable reference: `example/pages/ssr-puddle/` (Navara repo). Effects built on the `postprocessing` library can alternatively declare `attributes: EffectAttribute.DEPTH` to receive composer depth in `mainImage` (see `SSREffect`). Real implementations to copy from (Navara repo): `navara_three_default_descs/src/effects/AerialPerspectiveEffectDesc.ts`, `CloudsEffectDesc.ts`, `ssr/SSREffect.ts`.
- **Terrain and the globe do NOT write the main MRT normal buffer** — their normals live in the separate globe copies (`ctx.getGlobeNormalTexture()`, `MRTPassEffectDesc.globeNormalBuffer`). In the main normal buffer, terrain pixels keep packed normal `(0, 0)` (which `unpackVec2ToNormal` decodes as `(0, 0, 1)` — a bogus camera-facing normal). Shaders that classify pixels by G-buffer normal must treat `dot(g.xy, g.xy) ≈ 0` as "no normal written", not as a valid normal (verified in `example/pages/ssr-puddle/`).
- **Optional buffers exist only when a descriptor requests them** — the `normal`/`selectiveEffect`/`emissive`/`shadow` attachments and the `globeNormal` copy are allocated from the union of every effect's and mesh's `getRequiredBuffers()`; an unrequested `globeNormal` stays a 1x1 texture, so a shader sampling it reads one stale texel with no error. Effects declare `static requiredBuffers`; meshes override `getRequiredBuffers()` (default: `["globeNormal"]` in the `draped` pass, else `[]`). The result must follow from the config alone (read before `onCreate()`); when an `update()` changes it, emit `this.ctx.emit("gbufferRequirementsChanged")` (moving into/out of the `draped` pass emits it for you).
- **Read via `ViewContext` accessors** — `this.ctx` also exposes buffers directly (each throws before the render pass is initialized, so call from `createPass()`/`update()`, not the constructor):
  - `ctx.getGlobeDepthTexture()` / `ctx.getGlobeNormalTexture()` — globe-only depth/normal copies for post-processing
  - `ctx.getRenderTarget()` — the main G-buffer render target; `ctx.getNormalTexture()` / `ctx.getEffectIdsTexture()` / `ctx.getEmissiveTexture()` — its attachments 1–3
  - `ctx.getInputBuffer()` — the effect composer's input buffer; `ctx.getRenderer()` — the `WebGLRenderer`
- **Read the G-buffer back on the CPU** — `BufferView` (from `@navaramap/three`) reads MRT attachments off a render target, e.g. for debug visualization. Use `renderFromPixels()` for HalfFloat attachments (plain `render()` reads `Uint8Array` data only). Reference: `example/pages/debug/selective-effect/debugView.ts` (Navara repo).
- Depth-position queries from app code (no custom descriptor needed): `view.pickDepthPosition(x, y)` returns the ECEF position under a pixel using the full depth buffer.

Gotchas: some effects don't support `logarithmicDepthBuffer` (set it `false` when using them) and `hideUnderground: false` can break effect descriptors.

## Custom mesh

```typescript
import { MeshDesc } from "@navaramap/three";

export class MarchingCubesDesc extends MeshDesc<Config, Update, MarchingCubes> {
  createMesh() { /* build and return the Three.js object; apply matrix, shadows */ }
}
view.registerMesh("marchingCubes", MarchingCubesDesc);
view.addMesh<MarchingCubesDesc>({
  marchingCubes: { resolution: 50, material, castShadow: true },
  position: { x, y, z },                 // ECEF meters (or use matrixWorld + ENU frame)
  scale: new Vector3().setScalar(1500),
});
```

`InstancedMeshDesc` adds `add/removeAt/updateAt/clear/replaceAll/count` for per-instance management. Meshes can override `getPassKey()` to choose which scene/pass they render in.

## Picking for custom meshes

Simple cases: wrap with `PickableMeshWrapper` / `PickableInstancedMeshWrapper`. Custom shaders must implement the `PickableMesh` interface and encode the 24-bit `batchId` as RGB in their fragment shader:

```typescript
class PickableTorusKnot extends Object3D implements PickableMesh {
  constructor(public mesh, ctx: ViewContext) {
    super();
    this.batchId = ctx.genGlobalBatchId() ?? 0;
    mesh.material.uniforms.uBatchId.value = this.batchId;
    ctx.registerPickableMesh("torusKnot", this);   // (key: string, mesh: PickableMesh & Object3D)
  }
  onBeforePicking() { this.mesh.material.uniforms.uPicking.value = 1; }
  onAfterPicking()  { this.mesh.material.uniforms.uPicking.value = 0; }
  getRenderable()   { return this.mesh; }
}
// fragment shader: R = high byte, G = mid byte, B = low byte of batchId
```

Reference: `example/pages/mesh-layers/custom-pickable/main.ts` (Navara repo). Full authoring guide: https://navara.world/docs/three/core/custom-desc/
