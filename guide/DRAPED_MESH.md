# Draped Mesh

This document explains how DrapedMesh works and how to use it in custom descriptors. For background on the descriptor system, see [CUSTOM_DESC.md](CUSTOM_DESC.md). For the rendering pipeline context, see [ARCHITECTURE.md](ARCHITECTURE.md).

## Overview

DrapedMesh projects a 3D mesh onto terrain using a stencil-buffer technique. Instead of floating above or clipping through the ground, a draped mesh paints its shape directly onto the terrain surface, similar to how a decal is applied to a surface.

This is a purely Three.js construct with no WASM dependency, so it can be used in any layer package including `@navaramap/three-default-descs`.

## How It Works

### Stencil-Buffer Draping Algorithm

DrapedMesh uses a three-pass stencil test to determine where the mesh intersects the terrain. The terrain must already be rendered to the depth buffer before this process begins.

```
Pass 1: Back-face pass
  - Renders back faces of the mesh
  - Increments stencil buffer where depth test fails (behind terrain)
  - Color and depth writes disabled

Pass 2: Front-face pass
  - Renders front faces of the mesh
  - Decrements stencil buffer where depth test fails (behind terrain)
  - Color and depth writes disabled

Pass 3: Final pass
  - Renders only where stencil != 0 (mesh interior that intersects terrain)
  - Enables color write, disables depth test
  - Clears stencil buffer after rendering
```

After these three passes, only the parts of the mesh that intersect the terrain surface are visible, creating the appearance of draping.

