# Architecture Documentation

This document provides detailed architectural information for the Navara 3D globe map engine.

## GIS Engine to Rendering Engine Communication

Based on the system architecture, Navara employs a layered communication pattern between the GIS engine and rendering engine:

### **Data Flow Architecture**

```
Users/Application
       ↓
   Application ←→ GPU (WebGL rendering)
       ↓
Rendering Engine Layer
├─ API Library (@navaramap/three-api)
├─ Core Library (@navaramap/three)
└─ Rendering Engine (Three.js)
       ↑
   Rendering Data
       ↑
GIS Engine Layer (WASM)
├─ navara_wasm_api (Type conversion & utilities)
├─ navara_wasm (Main engine interface)
└─ navara_ecs (Central coordinator)
       ↑
   GIS Computations
       ↑
GIS Processing Modules
├─ navara_core, navara_quadtree
├─ navara_parser, navara_geometry
├─ navara_tiles, etc.
└─ Independent GIS processes
```

### **Communication Mechanisms**

#### **1. WASM Bridge Layer - Two Distinct Approaches**

**`navara_wasm` (Full Engine - 40+ crates)**

- **Stateful 3D engine** with complete ECS system (`navara_ecs` main loop)
- **Complex GIS operations**: Layer management, tile hierarchies, feature batching
- **Event-driven architecture**: Handles rendering events, data loading, worker task coordination
- **All GIS processing modules**: Uses the complete set of processing modules for comprehensive functionality
- **Memory-intensive**: Maintains persistent state, buffers, and complex data structures

**`navara_wasm_api` (Lightweight Utilities - 6 crates only)**

- **Stateless utility functions** for specific mathematical operations
- **Simple GIS operations**: Coordinate transformations, geometric calculations, ray intersections
- **Minimal GIS processing**: Uses only core math modules (`navara_core`, `navara_math`, `navara_camera`)
- **No persistent state**: Each function call is independent and lightweight
- **Fast initialization**: Small binary optimized for utility operations

#### **2. Rendering Data Transmission (Primary: `navara_wasm`)**

- **`navara_wasm`** processes complex geospatial data through its full GIS module suite:
  - Tile loading and parsing (`navara_tile`, `navara_parser`)
  - Feature processing and batching (`navara_feature`, `navara_geometry`)
  - Source definitions and dedup (`navara_source`) — the fetch/decode config layers read from
  - Layer management (`navara_layer`) with multiple format support, referencing sources by id
- Transmits rendering-ready information including:
  - Transformed geometry data (meshes, vertices, indices)
  - Camera matrices and view parameters from ECS system
  - Material properties and texture references
  - Level-of-detail (LOD) information from quadtree structures
  - Event-driven updates for new mesh additions

#### **3. Application Layer Integration - Dual Path Architecture**

- **`@navaramap/three`** (Main 3D Engine Interface)
  - Receives comprehensive processed data from `navara_wasm`
  - Handles complex layer management and stateful operations
  - Manages event-driven rendering updates and buffer transfers
- **`@navaramap/three-api`** (Utility Bridge)
  - Provides lightweight bridge to `navara_wasm_api` utilities
  - Handles simple coordinate transformations and geometric calculations
  - Used for specific operations like screen-to-world coordinate conversion
- Application layer can choose appropriate interface based on complexity needs
- GPU receives final rendering commands via WebGL from Three.js

### **Independent Processing Model - Module Specialization**

#### **Full Engine Processing (`navara_wasm` with 40+ modules)**

- **Complex coordinated operations** through ECS system:
  - Multi-layer tile hierarchies with LOD management (`navara_quadtree`, `navara_tile`)
  - Feature batching and geometry processing (`navara_feature`, `navara_geometry`)
  - Format parsing for MVT, GeoJSON, 3D Tiles (`navara_mvt`, `navara_geojson`, `navara_cesium3dtiles`)
  - Background worker task delegation (`navara_worker`) for heavy computations
  - Buffer management and memory optimization (`navara_buffer_store`)
- **Results consolidated through ECS system** before transmission to rendering layer
- **Event-driven coordination** between all processing modules

#### **Utility Processing (`navara_wasm_api` with 6 core modules)**

- **Independent mathematical operations** with no state coordination:
  - Direct coordinate transformations (`navara_core`, `navara_math`)
  - Simple geometric calculations (ray intersections, surface normals)
  - Camera-related utilities (`navara_camera`) for view transformations
  - Reference frame conversions (ENU, NED coordinate systems)
- **Each function executes independently** - no cross-module coordination needed
- **Immediate results** - no ECS processing or event system involvement

### **Performance Optimizations**

- **Zero-copy transfers** where possible between WASM and JavaScript
- **Buffer pooling** for efficient memory management across the boundary
- **Spatial culling** performed in GIS layer before sending data to renderer
- **Background processing** via Web Workers for CPU-intensive GIS operations

This architecture ensures clear separation of concerns: the GIS engine handles all geospatial computations and data processing, while the rendering engine focuses purely on visual representation and GPU optimization.

