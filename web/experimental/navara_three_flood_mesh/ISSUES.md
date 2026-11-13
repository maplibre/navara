# Issues

Known gaps of `@navaramap/three-flood-mesh` to revisit.

## Terrain types copied from `@navaramap/three`

The converters' `terrain` takes a `raster-dem` source or a `TerrainSampler`, shaped like `addSource` and `sampleTerrainMostDetailed` of `@navaramap/three`. Their types (`RasterDemTerrain`, `TerrainSampler`, `TerrainPosition` in `src/convert/terrain.ts`) are written out here rather than imported, because `@navaramap/three` is an optional peer dependency: a converter-only user does not install it, and the published `convert.d.ts` must resolve without it. Only `ElevationDecoder` and the names of its presets (`ElevationDecoderName`) come from the engine, through `@navaramap/engine-api`, a dependency.

Nothing checks that the copies keep matching Navara's `TerrainSampleSource`, `SampledTerrainPosition` and `LatLng`. A package holding only those types, with no runtime and no `three`, would let the converters import them, and remove the copies.

## Terrain sampled with a copy of `sampleTerrainMostDetailed`

`src/convert/rasterDem.ts`, which samples both the command's terrain and the geoid (`TileGeoid`), repeats what `sampleTerrainMostDetailed` of `@navaramap/three` does for a `raster-dem` source (tile grouping, falling back to parents on 404, the engine's interpolation), because `@navaramap/three` does not load in Node. Moving `sampleTerrainMostDetailed` into `@navaramap/three-api` would let the converters call it instead, once that package:

- takes the image decoder from the caller (a worker in `ThreeView`, `createImageBitmap` in a browser, `sharp` in Node), so that it depends on neither `@navaramap/worker` nor `sharp`;
- initializes its WASM from bytes, as Node needs; the module's own init fetches the file by URL, which Node cannot.

The command would then also sample `quantized-mesh` sources.
