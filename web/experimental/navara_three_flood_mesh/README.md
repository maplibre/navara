# @navaramap/three-flood-mesh

> **Nightly.** This package is published only in Navara nightly builds, under the `nightly` dist-tag, and any nightly may change its API. It requires `@navaramap/three` of the same nightly build: `npm install @navaramap/three@nightly @navaramap/three-flood-mesh@nightly`. Depend on exact versions.

Time-series flood water surfaces for Navara. `TimeSeriesFloodMeshDesc` plays a series of water-surface heights read from a [Zarr](https://zarr.dev/) store, such as the result of a flood or tsunami simulation, and the `@navaramap/three-flood-mesh/convert` entry and the `navara-flood-zarr` command write that store from simulation output.

## Quick Start

```typescript
import ThreeView from "@navaramap/three";
import { TimeSeriesFloodMeshDesc } from "@navaramap/three-flood-mesh";

const view = new ThreeView({ animation: true });
await view.init();
view.registerMesh("timeSeriesFlood", TimeSeriesFloodMeshDesc);

view.addMesh<TimeSeriesFloodMeshDesc>({
  timeSeriesFlood: { url: "https://example.com/flood.zarr", frame: 0 },
});
```

## Documentation

For how it works, usage examples, converting data and the API reference, see the [Flood Mesh documentation](https://navara.world/docs/three_flood_mesh/about/).

## AI Coding Agents

This package ships the `navara-flood-mesh` [agent skill](https://pnpm.io/agent-skills) (`skills/navara-flood-mesh`), which takes agents such as Claude Code from simulation output to the viewer: inspecting the input, writing the `navara-flood-zarr` configuration, reading its report, serving the group, and playing and coloring it with `TimeSeriesFloodMeshDesc`. It builds on the `navara-usage` skill of `@navaramap/three` for the rest of the scene. With pnpm 12.11 or later, run `pnpm approve` after installing to link it into your project's agent skills directory (for example `.claude/skills`). With another package manager, copy `node_modules/@navaramap/three-flood-mesh/skills/navara-flood-mesh` there instead.

## Development

### Example

`pnpm dev` serves `example/`, which plays the datasets listed in `example/datasets.json` over terrain and buildings, marks the levee breach where the data gives it, and shows the water at a clicked point over time. A coloring of the flood as a whole, such as `depth-max` or `arrival`, turns the time slider off. Pick a dataset with the `dataset` query parameter (a key of `example/datasets.json`, such as `saitama`) and a coloring with `colorBy` (`water`, or a property of the dataset such as `depth`, `depth-max`, `depth-heatmap`, `speed` or `arrival`). `clouds=off` clears the sky. `showUnderground` sets the mesh's option in meters, overriding the dataset's (`0` turns it off). `pnpm build:example` builds the example for https://navara.world/navara-three-flood-mesh/ into `dist-example`, with the published datasets only.

### Adding a Dataset to the Example

To play a converted group in this package's example, put it in `example/public/zarr` and add an entry for it to `example/datasets.json`, then run `pnpm dev` and open `?dataset=<key>`. The entries are listed in the dataset menu in the order of the file, and the first is shown by default. An entry needs a `label`, the group's `url` (relative to `example/public`, or an absolute URL for a group hosted elsewhere), an `attribution` and a `camera`. The optional fields turn on the staging they describe: `breach` marks the levee breach, `weather` adds rain that stops and a sky that clears over the given hours, `waterColor` replaces the muddy brown of a river flood, and `startStep`, `since` and `origin` set the first step shown and what the elapsed time counts from. The colorings offered follow the group's own properties. `example/data.ts` describes every field.

`pnpm build:example` writes the example to `dist-example` for the site, with the entries not marked `"publish": false` and their groups copied from `example/public`. An entry whose group is not there is left out with a warning. Mark data that must not be published with `"publish": false` to keep it to `pnpm dev`.

## License

MIT OR Apache-2.0
