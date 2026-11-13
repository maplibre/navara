# Custom Descriptors — meshes, effects, lights

For expression the built-ins can't produce, extend the descriptor base classes from `@navaramap/three`: `MeshDesc`, `InstancedMeshDesc`, `EffectDesc`, `LightDesc` (all extend `BaseDesc`). Register the class, then add instances declaratively — the config object's key selects the class.

Reading and writing the depth/normal/shadow G-buffers from a descriptor: [gbuffer.md](gbuffer.md).

- **`registerMesh()` / `registerEffect()` / `registerLight()` before `init()` throw** (e.g. "Cannot read properties of undefined (reading 'mesh')"): `view.init()` creates the registries. Register custom descriptors after it (or from a plugin), and type the view with a union so `addMesh` accepts their keys: `new ThreeView<DefaultDescriptions | { mesh: MyMeshConfig }>()`.

## Lifecycle hooks (all descriptor kinds)

- `constructor(view, ctx, config)` — note: the base class stores only `id`/`visible`; declare and assign your own `config` field
- Factory: `createMesh()` (mesh), `createGeometry()`+`createMaterial()` (instanced mesh only), `createPass()` (effect — returns a `postprocessing` `Pass`, or a wrapper object exposing it as `raw`; kept as `this._instance`), `createLight()` (light)
- `onUpdateConfig(updates)` — partial updates from `handle.update()`
- `update(time)` — optional per-frame hook; `onDestroy`; `onResize` (MeshDesc only)
- `this.view` — high-level state (camera, atmosphere, globe). `this.ctx` (`ViewContext`, API stability Tier 1 — may break between minor versions) — rendering internals: scenes (opaque/transparent/mrt/skyEnvMap/light/draped), pass management (`getPass`/`addPass`/`insertPassBefore`/`insertPassAfter`/`removePass`), renderer, G-buffer textures, CSM shadow helpers.

## Custom effect (post-processing) with pipeline ordering

```typescript
import { EffectDesc } from "@navaramap/three";

class VignetteEffectDesc extends EffectDesc<
  VignetteEffectConfig,
  VignetteEffectUpdate,
  Vignette
> {
  static key = "vignette";
  static insertBefore = ["smaa", "fxaa", "final"]; // declare position in the render pipeline
  static allowDuplication = true;
  private config: VignetteEffectConfig; // base class keeps only id/visible — store config yourself
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
const handle = view.addEffect<VignetteEffectDesc>({
  vignette: { offset: 0.5, darkness: 0.5 },
});
handle.update({ vignette: { darkness: 0.7 } }); // partial merge
```

Ordering is declared statically via `key` / `insertAfter` / `insertBefore` relative to other effects' keys. Runnable reference: `example/pages/custom-effect/` (Navara repo).

- **How the position resolves:** each `insertAfter` key is tried in order and the first existing pass wins; only when none exists are the `insertBefore` keys tried; with no match the pass is appended to the end. So `insertBefore` is a fallback, not a second constraint. Insertion resolves against passes that already exist at `addEffect` time — anchor to built-ins when possible. Built-in order: `skyEnvMap` → `mrt` → … → `transparent` → `final`.
- **Placement rule:** the built-in `transparent` pass renders overlay content that writes no depth/G-buffer data, so an effect that samples depth or G-buffer textures must run **before** it (running after it paints over that content). Either `static insertAfter = ["mrt"]` (right after MRT, which is already before `transparent`) or `static insertBefore = ["transparent"]` does it; the built-ins use `insertAfter = ["mrt"]` plus `insertBefore = ["transparent"]` as the fallback. Whole-frame screen effects (vignette, grading) go after it via `insertBefore: ["smaa", "fxaa", "final"]`.
- **Registered name vs `static key`:** `view.registerEffect(name, cls)`'s `name` is the config key that selects the class in `addEffect({ [name]: … })`; `static key` is the pass identity that other effects' `insertAfter`/`insertBefore` and `find()` match. Keep the two identical, as every built-in does.
- **Looking up other descriptors:** `this.find<T>(key)` and `this.ctx.findEffect<T>(key)` are the same lookup (by `static key`, `T | undefined`); `ctx.findLight(name)` / `ctx.findMesh(name)` match the registered name (`"sun"`, `"gltfModel"`).

## Reading scene state from a descriptor

- **A custom effect should inherit scene config, not re-declare it** — `ctx.findLight("sun")` / `findEffect` / `findMesh` resolve active descs (see the lookup rule above), so a lighting effect reads the sun's real intensity and `view.atmosphere.sunDirection` instead of growing its own options.
- **`view.atmosphere.textures.scatteringTexture` / `higherOrderScatteringTexture` are GPU-only once rendered** — their CPU data (`image.data`) is dropped after the first upload, so they can't be read on the CPU or bound in a second `WebGLRenderer`. The 2D `transmittanceTexture` / `irradianceTexture` keep their data. Get them via `view.atmosphere.onTexturesReady(cb, needs)`, never by polling `textures`, which loads lazily.

## Custom mesh

```typescript
import { MeshDesc } from "@navaramap/three";

export class MarchingCubesDesc extends MeshDesc<Config, Update, MarchingCubes> {
  createMesh() {
    /* build and return the Three.js object; apply matrix, shadows */
  }
}
view.registerMesh("marchingCubes", MarchingCubesDesc);
view.addMesh<MarchingCubesDesc>({
  marchingCubes: { resolution: 50, material, castShadow: true },
  position: { x, y, z }, // ECEF meters (or use matrixWorld + ENU frame)
  scale: new Vector3().setScalar(1500),
});
```

`InstancedMeshDesc` adds `add/removeAt/updateAt/clear/replaceAll/count` for per-instance management. Meshes can override `getPassKey()` to choose which scene/pass they render in.

## Picking for custom meshes

Simple cases: wrap with `PickableMeshWrapper` / `PickableInstancedMeshWrapper`. Custom shaders must implement the `PickableMesh` interface and encode the 24-bit `batchId` as RGB in their fragment shader:

```typescript
class PickableTorusKnot extends Object3D implements PickableMesh {
  constructor(
    public mesh,
    ctx: ViewContext,
  ) {
    super();
    this.batchId = ctx.genGlobalBatchId() ?? 0;
    mesh.material.uniforms.uBatchId.value = this.batchId;
    ctx.registerPickableMesh("torusKnot", this); // (key: string, mesh: PickableMesh & Object3D)
  }
  onBeforePicking() {
    this.mesh.material.uniforms.uPicking.value = 1;
  }
  onAfterPicking() {
    this.mesh.material.uniforms.uPicking.value = 0;
  }
  getRenderable() {
    return this.mesh;
  }
}
// fragment shader: R = high byte, G = mid byte, B = low byte of batchId
```

Reference: `example/pages/mesh-layers/custom-pickable/main.ts` (Navara repo). Full authoring guide: https://navara.world/docs/three/core/custom-desc/
