---
title: Custom Descriptor
description: How to implement custom descriptors
sidebar:
  order: 1070
---

In navara_three, you can implement your own mesh, effect, and light descriptors. For an overview of the layer concept, see [Layers & Descriptors](../../../three/introduction/about-layer/).

## Descriptor Base Classes

Depending on the descriptor type, you inherit from the corresponding base class to implement your Descriptor.

| Descriptor Type     | Base Class                      | Factory Method                          | Registration Method     |
| -------------- | ------------------------------- | --------------------------------------- | ----------------------- |
| Mesh           | `MeshDesc`          | `createMesh()`                          | `view.registerMesh()`   |
| Instanced Mesh | `InstancedMeshDesc` | `createGeometry()` + `createMaterial()` | `view.registerMesh()`   |
| Effect         | `EffectDesc`        | `createPass()`                          | `view.registerEffect()` |
| Light          | `LightDesc`         | `createLight()`                         | `view.registerLight()`  |

All base classes inherit from `BaseDesc` and share a common lifecycle.

## Common Lifecycle

| Method                           | Timing                           | Description                                                                                            |
| -------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `constructor(view, ctx, config)` | When the Descriptor is created   | Receives the ThreeView, ViewContext, and configuration                                                 |
| `onCreate()`                     | When `addMesh()`/`addLight()`/`addEffect()` is called | Calls the factory method to create an instance and adds it to the scene. Implemented by the base class |
| `onUpdateConfig(updates)`        | When `handle.update()` is called | Processes partial configuration updates                                                                |
| `onDestroy()`                    | When `handle.delete()` is called | Releases resources and removes from the scene                                                          |
| `update(time)`                   | Every frame (optional)           | Animation processing. Only called if implemented                                                       |
| `onResize(width, height)`        | On viewport resize (optional)    | Mesh Descriptors only. Only called if implemented                                                           |

## Common Properties

| Property    | Type                    | Description                                                                                |
| ----------- | ----------------------- | ------------------------------------------------------------------------------------------ |
| `view`      | `ThreeView`             | The ThreeView instance providing access to camera, atmosphere, globe, and other view state |
| `ctx`       | `ViewContext`           | The view context providing access to scenes, passes, and rendering internals               |
| `_instance` | `Instance \| undefined` | The created Three.js object                                                                |
| `id`        | `string`                | Unique identifier of the object                                                            |
| `visible`   | `boolean`               | Show/hide                                                                                  |

### view and ctx

Custom descriptors access internal APIs through two properties: `this.view` and `this.ctx`.

- **`this.view`** (`ThreeView`): High-level view state: camera, atmosphere, globe
- **`this.ctx`** (`ViewContext`): Rendering internals: scenes, post-processing passes, buffers, textures

#### view Properties

See [ThreeView Properties](../../../three/api/threeview-properties/).

#### ctx Properties

| Property                 | Description                                   |
| ------------------------ | --------------------------------------------- |
| `ctx.scenes.opaque`      | Scene for opaque objects                      |
| `ctx.scenes.transparent` | Scene for transparent objects                 |
| `ctx.scenes.mrt`         | Scene for selective effects (Bloom / Outline) |
| `ctx.scenes.skyEnvMap`   | Scene for environment maps                    |
| `ctx.scenes.light`       | Scene for lights                              |
| `ctx.scenes.draped`      | Scene for terrain-draped meshes               |

#### Pass Management

| Method                                         | Description                           |
| ---------------------------------------------- | ------------------------------------- |
| `ctx.getPass(name)`                            | Get a post-processing pass by name    |
| `ctx.addPass(name, pass)`                      | Add a post-processing pass            |
| `ctx.insertPassBefore(targetName, name, pass)` | Insert a pass before the target pass  |
| `ctx.insertPassAfter(targetName, name, pass)`  | Insert a pass after the target pass   |
| `ctx.removePass(name)`                         | Remove a post-processing pass by name |

#### Renderer Access

| Method                 | Description                                   |
| ---------------------- | --------------------------------------------- |
| `ctx.getRenderer()`    | Get the WebGLRenderer instance                |
| `ctx.getInputBuffer()` | Get the input buffer from the effect composer |

#### Descriptor Lookup

| Method                  | Description                                                                 |
| ----------------------- | --------------------------------------------------------------------------- |
| `ctx.findEffect(key)`   | First active effect Descriptor registered under `key` (e.g. `"mrt"`)         |
| `ctx.findLight(key)`    | First active light Descriptor registered under `key` (e.g. `"sun"`)          |
| `ctx.findMesh(key)`     | First active mesh Descriptor registered under `key` (e.g. `"gltfModel"`)     |

