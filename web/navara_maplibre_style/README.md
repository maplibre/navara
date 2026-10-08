# @navaramap/maplibre-style

MapLibre Style support for Navara. This package provides `MapLibreStylePlugin`, which parses a [MapLibre Style](https://maplibre.org/maplibre-style-spec/) JSON specification and translates its sources and layers into Navara layer operations and per-feature evaluators, so existing styles can be rendered on Navara's 3D globe.

## Quick Start

```typescript
import ThreeView from "@navaramap/three";
import { MapLibreStylePlugin } from "@navaramap/maplibre-style";
import style from "./style.json";

const view = new ThreeView();
view.addPlugin(new MapLibreStylePlugin(style));
await view.init();
```

## Documentation

For detailed usage, supported features, and known limitations, see the [MapLibre Style documentation](https://navara.world/docs/maplibre_style/about/).

## License

MIT OR Apache-2.0