**References:**
- [Hybrid Rendering of Dynamic Terrain in 3D GIS (ISPRS 2008)](https://www.isprs.org/proceedings/XXXVII/congress/2_pdf/5_WG-II-5/06.pdf)
- [Stencil-based Draping (WSCG 2007)](http://wscg.zcu.cz/WSCG2007/Papers_2007/journal/B17-full.pdf)

### Rendering Pipeline Integration

DrapedMesh rendering fits into CustomRenderPass between the globe (terrain) pass and the MRT pass:

```
1. Shadow map
2. Globe / terrain  →  writes depth buffer
3. Draped meshes    →  reads depth buffer, uses stencil test
4. MRT (selective effects)
5. Opaque scene
6. Transparent scene
7. Post-processing
```

The `draped` scene in the `Scenes` type holds all draped meshes. CustomRenderPass processes each DrapedMesh individually using a temporary scene to prevent stencil interference between meshes.

### PassKey System

Layers control which render pass they belong to by overriding `getPassKey()`. Returning `"draped"` places the mesh into the draped scene:

```typescript
type PassKey = "opaque" | "transparent" | "mrt" | "skyEnvMap" | "draped";
```

When `getPassKey()` returns `"draped"`, the layer's mesh is added to the draped scene and processed through the stencil-buffer algorithm described above.

## Usage

### Basic Usage

`DrapedMesh` is a drop-in replacement for Three.js `Mesh`:

```typescript
import { DrapedMesh } from "@navaramap/three";
import { BoxGeometry, MeshBasicMaterial } from "three";

const geometry = new BoxGeometry(1000, 10000, 1000);
const material = new MeshBasicMaterial({ color: 0xff4444 });

const mesh = new DrapedMesh(geometry, material, true); // third arg: enable draping
```

The `drapedEnable` property controls whether the stencil draping is active. When `false`, the mesh behaves like a normal Three.js Mesh.

### Implementing a Draped Layer

> [!NOTE]
> The mesh must be large enough to penetrate the terrain surface. The stencil test works by detecting where the mesh volume intersects the terrain, so if the mesh does not cover the terrain, nothing will be rendered.

To add draping support to a custom mesh descriptor:

1. Use `DrapedMesh` as the instance type
2. Override `getPassKey()` to return `"draped"` when draping is enabled
3. Optionally use an unlit material while draped, when the drape should ignore lighting, or shade a lit one with the ellipsoid normal via `setDrapeGroundNormals(material, false)`. Then override `getRequiredBuffers()` to return `[]`: the base class requires `globeNormal` in the draped pass, since a lit drape reads the terrain normal from the globe-normal copy by default

```typescript
import {
  MeshDesc,
  DrapedMesh,
  type MeshConfig,
  type MeshUpdate,
  type GBufferName,
  type PassKey,
  type ViewContext,
  Color,
} from "@navaramap/three";
import { BoxGeometry, MeshBasicMaterial, MeshLambertMaterial } from "three";

type MyProperties = {
  width?: number;
  height?: number;
  depth?: number;
  color?: Color;
};

// `draped` is creation-only, so it is left out of the update type.
type MyConfig = MeshConfig & { myBox?: MyProperties & { draped?: boolean } };
type MyUpdate = MeshUpdate & { myBox?: MyProperties };

class MyDrapedDesc extends MeshDesc<
  MyConfig,
  MyUpdate,
  DrapedMesh<BoxGeometry, MeshBasicMaterial | MeshLambertMaterial>
> {
  private config: MyConfig;

  constructor(view: ViewContext, config: MyConfig) {
    super(view, config);
    this.config = config;
  }

  createMesh() {
    const cfg = this.config.myBox ?? {};
    const draped = cfg.draped ?? false;
    const geometry = new BoxGeometry(
      cfg.width ?? 1000,
      cfg.height ?? 10000,
      cfg.depth ?? 1000,
    );

    // Unlit while draped, so the drape ignores the terrain lighting
    const material = draped
      ? new MeshBasicMaterial({ color: cfg.color?.raw ?? 0xffffff })
      : new MeshLambertMaterial({ color: cfg.color?.raw ?? 0xffffff });

    return new DrapedMesh(geometry, material, draped);
  }

  // Route to draped scene when draping is enabled
  protected override getPassKey(): PassKey {
    if (this.config.myBox?.draped) {
      return "draped";
    }
    return super.getPassKey();
  }

  // The unlit drape samples no G-buffer.
  override getRequiredBuffers(): readonly GBufferName[] {
    return [];
  }
}
```

### Changing the Draped State

The render pass patches a draped material's shader once and never reverts it, so a material cannot leave the draped pass. `BoxMeshDesc` and `CylinderMeshDesc` therefore fix `draped` at creation; delete the mesh and add it again to change it.

A descriptor that changes it in `onUpdateConfig()` must, before calling `super.onUpdateConfig()`:

1. Update `drapedEnable` on the DrapedMesh instance
2. Replace the material with a new one, re-applying everything set up on the old one (shadow material, selective-effect uniforms, picking hooks)

The base class then moves the mesh to the new scene and re-derives the G-buffer configuration. When the `globeNormal` copy would add a normal attachment past the device's `MAX_DRAW_BUFFERS`, the view logs an error and keeps the previous buffers, so the drape is shaded with a stale terrain normal. `PolygonMeshDesc` does this for `clampToGround`.

### Constraints

- **The mesh must cover the terrain geometry.** The stencil test works by detecting where the mesh volume intersects the terrain surface. If the mesh does not extend through the terrain, nothing will be rendered. This is the rendered surface, so a terrain exaggeration raises (or lowers) the heights the volume must span.
- **The material's depth is clamped to the far plane.** The render pass patches every draped material shaped like three's `ShaderLib` ones so a volume reaching past the far plane is not clipped (see RENDERING_PIPELINE.md §7). A custom `ShaderMaterial` is not patched, so its volume must stay within the far plane.
- **Lit materials are shaded at the terrain.** The render pass rewrites a draped lit material shaped like three's `ShaderLib` ones (see `setupMaterialForDrape` for the shader chunks it needs) to use the terrain normal and the ground position under each pixel (`setDrapeGroundNormals(material, false)` switches to the ellipsoid normal there, so the descriptor need not require `globeNormal`), including directional shadows when `receiveShadow` is set (see RENDERING_PIPELINE.md §7). Point and spot light shadows and `envMap` are not supported. `DrapedMesh` casts no shadow while draped, since its volume extends far above and below the ground; `castShadow` takes effect when `drapedEnable` is `false`.
- **A custom `ShaderMaterial` is shaded on its volume.** It is not rewritten, so anything depending on the fragment's position (lighting, textures by world position) follows whichever back face is drawn at the pixel.
- **Picking needs no extra work.** A `DrapedMesh` that implements `PickableMesh` is stencil-clipped against the globe depth in the pick render too, so it is hit only where it meets the terrain.

## Built-in Support

The default descriptors `BoxMeshDesc` and `CylinderMeshDesc` in `@navaramap/three-default-descs` support the `draped` option out of the box:

```typescript
const layer = view.addLayer<BoxMeshDesc>({
  type: "mesh",
  box: {
    width: 1000,
    height: 10000,
    depth: 1000,
    color: new Color().setHex(0xff4444),
    opacity: 0.8,
    transparent: true,
    draped: true,
  },
  matrixWorld: someMatrix,
});
```
