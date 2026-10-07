export {
  RainMeshDesc,
  type RainMeshConfig,
  type RainMeshUpdate,
} from "./RainMeshDesc";
export {
  SnowMeshDesc,
  type SnowMeshConfig,
  type SnowMeshUpdate,
} from "./SnowMeshDesc";
export {
  SkyMeshDesc,
  type SkyMeshConfig,
  type SkyMeshUpdate,
} from "./SkyMeshDesc";
export { StarsDesc, type StarsConfig, type StarsUpdate } from "./StarsDesc";
export {
  BoxMeshDesc,
  type BoxMeshConfig,
  type BoxMeshUpdate,
} from "./BoxMeshDesc";
export {
  SphereMeshDesc,
  type SphereMeshConfig,
  type SphereMeshUpdate,
} from "./SphereMeshDesc";
export {
  GlowGlobeMeshDesc,
  type GlowGlobeMeshConfig,
  type GlowGlobeMeshUpdate,
  DEFAULT_GLOW_GLOBE_OPTIONS,
} from "./GlowGlobeMeshDesc";
export {
  CylinderMeshDesc,
  type CylinderMeshConfig,
  type CylinderMeshUpdate,
} from "./CylinderMeshDesc";
export {
  PlaneMeshDesc,
  type PlaneMeshConfig,
  type PlaneMeshUpdate,
} from "./PlaneMeshDesc";
export {
  GLTFModelDesc,
  type GLTFModelConfig,
  type GLTFModelUpdate,
  type AnimationDetails,
  type AnimationState,
  type GLTFModelEvent,
  DEFAULT_GLTF_MODEL_DESCRIPTION,
} from "./GLTFModelDesc";
export {
  SplatMeshDesc,
  type SplatMeshConfig,
  type SplatMeshUpdate,
  type SplatMeshEvent,
} from "./SplatMeshDesc";
export {
  TubeMeshDesc,
  type TubeMeshConfig,
  type TubeMeshUpdate,
} from "./TubeMeshDesc";
export {
  ArclineMeshDesc,
  type ArclineMeshConfig,
  type ArclineMeshUpdate,
} from "./ArclineMeshDesc";
export {
  SmoothLineMeshDesc,
  type SmoothLineMeshConfig,
  type SmoothLineMeshUpdate,
} from "./SmoothLineMeshDesc";
export {
  SkyBoxMeshDesc,
  type SkyBoxMeshConfig,
  type SkyBoxMeshUpdate,
  DEFAULT_SKY_BOX_OPTIONS,
} from "./SkyBoxMeshDesc";
export {
  ArrowHelperDesc,
  type ArrowHelperConfig,
  type ArrowHelperUpdate,
} from "./ArrowHelperDesc";
export {
  AxesHelperDesc,
  type AxesHelperConfig,
  type AxesHelperUpdate,
} from "./AxesHelperDesc";
export {
  InstancedBoxMeshDesc,
  type InstancedBoxMeshConfig,
  type InstancedBoxMeshUpdate,
  type BoxChildConfig,
  type SharedBoxMaterialConfig,
  type BoxesDescription,
} from "./InstancedBoxMeshDesc";
export {
  InstancedSphereMeshDesc,
  type InstancedSphereMeshConfig,
  type InstancedSphereMeshUpdate,
  type SphereChildConfig,
  type SharedSphereConfig,
  type SpheresDescription,
} from "./InstancedSphereMeshDesc";
export {
  InstancedPlaneMeshDesc,
  type InstancedPlaneMeshConfig,
  type InstancedPlaneMeshUpdate,
  type PlaneChildConfig,
  type SharedPlaneConfig,
  type PlanesDescription,
} from "./InstancedPlaneMeshDesc";
export {
  InstancedCylinderMeshDesc,
  type InstancedCylinderMeshConfig,
  type InstancedCylinderMeshUpdate,
  type CylinderChildConfig,
  type SharedCylinderConfig,
  type CylindersDescription,
} from "./InstancedCylinderMeshDesc";
export {
  InstancedGltfModelMeshDesc,
  type InstancedGltfModelMeshConfig,
  type InstancedGltfModelMeshUpdate,
  type ModelChildConfig,
  type InstancedModelsDescription,
  type InstancedGltfModelEvent,
} from "./InstancedGltfModelMeshDesc";

export {
  PolygonMeshDesc,
  type PolygonMeshConfig,
  type PolygonMeshStyle,
  type PolygonMeshUpdate,
} from "./PolygonMeshDesc";
export {
  PolylineMeshDesc,
  type PolylineMeshConfig,
  type PolylineMeshStyle,
  type PolylineMeshUpdate,
} from "./PolylineMeshDesc";

// Mesh implementations
export { SkyMesh, type SkyMeshOptions } from "./skyMesh";
export { RainMesh, type RainConfig, DefaultRainConfig } from "./rain";
export { SnowMesh, type SnowConfig, DefaultSnowConfig } from "./snow";
export { Stars, type StarsOptions, DEFAULT_STARS_OPTIONS } from "./stars";
export { ArcLine, type ArcLineConfig, DefaultArcLineConfig } from "./arcLine";
export {
  SmoothLine,
  type SmoothLineConfig,
  DefaultSmoothLineConfig,
} from "./smoothLine";
export { SpherePoints, type SpherePointOptions } from "./spherePoints";
