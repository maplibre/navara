import ThreeView, {
  Color,
  fetchFontFamilyFromCss,
  type FeatureEvaluator,
  type Layer,
} from "@navaramap/three";
import {
  DefaultPlugin,
  type DefaultDescriptions,
} from "@navaramap/three-default-plugin";
import { SphericalHarmonics3 } from "three";
import { Pane } from "tweakpane";

import { withBase } from "../../helpers/base";
import { PMTILES_DATASETS } from "../../helpers/constants";
import { googleFontsCssUrl, notoSansStack } from "../../helpers/fonts";
import { SH_COEFFICIENTS } from "../../helpers/sh";

export type CustomDescriptions = DefaultDescriptions;

// Family names the label faces are registered under. Two, because the official
// Overture style uses a different weight for administrative names than for place
// names, and a Navara font family maps codepoints to faces by unicode range —
// not by weight — so one weight per registered family.
const LABEL_FONT = "OvertureAdminLabels";
const POI_FONT = "OverturePlaceLabels";

/**
 * Weights taken from the official Overture explorer style
 * (explore.overturemaps.org). Its `$globals.font` block resolves to
 * "Noto Sans SemiCondensed" in three weights, referenced as:
 *   primary   = SemiCondensed Bold    (700) — countries, regions, counties,
 *                                             localities over 1M population
 *   secondary = SemiCondensed Medium  (500) — smaller localities, boroughs
 *   tertiary  = SemiCondensed Regular (400) — filtered places (POI)
 * This example collapses each layer to one weight: admin labels take primary,
 * place labels take tertiary.
 */
const ADMIN_WEIGHT = 700;
const POI_WEIGHT = 400;

/**
 * Overture's glyph server exposes "Noto Sans SemiCondensed" as a named face; on
 * the Google Fonts CSS API the same design is the `wdth` axis of variable Noto
 * Sans at 87.5 (100 = normal, 75 = Condensed).
 */
const LABEL_WIDTH = 87.5;

/**
 * Label colors, resolved from the Overture explorer's style variables through
 * `$semantic` to `$globals.color`:
 *   admin text  `$semantic.division.label` = gray.900  hsl(0 0% 18%)
 *   admin halo  `$semantic.division.halo`  = white 80% hsla(0 0% 100% / 0.8)
 *   place text  `$semantic.place.label`    = gray.950  hsl(0 0% 11%)
 *   place halo  `$semantic.place.labelHalo`= white 30% hsla(0 0% 100% / 0.3)
 */
const OVERTURE_COLORS = {
  adminText: "#2e2e2e",
  adminHalo: "#ffffff",
  adminHaloOpacity: 0.8,
  placeText: "#1c1c1c",
  placeHalo: "#ffffff",
  placeHaloOpacity: 0.3,
} as const;

/**
 * Overture states halos as `text-halo-width` in *screen* pixels, constant across
 * text sizes. Navara's `outlineWidth` is em-relative instead: the value is
 * texels at the 64 px/em reference density, so it dilates by `w / 64` em (see
 * `atlasRangePx` in `@navaramap/font`). Converting needs the text size the halo
 * was authored against:
 *
 *   outlineWidth = haloPx / textSize * 64
 *
 * Overture's admin halos land near the same em value at their own sizes —
 * 1.2 px at size 19 (country), 1.5 px at 24 (locality), 1.1 px at 15 (region)
 * all come to ~0.065 em — so one number reproduces them: 0.065 * 64 ≈ 4.
 * Their filtered-place halo is proportionally much heavier: 1.5 px at size 12 is
 * 0.125 em, hence 8.
 */
const ADMIN_OUTLINE_WIDTH = 4;
const POI_OUTLINE_WIDTH = 8;
// Navara has no independent pixel offset for billboard/text materials. An en
// space at the fixed 12 px POI label size gives the pair a consistent visual
// gap while keeping both halves anchored to the same geographic point.
const POI_LABEL_GAP = "\u2002";

