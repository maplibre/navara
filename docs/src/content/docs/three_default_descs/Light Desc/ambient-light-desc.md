---
title: AmbientLightDesc
description: Ambient light descriptor for navara_three
sidebar:
  order: 151
---

The `AmbientLightDesc` class represents an ambient light descriptor that illuminates the entire scene uniformly. AmbientLight illuminates all objects evenly and does not cast shadows.

## Common Properties

### visible

**Type:** `boolean | undefined`

**Description:** Controls the visibility of the object.

**Default:** `true`

**Example:**

```typescript
{
  visible: false,
  ambient: { ... }
}
```

## Ambient Properties

### ambient

**Type:** `object | undefined`

**Description:** Configuration options for the ambient light.

#### color

**Type:** `Color | undefined`

**Description:** Specifies the color of the ambient light using a `Color` object.

**Default:** `new Color().setHex(0xffffff)`

**Example:**

```typescript
import { Color } from "@navaramap/three";

{
  ambient: {
    color: new Color().setHex(0xffffff),
  }
}
```

#### intensity

**Type:** `number | undefined`

**Description:** Specifies the intensity of the ambient light. Higher values result in brighter light. Diffuse shading divides the result by π (the Lambert BRDF), so without tone mapping, intensity 1 renders a surface at about 32% of its albedo. Use `Math.PI` in that setup to render surfaces at their true albedo.

**Default:** `1`

**Example:**

```typescript
{
  ambient: {
    intensity: 1.0,
  }
}
```

## Usage Examples

### Basic Usage

```typescript
import ThreeView, { Color } from "@navaramap/three";
import { AmbientLightDesc } from "@navaramap/three-default-descs";

const view = new ThreeView();
await view.init();

// Add an ambient light descriptor
const ambientLight = view.addLight<AmbientLightDesc>({
  ambient: {
    color: new Color().setHex(0xffffff),
    intensity: 1.0
  }
});
```

### Updating the Ambient Light

```typescript
// Update the ambient light color and intensity
ambientLight.update({
  ambient: {
    color: new Color().setHex(0xaabbcc),
    intensity: 0.5
  }
});
```

### Simple Ambient Light

```typescript
// Add ambient light with default settings
view.addLight<AmbientLightDesc>({
  ambient: {}
});
```

### Adding as Initially Hidden

```typescript
// Add ambient light in a hidden state, then toggle visibility later
const ambientLightDesc = view.addLight<AmbientLightDesc>({
  visible: false,
  ambient: {
    intensity: 1,
    color: new Color().setHex(0xffffff),
  },
});

// Toggle visibility
ambientLightDesc.visible = true;
```

## Notes

- Ambient light does not cast shadows.
- Ambient light illuminates objects evenly from all directions.
- It can be used in combination with other light types (SunLightDesc, SkyLightProbeDesc, etc.).
- If the ambient light intensity is too high, the scene may appear flat.
