const CESIUM_SPECS =
  "https://raw.githubusercontent.com/CesiumGS/cesium/main/Specs/Data/Cesium3DTiles";
const SAMPLES =
  "https://raw.githubusercontent.com/CesiumGS/3d-tiles-samples/main";

export type Dataset = {
  group: string;
  name: string;
  url: string;
  /** What to look for, or why it is expected to fail. */
  note?: string;
};

const specs = (group: string, names: string[], note?: string): Dataset[] =>
  names.map((name) => ({
    group,
    name,
    url: `${CESIUM_SPECS}/${group}/${name}/tileset.json`,
    note,
  }));

/**
 * Wraps a tileset without a transform, which would sit at the Earth's center,
 * as the external tileset of a root placed by `transform`.
 */
const placed = (url: string, transform: number[], box: number[]) =>
  `data:application/json,${encodeURIComponent(
    JSON.stringify({
      asset: { version: "1.1" },
      geometricError: 2,
      root: {
        transform,
        boundingVolume: { box },
        geometricError: 2,
        content: { uri: url },
      },
    }),
  )}`;

export const DATASETS: Dataset[] = [
  ...specs("Batched", [
    "BatchedColors",
    "BatchedColorsMix",
    "BatchedColorsTranslucent",
    "BatchedTextured",
    "BatchedTranslucent",
    "BatchedTranslucentOpaqueMix",
    "BatchedWithVertexColors",
    "BatchedNoBatchIds",
    "BatchedWithBatchTable",
    "BatchedWithBatchTableBinary",
    "BatchedWithoutBatchTable",
    "BatchedWithRtcCenter",
    "BatchedWithTransformBox",
    "BatchedWithTransformRegion",
    "BatchedWithTransformSphere",
    "BatchedWithBoundingSphere",
    "BatchedWGS84",
    "BatchedWithCopyright",
    "BatchedAnimated",
    "BatchedExpiration",
  ]),
  ...specs("Batched", ["BatchedWithContentDataUri"], "data: URI content"),
  ...specs(
    "Batched",
    ["BatchedDeprecated1", "BatchedDeprecated2"],
    "Legacy B3DM header",
  ),
  ...specs("Tilesets", [
    "Tileset",
    "TilesetOfTilesets",
    "TilesetEmptyRoot",
    "TilesetEmptyExternal",
    "TilesetPoints",
    "TilesetRefinementMix",
    "TilesetReplacement1",
    "TilesetReplacement2",
    "TilesetReplacement3",
    "TilesetUniform",
    "TilesetWithExternalResources",
    "TilesetWithTransforms",
    "TilesetWithViewerRequestVolume",
    "TilesetReplacementWithViewerRequestVolume",
  ]),
  ...specs("PointCloud", [
    "PointCloudRGB",
    "PointCloudRGBA",
    "PointCloudRGB565",
    "PointCloudNoColor",
    "PointCloudConstantColor",
    "PointCloudNormals",
    "PointCloudNormalsOctEncoded",
    "PointCloudDraco",
    "PointCloudDracoPartial",
    "PointCloudDracoBatched",
    "PointCloudBatched",
    "PointCloudWithPerPointProperties",
    "PointCloudWithTransform",
    "PointCloudWGS84",
  ]),
  ...specs(
    "PointCloud",
    ["PointCloudQuantized", "PointCloudQuantizedOctEncoded"],
    "POSITION_QUANTIZED; normals are not read",
  ),
  ...specs("GltfContent", ["glb"], "3D Tiles 1.1 glTF content"),
  ...specs("GltfContent", ["glTF"], "Plain .gltf content"),
  ...specs(
    "Metadata",
    ["StructuralMetadata"],
    "Plain .gltf with EXT_structural_metadata",
  ),
  ...[
    "TileMetadata",
    "ContentMetadata",
    "GroupMetadata",
    "TilesetMetadata",
  ].flatMap((name) => [
    {
      group: "Metadata",
      name,
      url: `${CESIUM_SPECS}/Metadata/${name}/tileset_1.1.json`,
      note: "3D Tiles 1.1 metadata over B3DM content: see the pane on load and click",
    },
    {
      group: "Metadata",
      name: `${name} (1.0)`,
      url: `${CESIUM_SPECS}/Metadata/${name}/tileset_1.0.json`,
      note: "The same metadata in the 1.0 `3DTILES_metadata` extension",
    },
  ]),
  {
    group: "MultipleContents",
    name: "MultipleContents",
    url: `${CESIUM_SPECS}/MultipleContents/MultipleContents/tileset_1.1.json`,
    note: "Tile `contents`: the B3DM renders, the I3DM is skipped",
  },
  ...specs(
    "Instanced",
    ["InstancedOrientation", "InstancedWithBatchTable", "InstancedRTC"],
    "I3DM: not supported, skipped",
  ),
  ...specs(
    "Composite",
    ["Composite", "CompositeOfComposite"],
    "CMPT: not supported, skipped",
  ),
  {
    group: "3d-tiles-samples 1.0",
    name: "TilesetWithDiscreteLOD",
    url: `${SAMPLES}/1.0/TilesetWithDiscreteLOD/tileset.json`,
    note: "Root transform + B3DM without RTC",
  },
  {
    group: "3d-tiles-samples 1.0",
    name: "TilesetWithRequestVolume",
    url: `${SAMPLES}/1.0/TilesetWithRequestVolume/tileset.json`,
  },
  {
    group: "3d-tiles-samples 1.0",
    name: "TilesetWithTreeBillboards",
    url: `${SAMPLES}/1.0/TilesetWithTreeBillboards/tileset.json`,
    note: "I3DM: not supported, skipped",
  },
  {
    group: "3d-tiles-samples 1.1",
    name: "MultipleContents",
    url: placed(
      `${SAMPLES}/1.1/MultipleContents/tileset.json`,
      // The sample's Sandcastle placement: ENU at (-75.152408, 39.9471, 1 m), scaled 15x.
      [
        14.499163085582246, 3.8437312364015646, 0, 0, -2.4679831941768637,
        9.309623546506499, 11.499563834145725, 0, 2.9467488476199777,
        -11.115603429622823, 9.631200944036403, 0, 1254717.3449038235,
        -4732992.577051421, 4073484.9527697754, 1,
      ],
      [0.5, -0.5, 0, 0.5, 0, 0, 0, 0.5, 0, 0, 0, 0.1],
    ),
    note: "Tile `contents`: two GLBs (triangles and points) render together",
  },
];
