import ThreeView, {
  Color,
  fetchFontFamilyFromCss,
  geodeticToVector3,
  JAPAN_GSI_ELEVATION_DECODER,
} from "@navaramap/three";
import {
  ToneMappingMode,
  type SphereMeshDesc,
} from "@navaramap/three-default-descs";
import {
  DefaultPlugin,
  type DefaultDescriptions,
} from "@navaramap/three-default-plugin";

type CustomDescriptions = DefaultDescriptions;

async function main() {
  // Create the view - this tests that the main export works
  const view = new ThreeView<CustomDescriptions>({});

  const plugin = new DefaultPlugin();
  view.addPlugin(plugin);

  // Initialize the view - this tests WASM loading
  await view.init();

  // Set exposure
  view.toneMappingExposure = 10;

  view.atmosphere.date.setHours(12);

  // Add default atmosphere descriptors - tests descriptor system
  const effects = plugin.addDefaultPhotorealScene();

  // Simplify by removing sky mesh (use aerial perspective for sky)
  effects.sky.delete();
  effects.aerialPerspective.update({
    aerialPerspective: {
      sky: true,
    },
  });

  effects.toneMapping.update({
    toneMapping: {
      mode: ToneMappingMode.REINHARD,
    },
  });

  // Add terrain layer - tests terrain system
  const demSource = view.addSource({
    type: "raster-dem",
    url: "https://cyberjapandata.gsi.go.jp/xyz/dem_png/{z}/{x}/{y}.png",
    elevationDecoder: JAPAN_GSI_ELEVATION_DECODER(),
    maxZoom: 15,
    minZoom: 6,
  });
  view.addLayer({
    type: "terrain",
    source: demSource,
  });

  // Add tile layer - tests tile system
  const seamlessphotoSource = view.addSource({
    type: "raster-tile",
    url: "https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg",
    maxZoom: 18,
  });
  view.addLayer({
    type: "raster",
    source: seamlessphotoSource,
    raster: {
      color: new Color().setStyle("#ffffff"),
      opacity: 1,
    },
  });

  // Add 3D Tiles layer - tests 3D Tiles loading (PLATEAU Chiyoda buildings)
  const chiyodaSource = view.addSource({
    type: "3d-tiles",
    url: "https://assets.cms.plateau.reearth.io/assets/db/070026-aa27-431b-8d53-7cc6b03244f8/13101_chiyoda-ku_pref_2023_citygml_1_op_bldg_3dtiles_13101_chiyoda-ku_lod2_no_texture/tileset.json",
  });
  view.addLayer({
    type: "3d-tiles",
    source: chiyodaSource,
    model: {
      color: new Color().setHex(0xffffff),
      metalness: 0,
      roughness: 1,
    },
  });

  view.setCamera({
    lng: 139.7671,
    lat: 35.6812,
    distance: 1000,
    heading: 50,
    pitch: -35,
    roll: 0,
  });

  // Add a text label - tests the font worker (WASM loading, shaping, atlas)
  view.addFontFamily(
    await fetchFontFamilyFromCss(
      "MapFont",
      "https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@800",
    ),
  );
  const labelSource = view.addSource({
    type: "geojson",
    data: {
      type: "Feature",
      properties: { name: "東京駅 Tokyo Station" },
      geometry: { type: "Point", coordinates: [139.7671, 35.6812] },
    },
  });
  const labelLayer = view.addLayer({
    type: "vector",
    source: labelSource,
    text: {
      font: "MapFont",
      color: new Color().setStyle("#ffffff"),
      size: 32,
      sizeInMeters: false,
      height: 300,
      depthTest: false,
      outlineColor: new Color().setStyle("#000000"),
      outlineWidth: 4,
    },
  });
  labelLayer.on("featureUpdated", ({ evaluator }) => {
    evaluator.evaluate(
      ({ properties }) => ({ text: properties?.["name"] as string }),
      { filters: ["name"] },
    );
  });

  // Add a rotating sphere mesh - tests mesh descriptor and geospatial API
  addRotatingSphere(view);
  // Log success message
  console.log("Navara integration test loaded successfully!");
  console.log(
    "If you can see the 3D globe with a rotating sphere, the library is working correctly.",
  );
}

/**
 * Add a sphere that rotates around the globe.
 * Tests: SphereMeshDesc, geodeticToVector3 APIs
 */
function addRotatingSphere(view: ThreeView<CustomDescriptions>) {
  // Create a sphere mesh descriptor
  const sphereLayer = view.addMesh<SphereMeshDesc>({
    sphere: {
      radius: 1,
      color: new Color().setHex(0xff6600), // Orange color
      emissiveColor: new Color().setHex(0x331100),
    },
    position: { x: 0, y: 0, z: 0 },
  });

  // Get the raw Three.js mesh for direct manipulation
  const sphere = sphereLayer.ref.raw;
  if (!sphere) {
    console.error("Failed to create sphere mesh");
    return;
  }

  // Set sphere size
  const sphereRadius = 200000; // 200km radius
  sphere.scale.set(sphereRadius, sphereRadius, sphereRadius);

  // Animation state
  let lng = 0;
  let lat = 0;
  let latDirection = 1;
  const lngSpeed = 0.5; // degrees per frame
  const latSpeed = 0.1; // degrees per frame
  const altitude = 500000; // 500km above surface

  // Animation loop
  const animate = () => {
    // Update longitude (0 to 360)
    lng += lngSpeed;
    if (lng >= 360) lng -= 360;
    if (lng < 0) lng += 360;

    // Update latitude (-60 to 60, bouncing)
    lat += latSpeed * latDirection;
    if (lat > 60) {
      lat = 60;
      latDirection = -1;
    } else if (lat < -60) {
      lat = -60;
      latDirection = 1;
    }

    // Convert geodetic coordinates to 3D position
    const position = geodeticToVector3({
      lat,
      lng,
      height: altitude,
    });

    // Update sphere position
    sphere.position.set(position.x, position.y, position.z);

    // Request re-render
    view.forceUpdate();

    // Continue animation
    requestAnimationFrame(animate);
  };

  // Start animation
  animate();

  console.log("Rotating sphere added - testing geospatial APIs");
}

main().catch(console.error);