For the rendering engine's internals — the pass pipeline, the MRT G-buffer (layout, encodings, blending invariants), scene/pass routing, and the `lit` system — see [RENDERING_PIPELINE.md](RENDERING_PIPELINE.md).

## Source and Layer Model

Navara separates **what data to fetch** from **how to render it**:

- **`Source`** (`navara_source`) — the origin and format of data: URL/template, zoom range, tiling scheme, elevation decoder, inline data, etc. One `Source` variant exists per data kind (GeoJSON, vector tile, raster tile, raster DEM, quantized mesh, ellipsoid, 3D Tiles, b3dm, pnts). A source owns everything required to fetch and decode; it carries no rendering options.
- **`Layer`** (`navara_layer`) — rendering configuration that references a source by its id (`source_id`). Many layers can reference the same source.

The engine deduplicates the underlying fetch/tiling resources so multiple layers sharing a source do not re-fetch the same tiles. The **`SourceStore`** resource maps a source id to its `Source` definition, its spawned source entity, and a **reference count** of the layers using it:

- Adding a layer links it to a source (`link_layer_source` / `link_layer`), incrementing the ref count.
- Deleting a layer unlinks it, decrementing the count. A user-defined (explicit) source survives at ref count 0 and is removed only via `delete_source`.
- Deleting a source while layers still reference it is rejected.

> **Legacy layer API:** older layer APIs create an _implicit_ source (1:1 with the layer) behind the scenes; implicit sources are reclaimed automatically once their last reference is dropped. These paths are marked `TODO: Remove with the legacy layer API` and will go away once callers migrate to explicit sources.

## Multi-Language Architecture

The project implements a sophisticated multi-language architecture:

```
┌─────────────────────────────────────────────────────────────┐
│                    Navara Architecture                      │
├─────────────────────────────────────────────────────────────┤
│  TypeScript Frontend (Three.js + Web APIs)                 │
│  ├─ @navaramap/three     - Main 3D rendering engine          │
│  ├─ @navaramap/core      - Core utilities and types          │
│  ├─ @navaramap/worker    - Web Worker coordination           │
│  └─ @navaramap/three-api - API bridge utilities              │
├─────────────────────────────────────────────────────────────┤
│  WebAssembly Interface Layer                               │
│  ├─ navara_wasm        - Main engine (40+ crates)         │
│  ├─ navara_wasm_worker - Background processing            │
│  └─ navara_wasm_api    - Utility functions               │
├─────────────────────────────────────────────────────────────┤
│  Rust Core Engine (Bevy ECS)                              │
│  ├─ Core Systems       - Math, geometry, ECS              │
│  ├─ Rendering          - Camera, materials, effects       │
│  ├─ Data Handling      - Tiles, features, formats         │
│  ├─ Geometry Processing - Meshes, spatial structures      │
│  └─ Support Systems    - Events, workers, utilities       │
└─────────────────────────────────────────────────────────────┘
```

## TypeScript Web Ecosystem

### **Core Packages**

- **`@navaramap/core`** (`web/navara_core/`) - Core utilities, event management, type definitions
- **`@navaramap/three`** (`web/navara_three/`) - Main Three.js integration with comprehensive 3D engine
- **`@navaramap/worker`** (`web/navara_worker/`) - Web Worker abstraction with task queuing
- **`@navaramap/three-api`** (`web/navara_three_api/`) - Bridge between Three.js and WASM API

### **WASM Integration** (`web/wasm/`)

- **`navara_engine`** - Main engine functionality (generated from `navara_wasm`)
- **`navara_engine_worker`** - Background processing (generated from `navara_wasm_worker`)
- **`navara_engine_api`** - Utility functions (generated from `navara_wasm_api`)

## Build System Architecture

### **Multi-Target WASM Compilation**

The project compiles three separate WASM modules for different purposes:

1. **Main Engine** (`navara_wasm`) → `web/wasm/navara_engine/`
   - Full 3D engine functionality
   - Camera, layers, features, tiles
   - ECS system integration

2. **Web Worker** (`navara_wasm_worker`) → `web/wasm/navara_engine_worker/`
   - Performance-critical background tasks
   - Terrain mesh construction
   - Polygon/polyline batch processing

3. **API Bindings** (`navara_wasm_api`) → `web/wasm/navara_engine_api/`
   - Lightweight utility functions
   - Coordinate transformations
   - Mathematical operations

### **Build Pipeline**

```bash
# Build sequence (enforced by cargo-make):
1. Compile WASM modules (Rust → WebAssembly)
2. Generate TypeScript bindings
3. Install web dependencies (pnpm workspace)
4. Build TypeScript packages
5. Copy assets and prepare examples
```

## Supported Geospatial Formats

The engine supports comprehensive geospatial data formats:

- **Raster Tiles** - Standard web map tiles (XYZ, TMS)
- **Vector Tiles** - Mapbox Vector Tiles (MVT) format
- **3D Tiles** - Cesium 3D Tiles specification (buildings, point clouds)
- **GeoJSON** - Feature collections and geometries
- **Terrain Data** - Height maps and digital elevation models
- **3D Models** - GLB/GLTF models with geospatial positioning

