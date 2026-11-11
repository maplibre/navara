# Custom Descriptors & Plugin System

This document explains the plugin system and custom descriptor architecture in Navara.

## Motivation

Rendering descriptors (meshes, lights, effects) are purely Three.js constructs with no dependency on the GIS engine or WASM modules. Keeping them separate from `@navaramap/three` ensures that:

- **The core stays focused** on bridging the GIS engine to Three.js, without being inflated by rendering-only implementations.
- **GIS and rendering concerns stay decoupled** — GIS-driven descriptors (tiles, vector features) and rendering-only descriptors (decorative meshes, atmospheric effects, lights) have a clear boundary.
- **Custom and official descriptors are on equal footing** — external packages use the same public API as the default descriptors, so users can extend, replace, or compose descriptors freely.

## Descriptor Types

`ThreeView` provides three registration methods, each corresponding to a descriptor category:

| Method                             | Category | Purpose                                                            |
| ---------------------------------- | -------- | ------------------------------------------------------------------ |
| `view.registerMesh(name, class)`   | Mesh     | 3D objects added to the scene (rain, snow, sky, GLTF models, etc.) |
| `view.registerLight(name, class)`  | Light    | Light sources (sun, ambient, light probes)                         |
| `view.registerEffect(name, class)` | Effect   | Post-processing effects (SSAO, SSR, tone mapping, clouds, etc.)    |

All three are available to plugins, giving external packages the same capabilities as built-in descriptors.

## Plugin System

### Plugin base class (`@navaramap/core`)

A minimal `Plugin` base class that any package can extend:

```typescript
export class Plugin {
  async init(_view: unknown): Promise<void> {}
}
```

### Plugin lifecycle (`@navaramap/three`)

Plugins are registered before initialization and initialized during `view.init()`:

```typescript
view.addPlugin(plugin); // Register before init()
await view.init(); // Calls plugin.init(view) for each registered plugin
```

Light, effect, and mesh descriptors are registered through the plugin system (e.g., `@navaramap/three-default-plugin`). Core effect descriptors (MRT, selective effects, final copy) are registered by `@navaramap/three` itself.

Multiple plugins can be composed together:

```typescript
view.addPlugin(new DefaultPlugin());
view.addPlugin(new MyPlugin());
await view.init();
```

## Implementing a Custom Descriptor

### Mesh descriptor

Extend `MeshDesc` (or `MeshDescWithSelectiveEffect` for bloom/outline support). Define a config type, implement `createMesh()`, and optionally override `onUpdateConfig()` for dynamic updates.

```typescript
import {
  MeshDesc,
  type MeshConfig,
  type MeshUpdate,
  type ViewContext,
  Color,
} from "@navaramap/three";
import { Mesh, SphereGeometry, MeshStandardMaterial } from "three";

type MyMeshDescription = {
  myMesh?: {
    radius?: number;
    color?: Color;
  };
};

type MyMeshConfig = MeshConfig & MyMeshDescription;
type MyMeshUpdate = MeshUpdate & MyMeshDescription;

class MyMeshDesc extends MeshDesc<
  MyMeshConfig,
  MyMeshUpdate,
  Mesh<SphereGeometry, MeshStandardMaterial>
> {
  private config: MyMeshConfig;

  constructor(view: ViewContext, config: MyMeshConfig) {
    super(view, config);
    this.config = config;
  }

  createMesh() {
    const cfg = this.config.myMesh ?? {};
    const geometry = new SphereGeometry(cfg.radius ?? 1);
    const material = new MeshStandardMaterial({
      color: cfg.color?.raw ?? 0xffffff,
    });
    return new Mesh(geometry, material);
  }

  onUpdateConfig(updates: MyMeshUpdate): void {
    if (updates.myMesh && this._instance) {
      if (updates.myMesh.color !== undefined) {
        this._instance.material.color.set(updates.myMesh.color.raw);
      }
      this.emit("needsUpdate");
    }
    super.onUpdateConfig(updates);
  }
}
```

See `MeshDesc` JSDoc and the `custom-shader` example for a complete tutorial.

### Picking support

Mesh layers can opt into GPU-based click picking by setting `pickable: true` in the layer config. The picking system renders pickable meshes into a dedicated single-pixel render target using a color-encoded batch ID, then decodes the pixel to identify which mesh was clicked.

#### Turnkey picking with PickableMeshWrapper

For layers that use standard Three.js materials (`MeshStandardMaterial`, `MeshLambertMaterial`, etc.) or `ShaderMaterial`/`LineMaterial`, wrap the mesh in a `PickableMeshWrapper`. The wrapper automatically injects picking shader code via `onBeforeCompile` (for standard materials) or direct source mutation (for `ShaderMaterial`).

```typescript
import { MeshDesc, PickableMeshWrapper, type ViewContext } from "@navaramap/three";

class MyPickableDesc extends MeshDesc</* ... */> {
  private pickWrapper?: PickableMeshWrapper;

  get batchId(): number | undefined {
    return this.pickWrapper?.batchId;
  }

  createMesh() {
    const mesh = new Mesh(geometry, material);

    if (this.config.pickable) {
      this.pickWrapper = new PickableMeshWrapper(mesh, this.ctx);
      this.ctx.registerPickableMesh(this.id, this.pickWrapper);
    }

    return mesh;
  }

  onUpdateConfig(updates) {
    // If material was recreated, re-sync picking shaders
    if (materialChanged) {
      this.pickWrapper?.syncMaterials();
    }
    super.onUpdateConfig(updates);
  }

  onDestroy() {
    if (this.pickWrapper) {
      this.ctx.unregisterPickableMesh(this.id);
    }
    super.onDestroy();
  }
}
```

