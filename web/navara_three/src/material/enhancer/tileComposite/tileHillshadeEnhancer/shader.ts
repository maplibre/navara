import type { CompositeSlotContext } from "../tileCompositeBaseEnhancer";

export const hillshadeSlotUniformDecls = (numTextures: number): string =>
  `uniform bool uIsHillshades[${numTextures}];`;

/** Hillshade slots contribute no color — their data is a normal map. */
export const hillshadePerSlotPostSample = ({
  k,
}: CompositeSlotContext): string => `
    if (uIsHillshades[${k}]) {
      texColor${k} = vec4(0.0);
    }`;

/**
 * After the slot loop, sample each hillshade slot's normal into the atlas's
 * normal attachment — the last hillshade slot wins. The TileMesh main shader
 * applies the exaggeration and rotates the stored tangent-space normal via its
 * TBN; the atlas keeps the unexaggerated normal, so exaggeration is applied
 * exactly once (and takes effect without re-compositing).
 */
export const hillshadePostLoop = (numTextures: number): string =>
  Array.from(
    { length: numTextures },
    (_, k) => `
  if (uIsHillshades[${k}]) {
    ivec2 normalMapSize${k} = textureSize(uTextures[${k}], 0);
    if (normalMapSize${k}.x > 1 && normalMapSize${k}.y > 1) {
      vec2 hillshadeUv${k} = clamp(vUv * uLayerUvScale[${k}] + uLayerUvOffset[${k}], vec2(0.0), vec2(1.0));
      vec3 n${k} = texture2D(uTextures[${k}], hillshadeUv${k}).rgb * 2.0 - 1.0;
      n${k} = normalize(n${k});
      hillshadeNormal = n${k} * 0.5 + 0.5; // store in [0,1]
      hasHillshadeNormal = true;
    }
  }`,
  ).join("\n");
