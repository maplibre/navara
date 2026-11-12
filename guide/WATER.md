# Water surface

How Navara draws water: which surfaces shade as water, how a layer's wave
settings become normals, how those normals stay stable from a few meters up to orbit,
and how the surface is lit. Every water surface runs the same GLSL chunk,
`shaders/glsl/chunks/water_pars_fragment.glsl`, fed by one `WaterState`
(`web/navara_three/src/water/waterState.ts`) per view.

The design is a map renderer's, not a game ocean's. There is no per-frame FFT
and no displaced geometry. A static generated slope texture, tiled at three
scales, gives the normals, and the slope variance that a pixel cannot resolve
moves into the microfacet roughness. The surface therefore keeps the same
total slope statistics at every distance.

## Contents

1. [Surfaces that shade as water](#1-surfaces-that-shade-as-water)
2. [From wave strength to slope statistics](#2-from-wave-strength-to-slope-statistics)
3. [The wave texture](#3-the-wave-texture)
4. [Coordinates and motion](#4-coordinates-and-motion)
5. [Level of detail](#5-level-of-detail)
6. [Shading](#6-shading)
7. [The sky env map](#7-the-sky-env-map)
8. [G-buffer and SSR](#8-g-buffer-and-ssr)
9. [Invariants](#9-invariants)
10. [Known limits](#10-known-limits)

## 1. Surfaces that shade as water

| Surface                          | Where it calls the chunk                                       | Per-surface inputs                                |
| -------------------------------- | -------------------------------------------------------------- | ------------------------------------------------- |
| Terrain watermask sea and rivers | `material/macro/tileShader.ts` (`tileWater`, `watermaskWater`) | ocean scale, `terrain.waveExaggeration`, `waveStrength`, `waveDirection`, `flowSpeed`, `waterMaskColor` |
| Vector layers draped on terrain  | `tileShader.ts`, the winning slot's `uWaterParams[N]`          | `water`, `waveExaggeration` and waves per slot (section 2) |
| Polygon meshes                   | `material/enhancer/polygon/polygonWaterEnhancer`               | `uWaveExaggeration`, and waves from `waveStrength`, `waveDirection`, `flowSpeed`, `waterScale` |
| Model meshes                     | `material/enhancer/model/modelWaterEnhancer`                   | `uWaveExaggeration`, and waves from `waveStrength`, `waveDirection`, `flowSpeed`, `waterScale` |

- In the tile shader, the attr atlas's water flag ORs the watermask into the
  winner's flag. A vector layer drawn over the sea counts as water only when
  its own `water` is set. Water that no vector layer owns is the watermask's,
  and it takes `waterMaskColor` as its body color when the terrain layer sets
  one.
- How the watermask itself is decoded, smoothed and baked into the atlas is in
  [TILE_TEXTURE_COMPOSITING.md](TILE_TEXTURE_COMPOSITING.md).
- Each surface calls `nvrWaterCoord(vViewPosition)` in uniform control flow,
  then `nvrWaterSurface(coord, normal, exaggeration, waves)`, then
  `nvrWaterShade(surface, viewPosition, normal, bodyLight)` in place of its
  lit color. `bodyLight` is the surface's own lit diffuse, so shadows and
  `waterMaskColor` reach the water body through it.
- Per-surface inputs are packed by meaning. The tile shader's `uWaterParams` is
  `(waveExaggeration, 1 for a water slot)`. `uWaterMaskColor` is a vec4 whose alpha
  is 1 when the terrain layer sets a color.
- The polygon and model enhancers share their state, uniform refs and chunk
  injection (`material/enhancer/water`); only their marker replacements
  differ.
- The chunk is imported through the `@shaders` alias, so only meshes inside
  this repository can call it.

## 2. From wave strength to slope statistics

Each layer sets its waves with `waveStrength` and `waveDirection`
(degrees clockwise from north, where the waves travel), and `waterScale`.
`waveStrength` is the wind speed `U` in m/s of the wave model below, so it sets
the wave size, slope and speed together. `waveExaggeration` then scales only the
slopes, like a height exaggeration, and `0` gives a mirror. `waveStrength` of 0
keeps the calm ripples.
`flowSpeed` is a current in m/s along `waveDirection`: it moves the whole
pattern and leaves the wave model alone (section 4).

**Wave sets.** `WaterState.createWaves(conditions)` returns a `WaterWavesRef` that
holds one `NvrWaterWaves` (taps, cascades, gust patch) and its f64 phases.
Surfaces with the same conditions share a set by reference count, and a set with no
holders is dropped. Only held sets advance each frame, and there is no limit on
their number.

Materials read `uniform NvrWaterWaves nvrWaterWaves[NVR_WATER_WAVES_COUNT]`:

- Polygon and model materials hold one set, at index 0.
- The tile shader holds one per vector slot plus the watermask's
  (`generateTileWaterDefines`). Index 0 is the watermask's, and a vector winner
  reads `1 + winIdx - TILE_FIRST_VECTOR_SLOT`. One pixel reads one entry, so
  the array costs uniform rows and no texture reads. A tile without a water
  layer compiles the watermask's entry alone, since each entry adds uniform
  upload per tile. With 5 vector slots, the shader takes about 145 rows under
  the GLSL ES packing rules, against a 224 minimum. Counting array elements
  overstates this: `float` arrays share rows with the free columns of `vec3`
  and `vec2` arrays.
- The GLSL functions take an index, not the struct. Passing the struct copies
  it, which cost 2 to 5 ms at 3200×1800 of water.

- **Total slope.** Cox–Munk clean-surface mean square slope:
  `mss = 0.003 + 0.00512·U` (`meanSquareSlope`).
- **Resolved and unresolved shares.** 60% of the wind part
  (`RESOLVED_SLOPE_SHARE`) is split evenly over three cascades of resolved
  waves. The calm intercept plus the other 40% is
  `nvrWaterFineMeanSquareSlope`, ripples finer than any cascade, which always
  shade as roughness.
- **Wave size.** The peak wavelength is fetch limited by JONSWAP,
  `fp·U/g = 3.5·(gX/U²)^-0.33`, and capped at the fully developed
  Pierson–Moskowitz peak (`peakWavelength`).
- **Scales.** `WATER_SCALES` (`ocean`, `large`, `medium`, `small`) have the
  fetches ∞, 20 km, 2 km and 200 m (`WATER_SCALE_FETCHES`). The slopes follow
  `U` alone, so every scale shares the slope statistics. Only the wave lengths
  differ.
- **Cascade lengths** (`windToCascades`):
  - Cascade 0's tile is `WAVE_DOMINANT_CYCLES` (5) peak wavelengths.
  - Cascades 1 and 2 nominally follow at ratios 1/6.3 and 1/(6.3·6.1). The
    ratios are never powers of two, so the repeats never line up.
  - The finest tile is clamped to 0.5–3 m. The upper bound stops strong
    wind from magnifying its texels up close. The lower bound keeps small
    water's finest band near the capillary limit.
  - The middle cascade keeps its log-scale place between the outer two.
- Each cascade uniform is `(rmsSlope, 1/tileLength, 1/dominantWavelength, 0)`.
  The first cascade's w holds the unresolved mean square slope.

## 3. The wave texture

`waveTexture.ts` generates one 512² RGBA8 texture (about 100 ms of CPU, once).
The first read of `WaterState.uniforms` requests it from the worker pool
(`generateWaveTexture` task), so views without water never pay for it and the
main thread never stalls. Until it arrives, a 1×1 mid-gray texture keeps the
water flat; the shared uniform ref then swaps in the real texture without
recompiling any material.

- **Two independent fields.** One complex inverse FFT yields two
  realizations: the real part (realization A, stored in RG) and the imaginary
  part (realization B, stored in BA). Each texel stores a slope `(sx, sy)`.
- **Bands.** Four wave number bands, 3–8, 8–20, 20–50 and 50–128 cycles per
  repeat, with rms slope shares 1, 0.8, 0.6 and 0.45. Heights follow
  `k^-1.7`. Directions spread as `cos²` around +x with a floor of 0.3, so
  crests run along y and some cross waves remain.
- **Crests.** The swell band stays rounded. The finer bands are folded,
  `-|h|`, whose slope is `-sign(h)·∇h`. This turns zero crossings into sharp
  crests, the wrinkled look of a wind-roughened surface.
- **Normalization.** Each realization has a mean square slope of 1, stored in
  8 bits over ±`WAVE_SLOPE_RANGE` (4).
- **Sampling.** The texture repeats and uses trilinear mipmaps with the
  renderer's max anisotropy. All taps use `textureGrad` with explicit
  gradients.

## 4. Coordinates and motion

- **Camera-relative ground coordinates.** `nvrWaterCoord` projects
  `-vViewPosition` on the camera's east and north (`nvrWaterFrame.east`,
  `nvrWaterFrame.north`, view space). It returns meters relative to the camera,
  their screen derivatives, the view direction and the distance. No ECEF
  coordinate enters the shader, so f32 precision holds anywhere on the
  globe.
- **Ground pinning.** `WaterState.update` integrates each tap's phase on the
  CPU in f64 from the camera's east/north displacement and wraps it to
  `[0, 1)`. A tap's uv is `dot(position, dir)/tileLength + phase`, so the
  pattern stays fixed to the ground while the camera moves. `enuBasis`
  carries the previous east vector across the poles.
- **Taps.** Each cascade reads realization A and realization B through two
  taps rotated from the wave direction by different angles (`TAP_ANGLES`). The two
  realizations are independent, so their sum `(A + B)/√2` keeps unit
  variance. The taps drift apart, so the pattern changes shape instead of
  sliding as one sheet.
- **Speed.** A tap moves along its direction at `PATTERN_SPEED_SCALE` (0.5) times the
  deep-water group speed at the slope spectrum's center wavelength
  (`WAVE_SLOPE_CENTER_CYCLES` ≈ 11.3 cycles per repeat). A rigid pattern
  reads as faster than real crests that change shape.
- **Gust patches.** One more tap per scale, 40 cascade-0 tiles long, drifting
  at `0.5·U`, scales the slopes by `1 ± NVR_WATER_PATCH_AMOUNT` (0.15). This
  gives the brighter and darker wind patches seen from low altitude.
- **Uniform current.** `flowSpeed` adds to every tap's phase on the CPU, as the
  opposite of a camera moving at that speed. The pattern moves rigidly, so this
  takes no shader change and no extra taps, and the gust patch moves with it.
- **Varying current.** `nvrWaterFlowSurface(coord, normal, exaggeration, flow, waves)` also
  carries the waves along a per-fragment current (east/north m/s). Two layers
  drift with the flow for one `WATER_FLOW_PERIOD` (8 s) cycle each, half a
  cycle apart, and crossfade with variance-preserving weights, so a varying
  flow never stretches the pattern without bound. It samples twice the taps.
  Ref: Vlachos, "Water Flow in Portal 2", SIGGRAPH 2010. Only the experimental
  time-series flood mesh calls it.

## 5. Level of detail

The normal is the sum of the cascades a pixel can still resolve. Whatever it
drops becomes roughness, so resolved slopes plus roughness always add up to
the same mean square slope.

- **Footprint.** Ground meters per pixel along the most stretched screen axis,
  from the coordinate derivatives.
- **Cascade fade.** A cascade's weight is
  `smoothstep(32, 128, tileLength / footprint)`, so it fades as one repeat
  shrinks from 128 to 32 px (`NVR_WATER_FADE_PIXELS`). The mipmaps have
  already averaged its finer bands by then.
- **Distance fade.** Every weight is also multiplied by one factor that falls
  over `NVR_WATER_WAVE_FADE_DISTANCE` (300 m → 2 km to the camera), whatever
  the cascade's size. Without it, the long cascades keep their repeat on screen
  from far away and read as large waves. Beyond 2 km the surface is one rough
  plane and all its taps are skipped.
- **Variance bookkeeping.** A cascade at weight `w` adds `(1 − w²)·rms²` to
  the hidden variance. A fully faded cascade skips its taps.
- **Antialias term.** The slope change across one pixel of the waves still
  drawn is added as variance, capped at `NVR_WATER_MAX_ANTIALIAS_SLOPE`
  (0.18).
- **Wave exaggeration.** A `waveExaggeration` above 1 multiplies the screen
  derivatives before the taps and the fade. Steeper waves are filtered as if
  seen from that much farther, so they do not alias into per-pixel speckle.
  The exaggeration and the gust then scale the slopes and the variance.
- **Gust fade.** The gust patches fade with the same distance factor, not with
  pixels. The patch tile grows with the wind, so a pixel-based fade would keep
  the tiled pattern on the glitter path up to the stratosphere in strong wind.

## 6. Shading

`nvrWaterShade` returns `bodyLight·(1 − F) + sky·F + sun`.

- **Fresnel.** F0 is 0.02 (IOR 1.333). F is averaged over the unresolved
  slopes with Bruneton's fit (`nvrWaterFresnel`), so rough distant water does
  not reach the mirror-like grazing Fresnel.
- **Visible normal tilt.** At grazing views, facets tilted toward the viewer
  fill more of the view and hide the others, so the sky they mirror sits
  higher than the mean normal's mirror direction. The reflected ray leaves a
  normal tilted toward the viewer by the mean tilt of the visible facets for
  Gaussian slopes, `σ²Φ(c/σ) / (cΦ(c/σ) + σφ(c/σ))` with `c = cot θ`. Φ uses a
  tanh approximation. The tilt is scaled by `NVR_WATER_VISIBLE_TILT_SCALE`
  (0.7), fitted by Monte Carlo to the Fresnel-weighted mean sky elevation
  over Cox–Munk slopes. Distant water then stays darker than the horizon sky,
  as in photographs. Ref: Heitz, "Importance Sampling Microfacet-Based BSDFs
  using the Distribution of Visible Normals", EGSR 2014.
- **Sky.** The reflected ray is folded above the geometric horizon, then looks
  up the sky env map (section 7) at a mip chosen from the roughness
  (`2·√mss` spread over a π/2 face). Without the env map, the light probe is
  used.
- **Sun.** The first directional light is the sun.
  - **Lobe.** A Beckmann distribution (sea slopes are near Gaussian, and a
    GGX tail would spread the highlight far from the mirror direction). It is
    multiplied by the GGX visibility term and Schlick Fresnel, and the
    result is capped at `NVR_WATER_MAX_SPECULAR_BRDF` so the half-float frame
    never stores Inf.
  - **Disc.** The sun has its real angular size
    (`NVR_WATER_SUN_ANGULAR_RADIUS`). The light comes from the point on the
    disc closest to the mirror direction (Karis, SIGGRAPH 2013), so the lobe is
    flat wherever a facet mirrors the disc and Gaussian beyond it. The peak is
    normalized over both parts, which keeps the energy for any roughness. On
    still water, the highlight is a round image of the sun.
  - **Sun normal.** Where any facet can mirror the sun toward the camera
    (`nvrWaterNearSunGlitter`: the half vector's tan² tilt is under 16 times
    the total mss), the sun uses its own normal. It keeps cascades down to an
    8 → 32 px repeat (`NVR_WATER_SUN_FADE_PIXELS`), and its lobe takes only
    `NVR_WATER_SUN_FINE_SHARE` (0.3) of the unresolved variance. The resolved
    waves then break the glitter path into separate highlights. The grain in
    the glitter comes from wave normals, not from noise. The distance fade
    takes the share back to 1 along with the waves, so a distant lobe has the
    full roughness.
  - **Elsewhere.** The sun normal is the forward normal, so the extra taps run
    only along the glitter path.
- **Body.** `bodyLight` is the surface's lit diffuse. The watermask uses the
  imagery color, or `waterMaskColor` when the terrain layer sets it.

## 7. The sky env map

- **Source.** A `sky: { envMap: true }` mesh enables `SkyEnvMapPass`
  (`passes/SkyEnvMapPass.ts`, created by `SkyEnvMapEffectDesc`). It renders
  the sky scene into a half-float cube map with mipmaps at the camera
  position, 256² per face unless `skyEnvMap.resolution` says otherwise. Such a
  mesh leaves out the sun and moon discs by default. A disc that small covers a
  texel or two of a face and would show as a square on smooth water, and the
  shading adds the sun itself (section 6).
- **Refresh.** After a full update, the pass refreshes one face per frame.
  Once the camera has travelled more than 5% of its height above the
  ellipsoid (at least 5 m) from the last full update, it renders all six faces
  again, so faces captured at distant positions never meet in one cube.
- **Binding.** The view hands the result to `WaterState.setSkyEnvMap` every
  frame, and `null` selects the light probe.
- **Horizon folding.** The cube is captured at the camera, so everything
  below the camera's horizontal plane is ground. A ray leaving distant water
  can point below that plane (the surface there tilts with the Earth's
  curvature) yet still meet sky. `nvrWaterSky` therefore folds the ray above
  the camera's horizontal (`nvrWaterFrame.up`). Without the fold, distant water
  reflects the ground as a dark band at the horizon.

## 8. G-buffer and SSR

- The water writes its own normal and roughness to the MRT G-buffer
  (`GBUFFER_WRITE_NORMAL(gbufferNormal, 0.02, gbufferRoughness)`), recomputed
  with a fade twice as strict (`NVR_WATER_GBUFFER_FADE_PIXELS`, 64 → 256 px).
  SSR traces at reduced resolution and turns per-pixel normal detail into
  noise.
- Under `view.lit = false`, only this G-buffer data survives, and the forward
  sky reflection is dropped. See [RENDERING_PIPELINE.md](RENDERING_PIPELINE.md)
  for the G-buffer layout and the `lit` system.

## 9. Invariants

- `nvrWaterCoord` takes screen derivatives and must run in uniform control
  flow. Every texture read after it uses `textureGrad`, which is what lets
  faded cascades, the sun taps and the patch tap sit behind branches.
- Constants mirrored between TS and GLSL must match:
  - `WAVE_SLOPE_RANGE` ↔ `NVR_WAVE_SLOPE_RANGE`
  - `WATER_FLOW_PERIOD` ↔ `NVR_WATER_FLOW_PERIOD`
  - the `NvrWaterWaves` array sizes (`WATER_TAP_COUNT` 6,
    `WATER_CASCADE_COUNT` 3).
- Both realizations must keep unit mean square slope. The `0.70710678` sum
  and the variance bookkeeping in section 5 rely on it.
- Reading `WaterState.uniforms` requests the texture, so only water materials
  may read it.
- The sky env map shows ground below the camera's horizontal plane, so every
  lookup must fold the ray (section 7).

## 10. Known limits

- **Tiling.** From a few hundred meters, the coarsest visible cascade repeats
  dozens of times on screen and can read as a lattice. Stochastic tiling of
  cascade 0 was tried: three randomly offset reads blended with
  variance-preserving weights (Heitz & Neyret, HPG 2018, and Mikkelsen,
  JCGT 2022).
  - It removed the repeat from the slope field (the autocorrelation peak at
    the tile period fell from 0.40 to 0.07).
  - In the shaded image, the change was subtle.
  - It cost about +4 ms per frame at 1600×900 with water filling the screen,
    even when blend weights let cell interiors read one corner only.
  - It is not used.
- **No moon reflection.** The env map holds no moon by default and the shading
  has no analytic moon. Setting `moon: true` on the env map mesh brings it back
  as a square texel.
- **Sun size.** The disc uses a constant radius, so a `sunAngularRadius` set on
  a sky mesh does not change the reflection.
- **No whitecaps.** Foam is not modeled. Monahan's coverage is about 1% at
  10 m/s.
- **No geometry.** The surface is flat. Waves never occlude each other or
  change the silhouette.
- **Watermask edges.** These stay at the attr atlas's pixel size, and there
  can be a sub-pixel offset at tile borders (see
  [TILE_TEXTURE_COMPOSITING.md](TILE_TEXTURE_COMPOSITING.md)).
