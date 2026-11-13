# Lighting — lights, sun, shadows, deferred lighting

## When a light is needed and which one to add

Lighting only affects surfaces that carry **normals**. Anything without normals is shaded uniformly (fullbright) and needs no light. But once normals are present, **no light means the surface renders black**. Add at least one light when you have:

- meshes / GLTF models that ship vertex normals
- `quantized-mesh` terrain loaded with `requestVertexNormals: true`
- `raster-dem` terrain rendered with a `hillshade` material
- the bare globe when the view was constructed with `useNormal: true` (init-only) — needed for the sun to shade the globe when no terrain or hillshade layer supplies normals

Non-draped vector polylines are lit too and draw black with zero lights: [vector-styling.md](vector-styling.md).

Built-in lights — register via `DefaultPlugin`, then `view.addLight<T>({ ... })`:

| Descriptor          | Key             | Use                                                                                          |
| ------------------- | --------------- | -------------------------------------------------------------------------------------------- |
| `AmbientLightDesc`  | `ambient`       | flat fill — raise overall brightness or light everything uniformly; no direction, no shadows |
| `LightProbeDesc`    | `lightProbe`    | pseudo-IBL from spherical-harmonics coefficients (e.g. a baked night ambient)                |
| `SkyLightProbeDesc` | `skyLightProbe` | dynamic sky ambient that follows the sun through the atmosphere system                       |
| `SunLightDesc`      | `sun`           | directional sun; its direction is derived from `atmosphere.date`, and it casts CSM shadows   |

`addDefaultPhotorealScene()` already adds a `sun` + `skyLightProbe` — start there for realistic scenes and add `ambient`/`lightProbe` to taste.

A `sun` light also works standalone, without `addDefaultPhotorealScene()`: its direction still follows `atmosphere.date`, and its color is computed from the atmosphere transmittance texture, which loads on demand (verified 2026-08 shading quantized-mesh terrain with only `view.addLight({ sun: {} })`). Note `view.toneMappingExposure` has no visible effect in such a scene — tone mapping is inactive without the photoreal effect stack, so don't reach for exposure to fix brightness there; use the light's `intensity`.

- **Without the atmosphere and tone mapping, `intensity: 1` looks dark — use `Math.PI`.** Diffuse shading divides by π (the Lambert BRDF), so there a fully lit surface renders at about 32% of its albedo. The no-atmosphere recipe: `view.addLight({ sun: { applyColor: true, intensity: Math.PI } })`. `applyColor: true` uses the light's own `color`; with the default `false` the color comes from the atmosphere transmittance texture and the sun renders black while that texture is unavailable. The same π factor applies to `ambient.intensity` (default 1).
- **`animation` is a view constructor option.** The view renders only on changes (or `view.forceUpdate()`) by default; `new ThreeView({ animation: true })` (default `false`, also settable at runtime as `view.animation = true`) renders every frame, which anything that moves on its own needs (e.g. water waves: [water-and-weather.md](water-and-weather.md)).

## Sun position and shadows

**Set the sun by assigning `view.atmosphere.date`, and mind the timezone.** It's a plain JS `Date`, so `new Date("2024-06-21T12:00:00")` is read in the _device's_ timezone — the sun lands in a different place per machine. Pin a global instant with an explicit UTC string, converting the local time you want yourself: noon in Tokyo (UTC+9) is `view.atmosphere.date = new Date("2024-06-21T03:00:00Z")`, while `T12:00:00Z` there is 21:00, night. To skip the conversion, give the local solar time (0–24 h) at a longitude: `view.atmosphere.setSolarTime({ lng: 139.69 }, 12)` (keeps the current solar day). To hold the same time-of-day or sun elevation while flying the camera to another country, don't recompute by hand — use `view.atmosphere.setDateFromCameraAt({ lng })` (keeps local solar time) or `setElevationFromCameraAt({ lat, lng })` (keeps sun elevation).

