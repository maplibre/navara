## v0.2.1 - 2026-10-08

### 🐛 Bug Fixes

- Include navara_three_default_descs in navara_three_plugins ([#857](https://github.com/maplibre/navara/pull/857))

## v0.2.0 - 2026-10-08

### 🚀 Features

- **BREAKING:** Improve selective bloom to use mipmap blur ([#832](https://github.com/maplibre/navara/pull/832))

- Add scaleToGeodeticSurface function to project a position onto the geodetic surface ([#818](https://github.com/maplibre/navara/pull/818))
- Enable SIMD ([#814](https://github.com/maplibre/navara/pull/814))
- Add multiple layers to single source ([#824](https://github.com/maplibre/navara/pull/824))
- Support specular and shadow lighting in AerialPerspectiveEffect ([#838](https://github.com/maplibre/navara/pull/838))
- Add polygon and polyline meshes ([#852](https://github.com/maplibre/navara/pull/852))

- **EXPERIMENTAL:** Support parsing and displaying maplibre's demo tiles ([#820](https://github.com/maplibre/navara/pull/820))
- **EXPERIMENTAL:** Add rotation and facing options for text and sprites ([#833](https://github.com/maplibre/navara/pull/833))

### 🐛 Bug Fixes

- SSAO depth test error ([#812](https://github.com/maplibre/navara/pull/812))
- Dynamic batch texture ([#813](https://github.com/maplibre/navara/pull/813))
- Use batch texture for point-related meshes and support emissive ([#816](https://github.com/maplibre/navara/pull/816))
- Hide texts at initialization when show=false ([#817](https://github.com/maplibre/navara/pull/817))
- MSAA for texturized vector ([#819](https://github.com/maplibre/navara/pull/819))
- Improve skybox mesh ([#822](https://github.com/maplibre/navara/pull/822))
- Release global batch id properly ([#821](https://github.com/maplibre/navara/pull/821))
- Join lines for a polygon ([#827](https://github.com/maplibre/navara/pull/827))
- Polyline joint artifact ([#829](https://github.com/maplibre/navara/pull/829))
- Fill poles  ([#828](https://github.com/maplibre/navara/pull/828))
- Unify camera event emissions for instantaneous changes ([#831](https://github.com/maplibre/navara/pull/831))
- Improve the performance of the terrain picking on the wheel event ([#834](https://github.com/maplibre/navara/pull/834))
- Gbuffer stamping ([#835](https://github.com/maplibre/navara/pull/835))
- Improve tile rendering structure ([#836](https://github.com/maplibre/navara/pull/836))
- Restrict the max upsampling ([#845](https://github.com/maplibre/navara/pull/845))
- Refactor background for maplibre style ([#846](https://github.com/maplibre/navara/pull/846))
- Efficient upsampling ([#848](https://github.com/maplibre/navara/pull/848))
- Improve SSR quality ([#849](https://github.com/maplibre/navara/pull/849))
- Improve the Draco decoder and PNTS color ([#854](https://github.com/maplibre/navara/pull/854))
- Outdated tile AABB ([#855](https://github.com/maplibre/navara/pull/855))

### 📚 Documentation

- Inconsistent wording
- Add Azerbaijani landing page locale ([#815](https://github.com/maplibre/navara/pull/815))
- Add brand assets page ([#837](https://github.com/maplibre/navara/pull/837))

### 🧹 Miscellaneous

- Cancel superseded pull request runs ([#811](https://github.com/maplibre/navara/pull/811))
- Update dependency node to v24.20.0 ([#810](https://github.com/maplibre/navara/pull/810))
- Update cargo dependencies ([#808](https://github.com/maplibre/navara/pull/808))
- Update npm dependencies (patch) ([#809](https://github.com/maplibre/navara/pull/809))
- Add examples (IBL, SSAO, feature evaluator for extruded height)
- Enable dependabot ([#840](https://github.com/maplibre/navara/pull/840))
- Fix dependabot for cargo ([#841](https://github.com/maplibre/navara/pull/841))
- Bump the actions-minor group with 3 updates ([#843](https://github.com/maplibre/navara/pull/843))
- Bump step-security/harden-runner in the actions-patch group ([#842](https://github.com/maplibre/navara/pull/842))
- Add docs for maplibre_style. ([#839](https://github.com/maplibre/navara/pull/839))
- Bump taiki-e/install-action ([#850](https://github.com/maplibre/navara/pull/850))
- Feature emissive example ([#851](https://github.com/maplibre/navara/pull/851))
- Add draw example ([#856](https://github.com/maplibre/navara/pull/856))

## v0.1.1 - 2026-08-30

### 🚀 Features

- Support async onCreate in BaseMesh ([#804](https://github.com/reearth/navara/pull/804))

### 🐛 Bug Fixes

- Run forceUpdate when deleted and added ([#805](https://github.com/reearth/navara/pull/805))
- **BREAKING:** Support touch operation and unify mouse related event to pointer ([#806](https://github.com/reearth/navara/pull/806))
- Avoid batch id interpolation ([#807](https://github.com/reearth/navara/pull/807))

### 🧹 Miscellaneous

- Add 404
- Improve example page performance for mobile

## v0.1.0 - 2026-08-28

We finally released the beta version 🎉  
Please check out [our website](https://navara.world/) as well.  
We'd love to hear your feedback!

### 🚀 Features

- Add resolveStartHeight API to fix the terrain height until stable ([#796](https://github.com/reearth/navara/pull/796))
- **BREAKING:** Unify public API to use dgree ([#799](https://github.com/reearth/navara/pull/799))
- Support geometryTypes ([#801](https://github.com/reearth/navara/pull/801))
- **BREAKING:** Replace pick event with feature mouse events ([#802](https://github.com/reearth/navara/pull/802))

### 🐛 Bug Fixes

- Support missing url field from billboard material ([#794](https://github.com/reearth/navara/pull/794))
- Support multi point feature evaluation ([#800](https://github.com/reearth/navara/pull/800))
- Draw polyline based on texel ([#803](https://github.com/reearth/navara/pull/803))

### 🧹 Miscellaneous

- Update rust to v1.98.0 ([#798](https://github.com/reearth/navara/pull/798))

## v0.0.8 - 2026-08-26

### 🚀 Features

- Add easing to fly to API ([#784](https://github.com/reearth/navara/pull/784))
- Update npm dependencies (minor) ([#789](https://github.com/reearth/navara/pull/789))
- Add mesh API - geodetic frame   ([#785](https://github.com/reearth/navara/pull/785))

### 🐛 Bug Fixes

- Repair broken sibling links and stale repo URLs in the docs ([#780](https://github.com/reearth/navara/pull/780))
- Fix review
- Picking tolerance ([#781](https://github.com/reearth/navara/pull/781))
- Camera fov/fovy getters and vertical fov handling ([#782](https://github.com/reearth/navara/pull/782))
- Billboard color space ([#795](https://github.com/reearth/navara/pull/795))

### 🧹 Miscellaneous

- Update dependency node to v24.19.0 ([#790](https://github.com/reearth/navara/pull/790))
- Update actions/checkout action to v7 ([#791](https://github.com/reearth/navara/pull/791))
- Pin step-security/harden-runner action to v2.21.0 ([#786](https://github.com/reearth/navara/pull/786))
- Update cargo dependencies (minor) ([#788](https://github.com/reearth/navara/pull/788))
- Update actions/setup-node action to v7 ([#792](https://github.com/reearth/navara/pull/792))
- Update pnpm/action-setup action to v6 ([#793](https://github.com/reearth/navara/pull/793))

## v0.0.7 - 2026-08-21

### 🚀 Features

- Add sampleTerrainMostDetailed ([#774](https://github.com/reearth/navara/pull/774))

### 🐛 Bug Fixes

- Improve polygon outline jitter ([#768](https://github.com/reearth/navara/pull/768))
- SSR and FogLight order ([#769](https://github.com/reearth/navara/pull/769))
- Bump Overture tiles URL release ([#770](https://github.com/reearth/navara/pull/770))
- Mvt text flicker ([#771](https://github.com/reearth/navara/pull/771))
- Text material flicker ([#772](https://github.com/reearth/navara/pull/772))
- Lazy font face fetch ([#773](https://github.com/reearth/navara/pull/773))
- Improve pickTerrainPosition precision ([#775](https://github.com/reearth/navara/pull/775))
- Remove height from sampleTerrainHeight arg ([#776](https://github.com/reearth/navara/pull/776))
- Shadow error and horizon culling for polyline ([#777](https://github.com/reearth/navara/pull/777))
- Tiled geojson deletion ([#778](https://github.com/reearth/navara/pull/778))
- Tiled polygon and polyline on the geodesic path ([#779](https://github.com/reearth/navara/pull/779))

## v0.0.6 - 2026-08-17

### 🚀 Features

- Replace legacy data with source completely ([#756](https://github.com/reearth/navara/pull/756))
- Increase animation speed and dash speed multiplier for PersonViewPlugin ([#759](https://github.com/reearth/navara/pull/759))
- Enhance person view plugin ([#761](https://github.com/reearth/navara/pull/761))
- Set reflectivity for watermask automatically ([#762](https://github.com/reearth/navara/pull/762))
- Dynamic MRT buffers ([#765](https://github.com/reearth/navara/pull/765))

### 🐛 Bug Fixes

- Improve text rendering quality ([#754](https://github.com/reearth/navara/pull/754))
- Improve pmtiles overture example ([#755](https://github.com/reearth/navara/pull/755))
- Improve CSM precision ([#758](https://github.com/reearth/navara/pull/758))
- Interpolate terrain height sampling API ([#760](https://github.com/reearth/navara/pull/760))
- Improve fog light quality ([#766](https://github.com/reearth/navara/pull/766))
- Improve SSR quality ([#767](https://github.com/reearth/navara/pull/767))

## v0.0.5 - 2026-07-31

### 🚀 Features

- Support maplibre style's line, circle, symbol ([#741](https://github.com/reearth/navara/pull/741))
- Batch text labels ([#748](https://github.com/reearth/navara/pull/748))
- Support raster dem in TileJSON ([#753](https://github.com/reearth/navara/pull/753))

### 🐛 Bug Fixes

- Improve atmosphere assets handling ([#747](https://github.com/reearth/navara/pull/747))
- Load atmosphere assets on demand ([#749](https://github.com/reearth/navara/pull/749))
- Avoid panic when model material is none ([#750](https://github.com/reearth/navara/pull/750))
- Remove unused clamp to ground from the model material ([#751](https://github.com/reearth/navara/pull/751))
- Incorrect tileSize on page maplibre-style ([#752](https://github.com/reearth/navara/pull/752))

### 🔨 Refactoring

- Update decluttering logic to improve label visibility handling ([#742](https://github.com/reearth/navara/pull/742))

## v0.0.4 - 2026-07-28

### 🚀 Features

- Rename snake-case to kebab-case to follow NPM convention ([#740](https://github.com/reearth/navara/pull/740))

## v0.0.3 - 2026-07-28

### 🚀 Features

- Increase solar API ([#731](https://github.com/reearth/navara/pull/731))
- Add load/error events to GLTF and splat meshes ([#734](https://github.com/reearth/navara/pull/734))
- Add SSR geometryBuffer ([#735](https://github.com/reearth/navara/pull/735))

### 🐛 Bug Fixes

- Improve rte ([#727](https://github.com/reearth/navara/pull/727))
- Multiple polygon in geojson-vt ([#726](https://github.com/reearth/navara/pull/726))
- Flickering vector tile ([#728](https://github.com/reearth/navara/pull/728))
- Camera jump issue ([#733](https://github.com/reearth/navara/pull/733))
- Terrain parent flickering ([#730](https://github.com/reearth/navara/pull/730))
- Avoid unnecessary feature evaluation ([#736](https://github.com/reearth/navara/pull/736))
- Arcline RTE related bugs ([#737](https://github.com/reearth/navara/pull/737))
- Improve text rendering performance ([#738](https://github.com/reearth/navara/pull/738))
- Terrain parent flickering ([#739](https://github.com/reearth/navara/pull/739))

### 🧹 Miscellaneous

- *(example)* Credit the data sources each example displays ([#719](https://github.com/reearth/navara/pull/719))
- Move font family util to rust ([#732](https://github.com/reearth/navara/pull/732))
 
## v0.0.2 - 2026-07-22

### 🚀 Features

- Update deps ([#720](https://github.com/reearth/navara/pull/720))
- Update postprocessing ([#722](https://github.com/reearth/navara/pull/722))
- Add declutter manager to avoid collision between text/sprite. ([#717](https://github.com/reearth/navara/pull/717))

### 🐛 Bug Fixes

- Tile gaps ([#721](https://github.com/reearth/navara/pull/721))
- Update the outdated pmtiles links, and use cdn endpoints ([#723](https://github.com/reearth/navara/pull/723))
- Gltf model RTE ([#724](https://github.com/reearth/navara/pull/724))

## v0.0.1 - 2026-07-22

First release 🎉