Use these to inherit the scene's existing configuration instead of duplicating it: a custom lighting effect can read the sun's intensity and colour from `ctx.findLight("sun")` rather than taking its own options. Each returns `undefined` when no such Descriptor is active.

#### Buffer / Texture Access

| Method                        | Description                                      |
| ----------------------------- | ------------------------------------------------ |
| `ctx.getRenderTarget()`       | Get the main render target (includes G-buffer)   |
| `ctx.getGlobeDepthTexture()`  | Get the globe depth texture for post-processing  |
| `ctx.getGlobeNormalTexture()` | Get the terrain-only normal, sampled in screen space. Declare `globeNormal` in `requiredBuffers`. It is kept at 1x1 otherwise |
| `ctx.getNormalTexture()`      | Get the scene normal texture from the G-buffer   |
| `ctx.getEffectIdsTexture()`   | Get the effect IDs texture from the G-buffer     |
| `ctx.getEmissiveTexture()`    | Get the emissive texture from the G-buffer       |
| `ctx.getShadowTexture()`      | Get the shadow texture (R=shadow amount, 0=lit..1=fully shadowed) from the G-buffer |

#### Shadow (Experimental)

| Method                               | Description                        |
| ------------------------------------ | ---------------------------------- |
| `ctx.applyShadowMaterial(material)`  | Apply CSM shadows to a material    |
| `ctx.removeShadowMaterial(material)` | Remove CSM shadows from a material |

## G-Buffer (MRT) Output

Navara renders into a multiple-render-target (MRT) G-buffer. Depth/normal-based effects (SSAO, SSR, outlines, aerial perspective, clouds) and selective effects (Bloom / Outline) read these attachments, so a mesh participates in those effects only if its material writes the G-buffer.

Only color and normal are always present. The rest are allocated on demand and **packed after them with no gaps**, so their locations shift with the configuration. The shader receives each one's `layout(location = …)` as a stamped define.

| Attachment | Location | Contents                                                     | Allocated                |
| ---------- | -------- | ------------------------------------------------------------ | ------------------------ |
| Color      | 0        | `gl_FragColor`                                                | always                   |
| Normal     | 1        | View-space normal (plus material properties)                  | always                   |
| Effect ID  | packed   | Selective-effect bitmask                                      | `buffers.selectiveEffect` |
| Emissive   | packed   | Selective-effect additive emissive                            | `buffers.emissive`        |
| Shadow     | packed   | R = shadow amount (0 = lit .. 1 = shadowed), G = albedo flag  | `buffers.shadow`          |

Never hardcode an optional attachment index. Read it from the `ViewContext` accessors below.

### Built-in Materials Are Automatic

Importing `@navaramap/three` patches every built-in Three.js material (`MeshStandardMaterial`, `MeshBasicMaterial`, `MeshLambertMaterial`, `MeshPhongMaterial`, `SpriteMaterial`, `PointsMaterial`) so they write the G-buffer. When your custom Descriptor uses one of these, there is nothing to do.

### Custom Materials Must Opt In

`ShaderMaterial` and three-stdlib `LineMaterial` do not go through Three.js `ShaderLib`, so Navara cannot patch them automatically. Opt them in with `setupMaterialForMRT()`.

```typescript
import { setupMaterialForMRT } from "@navaramap/three";

const material = new ShaderMaterial({ uniforms, vertexShader, fragmentShader });

// Name the view-space normal variable in your fragment shader (default "normal").
setupMaterialForMRT(material, { normal: "vNormal" });

// LineMaterial is detected and routed automatically; `normal` is ignored for it.
setupMaterialForMRT(lineMaterial);
```

| Parameter        | Type             | Description                                                                                                                             |
| ---------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `material`       | `ShaderMaterial` | The custom material to patch. `LineMaterial` (which extends `ShaderMaterial`) is detected and handled automatically                    |
| `options.normal` | `string`         | Name of the **view-space** normal variable in the fragment shader. Defaults to `"normal"`. It is packed with `packNormalToVec2`, which assumes view space |

If you skip this, the mesh writes nothing to the normal / effect-ID / emissive attachments, so depth/normal-based effects and selective effects break on that mesh (garbage normals, no bloom or outline).

Requirements and behavior:

