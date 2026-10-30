# @navaramap/three-plugins

Optional feature plugins for `@navaramap/three`. Each plugin packages a self-contained capability on top of the core view:

- **`PersonViewPlugin`**: first-person walk mode with a controllable character (GLTF model, animations, key bindings, teleport, view-mode switching).
- **`OverlayPlugin`**: anchors DOM elements to geographic positions and keeps them projected to screen space as the camera moves.
- **`CesiumIonPlugin`**: resolves a Cesium Ion asset endpoint and registers the asset as a quantized-mesh terrain layer via `addTerrain()`.
- **`TileJsonPlugin`**: fetches a TileJSON 3.0.0 document and registers it as a Navara source, surfacing its attribution through the view's built-in credit UI.
- **`StreetLightsPlugin`**: street lamps, roof beacons and moving traffic at night, streamed in around the camera from OpenMapTiles-schema vector tiles.

## Usage

Like all Navara plugins, add them before `view.init()`:

```typescript
import ThreeView from "@navaramap/three";
import {
  DefaultPlugin,
  type DefaultDescriptions,
} from "@navaramap/three-default-plugin";
import { OverlayPlugin, moveOverlayElement } from "@navaramap/three-plugins";

const view = new ThreeView<DefaultDescriptions>();
view.addPlugin(new DefaultPlugin());
const overlay = new OverlayPlugin();
view.addPlugin(overlay); // must happen before init()
await view.init();

// Basemap, credited through the built-in attribution UI.
const source = view.addSource({
  type: "raster-tile",
  url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  maxZoom: 18,
});
view.addLayer({ type: "raster", source });
view.attribution?.add([
  {
    attribution: "© OpenStreetMap contributors",
    attributionUrl: "https://www.openstreetmap.org/copyright",
  },
]);

// Anchor a DOM element to a geographic position.
overlay.setPositions([{ id: "tokyo", lng: 139.77, lat: 35.68, alt: 0 }]);
overlay.onUpdate(({ projected }) => {
  const pos = projected.get("tokyo");
  if (pos) moveOverlayElement(markerElement, pos.x, pos.y);
});
```

`@navaramap/three`, `@navaramap/three-default-plugin`, and `three` are peer dependencies.

## Documentation

Each plugin's options and events are documented at https://navara.world/docs/.

## License

MIT OR Apache-2.0
