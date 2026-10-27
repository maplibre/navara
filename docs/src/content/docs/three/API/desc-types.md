---
title: Descriptor Types
description: API Reference for Layer, BaseHandle, and BaseDesc types
sidebar:
  order: 950
---

In navara_three, Descriptors are classified into the following 4 types:

1. **Resource Layers** - Layers that load and display geographic data from external data sources (raster tiles, terrain, GeoJSON, 3D Tiles, etc.)
2. **Mesh Descs** - Descriptors that add 3D mesh objects to the scene
3. **Effect Descs** - Descriptors that apply post-processing effects
4. **Light Descs** - Descriptors that manage scene lighting

Resource layers and other Descriptors (mesh, effect, light) return different handle classes.

## Layer

A handle class for controlling resource layers (imagery, terrain, GeoJSON, 3D Tiles, etc.). Returned when adding a resource layer with `ThreeView.addLayer()`.

### Properties

#### id

**Type:** `string`

**Description:** The unique identifier of the layer.

### Methods

#### update()

Updates the layer settings. To change an elevation heatmap's `colorMap` or `colorStops`, use [`view.updateLayerById()`](../../../three/api/threeview-functions/#updatelayerbyid) instead, because `update()` does not update the colors.

**Syntax:**

```typescript
update(l: LayerDescription): void
```

**Parameters:**

- `l`: New layer settings

**Example:**

```typescript
const geoJsonSource = view.addSource({
  type: "geojson",
  url: "https://example.com/data.geojson",
});

const geoJsonHandle = view.addLayer({
  type: "vector",
  source: geoJsonSource,
  point: { color: 0xff0000 },
});

// Update layer settings
geoJsonHandle.update({
  type: "vector",
  source: geoJsonSource,
  point: { color: 0x00ff00 },
});
```

#### delete()

Removes the layer from the scene and releases resources. Do not use the layer after deletion.

**Syntax:**

```typescript
delete(): void
```

**Example:**

```typescript
geoJsonHandle.delete();
```

#### forceUpdate()

Marks the layer for update on the next frame. Call this when you need to trigger `featureUpdated` events.

**Syntax:**

```typescript
forceUpdate(): void
```

**Example:**

```typescript
// Trigger re-evaluation after style changes
layer.forceUpdate();
```

### Events