- The fragment shader must expose a view-space normal named by `options.normal`.
- The last `}` in the vertex and fragment shaders is assumed to close `main()`.
- Requires WebGL2 / GLSL 3 (Navara's default).
- Idempotent: calling it again on the same material is a no-op.

The automatic built-in patching is performed by an internal `overrideMaterialsForMRT()` on import. Application code never calls it.

#### Complete Example

Two things are required, and missing either one silently produces a mesh that
takes part in no depth/normal-based effect:

1. `setupMaterialForMRT()`, so the material writes the attachments.
2. `getPassKey()` returning `"mrt"`, so the mesh renders in the G-buffer pass.
   The default is `"opaque"`, which is composited **after** the G-buffer copy —
   a mesh left there writes nothing, whatever its material does.

```typescript
import ThreeView, {
  MeshDesc,
  setupMaterialForMRT,
  type MeshConfig,
  type MeshUpdate,
  type PassKey,
  type ViewContext,
} from "@navaramap/three";
import { Mesh, ShaderMaterial, SphereGeometry, Uniform, Vector3 } from "three";

type Description = { glowSphere?: { radius?: number } };
type GlowSphereConfig = MeshConfig & Description;
type GlowSphereUpdate = MeshUpdate & Description;

class GlowSphereDesc extends MeshDesc<
  GlowSphereConfig,
  GlowSphereUpdate,
  Mesh<SphereGeometry, ShaderMaterial>
> {
  private config: GlowSphereConfig;

  constructor(view: ThreeView, ctx: ViewContext, config: GlowSphereConfig) {
    super(view, ctx, config);
    this.config = config;
  }

  protected override getPassKey(): PassKey {
    return "mrt";
  }

  createMesh() {
    const material = new ShaderMaterial({
      uniforms: { uColor: new Uniform(new Vector3(0.1, 0.8, 0.5)) },
      vertexShader: `
        varying vec3 vNormal;
        void main() {
          // View space — packNormalToVec2 assumes it.
          vNormal = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        varying vec3 vNormal;
        void main() {
          gl_FragColor = vec4(uColor, 1.0);
        }
      `,
    });

    setupMaterialForMRT(material, { normal: "vNormal" });

    const radius = this.config.glowSphere?.radius ?? 100;
    return new Mesh(new SphereGeometry(radius, 32, 32), material);
  }
}

const view = new ThreeView();
view.registerMesh("glowSphere", GlowSphereDesc);
await view.init();

view.addMesh<GlowSphereDesc>({
  glowSphere: { radius: 200 },
  position: { x: 0, y: 0, z: 6_400_000 },
});
```

### Reading the G-Buffer

To read these buffers from a custom effect, use the [Buffer / Texture Access](#buffer--texture-access) accessors on `ctx`, or reference the MRT pass from another effect via [`find<MRTPassEffectDesc>("mrt")`](#referencing-other-effect-descs).

The effectIds, emissive, shadow and globeNormal buffers are optional: they exist only while an active effect declares them in its `static requiredBuffers` (e.g. `["selectiveEffect", "emissive"]`, `["shadow"]` or `["globeNormal"]`), and the accessors return `undefined` otherwise.

An effect whose needs depend on its own configuration overrides `getRequiredBuffers()` instead. The override replaces the static entirely, so declare one or the other. It is read before `onCreate()`, so derive the result from the constructor config, and emit `gbufferRequirementsChanged` on `ctx` when an `update()` changes it. The view then re-derives the buffers. The emit throws when the new attachment exceeds the device's `MAX_DRAW_BUFFERS`, so restore your previous state before letting that error propagate.

```typescript
import { type GBufferName } from "@navaramap/three";

export class MyEffectDesc extends EffectDesc<MyEffectConfig, MyEffectUpdate, MyPostProcessingPass> {
  static key = "myEffect";

  private shadow: boolean;

  constructor(view: ThreeView, ctx: ViewContext, config: MyEffectConfig) {
    super(view, ctx, config);
    this.shadow = config.myEffect?.shadow ?? false;
  }

  getRequiredBuffers(): readonly GBufferName[] {
    return this.shadow ? ["normal", "shadow"] : ["normal"];
  }

  update(config: MyEffectUpdate) {
    const shadow = config.myEffect?.shadow;
    if (shadow !== undefined && shadow !== this.shadow) {
      this.shadow = shadow;
      this.ctx.emit("gbufferRequirementsChanged");
    }
  }
}
```

`globeNormal` is the odd one out: it is a separate screen-space copy of the terrain normal rather than a G-buffer attachment, so it takes no attachment slot and does not count against the device's `MAX_DRAW_BUFFERS`. Undeclared, its target stays 1x1 and `ctx.getGlobeNormalTexture()` returns a texture you cannot sample meaningfully. A custom effect that reads them must declare `requiredBuffers` so the view allocates them. Note that changing the set of allocated buffers reallocates attachments and recompiles shaders, so effects should be added once and tuned via `update()` rather than added and removed repeatedly. Because a configuration change rebuilds the attachments, fetch these textures each frame (in `update()` or the pass's `render()`) instead of caching them at pass creation.

Buffer encodings to be aware of when sampling:

- The normal buffer's RG channels hold the **view-space normal in octahedral encoding**. Decode with `unpackVec2ToNormal()` from the `NORMAL_PACKING_SHADER` GLSL string exported by `@navaramap/three` (a plain `xy * 2 - 1` reconstruction produces wrong shading).
- The shadow buffer holds `R = shadow amount` (0 = lit .. 1 = fully shadowed) and `G = albedo-output flag` (1 when the fragment's color is plain albedo via the [`lit`](../../../three/api/threeview-properties/#lit) option. A deferred lighting pass uses it as its "shade this pixel" mask).
- Depth textures follow Three.js packing conventions: check `depthBufferPacking` / `globeDepthBufferPacking` on the MRT pass and unpack with the helpers in the `DEPTH_PACKING_SHADER` GLSL string exported by `@navaramap/three` (Three.js's `packing` chunk).

## Custom Mesh Desc

### Type Parameters

```typescript
class MyMeshDesc extends MeshDesc<
  Config,      // Descriptor configuration type (extends MeshConfig)
  UpdateConfig, // Update configuration type (extends MeshUpdate)
  InstanceObj,  // Three.js object type (extends Object3D)
> {}
```

### Defining Configuration Types

```typescript
import type { MeshConfig, MeshUpdate } from "@navaramap/three";

type MyMeshDescription = {
  myMesh?: {
    radius?: number;
    color?: Color;
  };
};

type MyMeshConfig = MeshConfig & MyMeshDescription;
type MyMeshUpdate = MeshUpdate & MyMeshDescription;
```

### Properties Managed by the Base Class

`MeshDesc` automatically handles `position`, `rotation`, `scale`, `matrix`, `matrixWorld`, `geodetic`, `pickable`, and `visible`, so a custom descriptor can be placed at a longitude / latitude with `geodetic` like any built-in one. For a full description of these properties, transform composition modes, and picking behavior, see [MeshDesc](../../../three_default_descs/mesh-desc/mesh-desc-base).

### Specifying the Render Pass

You can override `getPassKey()` to change the scene where the mesh is rendered.

| PassKey         | Description                             |
| --------------- | --------------------------------------- |
| `"opaque"`      | Opaque rendering (default)              |
| `"transparent"` | Transparent rendering                   |
| `"mrt"`         | For selective effects (Bloom / Outline) |
| `"skyEnvMap"`   | For environment maps                    |
| `"draped"`      | For terrain-draped rendering            |

### Implementation Example

```typescript
import ThreeView, {
  MeshDesc,
  type MeshConfig,
  type MeshUpdate,
  type ViewContext,
  Color,
} from "@navaramap/three";
import {
  Mesh,
  SphereGeometry,
  MeshStandardMaterial,
} from "three";

// Define configuration types
type MySphereMeshDescription = {
  mySphere?: {
    radius?: number;
    color?: Color;
    castShadow?: boolean;
  };
};
type MySphereMeshConfig = MeshConfig & MySphereMeshDescription;
type MySphereMeshUpdate = MeshUpdate & MySphereMeshDescription;

export class MySphereMeshDesc extends MeshDesc<
  MySphereMeshConfig,
  MySphereMeshUpdate,
  Mesh<SphereGeometry, MeshStandardMaterial>
> {
  private config: MySphereMeshConfig;

  constructor(view: ThreeView, ctx: ViewContext, config: MySphereMeshConfig) {
    super(view, ctx, config);
    this.config = config;
  }

  // Create and return the Three.js object
  createMesh() {
    const cfg = this.config.mySphere ?? {};
    const geometry = new SphereGeometry(cfg.radius ?? 1);
    const material = new MeshStandardMaterial({
      color: cfg.color?.raw ?? 0xffffff,
    });
    const mesh = new Mesh(geometry, material);

    // Enable shadows if configured
    if (cfg.castShadow) {
      mesh.castShadow = true;
      this.ctx.applyShadowMaterial(material);
    }

    return mesh;
  }

  // Handle partial updates
  onUpdateConfig(updates: MySphereMeshUpdate) {
    if (updates.mySphere && this._instance) {
      if (updates.mySphere.radius !== undefined) {
        // Call recreate() when geometry needs to be recreated
        this.recreate();
      }
      if (updates.mySphere.color !== undefined) {
        this._instance.material.color.set(updates.mySphere.color.raw);
      }
      this.emit("needsUpdate");
    }
    // Base class handling (position, scale, rotation, visible)
    super.onUpdateConfig(updates);
  }

  // Release resources
  onDestroy() {
    if (this._instance) {
      this._instance.geometry.dispose();
      this._instance.material.dispose();
    }
    super.onDestroy();
  }
}
```

### Registration and Usage

```typescript
import ThreeView from "@navaramap/three";

const view = new ThreeView({});
view.registerMesh("mySphere", MySphereMeshDesc);
await view.init();

const handle = view.addMesh<MySphereMeshDesc>({
  mySphere: { radius: 100, color: new Color().setHex(0x00aaff) },
  position: { x: 0, y: 0, z: 6378137 },
});

// Partial update
handle.update({ mySphere: { color: new Color().setHex(0xff0000) } });
```

### Per-Frame Animation

Implementing the `update()` method causes it to be called every frame.

```typescript
export class RotatingBoxDesc extends MeshDesc</* ... */> {
  createMesh() {
    // ...
  }

  // Called every frame
  update(time: number) {
    if (this._instance) {
      this._instance.rotation.y = time * 0.001;
    }
  }
}
```

## Custom Instanced Mesh Desc

For rendering many copies of the same geometry in a single draw call, use `InstancedMeshDesc`. All instances share one geometry and material, with per-instance variation through `instanceMatrix` and `instanceColor`.

### Type Parameters

```typescript
class MyInstancedDesc extends InstancedMeshDesc<
  TGeometry,    // Three.js BufferGeometry type
  TMaterial,    // Three.js Material type
  Config,       // Descriptor configuration type (extends InstancedMeshConfig)
  UpdateConfig, // Update configuration type (extends InstancedMeshUpdate)
  ChildConfig,  // Per-instance configuration type (extends InstancedChildConfig)
> {}
```

### InstancedChildConfig

Common transform fields for individual instances:

| Property   | Type      | Description                                                                  |
| ---------- | --------- | ---------------------------------------------------------------------------- |
| `position` | [`XYZ`](../../../three/api/types/#xyz) | Local position relative to the parent group                                  |
| `rotation` | [`XYZ`](../../../three/api/types/#xyz) | Local rotation (Euler angles in radians)                                     |
| `scale`    | [`XYZ`](../../../three/api/types/#xyz) | Local scale                                                                  |
| `matrix`   | `Matrix4` | Pre-computed transform matrix. When set, position/rotation/scale are ignored |

### Abstract Methods

| Method                     | Return Type               | Description                                                         |
| -------------------------- | ------------------------- | ------------------------------------------------------------------- |
| `createGeometry()`         | `TGeometry`               | Create the shared geometry for all instances                        |
| `createMaterial()`         | `TMaterial`               | Create the shared material for all instances                        |
| `getChildConfigs()`        | `ChildConfig[]`           | Extract the initial array of instance configs from the Descriptor config |
| `getInstanceColor(config)` | `ThreeColor \| undefined` | Extract the per-instance color, or undefined for default white      |

### Optional Override Methods

| Method                             | Description                                                                                                 |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `getInstanceScale(config, target)` | Compute per-instance scale. Override to incorporate geometry-specific dimensions (e.g., width/height/depth) |
| `composeInstanceMatrix(config)`    | Compose the transform matrix for one instance. Override for custom transform logic                          |

### Instance Management Methods

| Method                    | Signature                                               | Description                                 |
| ------------------------- | ------------------------------------------------------- | ------------------------------------------- |
| `add(config)`             | `(config: ChildConfig) => number`                       | Add a new instance. Returns the index       |
| `removeAt(index)`         | `(index: number) => void`                               | Remove by index (swap-with-last, O(1))      |
| `updateAt(index, config)` | `(index: number, config: Partial<ChildConfig>) => void` | Update an instance at the given index       |
| `clear()`                 | `() => void`                                            | Remove all instances                        |
| `replaceAll(configs)`     | `(configs: ChildConfig[]) => void`                      | Batch replace all instances (single update) |
| `count`                   | `number` (getter)                                       | Number of active instances                  |

### Implementation Example

```typescript
import ThreeView, {
  InstancedMeshDesc,
  type InstancedMeshConfig,
  type InstancedMeshUpdate,
  type InstancedChildConfig,
  type ViewContext,
  Color,
} from "@navaramap/three";
import {
  BoxGeometry,
  MeshStandardMaterial,
  Color as ThreeColor,
} from "three";

// Per-instance configuration
type MyBoxChild = InstancedChildConfig & {
  color?: Color;
};

// Descriptor configuration
type MyBoxesConfig = InstancedMeshConfig & {
  boxes?: { children?: MyBoxChild[] };
};
type MyBoxesUpdate = InstancedMeshUpdate & {
  boxes?: { children?: MyBoxChild[] };
};

export class MyBoxesDesc extends InstancedMeshDesc<
  BoxGeometry,
  MeshStandardMaterial,
  MyBoxesConfig,
  MyBoxesUpdate,
  MyBoxChild
> {
  private config: MyBoxesConfig;

  constructor(view: ThreeView, ctx: ViewContext, config: MyBoxesConfig) {
    super(view, ctx, config);
    this.config = config;
  }

  createGeometry() {
    return new BoxGeometry(1, 1, 1);
  }

  createMaterial() {
    return new MeshStandardMaterial();
  }

  getChildConfigs(): MyBoxChild[] {
    return this.config.boxes?.children ?? [];
  }

  getInstanceColor(config: MyBoxChild): ThreeColor | undefined {
    return config.color ? new ThreeColor(config.color.raw) : undefined;
  }
}
```

### Registration and Usage

```typescript
import ThreeView, { Color } from "@navaramap/three";

const view = new ThreeView({});
view.registerMesh("myBoxes", MyBoxesDesc);
await view.init();

const handle = view.addMesh<MyBoxesDesc>({
  boxes: {
    children: [
      { position: { x: 0, y: 0, z: 100 }, color: new Color().setHex(0xff0000) },
      { position: { x: 200, y: 0, z: 100 }, color: new Color().setHex(0x00ff00) },
    ],
  },
  position: { x: 0, y: 0, z: 6378137 },
});

// Add an instance dynamically
handle.ref.add({ position: { x: 400, y: 0, z: 100 }, color: new Color().setHex(0x0000ff) });

// Update instance at index 0
handle.ref.updateAt(0, { color: new Color().setHex(0xffff00) });

// Remove instance at index 1
handle.ref.removeAt(1);
```

## Custom Effect Desc

### Type Parameters

```typescript
class MyEffectDesc extends EffectDesc<
  Config,      // Descriptor configuration type (extends EffectConfig)
  UpdateConfig, // Update configuration type (extends EffectUpdate)
  InstanceObj,  // Post-processing pass type
> {}
```

### Static Properties (Pipeline Ordering)

Effect descriptors have static properties that control their insertion position within the render pipeline.

| Property           | Type       | Description                                                                           |
| ------------------ | ---------- | ------------------------------------------------------------------------------------- |
| `key`              | `string`   | **Required**. Unique key name for the effect                                          |
| `insertAfter`      | `string[]` | Insert after the specified effects (preferred)                                        |
| `insertBefore`     | `string[]` | Insert before the specified effects (fallback if `insertAfter` targets are not found) |
| `allowDuplication` | `boolean`  | Whether to allow multiple instances of the same effect                                |

The insertion order is determined by priority: `insertAfter` -> `insertBefore` -> append to end.

### Implementation Example

```typescript
import ThreeView, {
  EffectDesc,
  type EffectConfig,
  type EffectUpdate,
  type ViewContext,
} from "@navaramap/three";

type MyEffectDescription = {
  myEffect?: {
    intensity?: number;
  };
};
type MyEffectConfig = EffectConfig & MyEffectDescription;
type MyEffectUpdate = EffectUpdate & MyEffectDescription;

export class MyEffectDesc extends EffectDesc<
  MyEffectConfig,
  MyEffectUpdate,
  MyPostProcessingPass
> {
  // Control ordering within the pipeline
  static key = "myEffect";
  static insertAfter = ["clouds"];
  static insertBefore = ["transparent"];

  private config: MyEffectConfig;

  constructor(view: ThreeView, ctx: ViewContext, config: MyEffectConfig) {
    super(view, ctx, config);
    this.config = config;
  }

  // Create and return the post-processing pass
  createPass() {
    const cfg = this.config.myEffect ?? {};
    return new MyPostProcessingPass({
      intensity: cfg.intensity ?? 1.0,
    });
  }

  onUpdateConfig(updates: MyEffectUpdate) {
    if (updates.myEffect && this._instance) {
      if (updates.myEffect.intensity !== undefined) {
        this._instance.intensity = updates.myEffect.intensity;
      }
      this.emit("needsUpdate");
    }
    super.onUpdateConfig(updates);
  }
}
```

### Referencing Other Effect Descs

You can reference other registered effect descriptors using `find()`.

```typescript
createPass() {
  const mrt = this.find<MRTPassEffectDesc>("mrt");
  // ...
}
```

## Custom Light Desc

### Type Parameters

```typescript
class MyLightDesc extends LightDesc<
  Config,      // Descriptor configuration type (extends LightConfig)
  UpdateConfig, // Update configuration type (extends LightUpdate)
  InstanceObj,  // Three.js Light type
> {}
```

### Properties Managed by the Base Class

| Property   | Type          | Description    |
| ---------- | ------------- | -------------- |
| `position` | `{ x, y, z }` | Light position |
| `visible`  | `boolean`     | Show/hide      |

Lights are automatically added to the `ctx.scenes.light` scene.

### Implementation Example

```typescript
import ThreeView, {
  LightDesc,
  type LightConfig,
  type LightUpdate,
  type ViewContext,
  Color,
} from "@navaramap/three";
import { PointLight } from "three";

type MyPointLightDescription = {
  myPointLight?: {
    color?: Color;
    intensity?: number;
    distance?: number;
  };
};
type MyPointLightConfig = LightConfig & MyPointLightDescription;
type MyPointLightUpdate = LightUpdate & MyPointLightDescription;

export class MyPointLightDesc extends LightDesc<
  MyPointLightConfig,
  MyPointLightUpdate,
  PointLight
> {
  private config: MyPointLightConfig;

  constructor(view: ThreeView, ctx: ViewContext, config: MyPointLightConfig) {
    super(view, ctx, config);
    this.config = config;
  }

  createLight() {
    const cfg = this.config.myPointLight ?? {};
    const light = new PointLight(
      cfg.color?.raw ?? 0xffffff,
      cfg.intensity ?? 1,
      cfg.distance ?? 0,
    );
    return light;
  }

  onUpdateConfig(updates: MyPointLightUpdate) {
    if (updates.myPointLight && this._instance) {
      if (updates.myPointLight.color !== undefined) {
        this._instance.color.set(updates.myPointLight.color.raw);
      }
      if (updates.myPointLight.intensity !== undefined) {
        this._instance.intensity = updates.myPointLight.intensity;
      }
      if (updates.myPointLight.distance !== undefined) {
        this._instance.distance = updates.myPointLight.distance;
      }
      this.emit("needsUpdate");
    }
    super.onUpdateConfig(updates);
  }
}
```

## BaseHandle

The `BaseHandle<T>` returned from `view.addMesh()`, `view.addLight()`, or `view.addEffect()` is a handle for controlling the object.

| Property / Method | Type      | Description                                    |
| ----------------- | --------- | ---------------------------------------------- |
| `id`              | `string`  | Unique identifier of the object                |
| `visible`         | `boolean` | Get/set show/hide                              |
| `ref`             | `T`       | Direct access to the base Descriptor instance  |
| `update(updates)` | `void`    | Partial configuration update                   |
| `delete()`        | `void`    | Delete the object. Calls `onDestroy()`         |

## Implementing Picking in Custom Descriptors

For an overview of picking from the user's perspective, see [MeshDesc: Picking](../../../three_default_descs/mesh-desc/mesh-desc-base/#picking). This section covers how to implement picking support when authoring a custom Descriptor.

### Turnkey Picking with PickableMeshWrapper

For Descriptors that use standard Three.js materials (`MeshStandardMaterial`, `MeshLambertMaterial`, etc.) or `ShaderMaterial`, wrap the mesh in a `PickableMeshWrapper`. It automatically injects the picking shader code.

```typescript
import ThreeView, {
  MeshDesc,
  PickableMeshWrapper,
  type MeshConfig,
  type MeshUpdate,
  type ViewContext,
  Color,
} from "@navaramap/three";
import { Mesh, BoxGeometry, MeshStandardMaterial } from "three";

type MyConfig = MeshConfig & { myBox?: { color?: Color } };
type MyUpdate = MeshUpdate & { myBox?: { color?: Color } };

class MyPickableBoxDesc extends MeshDesc<
  MyConfig, MyUpdate, Mesh
> {
  private config: MyConfig;
  private pickWrapper?: PickableMeshWrapper;

  constructor(view: ThreeView, ctx: ViewContext, config: MyConfig) {
    super(view, ctx, config);
    this.config = config;
  }

  get batchId(): number | undefined {
    return this.pickWrapper?.batchId;
  }

  createMesh() {
    const mesh = new Mesh(
      new BoxGeometry(1, 1, 1),
      new MeshStandardMaterial({ color: this.config.myBox?.color?.raw ?? 0xffffff }),
    );

    if (this.config.pickable) {
      this.pickWrapper = new PickableMeshWrapper(mesh, this.ctx);
      this.ctx.registerPickableMesh(this.id, this.pickWrapper);
    }

    return mesh;
  }

  onDestroy() {
    if (this.pickWrapper) {
      this.ctx.unregisterPickableMesh(this.id);
    }
    super.onDestroy();
  }
}
```

### Instanced Mesh Picking

For instanced mesh Descriptors, use `PickableInstancedMeshWrapper`. It assigns a unique batch ID per instance, enabling you to identify which individual instance was clicked.

```typescript
import {
  InstancedMeshDesc,
  PickableInstancedMeshWrapper,
} from "@navaramap/three";

class MyPickableInstancedDesc extends InstancedMeshDesc</* ... */> {
  private pickWrapper?: PickableInstancedMeshWrapper;

  get batchIds(): readonly number[] {
    return this.pickWrapper?.batchIds ?? [];
  }

  override onCreate() {
    super.onCreate();
    if (this.config.pickable) {
      this.pickWrapper = new PickableInstancedMeshWrapper(
        this.raw, this.count, this.ctx,
      );
      this.ctx.registerPickableMesh(this.id, this.pickWrapper);
    }
  }

  protected override onInstanceAdded(index: number) {
    this.pickWrapper?.addInstance();
  }

  protected override onInstanceRemoved(index: number, wasLast: boolean) {
    this.pickWrapper?.removeInstanceAt(index);
  }

  protected override onInstanceMeshReplaced(newMesh: InstancedMesh) {
    this.pickWrapper?.syncMesh(newMesh);
  }

  onDestroy() {
    if (this.pickWrapper) {
      this.ctx.unregisterPickableMesh(this.id);
    }
    super.onDestroy();
  }
}
```

### Custom Picking with PickableMesh

For Descriptors with fully custom shaders, implement the `PickableMesh` interface directly. Your fragment shader must encode the batch ID as an RGB color when the picking uniform is active.

```typescript
import { type PickableMesh } from "@navaramap/three";

class CustomPickable extends Object3D implements PickableMesh {
  batchId: number;
  private mesh: Mesh;

  constructor(mesh: Mesh, ctx: ViewContext) {
    super();
    this.mesh = mesh;
    this.batchId = ctx.genGlobalBatchId() ?? 0;
    mesh.material.uniforms.uBatchId.value = this.batchId;
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
```

The batch ID encoding in the fragment shader:

```glsl
vec3 batchIdToColor(float id) {
  float r = floor(id / 65536.0);
  float g = floor(mod(id / 256.0, 256.0));
  float b = mod(id, 256.0);
  return vec3(r, g, b) / 255.0;
}

// In the main function:
if (uPicking > 0.0) {
  gl_FragColor = vec4(batchIdToColor(uBatchId), 1.0);
  return;
}
```

### ViewContext Picking API

| Method                                          | Description                                |
| ----------------------------------------------- | ------------------------------------------ |
| `ctx.genGlobalBatchId()`                        | Generate a unique batch ID for picking     |
| `ctx.registerPickableMesh(key, mesh)`           | Register a pickable mesh                   |
| `ctx.unregisterPickableMesh(key)`               | Unregister a pickable mesh                 |

## Related Resources

- [Layers & Descriptors](../../../three/introduction/about-layer/) - Layer concepts and types
- [About Plugin](../../../three/introduction/about-plugin/) - Plugin system concepts
- [Plugin API](../../../three/core/plugin/) - How to implement plugins
- [three_default_descs](../../../three_default_descs/about/) - Default Descriptor implementation examples
