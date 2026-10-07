// Shades the rest of `main` at the ground point under this fragment instead
// of on the draped volume: the terrain normal replaces `normal`, and
// `vViewPosition` and the directional shadow coordinates move to the ground.
// With NVR_DRAPE_ELLIPSOID_NORMAL, the ellipsoid normal at the ground point
// replaces `normal` instead, so the drape is shaded without the terrain's
// relief. Placed right after <normal_fragment_begin>, so everything reading
// `normal` afterwards sees the replacement.
float nvrDrapeGroundW = nvr_globeEyeDistance(unpackRGBAToDepth(
    texture2D(tGlobeDepth, gl_FragCoord.xy / vec2(textureSize(tGlobeDepth, 0)))
));
vec3 nvrGroundViewPosition = vViewPosition * (nvrDrapeGroundW / vViewPosition.z);

#ifdef NVR_DRAPE_ELLIPSOID_NORMAL
    vec3 nvrDrapeGroundWorld = cameraPosition
        + (vec4(-nvrGroundViewPosition, 0.0) * viewMatrix).xyz;
    normal = normalize((viewMatrix * vec4(
        nvrDrapeGroundWorld * ONE_OVER_WGS84_RADII_SQUARED, 0.0
    )).xyz);
#else
    normal = normalize(unpackVec2ToNormal(texture2D(
        tGlobeNormal, gl_FragCoord.xy / vec2(textureSize(tGlobeNormal, 0))
    ).xy));
#endif
vec3 nvrGroundShadowNormal = normal;
#include ground_shadow_coord_fragment;