:::note
For the data structure behind these events (Layer, FeatureSet, Feature, Batch), see [Layers & Descriptors](../../introduction/about-layer/#layer-data-structure). For the `FeatureEvaluator` class used in event callbacks, see [FeatureEvaluator](../feature-evaluator/).
:::

#### featureCreated

**Description:** Fires when a new feature is created within the layer.

**Handler Type:**

```typescript
(params: FeatureCreatedParams) => void
```

**FeatureCreatedParams:**

| Property | Type | Description |
|----------|------|-------------|
| `featureSetId` | `FeatureSetId` | Unique identifier of the created feature set |
| `evaluator` | `FeatureEvaluator` | Evaluator class used for feature styling |
| `credit` | `string \| undefined` | Data source credit information (optional) |

**Example:**

```typescript
layer.on("featureCreated", ({ evaluator }) => {
  console.log("Feature created:", evaluator.id);
});
```

#### featureUpdated

**Description:** Fires when a feature within the layer is updated.

**Handler Type:**

```typescript
(params: FeatureUpdatedParams) => void
```

**FeatureUpdatedParams:**

| Property | Type | Description |
|----------|------|-------------|
| `featureSetId` | `FeatureSetId` | Unique identifier of the updated feature set |
| `evaluator` | `FeatureEvaluator` | Evaluator class used for feature styling |
| `updatedAt` | `number` | Update timestamp |

**Example:**

```typescript
layer.on("featureUpdated", ({ evaluator }) => {
  evaluator.evaluate((_batchId, property) => {
    const height = property?.["height"] as number;
    return {
      color: new Color().setStyle(height > 50 ? "#ff0000" : "#00ff00"),
    };
  });
});
```

#### featureVisibilityChanged

**Description:** Fires when the visibility of a feature changes.

**Handler Type:**

```typescript
(params: FeatureVisibilityChangedParams) => void
```

**FeatureVisibilityChangedParams:**

| Property | Type | Description |
|----------|------|-------------|
| `featureSetId` | `FeatureSetId` | Identifier of the feature set whose visibility changed |
| `visible` | `boolean` | Whether the feature set is now visible |

#### featureRemoved

**Description:** Fires when a feature is removed from the layer.

**Handler Type:**

```typescript
(params: FeatureRemovedParams) => void
```

**FeatureRemovedParams:**

| Property | Type | Description |
|----------|------|-------------|
| `featureSetId` | `FeatureSetId` | Identifier of the removed feature set |

#### deleted

**Description:** Fires when the layer is deleted.

**Handler Type:**

```typescript
() => void
```

**Example:**

```typescript
layer.on("deleted", () => {
  console.log("Layer has been deleted");
});
```

---

## BaseHandle

A handle class for controlling mesh descriptors, light descriptors, and effect descriptors. Returned when adding a Descriptor with `ThreeView.addMesh()`, `ThreeView.addLight()`, or `ThreeView.addEffect()`.

### Properties

#### id

**Type:** `string`

**Description:** The unique identifier of the object.

**Example:**

```typescript
// SkyMeshDesc must be registered
const skyHandle = view.addMesh<SkyMeshDesc>({ sky: {} });
console.log("Object ID:", skyHandle.id);
```

#### visible

**Type:** `boolean`

**Description:** Whether the object is visible in the scene.

**Example:**

```typescript
// Check visibility
console.log("Visible:", skyHandle.visible);

// Toggle visibility
skyHandle.visible = false;
```

#### ref

**Type:** `T` (subclass of BaseDesc)

**Description:** Provides direct access to the underlying Descriptor instance. Use this to access Descriptor-specific methods and properties not exposed through the handle.

**Example:**

```typescript
// SkyMeshDesc must be registered
const skyHandle = view.addMesh<SkyMeshDesc>({ sky: {} });

// Access the underlying Descriptor instance
const skyDesc = skyHandle.ref;
```

### Methods

#### update()

Updates Descriptor settings with a partial update. Only the specified properties are changed. Others remain unchanged.

**Syntax:**

```typescript
update(updates: UpdateConfig): void
```

**Parameters:**

- `updates`: A partial configuration object containing the properties to update

**Example:**

```typescript
// SkyMeshDesc must be registered
const skyHandle = view.addMesh<SkyMeshDesc>({ sky: {} });

// Update settings
skyHandle.update({ sky: { sunAngularRadius: 0.05 } });
```

#### delete()

Removes the object from the scene and releases resources. Do not use the handle after deletion.

**Syntax:**

```typescript
delete(): void
```

**Example:**

```typescript
skyHandle.delete();
```

### Events

#### deleted

**Description:** Fires when the object is deleted.

**Handler Type:**

```typescript
() => void
```

**Example:**

```typescript
skyHandle.on("deleted", () => {
  console.log("Sky object has been deleted");
});
```

---

## BaseDesc

An abstract base class for mesh descriptors, light descriptors, and effect descriptors. Extend this class to create custom descriptor types.

These descriptors differ from resource layers in that they are purely client-side and do not load data from external sources. They directly create Three.js objects.

### Type Parameters

- `Config` - The Descriptor configuration type (extends BaseDescConfig)
- `UpdateConfig` - Updatable configuration properties (extends BaseDescConfigUpdate)
- `Instance` - The underlying Three.js object type that the Descriptor creates
- `CustomEvent` - Additional custom events that the Descriptor can fire

### Properties

#### id

**Type:** `string`

**Description:** The unique identifier of the object. Specified via `config.id` or auto-generated.

#### visible

**Type:** `boolean`

**Description:** Gets or sets whether the object is currently visible.

### Methods

#### onCreate() (abstract)

Called when the Descriptor is added to the scene. Override to create Three.js objects. You must initialize `this._instance` and add it to the appropriate scene here.

**Syntax:**

```typescript
abstract onCreate(): void
```

#### onUpdateConfig()

Called when the Descriptor configuration is updated via `BaseHandle.update()`. Override to handle custom configuration updates.

**Syntax:**

```typescript
onUpdateConfig(updates: UpdateConfig): void
```

**Parameters:**

- `updates`: The configuration properties being updated

#### onDestroy()

Called when the object is removed via `BaseHandle.delete()`. Override to clean up resources. Remember to call `super.onDestroy()`.

**Syntax:**

```typescript
onDestroy(): void
```

### Example

```typescript
import { BaseDesc, type BaseDescConfig } from "@navaramap/three";
import { BoxGeometry, Mesh, MeshBasicMaterial } from "three";

// Define custom configuration type
type MyBoxConfig = BaseDescConfig & {
  size?: number;
  color?: number;
};

// Create custom Descriptor
class MyBoxDesc extends BaseDesc<MyBoxConfig, MyBoxConfig, Mesh> {
  private size: number;
  private color: number;

  constructor(view: ThreeView, ctx: ViewContext, config: MyBoxConfig) {
    super(view, ctx, config);
    this.size = config.size ?? 1;
    this.color = config.color ?? 0xff0000;
  }

  onCreate() {
    const geometry = new BoxGeometry(this.size, this.size, this.size);
    const material = new MeshBasicMaterial({ color: this.color });
    this._instance = new Mesh(geometry, material);
    this.ctx.scenes.opaque.add(this._instance);
  }

  onUpdateConfig(updates: MyBoxConfig) {
    super.onUpdateConfig(updates);

    if (updates.color !== undefined && this._instance) {
      (this._instance.material as MeshBasicMaterial).color.set(updates.color);
    }
  }

  onDestroy() {
    if (this._instance) {
      this.ctx.scenes.opaque.remove(this._instance);
      this._instance.geometry.dispose();
      (this._instance.material as MeshBasicMaterial).dispose();
    }
    super.onDestroy();
  }
}
```

### BaseDescConfig

Base configuration options common to all mesh, effect, and light descriptors.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `id` | `string \| undefined` | Auto-generated | Custom ID for the object |
| `visible` | `boolean \| undefined` | `true` | Whether to display the object |