// Camera presets.
const VIEWPOINTS = {
  World: { lng: 10, lat: 25, height: 22_000_000, pitch: -90 },
  Europe: { lng: 12, lat: 48, height: 4_500_000, pitch: -90 },
  "East Asia": { lng: 121, lat: 33, height: 5_000_000, pitch: -90 },
  Americas: { lng: -95, lat: 35, height: 8_000_000, pitch: -90 },
  "Tokyo (street)": { lng: 139.767, lat: 35.679, height: 1_000, pitch: -35 },
} as const;

// Admin tiers, coarsest first. They only feed declutter priority: labels are
// always candidates, and the screen-space declutter pass decides what fits —
// countries beat regions beat counties beat localities wherever they overlap.
// (The tile pyramid still gates data naturally: fine admin features only
// exist in higher-zoom tiles, so the world view never even loads them.)
//
// `size` reproduces Overture's type hierarchy. Its style ramps each tier's
// `text-size` over zoom; this globe has no discrete zoom, so each tier takes the
// mid-ramp value from the official style and the UI slider scales all of them
// together (see `sizeScale`):
//   country  z9  → 19    region z9  → 15
//   county   z10 → 12    locality z12 → 24 (over 1M) / 20
const LABEL_TIERS = [
  {
    key: "country",
    match: ["country"],
    size: 19,
  },
  {
    key: "region",
    match: ["region", "macroregion", "governorate", "province", "state"],
    size: 15,
  },
  {
    key: "county",
    match: ["county", "macrocounty", "localadmin", "district"],
    size: 12,
  },
  {
    key: "locality",
    match: ["locality", "city", "town"],
    size: 24,
  },
];

/**
 * Overture sets `text-transform: uppercase` on every administrative label
 * (country, region, county and locality) — but not on boroughs or
 * neighbourhoods, which this example does not label. Applied here in the
 * evaluator because Navara has no `textTransform` property.
 *
 * `toLocaleUpperCase` leaves ideographs and other caseless scripts untouched, so
 * this is safe to run over every name regardless of script.
 */
const overtureCase = (name: string) => name.toLocaleUpperCase();

// Reverse index: normalized property value -> tier index (first tier wins).
const TIER_INDEX_OF = new Map<string, number>();
LABEL_TIERS.forEach((tier, i) => {
  for (const value of tier.match) {
    if (!TIER_INDEX_OF.has(value)) TIER_INDEX_OF.set(value, i);
  }
});

// Within the finest (`locality`) tier, keep only large cities.
const CITY_POPULATION_THRESHOLD = 1_000_000;

const BASE_POLYGONS = [
  { title: "Land", source: "land", color: "#f8f4f1" }, // sand.50
  { title: "Land cover", source: "land_cover", color: "#c4eaa9" }, // grass fallback
  { title: "Land use", source: "land_use", color: "#d6ecd5" }, // park green.200
  { title: "Water", source: "water", color: "#9adefc" }, // ocean.900
] as const;

// 3D buildings (Overture `buildings` theme). Where `height` (meters) is missing
// we estimate from `num_floors` (~3 m each), else fall back to a small default.
const BUILDING_COLOR = "#cabfb3"; // sand.300
const METERS_PER_FLOOR = 3;
const DEFAULT_BUILDING_HEIGHT = 6;

const LAND_COVER_COLORS: Record<string, string> = {
  forest: "#a2e2a4", // green.500
  mangrove: "#a1e3cf", // teal.100
  grass: "#c4eaa9", // green.400
  shrub: "#d8eaae", // olive.200
  crop: "#ebedb1", // yellow.300
  wetland: "#afe9e7", // teal.50
  moss: "#95daaa", // green.600
  barren: "#efe8cd", // yellow.200
  snow: "#f3f5f7", // sky.50
  urban: "#e8ded4", // sand.400
};

const POI_CATEGORIES = [
  { key: "Restaurants", icon: withBase("icons/restaurant.svg") },
  { key: "Cafés", icon: withBase("icons/cafe.svg") },
  { key: "Hotels", icon: withBase("icons/hotel.svg") },
  { key: "Schools", icon: withBase("icons/school.svg") },
  { key: "Hospitals", icon: withBase("icons/hospital.svg") },
  { key: "Shopping", icon: withBase("icons/shopping.svg") },
] as const;

type PoiKey = (typeof POI_CATEGORIES)[number]["key"];

