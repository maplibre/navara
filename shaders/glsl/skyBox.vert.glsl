#include "chunks/geographic.glsl"

uniform vec3 uSunDirView;

out vec3 v_posView;
flat out vec3 v_upView;
flat out float v_cameraAltitude;
flat out float v_sunElevation;

void main() {
    vec4 positionView = inverse(projectionMatrix) * vec4(position.xyz, 1.0);
    v_posView = positionView.xyz / positionView.w;

    vec3 cameraPositionLLA = ecefToLonLat(cameraPosition);
    v_cameraAltitude = cameraPositionLLA.z;
    vec2 lonLat = cameraPositionLLA.xy * DEG_TO_RAD;
    vec3 upWorld = vec3(cos(lonLat.y) * cos(lonLat.x), cos(lonLat.y) * sin(lonLat.x), sin(lonLat.y));
    v_upView = normalize(mat3(viewMatrix) * upWorld);
    v_sunElevation = dot(v_upView, normalize(uSunDirView));

    gl_Position = vec4(position.xyz, 1.0);
}
