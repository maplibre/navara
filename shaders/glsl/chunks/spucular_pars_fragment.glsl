// ref: https://github.com/mrdoob/three.js/blob/8e16eaf1c2a06264e4b9edc798ffd6031d53c822/src/renderers/shaders/ShaderChunk/iridescence_fragment.glsl.js#L29
float IorToFresnel0(float ior) {
  return pow2((ior - 1.0) / (ior + 1.0));
}

// ref: https://github.com/mrdoob/three.js/blob/54ac263593c81b669ca9a089491ddd9e240427d2/examples/jsm/objects/Water.js#L165-L167
vec3 specularColor( const vec3 surfaceNormal, const vec3 eyeDirection, float shiny, float spec) {
    #if NUM_DIR_LIGHTS > 0
    DirectionalLight sunLight = directionalLights[0]; // Assuming first light is sun light.

    float ndotL = max(dot(surfaceNormal, sunLight.direction), 0.0);
    if (ndotL <= 0.0) return vec3(0.0);

    vec3 reflection = normalize( reflect( -sunLight.direction, surfaceNormal ) );
    float direction = max(dot( eyeDirection, reflection ), 0.0);
    // A layer may set shininess 0, and pow(0, 0) is undefined (NaN on some GPUs).
    return pow( direction, max( shiny, 1e-4 ) ) * sunLight.color * spec;
    #else
    return vec3(0.0);
    #endif
}

vec3 computeSpecular(
    const in vec3 viewPosition,
    const in vec3 normal,
    const in float shininess,
    const in float specStrength,
    const in float ior
) {
    vec3 toEye = normalize(viewPosition);
    float ndotV = max(dot(normal, toEye), 0.0);
    float FO = IorToFresnel0(ior);
    float specularF = F_Schlick(FO, 1.0, ndotV);

    return specularColor(normal, toEye, shininess, specStrength) * specularF;
}
