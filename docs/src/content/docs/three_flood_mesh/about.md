---
title: About
description: Time-series flood water surfaces for Navara, from flood simulation output.
sidebar:
  order: 1
since: nightly
---

## What is three_flood_mesh?

`@navaramap/three-flood-mesh` draws a water surface that changes over time, such as the result of a flood or tsunami simulation, on Navara's 3D globe. It provides:

- **`TimeSeriesFloodMeshDesc`**: a mesh descriptor that plays a series of water-surface heights read from a [Zarr](https://zarr.dev/) store, shaded as Navara's water or colored by a property such as the depth or the flow speed.
- **Series functions**: `loadTimeSeriesFlood` to load a series, `sampleTimeSeriesFlood` to read the water at a point, and `timeToFrame` / `frameToTime` to convert between times and frames.
- **Converters**: the `@navaramap/three-flood-mesh/convert` entry and the `navara-flood-zarr` command, which write the Zarr group from simulation output (CSV, netCDF and CZML).

See it running in the [example](https://navara.world/navara-three-flood-mesh/).

## Installation

`@navaramap/three-flood-mesh` is published only in [nightly builds](../../three/introduction/install/#nightly-builds). It requires `@navaramap/three` of the same nightly build, so install both from the `nightly` dist-tag:

```bash
npm install @navaramap/three@nightly @navaramap/three-flood-mesh@nightly
```

## Quick Start

```typescript
import ThreeView from "@navaramap/three";
import { TimeSeriesFloodMeshDesc } from "@navaramap/three-flood-mesh";

const view = new ThreeView({ animation: true });
await view.init();
view.registerMesh("timeSeriesFlood", TimeSeriesFloodMeshDesc);

const water = view.addMesh<TimeSeriesFloodMeshDesc>({
  timeSeriesFlood: { url: "https://example.com/flood.zarr", frame: 0 },
});
```

See [Usage Examples](../usage-examples/) for playback, coloring and loading recipes.

## Relationship with Other Packages

```text
@navaramap/three (core: ThreeView, MeshDesc)
  └── @navaramap/three-flood-mesh
        ├── TimeSeriesFloodMeshDesc, loadTimeSeriesFlood (browser entry)
        └── convertRasters, convertMesh, convertPolygons (/convert entry, browsers and Node)
```

The `/convert` entry and the `navara-flood-zarr` command need neither `three` nor `@navaramap/three`.

## Building with AI Coding Agents

The package ships the [navara-flood-mesh skill](https://github.com/reearth/navara/tree/main/web/experimental/navara_three_flood_mesh/skills/navara-flood-mesh) for AI coding agents such as Claude Code. It walks an agent from the simulation output to the viewer: inspecting the input, choosing the converter and writing its configuration, reading the report, serving the Zarr group, and playing and coloring it with `TimeSeriesFloodMeshDesc`. For the rest of the scene, it builds on the navara-usage skill of `@navaramap/three` (see [Building with AI Coding Agents](../../guides/introduction/getting-started/#building-with-ai-coding-agents)).

With pnpm 12.11 or later, run `pnpm approve` after installing to link it into your project's agent skills directory, such as `.claude/skills`. With another package manager, copy `node_modules/@navaramap/three-flood-mesh/skills/navara-flood-mesh` there.

## Pages

- [How It Works](../how-it-works/): the data format the surface reads, its properties, the flow the waves follow, and the GPU memory a series takes
- [Usage Examples](../usage-examples/): playing a simulation, loading from a private server or in a worker, and switching scenarios
- [Converting Data](../converting-data/): writing the Zarr group with the command or the API, and the vertical datum of the heights
- [Preparing Flood Data](../preparing-data/): converting real datasets of each kind, step by step
- API: [TimeSeriesFloodMeshDesc](../api/time-series-flood-mesh-desc/), [Series Functions](../api/series-functions/), [Converters](../api/converters/)
