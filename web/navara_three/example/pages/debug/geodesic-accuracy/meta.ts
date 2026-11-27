import type { DevPageMeta } from "../../../helpers/devPageMeta";

export default {
  covers: [
    "crates/navara_core/src/ellipsoid_geodesic.rs",
    "web/navara_three_api/src/ellipsoidGeodesic.ts",
  ],
  lookFor:
    "Seen from a few meters above, the point `EllipsoidGeodesic.interpolateDistance` lands on (blue) coincides with GeographicLib's point at the same distance (orange) for each case; any visible gap is an error in the geodesic.",
  params: {
    case: "test case: meridian | equator | tokyo-sf | paris-1km | near-pole | southern; default meridian",
    point: "which point to frame: mid | end (default end)",
  },
  evidenceFor: [1016],
} satisfies DevPageMeta;
