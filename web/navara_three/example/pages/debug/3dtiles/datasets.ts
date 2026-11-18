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
    "POSITION_QUANTIZED: not supported, nothing renders",
  ),
  ...specs("GltfContent", ["glb"], "3D Tiles 1.1 glTF content"),
  ...specs("GltfContent", ["glTF"], "Plain .gltf content"),
  ...specs(
    "Metadata",
    ["StructuralMetadata"],
    "Plain .gltf: renders, but its metadata is not read",
  ),
  ...[
    "TileMetadata",
    "ContentMetadata",
    "GroupMetadata",
    "TilesetMetadata",
  ].map((name) => ({
    group: "Metadata",
    name,
    url: `${CESIUM_SPECS}/Metadata/${name}/tileset_1.1.json`,
    note: "3D Tiles 1.1 metadata over B3DM content",
  })),
  {
    group: "MultipleContents",
    name: "MultipleContents",
    url: `${CESIUM_SPECS}/MultipleContents/MultipleContents/tileset_1.1.json`,
    note: "Tile `contents`: not supported, nothing renders",
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
];
