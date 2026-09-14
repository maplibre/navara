const float ATMOSPHERE_CUTOFF_ALTITUDE_LOW = 100000.0; // 100 km
const float ATMOSPHERE_CUTOFF_ALTITUDE_HIGH = ATMOSPHERE_CUTOFF_ALTITUDE_LOW + 90000.0;
const float SUN_RADIUS = 0.00465;

uniform vec3 uDayColor;
uniform vec3 uNightColor;
uniform vec3 uSunColor;
uniform vec3 uSunDirView;

in vec3 v_posView;
flat in vec3 v_upView;
flat in float v_cameraAltitude;
flat in float v_sunElevation;

float dither(vec2 pixel) {
    return fract(52.9829189 * fract(dot(pixel, vec2(0.06711056, 0.00583715))));
}

void main() {
    vec3 sunDir = normalize(uSunDirView);
    vec3 pixelDir = normalize(v_posView);
    float daylight = smoothstep(-0.2, 0.2, v_sunElevation);
    float horizon = 1.0 - smoothstep(0.0, 0.65, abs(dot(pixelDir, v_upView)));

    float dayLuminance = dot(uDayColor, vec3(0.2126, 0.7152, 0.0722));
    vec3 horizonColor = mix(uDayColor, vec3(dayLuminance), 0.35) * 1.15;
    vec3 dayColor = mix(uDayColor * 0.8, horizonColor, horizon);
    vec3 skyColor = mix(uNightColor, dayColor, daylight);

    float sunAlignment = max(dot(pixelDir, sunDir), 0.0);
    float twilight = 1.0 - smoothstep(0.0, 0.25, abs(v_sunElevation));
    skyColor += uSunColor * (0.18 * twilight * horizon * pow(sunAlignment, 8.0));

    // Chord distance retains precision at the small solar disc, unlike acos(dot()).
    vec3 sunOffset = pixelDir - sunDir;
    float sunDistance = length(sunOffset);
    float discEdge = max(fwidth(sunDistance), 0.00001);
    float sunDisc = 1.0 - smoothstep(SUN_RADIUS - discEdge, SUN_RADIUS + discEdge, sunDistance);
    float sunHalo = exp2(-dot(sunOffset, sunOffset) / 0.00045);

    float opacity = 1.0 - smoothstep(
        ATMOSPHERE_CUTOFF_ALTITUDE_LOW, ATMOSPHERE_CUTOFF_ALTITUDE_HIGH, v_cameraAltitude);
    skyColor = max(skyColor + (dither(gl_FragCoord.xy) - 0.5) / 255.0, vec3(0.0));
    // Premultiplied blending lets the sky fade independently of the sun and its halo.
    vec3 color = skyColor * (0.3 * opacity);
    color += uSunColor * (1.8 * sunDisc + 0.18 * sunHalo);
    float coverage = opacity + (1.0 - opacity) * sunDisc;
    gl_FragColor = vec4(color, coverage);
}
