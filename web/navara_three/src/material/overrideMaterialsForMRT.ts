// Ref: https://github.com/takram-design-engineering/three-geospatial/blob/main/packages/effects/src/setupMaterialsForGeometryPass.ts

import { packing } from "@takram/three-geospatial/shaders";
import {
  ShaderLib,
  ShaderMaterial,
  type Material,
  type ShaderLibShader,
} from "three";
import { LineMaterial } from "three-stdlib";

import { createReplacer } from "../utils";

import {
  GBUFFER_EFFECT_WRITE_BUILTIN,
  GBUFFER_EFFECT_WRITE_ID_ONLY,
  GBUFFER_EFFECT_WRITE_SHADER_MATERIAL,
  GBUFFER_EFFECT_WRITE_ZERO,
  GBUFFER_NORMAL_WRITE_BASIC,
  GBUFFER_NORMAL_WRITE_PHYSICAL,
  GBUFFER_PARS_FRAGMENT,
} from "./gbufferLayout";

const SETUP = Symbol("SETUP");

/** `lit: true` – wins over {@link NVR_UNLIT_SCENE_DEFINE}. */
export const NVR_LIT_DEFINE = "NVR_LIT";
/** `lit: false` – only the lighting equation is bypassed; the lit pipeline
 * still runs, so normals and the shadow G-buffer keep being written. */
export const NVR_UNLIT_DEFINE = "NVR_UNLIT";
/** Scene-level default, stamped by `CustomRenderPass` from `view.lit`. */
export const NVR_UNLIT_SCENE_DEFINE = "NVR_UNLIT_SCENE";
/**
 * Stamped from `material.transparent`. Under blending, `normalBuffer.a` is
 * the attachment's blend factor, so a blended material must write 1.0 there
 * instead of roughness or it keeps the normal of whatever lies behind.
 */
export const NVR_BLENDED_DEFINE = "NVR_BLENDED";

/** Applies a material's three-state `lit` option. */
export function applyLitOption(
  material: Material,
  lit: boolean | undefined,
): void {
  // `false` is three's "absent" define value, avoiding a delete.
  const forceLit = lit === true ? 1 : false;
  const forceUnlit = lit === false ? 1 : false;
  material.defines ??= {};
  if (
    (material.defines[NVR_LIT_DEFINE] ?? false) === forceLit &&
    (material.defines[NVR_UNLIT_DEFINE] ?? false) === forceUnlit
  ) {
    return;
  }
  material.defines[NVR_LIT_DEFINE] = forceLit;
  material.defines[NVR_UNLIT_DEFINE] = forceUnlit;
  material.needsUpdate = true;
}

declare module "three" {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface ShaderLibShader {
    [SETUP]?: boolean;
  }
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface ShaderMaterial {
    [SETUP]?: boolean;
  }
}

function injectNormal(shader: ShaderLibShader): ShaderLibShader {
  const vertexShader = createReplacer(shader.vertexShader)
    .replace(
      /* glsl */ `#include <fog_pars_vertex>`,
      /* glsl */ `
        #include <fog_pars_vertex>
        #include <normal_pars_vertex>
      `,
    )
    .replace(
      /* glsl */ `#include <defaultnormal_vertex>`,
      /* glsl */ `
        #include <defaultnormal_vertex>
        #include <normal_vertex>
      `,
    )
    .replace(
      /* glsl */ `#if defined ( USE_ENVMAP ) || defined ( USE_SKINNING )`,
      /* glsl */ `#if 1`,
    )
    .replace(
      /* glsl */ `#include <clipping_planes_vertex>`,
      /* glsl */ `
        #include <clipping_planes_vertex>
        vViewPosition = - mvPosition.xyz;
      `,
    ).source;
  shader.vertexShader = /* glsl */ `
    #undef FLAT_SHADED
    varying vec3 vViewPosition;
    ${vertexShader}
  `;

  const fragmentShader = createReplacer(shader.fragmentShader)
    .replace(
      /#ifndef FLAT_SHADED\s+varying vec3 vNormal;\s+#endif/m,
      /* glsl */ `#include <normal_pars_fragment>`,
    )
    .replace(
      /* glsl */ `#include <specularmap_fragment>`,
      /* glsl */ `
        #include <specularmap_fragment>
        #include <normal_fragment_begin>
        #include <normal_fragment_maps>
      `,
    ).source;
  shader.fragmentShader = /* glsl */ `
    #undef FLAT_SHADED
    varying vec3 vViewPosition;
    ${fragmentShader}
  `;

  return shader;
}