## Performance Features

### **Rendering Optimizations**

- **Frustum Culling** - Automatic geometry culling outside camera view
- **Level-of-Detail (LOD)** - Hierarchical detail management
- **Tile Management** - Automatic loading/unloading based on viewport
- **GPU Acceleration** - WebGL-based rendering pipeline

### **Computational Optimizations**

- **Web Workers** - CPU-intensive tasks offloaded to background threads
- **WASM Performance** - Core algorithms implemented in Rust
- **Memory Management** - Efficient buffer pooling and zero-copy transfers
- **Spatial Indexing** - Quadtree-based spatial data structures

## Mesh Picking

The rendering engine includes a GPU-based mesh picking system that identifies which mesh the user clicked or hovered. Rather than using CPU-side raycasting, picking renders all pickable meshes into a dedicated 1×1 render target with each mesh's batch ID encoded as an RGB color, then reads back the single pixel to determine the hit.

Two gestures trigger a pick: a click (emitting `"featureClick"`) and hovering (emitting `"featureHover"` plus the diff-synthesized `"featureEnter"` / `"featureLeave"` pair). Hover picks are throttled to one per animation frame and suppressed while a mouse button is down. Both gestures are lazy, and the pick runs only while a matching listener is registered on the view.

### Pick Flow

1. The user clicks on the canvas.
2. `PickHelper` converts the click coordinates to WebGL pixel space (Y-flipped) and sets a scissor rect to limit the GPU work to a single pixel.
3. All registered pickable meshes are temporarily re-parented into a dedicated pick scene. Each mesh's `onBeforePicking()` callback activates the picking shader branch.
4. The pick scene is rendered with a black clear color (batch ID 0 = miss).
5. The single pixel is read back and decoded: `batchId = (R << 16) + (G << 8) + B`.
6. `onAfterPicking()` restores each mesh's normal rendering state, and all meshes are re-parented to their original scenes.
7. A `"featureClick"` event is emitted with the decoded `PickedFeature` (batch ID, layer ID, properties).

### Shader Injection

For standard Three.js materials, `PickableMeshWrapper` injects picking uniforms (`nvr_uPickable`, `nvr_uBatchId`) and a color-encoding branch via `onBeforeCompile`. For `ShaderMaterial` variants, the injection modifies the shader source directly. Layers with fully custom shaders implement the `PickableMesh` interface and handle the encoding themselves.

### Instanced Mesh Picking

`PickableInstancedMeshWrapper` assigns a unique batch ID per instance using an `InstancedBufferAttribute`. The vertex shader passes the per-instance ID as a varying, and the fragment shader encodes it during the pick pass. This allows picking individual instances within a single draw call.

## Three.js Integration

### **Rendering Pipeline**

- **Multi-Render Targets** - Separate color, normal, and depth buffers
- **Post-Processing** - SSAO, tone mapping, anti-aliasing, lens flare
- **Atmospheric Effects** - Realistic atmosphere with scattering
- **Weather Effects** - Volumetric clouds and fog systems
- **Mesh Picking** - GPU-based single-pixel picking with scissor optimization

### **Key Dependencies**

- **Three.js** - Core 3D rendering
- **@takram/three-*** - Specialized extensions for atmosphere, clouds, geospatial effects
- **Postprocessing library** - Advanced visual effects

## Key Technologies

### **Rust Ecosystem**

- **Bevy ECS** - Entity Component System framework
- **wasm-bindgen** - WebAssembly bindings generation
- **geo-types** - Geometric types and operations
- **serde** - Serialization/deserialization

### **Web Ecosystem**

- **Three.js** - 3D rendering engine
- **TypeScript** - Type-safe JavaScript development
- **Vite** - Fast build tool and development server
- **pnpm workspaces** - Monorepo package management

### **Build Tools**

- **cargo-make** - Task runner and build orchestration
- **wasm-pack** - WebAssembly package builder
- **cargo-watch** - File watching for automatic rebuilds

## Code Quality Standards

- **Clippy**: Configured with `-D warnings` (warnings treated as errors)
- **Rust 1.93.0**: Exact toolchain version for consistency
- **ESLint**: Strict TypeScript linting with reearth configuration
- **Format on save**: Both Rust and TypeScript code formatting enforced

## Testing Strategy

- **Rust Tests**: Unit and integration tests with `cargo test`
- **TypeScript Tests**: Vitest for web package testing
- **Parallel Execution**: `cargo make test` runs both test suites simultaneously

## Memory Management

- **Zero-copy transfers** between WASM and JavaScript where possible
- **Buffer pooling** for efficient memory usage
- **Automatic cleanup** of geometry and texture resources
- **Reference counting** for shared resources

This architecture provides a robust, high-performance foundation for complex geospatial visualizations while maintaining developer productivity through excellent tooling and hot reload capabilities.