// Deterministic [0,1] hash (FNV-1a) of a string. The screen-space declutter
// pass cannot treat an icon and its label as one collision candidate, and
// render-time decluttering could therefore hide only half of a pair. POIs opt
// out of that pass and are thinned data-side instead: hash a stable per-feature
// key and keep only points below a density threshold. This caps how many
// icon/label pairs exist at all, is stable across re-evaluation (nothing
// flickers on pan/zoom), and thins roughly uniformly across space.
const hash01 = (s: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 0xffffffff;
};

// Map an Overture place to an icon category (or `undefined` to skip).
// `taxonomy` is a JSON string whose `hierarchy[0]` is the broad bucket;
// `basic_category` is finer, used only to split cafés out of food_and_drink.
const classifyPlace = (
  properties: Record<string, unknown> | undefined,
): PoiKey | undefined => {
  const basic = properties?.["basic_category"] as string | undefined;
  if (basic === "cafe" || basic === "coffee_shop") return "Cafés";

  const taxonomyRaw = properties?.["taxonomy"] as string | undefined;
  if (!taxonomyRaw) return undefined;
  let bucket: string | undefined;
  try {
    bucket = (JSON.parse(taxonomyRaw) as { hierarchy?: string[] })
      .hierarchy?.[0];
  } catch {
    return undefined;
  }

  switch (bucket) {
    case "food_and_drink":
      return "Restaurants";
    case "lodging":
      return "Hotels";
    case "education":
      return "Schools";
    case "health_care":
      return "Hospitals";
    case "shopping":
      return "Shopping";
    default:
      return undefined;
  }
};