function injectGBuffer(
  shader: ShaderLibShader,
  { type }: { type?: "basic" | "physical" } = {},
): ShaderLibShader {
  if (shader[SETUP] === true) {
    return shader;
  }
  if (type === "basic") {
    injectNormal(shader);
  }
  const normalBufferWrite =
    type === "physical"
      ? /* glsl */ `
          ${GBUFFER_NORMAL_WRITE_PHYSICAL}
        `
      : /* glsl */ `
          #ifdef USE_ROUGHNESS
            float roughnessFactor = roughness;
          #else
            // Not just a default: 0.0 here would leak the normal behind a
            // blended surface (see NVR_BLENDED_DEFINE).
            float roughnessFactor = 1.0;
          #endif
          ${GBUFFER_NORMAL_WRITE_BASIC}
        `;
  shader.fragmentShader = /* glsl */ `
    ${GBUFFER_PARS_FRAGMENT}

    #if !defined(USE_ENVMAP)
      uniform float reflectivity;
    #endif // !defined(USE_ENVMAP)

    #ifdef USE_ROUGHNESS
      uniform float roughness;
    #endif // USE_ROUGHNESS

    #ifdef USE_SELECTIVE_EFFECT
      uniform float uEffectIdsMask;
      uniform float uEmissiveIntensity;
    #endif

    ${packing}
    ${
      createReplacer(shader.fragmentShader)
        // ShaderLib's lit materials lack <packing>. It is added once here, so
        // patches must not include it again: a second copy fails to compile.
        .replace(
          /* glsl */ `#include <common>`,
          /* glsl */ `
            #include <common>
            #include <packing>
          `,
        )
        .replace(
          /* glsl */ `#include <opaque_fragment>`,
          /* glsl */ `
            #if !defined(${NVR_LIT_DEFINE}) && (defined(${NVR_UNLIT_DEFINE}) || defined(${NVR_UNLIT_SCENE_DEFINE}))
              // Overwrite rather than skip the lighting: the G-buffer writes
              // below still need the lit pipeline to have run.
              outgoingLight = diffuseColor.rgb;
            #endif
            #include <opaque_fragment>
          `,
        )
        .replace(
          /}\s*$/, // Assume the last curly brace is of main()
          /* glsl */ `
          #ifndef USE_SHADOWMAP_DEPTH
            ${normalBufferWrite}

            #ifdef USE_SELECTIVE_EFFECT
              ${GBUFFER_EFFECT_WRITE_BUILTIN}
            #else
              ${GBUFFER_EFFECT_WRITE_ZERO}
            #endif

            GBUFFER_WRITE_SHADOW
          #endif
        }
      `,
        ).source
    }
  `;
  shader[SETUP] = true;
  return shader;
}

function injectGBufferToSpriteMaterial(shader: ShaderLibShader) {
  if (shader[SETUP] === true) {
    return shader;
  }

  shader.vertexShader = /* glsl */ `
    varying vec3 vViewPosition;
    ${
      createReplacer(shader.vertexShader).replace(
        /}\s*$/,
        `
        vViewPosition = -mvPosition.xyz;
      }
    `,
      ).source
    }
  `;

  shader.fragmentShader = /* glsl */ `
    ${GBUFFER_PARS_FRAGMENT}

    #ifdef USE_SELECTIVE_EFFECT
      uniform float uEffectIdsMask;
    #endif

    varying vec3 vViewPosition;

    ${packing}

    ${
      createReplacer(shader.fragmentShader).replace(
        /}\s*$/, // Assume the last curly brace is of main()
        /* glsl */ `
          #ifndef USE_SHADOWMAP_DEPTH
            // Flat shading
            vec3 fdx = dFdx( vViewPosition );
            vec3 fdy = dFdy( vViewPosition );
            vec3 normal = normalize( cross( fdx, fdy ) );
            // A=1.0 replaces the normal behind under blending.
            GBUFFER_WRITE_NORMAL(normal, 0.0, 1.0)

            #ifdef USE_SELECTIVE_EFFECT
              ${GBUFFER_EFFECT_WRITE_ID_ONLY}
            #else
              ${GBUFFER_EFFECT_WRITE_ZERO}
            #endif

            GBUFFER_WRITE_SHADOW_ZERO
          #endif
        }
      `,
      ).source
    }
  `;

  shader[SETUP] = true;

  return shader;
}

/**
 * @internal
 * Patches all built-in Three.js `ShaderLib` materials (basic, lambert, phong,
 * standard, physical, sprite, points) so they write to the MRT G-buffer.
 * Called automatically when `@navaramap/three` is imported — application code
 * never needs to call this. Custom `ShaderMaterial`/`LineMaterial` do not go
 * through `ShaderLib`, so they must opt in via {@link setupMaterialForMRT}.
 */
export function overrideMaterialsForMRT(): void {
  injectGBuffer(ShaderLib.lambert);
  injectGBuffer(ShaderLib.phong);
  injectGBuffer(ShaderLib.basic, { type: "basic" });
  injectGBuffer(ShaderLib.standard, { type: "physical" });
  injectGBuffer(ShaderLib.physical, { type: "physical" });
  injectGBufferToSpriteMaterial(ShaderLib.sprite);
  injectGBufferToSpriteMaterial(ShaderLib.points);
}

// TODO: Use a parser to handle this.
function injectGBufferToShaderMaterial(
  shader: ShaderMaterial,
  normalVariableName = "normal",
): ShaderLibShader {
  if (shader[SETUP] === true) {
    return shader;
  }

  // Vertex shader
  const common = "#include <common>";

  const logdepthParsVert = "#include <logdepthbuf_pars_vertex>";
  const logdepthVert = "#include <logdepthbuf_vertex>";

  shader.vertexShader = /* glsl */ `
    ${shader.vertexShader.includes(common) ? "" : common}
    ${shader.vertexShader.includes(logdepthParsVert) ? "" : logdepthParsVert}

    ${
      createReplacer(shader.vertexShader).replace(
        /}\s*$/, // Assume the last curly brace is of main()
        /* glsl */ `
          ${shader.vertexShader.includes(logdepthVert) ? "" : logdepthVert}
        }
      `,
      ).source
    }
  `;

  // Fragment shader
  const logdepthParsFrag = "#include <logdepthbuf_pars_fragment>";
  const logdepthFrag = "#include <logdepthbuf_fragment>";
  const normalBufferWrite = /* glsl */ `
          GBUFFER_WRITE_NORMAL(${normalVariableName}, 0.0, 1.0)
        `;
  shader.fragmentShader = /* glsl */ `
    ${GBUFFER_PARS_FRAGMENT}

    #ifndef USE_SHADOWMAP_DEPTH
      #ifdef USE_SELECTIVE_EFFECT
        uniform float uEffectIdsMask;
        uniform vec3 uEmissiveColor;
        uniform float uEmissiveIntensity;
      #endif
    #endif

    ${packing}

    ${shader.fragmentShader.includes(logdepthParsFrag) ? "" : logdepthParsFrag}

    ${
      createReplacer(shader.fragmentShader).replace(
        /}\s*$/, // Assume the last curly brace is of main()
        /* glsl */ `
          ${shader.fragmentShader.includes(logdepthFrag) ? "" : logdepthFrag}

          #ifndef USE_SHADOWMAP_DEPTH
            ${normalBufferWrite};

            #ifdef USE_SELECTIVE_EFFECT
              ${GBUFFER_EFFECT_WRITE_SHADER_MATERIAL}
            #else
              ${GBUFFER_EFFECT_WRITE_ZERO}
            #endif

            GBUFFER_WRITE_SHADOW_ZERO
          #endif
        }
      `,
      ).source
    }
  `;

  shader[SETUP] = true;

  return shader;
}

export type SetupMaterialForMRTOptions = {
  /**
   * Name of the GLSL variable holding the **view-space** normal in the
   * fragment shader (it is packed with `packNormalToVec2`, which assumes
   * view space). Defaults to `"normal"`. Shaders that expose their normal as
   * a `varying vec3 vNormal` should pass `{ normal: "vNormal" }`.
   *
   * Ignored for `LineMaterial`, which derives a screen-space normal itself.
   */
  normal?: string;
};

// LineMaterial MRT Support. Injects normalBuffer, effectIdBuffer, emissiveBuffer outputs.
// When USE_SELECTIVE_EFFECT is defined, outputs effectIdsMask (emissive not supported for LineMaterial).
function injectGBufferToLineMaterial(lineMaterial: LineMaterial) {
  if (lineMaterial[SETUP] === true) {
    return lineMaterial;
  }

  // Check if this is actually a LineMaterial from three-stdlib
  if (
    !lineMaterial.fragmentShader ||
    !lineMaterial.fragmentShader.includes("vLineDistance")
  ) {
    return lineMaterial;
  }

  // LineMaterial already has proper vertex shader setup, so we only modify fragment shader

  lineMaterial.fragmentShader = /* glsl */ `
    ${GBUFFER_PARS_FRAGMENT}

    #ifdef USE_SELECTIVE_EFFECT
      uniform float uEffectIdsMask;
    #endif

    ${packing}

    ${
      createReplacer(lineMaterial.fragmentShader)
        .replace(
          "void main() {",
          /* glsl */ `
          void main() {
            // Calculate screen-space normal for Line2 MRT compatibility
            vec3 fdx = dFdx(gl_FragCoord.xyz);
            vec3 fdy = dFdy(gl_FragCoord.xyz);
            vec3 normal = normalize(cross(fdx, fdy));

            // Ensure normal faces camera (positive Z in screen space)
            if (normal.z < 0.0) normal = -normal;
        `,
        )
        .replace(
          /}\s*$/, // Assume the last curly brace is of main()
          /* glsl */ `
          #ifndef USE_SHADOWMAP_DEPTH
            // A=1.0 replaces the normal behind under blending.
            GBUFFER_WRITE_NORMAL(normal, 0.0, 1.0)

            #ifdef USE_SELECTIVE_EFFECT
              ${GBUFFER_EFFECT_WRITE_ID_ONLY}
            #else
              ${GBUFFER_EFFECT_WRITE_ZERO}
            #endif

            GBUFFER_WRITE_SHADOW_ZERO
          #endif
        }
      `,
        ).source
    }
  `;

  lineMaterial[SETUP] = true;

  return lineMaterial;
}

/**
 * Wire a custom material into Navara's MRT G-buffer so depth/normal-based
 * effects (SSAO, SSR, outline, aerial perspective, clouds) and SelectiveEffect
 * (Bloom/Outline) work on the mesh that uses it.
 *
 * Built-in Three.js materials (`MeshStandardMaterial`, `MeshBasicMaterial`,
 * `Sprite`, `Points`, …) are patched automatically on import and do **not**
 * need this. Only custom `ShaderMaterial` and three-stdlib `LineMaterial`
 * bypass `ShaderLib`, so they must opt in here.
 *
 * `LineMaterial` is detected and routed automatically; the `normal` option is
 * only used for plain `ShaderMaterial`.
 *
 * Injects `normalBuffer` (location 1), `effectIdBuffer` (location 2), and
 * `emissiveBuffer` (location 3). For `ShaderMaterial` it also injects the
 * `logdepthbuf` modules; `LineMaterial` already has its own vertex setup, so
 * those are not added. When `USE_SELECTIVE_EFFECT` is defined,
 * `effectIdBuffer`/`emissiveBuffer` are populated (emissive is unsupported for
 * `LineMaterial`). Idempotent — calling it more than once on the same material
 * is a no-op.
 *
 * Requirements for `ShaderMaterial`: the fragment shader must expose a
 * view-space normal (named by `options.normal`, default `"normal"`), and the
 * last `}` in each shader is assumed to close `main()`.
 */
export function setupMaterialForMRT(
  material: ShaderMaterial,
  options?: SetupMaterialForMRTOptions,
): void {
  // Detect LineMaterial by `type`, not only `instanceof`: callers may construct
  // it from `three/examples/jsm/lines` while this module's `LineMaterial` comes
  // from `three-stdlib`, so a bare `instanceof` misses those cross-copy
  // instances and would wrongly route them through the ShaderMaterial path
  // (whose normal-buffer write references an undeclared `normal`).
  if (material instanceof LineMaterial || material.type === "LineMaterial") {
    injectGBufferToLineMaterial(material as LineMaterial);
    return;
  }
  injectGBufferToShaderMaterial(material, options?.normal);
}
