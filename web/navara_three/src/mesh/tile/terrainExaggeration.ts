import { exaggerateTerrainHeight } from "@navaramap/engine";
import TerrainExaggerationParsVertex from "@shaders/glsl/chunks/terrain_exaggeration_pars_vertex.glsl";
import {
  Box3,
  MeshDepthMaterial,
  RGBADepthPacking,
  Sphere,
  type Vector3,
} from "three";

import type { TerrainExaggeration } from "../../terrain/exaggeration";
import { createReplacer, type Replacer } from "../../utils/replacer";

/**
 * Displaces terrain vertices along the geodetic surface normal by the
 * exaggeration (`uTerrainExaggeration`, read from the `terrainHeight`
 * attribute). With `withNormal`, also tilts a vertex normal attribute
 * (`USE_VERTEX_NORMAL`) to match the scaled slopes.
 */
export function injectTerrainExaggeration(
  vertexShader: Replacer,
  withNormal: boolean,
): Replacer {
  const displaced = vertexShader
    .replace(
      "#include <common>",
      `#include <common>
${TerrainExaggerationParsVertex}`,
    )
    .replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
transformed += nvr_terrainExaggerationOffset(nvr_terrainUp(transformed));`,
    );
  return withNormal
    ? displaced.replace(
        "#include <beginnormal_vertex>",
        `#include <beginnormal_vertex>
#if USE_VERTEX_NORMAL
objectNormal = nvr_exaggerateTerrainNormal(objectNormal, nvr_terrainUp(position));
#endif`,
      )
    : displaced;
}

/**
 * Bounds of a terrain mesh after exaggeration, from its unexaggerated AABB
 * (`center` ± `extent`) and the height range of its geometry. The
 * displacement is affine in the height, so its largest magnitude is at one
 * end of the range; the box grows by it on every axis since the direction
 * (the surface normal) varies across the tile.
 */
export function exaggeratedTerrainBounds(
  center: Vector3,
  extent: Vector3,
  minHeight: number,
  maxHeight: number,
  [scale, relativeHeight]: TerrainExaggeration,
): { box: Box3; sphere: Sphere } {
  const displacement = (height: number) =>
    Math.abs(exaggerateTerrainHeight(height, scale, relativeHeight) - height);
  const grow = Math.max(displacement(minHeight), displacement(maxHeight));
  const halfSize = extent.clone().addScalar(grow);
  return {
    box: new Box3(center.clone().sub(halfSize), center.clone().add(halfSize)),
    sphere: new Sphere(center.clone(), extent.length() + grow),
  };
}

const depthMaterials = new WeakMap<
  { value: TerrainExaggeration },
  MeshDepthMaterial
>();

/**
 * Shadow-map depth material for terrain, displacing vertices like the tile
 * material does. One per exaggeration uniform (i.e. per view), shared by every
 * tile.
 */
export function terrainDepthMaterial(uniform: {
  value: TerrainExaggeration;
}): MeshDepthMaterial {
  let material = depthMaterials.get(uniform);
  if (!material) {
    material = new MeshDepthMaterial({ depthPacking: RGBADepthPacking });
    material.customProgramCacheKey = () => "nvr-terrain-depth";
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uTerrainExaggeration = uniform;
      shader.vertexShader = injectTerrainExaggeration(
        createReplacer(shader.vertexShader),
        false,
      ).source;
    };
    depthMaterials.set(uniform, material);
  }
  return material;
}