export const run = async (view: ThreeView<CustomDescriptions>) => {
  const defaultPlugin = new DefaultPlugin();
  view.addPlugin(defaultPlugin);

  const attribution = view.attribution;

  await view.init();

  // The Google Fonts CSS API orders @font-face blocks alphabetically, so pass
  // the stack as a fontFamily array to restore the intended priority (e.g. JP
  // before SC/KR for codepoints shared across CJK subsets).
  //
  // Two registrations, one per weight: admin names at Overture's `primary`
  // (SemiCondensed Bold), place names at its `tertiary` (SemiCondensed Regular).
  // Face files are still fetched lazily per unicode range, so registering both
  // does not download two full font sets.
  await Promise.all(
    (
      [
        [LABEL_FONT, ADMIN_WEIGHT],
        [POI_FONT, POI_WEIGHT],
      ] as const
    ).map(async ([name, weight]) => {
      const stack = notoSansStack(weight, LABEL_WIDTH);
      view.addFontFamily(
        await fetchFontFamilyFromCss(name, googleFontsCssUrl(stack), {
          fontFamily: stack.map((family) => family.split(":")[0]),
        }),
      );
    }),
  );

  view.addLight({ ambient: {} });
  view.addLight({
    lightProbe: {
      sh: new SphericalHarmonics3().set(SH_COEFFICIENTS.white),
      intensity: 1,
    },
  });

  view.setCamera({ ...VIEWPOINTS.World, heading: 0, roll: 0 });

  view.addLayer({ type: "terrain", ellipsoid: {} });

  // One vector-tile source per `.pmtiles` archive (PMTiles is detected from the
  // URL extension); every layer references its archive's source and selects
  // which MVT sublayer to style via `sourceLayers`.
  const baseSource = view.addSource({
    type: "vector-tile",
    url: PMTILES_DATASETS.overtureBase.url,
    maxZoom: 13,
  });
  const divisionsSource = view.addSource({
    type: "vector-tile",
    url: PMTILES_DATASETS.overtureDivisions.url,
    // Finer admin features (governorate/district) exist only in higher-zoom
    // tiles, so fetch to z12 and let the altitude tiers keep the view uncluttered.
    maxZoom: 12,
  });
  const buildingsSource = view.addSource({
    type: "vector-tile",
    url: PMTILES_DATASETS.overtureBuildings.url,
    maxZoom: 14,
  });
  const placesSource = view.addSource({
    type: "vector-tile",
    url: PMTILES_DATASETS.overturePlaces.url,
    maxZoom: 14,
  });

  // Visibility is driven per-feature via each layer's evaluator, not the
  // material's `show` (which only seeds future features). The evaluator restyles
  // already-batched geometry, so toggling affects what's already on screen.
  const visible: Record<string, boolean> = {};

  const toggles: { title: string; layer: Layer }[] = [];

  // Precompute per-subtype Color instances (the evaluator runs per feature).
  const landCoverColors: Record<string, Color> = Object.fromEntries(
    Object.entries(LAND_COVER_COLORS).map(([k, hex]) => [
      k,
      new Color().setStyle(hex),
    ]),
  );

  for (const { title, source, color } of BASE_POLYGONS) {
    visible[title] = true;
    const layer = view.addLayer({
      type: "vector",
      source: baseSource,
      sourceLayers: [source],
      polygon: {
        color: new Color().setStyle(color),
        clampToGround: true,
      },
    });

    // `land_cover` additionally colors each feature by its `subtype`.
    const apply = ({ evaluator }: { evaluator: FeatureEvaluator }) => {
      if ((source as string) === "land_cover") {
        evaluator.evaluate(
          ({ properties }) => {
            const subtype = properties?.["subtype"] as string | undefined;
            const subtypeColor = subtype ? landCoverColors[subtype] : undefined;
            return subtypeColor
              ? { show: visible[title], color: subtypeColor }
              : { show: visible[title] };
          },
          { filters: ["subtype"] },
        );
      } else {
        evaluator.evaluate(() => ({ show: visible[title] }), { filters: [] });
      }
    };
    layer.on("featureCreated", apply);
    layer.on("featureUpdated", apply);

    toggles.push({ title, layer });
  }

  // Administrative boundaries from the `divisions` theme.
  const boundaryTitle = "Boundaries";
  visible[boundaryTitle] = true;
  const boundaryLayer = view.addLayer({
    type: "vector",
    source: divisionsSource,
    sourceLayers: ["division_boundary"],
    polyline: {
      color: new Color().setStyle("#757575"), // division.boundary gray.700
      width: 1.5,
      height: 1,
      clampToGround: true,
    },
  });
  {
    const apply = ({ evaluator }: { evaluator: FeatureEvaluator }) => {
      evaluator.evaluate(() => ({ show: visible[boundaryTitle] }), {
        filters: [],
      });
    };
    boundaryLayer.on("featureCreated", apply);
    boundaryLayer.on("featureUpdated", apply);
    toggles.push({ title: boundaryTitle, layer: boundaryLayer });
  }

  // 3D buildings from the `buildings` theme. Footprints are extruded by the
  // per-feature `extrudedHeight` (meters)
  //
  // Two MVT layers cooperate (OSM/Overture 3D convention):
  //   • `building`      — one footprint per building (bulk massing).
  //   • `building_part` — detailed sub-volumes for buildings modeled in 3D.
  // Where a footprint `has_parts` we hide it and let its parts stand in, else
  // the two double-draw and z-fight.
  const buildingsTitle = "Buildings";
  visible[buildingsTitle] = true;
  const buildingColor = new Color().setStyle(BUILDING_COLOR);

  // Bulk footprints. Hidden where `has_parts`, so detailed parts represent them.
  const buildingLayer = view.addLayer({
    type: "vector",
    source: buildingsSource,
    sourceLayers: ["building"],
    polygon: {
      color: buildingColor,
      // Seeds the attribute slots; the evaluator overrides height per feature.
      height: 0,
      extrudedHeight: 0,
      clampToGround: false,
    },
  });
  {
    const apply = ({ evaluator }: { evaluator: FeatureEvaluator }) => {
      evaluator.evaluate(
        ({ properties }) => {
          if (!visible[buildingsTitle]) return { show: false };
          // Buildings with detailed parts are drawn by the part layer instead.
          if (properties?.["has_parts"] === true) return { show: false };

          const height = properties?.["height"] as number | undefined;
          const numFloors = properties?.["num_floors"] as number | undefined;
          const extrudedHeight =
            height ??
            (numFloors != null
              ? numFloors * METERS_PER_FLOOR
              : DEFAULT_BUILDING_HEIGHT);

          return { show: true, extrudedHeight };
        },
        { filters: ["height", "num_floors", "has_parts"] },
      );
    };
    buildingLayer.on("featureCreated", apply);
    buildingLayer.on("featureUpdated", apply);
    toggles.push({ title: buildingsTitle, layer: buildingLayer });
  }

  // Detailed building parts. A part spans `min_height` (base) to `height` (top),
  // so base -> `height` attribute, top -> `extrudedHeight`; this keeps stacked
  // setbacks from overlapping and lets towers float above their podium.
  const buildingPartLayer = view.addLayer({
    type: "vector",
    source: buildingsSource,
    sourceLayers: ["building_part"],
    polygon: {
      color: buildingColor,
      height: 0,
      extrudedHeight: 0,
      clampToGround: false,
    },
  });
  {
    const apply = ({ evaluator }: { evaluator: FeatureEvaluator }) => {
      evaluator.evaluate(
        ({ properties }) => {
          if (!visible[buildingsTitle]) return { show: false };

          const top = properties?.["height"] as number | undefined;
          const numFloors = properties?.["num_floors"] as number | undefined;
          const base = (properties?.["min_height"] as number | undefined) ?? 0;
          const extrudedHeight =
            top ??
            (numFloors != null
              ? numFloors * METERS_PER_FLOOR
              : DEFAULT_BUILDING_HEIGHT);

          // Skip degenerate parts whose base is at or above their top.
          if (extrudedHeight <= base) return { show: false };

          return { show: true, height: base, extrudedHeight };
        },
        { filters: ["height", "num_floors", "min_height"] },
      );
    };
    buildingPartLayer.on("featureCreated", apply);
    buildingPartLayer.on("featureUpdated", apply);
    // Same title as the footprint layer: one "Buildings" toggle drives both
    // (the panel dedupes the repeated title).
    toggles.push({ title: buildingsTitle, layer: buildingPartLayer });
  }

  // Labels. Overture stores the localized primary name under `@name`; the
  // registered font family resolves the correct face per glyph. Visibility is
  // handled entirely by the screen-space declutter pass — no camera-altitude
  // gating: whatever fits on screen shows, coarser tiers winning overlaps.
  const labelTitle = "Labels";
  visible[labelTitle] = true;
  // `sizeScale` multiplies every tier's Overture size; 1.0 is the official
  // hierarchy. `size` on the layer is only the fallback for a feature the
  // evaluator does not size.
  const params = { sizeScale: 1.0, maxWidth: 9.0 };

  const labelLayer = view.addLayer({
    type: "vector",
    source: divisionsSource,
    sourceLayers: ["division"],
    text: {
      font: LABEL_FONT,
      color: new Color().setStyle(OVERTURE_COLORS.adminText),
      size: LABEL_TIERS[0].size,
      sizeInMeters: false,
      clampToGround: false,
      center: { x: 0.5, y: 0.5 },
      outlineColor: new Color().setStyle(OVERTURE_COLORS.adminHalo),
      outlineWidth: ADMIN_OUTLINE_WIDTH,
      outlineOpacity: OVERTURE_COLORS.adminHaloOpacity,
      offsetDepth: true,
      depthTest: true,
      maxWidth: params.maxWidth,
    },
  });

  {
    const apply = ({ evaluator }: { evaluator: FeatureEvaluator }) => {
      evaluator.evaluate(
        ({ properties }) => {
          if (!visible[labelTitle]) return { show: false };

          let name = properties?.["@name"] as string | undefined;
          if (!name) return { text: "", show: false };

          // Assign a priority tier: prefer locale-specific `local_type`, fall
          // back to the stable `subtype` enum. Unrecognized is never labeled.
          const localType = (
            properties?.["local_type"] as string | undefined
          )?.toLowerCase();
          const subtype = (
            properties?.["subtype"] as string | undefined
          )?.toLowerCase();
          const tierIndex =
            (localType !== undefined
              ? TIER_INDEX_OF.get(localType)
              : undefined) ??
            (subtype !== undefined ? TIER_INDEX_OF.get(subtype) : undefined);
          if (tierIndex === undefined) return { text: "", show: false };

          const tier = LABEL_TIERS[tierIndex];

          // Within the locality tier, still keep only the largest cities.
          if (tier.key === "locality") {
            const population = properties?.["population"] as number | undefined;
            if ((population ?? 0) < CITY_POPULATION_THRESHOLD) {
              return { text: "", show: false };
            }
          }

          // replace `/` with a line break
          name = name.replace(/\s*\/\s*/g, "\n");

          return {
            text: overtureCase(name),
            show: true,
            // Overture's per-tier type hierarchy, scaled by the UI slider.
            size: tier.size * params.sizeScale,
            // Coarser admin levels win overlaps: country > region > county >
            // locality. POI names use confidence (< 1) so they always rank
            // below admin labels.
            declutterPriority: LABEL_TIERS.length - tierIndex,
          };
        },
        { filters: ["@name", "subtype", "local_type", "population"] },
      );
    };
    labelLayer.on("featureCreated", apply);
    labelLayer.on("featureUpdated", apply);
    // toggles.push({ title: labelTitle, layer: labelLayer });
  }

  // ---- Points of interest (places theme) -----------------------------------

  // One billboard layer renders every supported category. The evaluator assigns
  // an `image` URL per feature; distinct URLs are loaded once and packed into the
  // layer's shared multi-image atlas.
  const iconByKey = new Map<PoiKey, string>(
    POI_CATEGORIES.map(({ key, icon }) => [key, icon]),
  );

  // Overture tags a `confidence` in [0,1] per place; raising the floor thins
  // dense POIs across all supported categories.
  const poiState = {
    minConfidence: 0.99,
    // Fraction of matching places to keep (deterministic hash thinning). Low by
    // default so the street view stays legible and cheap; raise for completeness.
    density: 0.02,
  };

  // `sizeInMeters: false` keeps the pair a constant screen size. `text` and
  // `billboard` are independent materials on one MVT layer, while the feature
  // evaluator selects each billboard's atlas image, so every supported category
  // can render at once.
  //
  // Positioning is anchor-only (`center`, a normalized Vec2), there is no pixel
  // offset. To read as `icon │ name` we anchor the icon's RIGHT edge and the
  // text's LEFT edge to the same geographic point. The text keeps its baseline
  // origin so the icon aligns with the first line; the leading en space supplies
  // a small, consistent gap between them.
  const poiLayer = view.addLayer({
    type: "vector",
    source: placesSource,
    sourceLayers: ["place"],
    billboard: {
      url: iconByKey.get("Restaurants") ?? "",
      size: 30,
      sizeInMeters: false,
      clampToGround: false,
      center: { x: 0.5, y: 0.0 },
      depthTest: true,
      offsetDepth: true,
      transparent: true,
      alphaTest: 0.5,
      declutter: false,
    },
    // Overture's filtered-place labels: SemiCondensed Regular at `text-size` 12,
    // gray.950 with a 30%-opacity white halo. Not uppercased — only
    // administrative names are.
    text: {
      font: POI_FONT,
      color: new Color().setStyle(OVERTURE_COLORS.placeText),
      size: 12,
      sizeInMeters: false,
      clampToGround: false,
      center: { x: 0.0, y: 0.0 },
      outlineColor: new Color().setStyle(OVERTURE_COLORS.placeHalo),
      outlineWidth: POI_OUTLINE_WIDTH,
      outlineOpacity: OVERTURE_COLORS.placeHaloOpacity,
      depthTest: true,
      offsetDepth: true,
      maxWidth: params.maxWidth,
      textAlign: "left",
    },
  });
  {
    const apply = ({ evaluator }: { evaluator: FeatureEvaluator }) => {
      evaluator.evaluate(
        ({ properties }) => {
          const category = classifyPlace(properties);
          const image = category ? iconByKey.get(category) : undefined;
          if (!image) return { show: false };
          const confidence =
            (properties?.["confidence"] as number | undefined) ?? 0;
          if (confidence < poiState.minConfidence) return { show: false };

          // A POI is useful here only as an icon + label pair. Reject places
          // without a non-empty primary name before they reach either material.
          const name = (properties?.["@name"] as string | undefined)?.trim();
          if (!name) return { show: false };

          // Density cap: keep only a stable hashed fraction so dense areas don't
          // flood the view. Key off the stable Overture `id` when present, else
          // a composite of properties (name+taxonomy+confidence) — either way the
          // same feature always hashes the same, so the kept set never flickers.
          const key =
            (properties?.["id"] as string | undefined) ??
            `${(properties?.["@name"] as string | undefined) ?? ""}|${
              (properties?.["taxonomy"] as string | undefined) ?? ""
            }|${confidence}`;
          if (hash01(key) >= poiState.density) return { show: false };

          return {
            show: true,
            image,
            // `@name` is Overture's computed primary name (same convention the
            // division labels use). Replace `/` with a line break, indenting
            // every explicit line by the same icon-to-label gap.
            text: `${POI_LABEL_GAP}${name.replace(
              /\s*\/\s*/g,
              `\n${POI_LABEL_GAP}`,
            )}`,
            // Confidence in [0,1]: confident places win among POI names but
            // always rank below admin labels (tier priorities are >= 1). It is
            // currently inert because POI pairs opt out of decluttering, but
            // remains available if grouped decluttering is added later.
            declutterPriority: confidence,
          };
        },
        {
          filters: ["id", "@name", "taxonomy", "basic_category", "confidence"],
        },
      );
    };
    poiLayer.on("featureCreated", apply);
    poiLayer.on("featureUpdated", apply);
  }

  // Re-evaluate the POI layer (after a category/confidence change) and redraw.
  const restylePois = () => {
    poiLayer.forceUpdate();
    view.forceUpdate();
  };

  // Re-evaluate every layer and render. `forceUpdate` re-emits `featureUpdated`
  // for all loaded tiles, so a toggle flips visibility on existing geometry now.
  const restyle = () => {
    for (const { layer } of toggles) layer.forceUpdate();
    view.forceUpdate();
  };

  // ---- Control panel -------------------------------------------------------
  const pane = new Pane({ title: "Overture worldwide PMTiles" });

  const viewFolder = pane.addFolder({ title: "Viewpoints" });
  (Object.keys(VIEWPOINTS) as (keyof typeof VIEWPOINTS)[]).forEach((name) => {
    viewFolder.addButton({ title: name }).on("click", () => {
      view.setCamera({ ...VIEWPOINTS[name], heading: 0, roll: 0 });
    });
  });

  // Layer toggles — flipping a checkbox restyles every layer. Some titles map to
  // multiple layers (e.g. "Buildings"), so add one binding per distinct title.
  const layersFolder = pane.addFolder({ title: "Layers" });
  const boundToggleTitles = new Set<string>();
  for (const { title } of toggles) {
    if (boundToggleTitles.has(title)) continue;
    boundToggleTitles.add(title);
    layersFolder.addBinding(visible, title).on("change", () => {
      restyle();
    });
  }

  // Scales every tier together; the evaluator reads `params.sizeScale`, so a
  // restyle is what applies it.
  layersFolder
    .addBinding(params, "sizeScale", {
      min: 0.4,
      max: 4,
      step: 0.1,
      label: "label size ×",
    })
    .on("change", () => {
      restyle();
    });

  layersFolder
    .addBinding(params, "maxWidth", {
      min: 0,
      max: 20,
      step: 0.5,
      label: "label max width",
    })
    .on("change", ({ value }) => {
      labelLayer.update({ text: { maxWidth: value } });
      poiLayer.update({ text: { maxWidth: value } });
      view.forceUpdate();
    });

  // POI controls apply globally to every supported category in the shared
  // multi-image billboard layer.
  const poiFolder = pane.addFolder({ title: "Places (POIs)" });
  poiFolder
    .addBinding(poiState, "minConfidence", {
      min: 0,
      max: 1,
      step: 0.01,
      label: "min confidence",
    })
    .on("change", () => {
      restylePois();
    });
  poiFolder
    .addBinding(poiState, "density", {
      min: 0,
      max: 1,
      step: 0.01,
      label: "max density",
    })
    .on("change", () => {
      restylePois();
    });

  // All four Overture sources are declared; base/divisions/buildings share one
  // credit, so the AttributionPlugin collapses them to a single rendered line.
  attribution?.add([
    PMTILES_DATASETS.overtureBase,
    PMTILES_DATASETS.overtureDivisions,
    PMTILES_DATASETS.overtureBuildings,
    PMTILES_DATASETS.overturePlaces,
  ]);
};
