// Fragment outputs and write macros for the screen G-buffer (MRT).
// TS-side mirror: web/navara_three/src/material/gbufferLayout.ts.
//
//   location 0: gl_FragColor (color)
//   location 1: normalBuffer (RG=packed view-space normal, B=metalness/reflectivity, A=roughness)
//   optional, packed after the fixed ones at computed locations:
//     effectIdBuffer (R=selective-effect bitmask) – USE_GBUFFER_SELECTIVE_EFFECT
//     emissiveBuffer (RGB=emissive, HDR half-float) – USE_GBUFFER_EMISSIVE
//     shadowBuffer (R=shadow amount, 0=lit..1=shadowed) – USE_GBUFFER_SHADOW
//
// Never assign effectIdBuffer/emissiveBuffer directly: without its buffer's
// define an output is undeclared, and only the macros compile the write out.
//
// INVARIANT – A of effectIdBuffer/emissiveBuffer is NOT a data channel.
// WebGL2 blends each attachment with that attachment's own output alpha, and
// selective-effect meshes reach the G-buffer even when `transparent: true`,
// so A=1.0 means "replace dst" and A=0.0 means "keep dst". Packing data there
// (e.g. merging emissive into effectIdBuffer) turns the blend factor into the
// packed value and silently breaks blended selective meshes.

// Per-feature emissive from the batch data texture, folded (rgb × intensity)
// in the vertex stage (batch_texture_vertex.glsl). Declared here because this
// chunk reaches every builtin fragment where USE_BATCH_EMISSIVE can be on.
#ifdef USE_BATCH_EMISSIVE
in vec3 nvr_vEmissive;
#define NVR_BATCH_EMISSIVE_OR(fallback) nvr_vEmissive
#else
#define NVR_BATCH_EMISSIVE_OR(fallback) (fallback)
#endif
#ifndef USE_SHADOWMAP_DEPTH
// The chunk is injected into every ShaderLib material, including ones that
// never render into the G-buffer (the opaque/transparent scenes get only the
// lighting defines). Keying the declaration on the location define — which
// CustomRenderPass stamps only on G-buffer materials — is what keeps those
// compiling.
#ifdef GBUFFER_NORMAL_LOCATION
layout(location = GBUFFER_NORMAL_LOCATION) out vec4 normalBuffer;

// The roughness slot doubles as the blend factor, so a blended material has
// to write 1.0 or it keeps the normal BEHIND the mesh. Its stored roughness
// was garbage under blending anyway.
#ifdef NVR_BLENDED
#define GBUFFER_NORMAL_ALPHA(roughnessValue) 1.0
#else
#define GBUFFER_NORMAL_ALPHA(roughnessValue) (roughnessValue)
#endif

// Every normal write goes through this, so the output can be compiled out
// wholesale. `blue` is metalness/reflectivity; unlit writers pass 0.0 and an
// alpha of 1.0 (they have no roughness to store).
#define GBUFFER_WRITE_NORMAL(n, blue, roughnessValue) normalBuffer = vec4(packNormalToVec2(n), blue, GBUFFER_NORMAL_ALPHA(roughnessValue));
#else
#define GBUFFER_WRITE_NORMAL(n, blue, roughnessValue)
#endif

#ifdef USE_GBUFFER_SELECTIVE_EFFECT
layout(location = GBUFFER_EFFECT_ID_LOCATION) out vec4 effectIdBuffer;
// Selective write: A=1.0 replaces dst under blending.
#define GBUFFER_WRITE_EFFECT_ID(mask) effectIdBuffer = vec4(mask, 0.0, 0.0, 1.0);
// Non-selective write: A=0.0 keeps dst under blending.
#define GBUFFER_WRITE_EFFECT_ID_ZERO effectIdBuffer = vec4(0.0);
#else
#define GBUFFER_WRITE_EFFECT_ID(mask)
#define GBUFFER_WRITE_EFFECT_ID_ZERO
#endif

#ifdef USE_GBUFFER_EMISSIVE
layout(location = GBUFFER_EMISSIVE_LOCATION) out vec4 emissiveBuffer;
// Selective write: A=1.0 replaces dst under blending.
#define GBUFFER_WRITE_EMISSIVE(emissiveRgb) emissiveBuffer = vec4(emissiveRgb, 1.0);
// Non-selective write: A=0.0 keeps dst under blending.
#define GBUFFER_WRITE_EMISSIVE_ZERO emissiveBuffer = vec4(0.0);
#else
#define GBUFFER_WRITE_EMISSIVE(emissiveRgb)
#define GBUFFER_WRITE_EMISSIVE_ZERO
#endif

#ifdef USE_GBUFFER_SHADOW
layout(location = GBUFFER_SHADOW_LOCATION) out vec4 shadowBuffer;
// Accumulator the navara_three_csm light chunks multiply each sampled shadow
// into (1.0=fully lit), hence declared ahead of the lights code.
float nvr_shadowMask = 1.0;
// Must mirror the albedo-output condition in overrideMaterialsForMRT.
#if !defined(NVR_LIT) && (defined(NVR_UNLIT) || defined(NVR_UNLIT_SCENE))
#define NVR_GBUFFER_UNLIT_FLAG 1.0
#else
#define NVR_GBUFFER_UNLIT_FLAG 0.0
#endif
// R is the shadow AMOUNT, so a cleared buffer reads as "unshadowed".
#define GBUFFER_WRITE_SHADOW shadowBuffer = vec4(1.0 - nvr_shadowMask, NVR_GBUFFER_UNLIT_FLAG, 0.0, 1.0);
// Unlit/no-data write: A=0.0 keeps dst under blending.
#define GBUFFER_WRITE_SHADOW_ZERO shadowBuffer = vec4(0.0);
#else
#define GBUFFER_WRITE_SHADOW
#define GBUFFER_WRITE_SHADOW_ZERO
#endif

// Composed macros – the only interface write sites use. Each buffer's part
// vanishes independently when that buffer is disabled.
#define GBUFFER_WRITE_EFFECT(mask, emissiveRgb) GBUFFER_WRITE_EFFECT_ID(mask) GBUFFER_WRITE_EMISSIVE(emissiveRgb)
// Line/sprite/points: no emissive support.
#define GBUFFER_WRITE_EFFECT_ID_ONLY(mask) GBUFFER_WRITE_EFFECT_ID(mask) GBUFFER_WRITE_EMISSIVE_ZERO
#define GBUFFER_WRITE_EFFECT_ZERO GBUFFER_WRITE_EFFECT_ID_ZERO GBUFFER_WRITE_EMISSIVE_ZERO
#endif