- **Shadows need three switches, and two are off by default.** (1) the view option `shadow: true` — init-only, default off; (2) the sun's `castShadow` — default `true`, with 4 cascades of 2048 px (`shadowCascadeCount`, `shadowMapSize`); (3) per layer material, `castShadow` and `receiveShadow` — both default `false` on `polygon` / `polyline` / `model` / `terrain` (built-in meshes such as `box` take their own `castShadow`, also default `false`). With (1) and (2) but nothing opted in, no shadow renders and nothing warns.
- **`sun.shadowFar` defaults to 50 km**, spreading the 4 cascades so wide that person- or car-scale shadows never resolve. For character/street-level scenes use `shadowFar: ~1000` with `shadowLambda: 1` (fully logarithmic split) — that is what makes a walking character cast a visible shadow (`example/pages/examples/plugin/person-view`).

A complete shadow setup in context (view `shadow: true`, sun `castShadow`, terrain `castShadow`/`receiveShadow`): [recipes.md](recipes.md). What the shadow buffer holds and which materials write it: [gbuffer.md](gbuffer.md).

## Deferred lighting

- **Deferred lighting recipe:** set `view.lit = false` so materials output albedo while the lit pipeline keeps writing normals and the shadow buffer, then re-light in a late post pass from `getNormalTexture()` + `getShadowTexture()`. A per-mesh/material `lit: true` opts something out, and the shadow buffer's G channel is the per-pixel mask for it — transparent unlit materials cannot be masked this way (they are already blended into the albedo). Toggling `lit` recompiles, so it is a config switch, not a per-frame control. Worked effect: `example/pages/debug/buffers/run.ts`; option semantics: docs `three/api/threeview-properties#lit`.
- **`aerialPerspective.irradiance: true` IS a deferred lighting pass — always pair it with `view.lit = false`.** `addDefaultPhotorealScene({ deferredLighting: true })` sets both. It re-lights the G-buffer from the precomputed atmosphere through the normal buffer, so the default `view.lit = true` applies lighting twice, forward pass plus atmosphere (exposure then depends on the basemap: about `10` on dark satellite imagery, about `3` on bright tiles, and `ToneMappingMode.NEUTRAL` keeps tiles even; docs `three_default_descs/effect-desc/tone-mapping-effect-desc#choosing-the-exposure`). That path is Lambertian, so cascaded shadows and the sun's specular are gone (cloud shadows survive).
- **Enable shadows and specular in that lighting with the effect's `shadow` / `specular` options:** `addDefaultPhotorealScene({ deferredLighting: true, shadow: true, specular: true })` at setup, or `aerialPerspective.update({ aerialPerspective: { shadow: true } })` at any time, with `false` releasing the shadow G-buffer again. Tuning is flat `shadow*` keys on the same config, not a nested object, and they survive the term being off. Both terms need `irradiance: true` plus `useNormalBuffer`, and neither reaches transparent surfaces or `lit: true` meshes, so close-ups that need shadowed glass or water keep `irradiance: false` and the default `lit`. Option list: docs `three_default_descs/effect-desc/aerial-perspective-effect-desc`. Worked page: `example/pages/debug/deferred-lighting`.
- **`aerialPerspective.specular` has no roughness or reflectance option — both are per-pixel material properties read from the normal buffer.** The reflectance is F0, taken as is from metalness on models (`0` → no reflection, `1` → untinted mirror) and from `reflectivity` on polygons and terrain. glTF and most mesh types leave roughness at `1`, which spreads the term into a faint sheen (and skips SSR entirely), so the layer has to ask for a highlight: `model: { metalness: 0.5, roughness: 0.2 }`. Reflectance below `0.01` is skipped, so terrain, polylines, sprites, text and plain Lambert/Phong meshes stay matte. Water (the terrain watermask's sea and `water: true` layers) ignores both and writes F0 `0.02` plus a roughness computed from the wind's wave slopes, so its glitter widens with distance and wind.