For instanced meshes, use `PickableInstancedMeshWrapper` instead. It assigns a unique batch ID per instance and uses an instanced buffer attribute to pass per-instance IDs to the fragment shader.

#### Custom picking with PickableMesh

When you need full control over the picking shader (e.g., for a custom `ShaderMaterial` with a non-standard rendering pipeline), implement the `PickableMesh` interface directly. Your implementation must output the batch ID as an RGB-encoded color during the pick pass.

```typescript
import { type PickableMesh } from "@navaramap/three";

class CustomPickable extends Object3D implements PickableMesh {
  batchId: number;

  constructor(mesh: Mesh, ctx: ViewContext) {
    super();
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

The batch ID encoding in the fragment shader must follow this convention:

```glsl
vec3 batchIdToColor(float id) {
  float r = floor(id / 65536.0);
  float g = floor(mod(id / 256.0, 256.0));
  float b = mod(id, 256.0);
  return vec3(r, g, b) / 255.0;
}
```

See the `mesh-layers/custom-pickable` example for a complete reference.

#### Listening for pick events

Enable picking on the view and listen for the `"featureClick"` event (hover picking is also available via `"featureHover"` / `"featureEnter"` / `"featureLeave"`):

```typescript
const view = new ThreeView({ picking: true });
// ...

view.on("featureClick", (info) => {
  if (info) {
    console.log("Picked batch ID:", info.batchId);
    console.log("Layer ID:", info.layerId);
    console.log("Properties:", info.properties);
  }
});
```

### Instanced mesh descriptor

Extend `InstancedMeshDesc` to render many instances of the same geometry in a single draw call via Three.js `InstancedMesh`. Implement four abstract methods: `createGeometry()`, `createMaterial()`, `getChildConfigs()`, and `getInstanceColor()`. Optionally override `getInstanceScale()` to encode geometry-specific dimensions (e.g., width/height/depth) into the scale.

```typescript
import {
  InstancedMeshDesc,
  type InstancedChildConfig,
  type InstancedMeshConfig,
  type InstancedMeshUpdate,
  type ViewContext,
  Color,
} from "@navaramap/three";
import {
  BoxGeometry,
  Color as ThreeColor,
  MeshLambertMaterial,
  Vector3,
} from "three";

type BoxChildConfig = InstancedChildConfig & {
  width?: number;
  height?: number;
  depth?: number;
  color?: Color;
};

type BoxesDescription = {
  color?: Color;
  children?: BoxChildConfig[];
};

type MyConfig = InstancedMeshConfig & { boxes?: BoxesDescription };
type MyUpdate = InstancedMeshUpdate & { boxes?: BoxesDescription };

class InstancedBoxMeshDesc extends InstancedMeshDesc<
  BoxGeometry,
  MeshLambertMaterial,
  MyConfig,
  MyUpdate,
  BoxChildConfig
> {
  private config: MyConfig;

  constructor(view: ViewContext, config: MyConfig) {
    super(view, config);
    this.config = config;
  }

  protected createGeometry() {
    return new BoxGeometry(1, 1, 1);
  }

  protected createMaterial() {
    return new MeshLambertMaterial({
      color: this.config.boxes?.color?.raw ?? 0xffffff,
    });
  }

  protected getChildConfigs() {
    return this.config.boxes?.children ?? [];
  }

  protected getInstanceColor(config: BoxChildConfig) {
    return config.color ? new ThreeColor(config.color.raw) : undefined;
  }

  // Encode width/height/depth as scale
  protected override getInstanceScale(config: BoxChildConfig, target: Vector3) {
    const s = config.scale;
    target.set(
      (config.width ?? 1) * (s?.x ?? 1),
      (config.height ?? 1) * (s?.y ?? 1),
      (config.depth ?? 1) * (s?.z ?? 1),
    );
  }
}
```

After creation, instances can be managed dynamically via `add()`, `removeAt()`, `updateAt()`, `clear()`, and `count`. The internal buffer grows automatically when capacity is exceeded.

See `InstancedBoxMeshDesc` and the `mesh-layers/instanced-mesh` example for a complete reference.

### Bundling descriptors into a plugin

A plugin registers descriptor classes so they can be used via `view.addMesh()`, `view.addLight()`, `view.addEffect()`:

```typescript
import { Plugin } from "@navaramap/core";
import type ThreeView from "@navaramap/three";

type CustomDescriptions = {
  mesh: MyMeshDescription;
  light: MyLightDescription;
  effect: MyEffectDescription;
};

class MyPlugin extends Plugin {
  async init(view: ThreeView<CustomDescriptions>) {
    view.registerMesh("myMesh", MyMeshDesc);
    view.registerLight("myLight", MyCustomLightDesc);
    view.registerEffect("myEffect", MyCustomEffectDesc);
  }
}
```

`StreetLightsPlugin` in `@navaramap/three-plugins` is a shipped example: it registers `StreetTrafficMeshDesc` in `init()` and adds one such mesh per streamed tile.

## `@navaramap/three-default-plugin`

`@navaramap/three-default-plugin` is a plugin that registers the default descriptors from `@navaramap/three-default-descs`. It also exports `DefaultDescriptions` — a structured type with `mesh`, `light`, and `effect` fields for type-safe descriptions.

```typescript
import ThreeView from "@navaramap/three";
import {
  DefaultPlugin,
  type DefaultDescriptions,
} from "@navaramap/three-default-plugin";

const view = new ThreeView<DefaultDescriptions>({/* options */});
view.addPlugin(new DefaultPlugin());
await view.init();
```
