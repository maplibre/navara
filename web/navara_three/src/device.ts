/**
 * Device detection and adaptive quality utilities for mobile optimization.
 */
import type { NormalizeWASMClass } from "@navaramap/core";
import type { DynamicSse as EngineDynamicSse } from "@navaramap/engine";

/** Cached result of mobile device detection */
let cachedIsMobile: boolean | undefined;

/** Keywords to detect mobile devices from user agent string */
const MOBILE_KEYWORDS = [
  "android",
  "webos",
  "iphone",
  "ipad",
  "ipod",
  "blackberry",
  "windows phone",
  "opera mini",
  "mobile",
];

/**
 * Detects if the current device is a mobile device.
 * Uses user agent and touch capability heuristics.
 * Result is memoized since it doesn't change during runtime.
 */
export function isMobileDevice(): boolean {
  if (cachedIsMobile !== undefined) return cachedIsMobile;

  if (typeof navigator === "undefined") {
    cachedIsMobile = false;
    return false;
  }

  // Check user agent for mobile indicators
  const userAgent = navigator.userAgent.toLowerCase();
  const isMobileUA = MOBILE_KEYWORDS.some((keyword) =>
    userAgent.includes(keyword),
  );

  // Also check for touch capability + small screen as fallback
  const hasTouch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
  const isSmallScreen = window.innerWidth <= 768;

  cachedIsMobile = isMobileUA || (hasTouch && isSmallScreen);
  return cachedIsMobile;
}

/** Maximum pixel ratio for mobile devices to balance quality vs performance */
const MOBILE_MAX_PIXEL_RATIO = 1.0;

/**
 * Default pixel-ratio cap applied on every mobile device (without opting into
 * `mobileOptimization`). The fixed screen-sized render-target stack (composer
 * buffers, gbuffer MRT and depth textures, counted by the ledger as
 * `fixed_gpu_bytes`) grows quadratically with the drawing-buffer size — and
 * with the derived `buffers` configuration, which starts at one attachment
 * (color) and grows as effects declare `requiredBuffers`: at
 * DPR 3 it alone can exceed a mobile tile-cache budget and permanently close
 * the load gate. Above DPR 2 the sharpness gain is marginal on phone screens.
 */
const MOBILE_DEFAULT_MAX_PIXEL_RATIO = 2.0;

export type DevicePixelRatioOptions = {
  /** User-specified pixel ratio override (takes precedence over all other settings) */
  override?: number;
  /** Enable mobile optimization to cap pixel ratio on mobile devices */
  mobileOptimization?: boolean;
};

export const MB = 1024 * 1024;

/** Per-worker WASM heap floor: below a warmed worker's baseline, the pool
 * would recycle-thrash, so budgets never go under this. */
const WORKER_HEAP_FLOOR_BYTES = 64 * MB;
const WORKER_HEAP_CAP_DESKTOP = 256 * MB;
/** Mobile workers pin at the floor: capping heap growth here frees real RAM
 * headroom, which is what justifies the larger mobile tile-cache budget. */
const WORKER_HEAP_CAP_MOBILE = 64 * MB;
const FONT_BUDGET_DESKTOP = 128 * MB;
const FONT_BUDGET_MOBILE = 64 * MB;
/** In-flight fetch caps (per tile pipeline): a camera move on mobile must
 * not burst 50 simultaneous decodes into a memory-constrained process. */
const MAX_PENDING_REQUESTS_DESKTOP = 50;
/** Mobile reporting >= 4GB of device memory. */
const MAX_PENDING_REQUESTS_MOBILE = 16;
/** Low-end or unknown mobile (iOS Safari has no deviceMemory). */
const MAX_PENDING_REQUESTS_MOBILE_LOW = 8;

/** Desktop budget cap; also the fallback when deviceMemory is unavailable. */
const DESKTOP_MAX_CACHE_BYTES = 2048 * MB;
/** Mobile budget for devices reporting >= 4GB of memory — and for devices not
 * reporting it at all: iOS Safari never exposes `deviceMemory`, and modern
 * iPhones/iPads have 4-8GB of RAM, so treating "unreported" as conservative
 * would starve exactly the devices this budget matters most for. */
const MOBILE_CACHE_BYTES_HIGH = 512 * MB - WORKER_HEAP_CAP_MOBILE;
/** Conservative budget for devices explicitly reporting < 4GB (low-end Android). */
const MOBILE_CACHE_BYTES_LOW = 256 * MB - WORKER_HEAP_CAP_MOBILE;

type NavigatorWithDeviceMemory = Navigator & { deviceMemory?: number };

export type DefaultCacheBytesInputs = {
  /** Override mobile detection (defaults to `isMobileDevice()`). */
  isMobile?: boolean;
  /** Override the reported device memory in GB (defaults to `navigator.deviceMemory`; Chrome-only, spec-clamped to [0.5, 8]). */
  deviceMemoryGB?: number;
};

/**
 * Default tile-cache memory budget (`Options.cacheBytes`) for the current
 * device. Desktop: a quarter of the reported device memory, capped at 2GB.
 * Mobile: 512MB unless the device explicitly reports < 4GB (then 256MB) —
 * "unreported" counts as the 512MB tier because iOS Safari never exposes
 * `navigator.deviceMemory` while modern iPhones/iPads have 4-8GB of RAM.
 */
export function getDefaultCacheBytes(inputs?: DefaultCacheBytesInputs): number {
  const isMobile = inputs?.isMobile ?? isMobileDevice();
  const deviceMemoryGB =
    inputs?.deviceMemoryGB ??
    (typeof navigator === "undefined"
      ? undefined
      : (navigator as NavigatorWithDeviceMemory).deviceMemory);

  if (isMobile) {
    return deviceMemoryGB === undefined || deviceMemoryGB >= 4
      ? MOBILE_CACHE_BYTES_HIGH
      : MOBILE_CACHE_BYTES_LOW;
  }

  if (deviceMemoryGB === undefined) {
    return DESKTOP_MAX_CACHE_BYTES;
  }
  return Math.min((deviceMemoryGB * 1024 * MB) / 4, DESKTOP_MAX_CACHE_BYTES);
}

/**
 * Per-tile GPU byte estimates the WASM memory ledger cannot compute itself,
 * because the composite-atlas / render-target dimensions live on the JS side.
 * Passed to `Core.setMemoryCostHints` in `init()`. Bytes are `w*h*4` (RGBA),
 * with a mipmap factor applied only where the Rust default applies one (raster
 * textures), matching `navara_memory::CostHints::default`.
 */
export type MemoryCostHints = {
  /** Composite-atlas cost per tile. */
  atlasTileBytes: number;
  /** Raster texture cost per fragment. */
  rasterTileBytes: number;
};

export type MemoryCostHintsInputs = {
  /** Override mobile detection (defaults to `isMobileDevice()`). */
  isMobile?: boolean;
};

const ATLAS_SIZE_DESKTOP = 512;
const ATLAS_SIZE_MOBILE = 512;
/** The MRT composite atlas has three RGBA attachments (color, attr, normal). */
const ATLAS_ATTACHMENTS = 3;
/** Raster tiles are 256² RGBA. Mipmaps add ~1/3, matching the Rust default. */
const RASTER_TILE_SIZE = 256;
const RASTER_MIPMAP_NUMERATOR = 133;
const RASTER_MIPMAP_DENOMINATOR = 100;

/** Composite-atlas side length for this device — the single source of truth
 * shared by the compositor allocation (`TileTextureCompositor`) and the cost
 * hints below, so the ledger's per-tile estimate always matches reality. */
export function getCompositeAtlasSize(isMobile: boolean): number {
  return isMobile ? ATLAS_SIZE_MOBILE : ATLAS_SIZE_DESKTOP;
}

/**
 * GPU cost hints for the memory ledger, matching the actual allocation sizes.
 * The composite atlas is 512² on both desktop and mobile (see
 * `getCompositeAtlasSize`), so with three MRT attachments each rendered tile
 * costs ~3MB. The ledger must match reality or the map settles far too coarse.
 */
export function getDefaultMemoryCostHints(
  inputs?: MemoryCostHintsInputs,
): MemoryCostHints {
  const isMobile = inputs?.isMobile ?? isMobileDevice();
  const atlasSize = getCompositeAtlasSize(isMobile);
  return {
    atlasTileBytes: atlasSize * atlasSize * 4 * ATLAS_ATTACHMENTS,
    rasterTileBytes: Math.round(
      (RASTER_TILE_SIZE * RASTER_TILE_SIZE * 4 * RASTER_MIPMAP_NUMERATOR) /
        RASTER_MIPMAP_DENOMINATOR,
    ),
  };
}

/**
 * Device-wide memory budgets, derived together so the main-thread tile cache,
 * the tile-worker pool, and the font worker share one view of the device's
 * memory instead of three independent constants.
 */
export type MemoryBudgets = {
  /** Main-thread tile-cache budget (same as `getDefaultCacheBytes`). */
  cacheBytes: number;
  /** WASM heap budget per tile worker; the pool recycles a worker above it. */
  maxWorkerHeapBytes: number;
  /** Font-worker cache budget (font data + atlas pixels; caps further growth). */
  fontBudgetBytes: number;
  /** In-flight data fetch cap per tile pipeline; lower on mobile to shrink
   * the decode/upload burst on camera moves. */
  maxPendingRequests: number;
  /** Resting SSE multiplier (far tiles always this much coarser; >1 on
   * mobile shrinks the working set from the start). */
  sseMultiplierMin: number;
  /** Ceiling the memory-pressure SSE degrade may rise to; larger on mobile. */
  sseMultiplierMax: number;
};

export type DefaultMemoryBudgetsInputs = DefaultCacheBytesInputs & {
  /** Number of tile workers in the pool. */
  poolSize: number;
};

/**
 * Default memory budgets for the current device. The tile-worker share is a
 * quarter (desktop) or an eighth (mobile) of the reported device memory,
 * split across the pool and clamped to [64MB, 256MB desktop / 64MB mobile]
 * per worker (mobile workers pin at the floor) — on an 8GB desktop with an
 * 8-worker pool this matches the
 * historical fixed values exactly; low-memory devices shrink together.
 * Browsers without `navigator.deviceMemory` fall back to the caps.
 */
export function getDefaultMemoryBudgets(
  inputs: DefaultMemoryBudgetsInputs,
): MemoryBudgets {
  const isMobile = inputs.isMobile ?? isMobileDevice();
  const deviceMemoryGB =
    inputs.deviceMemoryGB ??
    (typeof navigator === "undefined"
      ? undefined
      : (navigator as NavigatorWithDeviceMemory).deviceMemory);
  const poolSize = Math.max(1, inputs.poolSize);

  const perWorkerCap = isMobile
    ? WORKER_HEAP_CAP_MOBILE
    : WORKER_HEAP_CAP_DESKTOP;
  let maxWorkerHeapBytes = perWorkerCap;
  if (deviceMemoryGB !== undefined) {
    const workerShare = (deviceMemoryGB * 1024 * MB) / (isMobile ? 8 : 4);
    maxWorkerHeapBytes = Math.min(
      Math.max(
        Math.floor(workerShare / poolSize / MB) * MB,
        WORKER_HEAP_FLOOR_BYTES,
      ),
      perWorkerCap,
    );
  }

  let fontBudgetBytes = isMobile ? FONT_BUDGET_MOBILE : FONT_BUDGET_DESKTOP;
  if (deviceMemoryGB !== undefined && deviceMemoryGB < 4) {
    fontBudgetBytes /= 2;
  }

  // Same shape as `getDefaultCacheBytes`: only mobiles reporting >= 4GB get
  // the higher cap; unknown deviceMemory (iOS Safari) stays conservative.
  let maxPendingRequests = MAX_PENDING_REQUESTS_DESKTOP;
  if (isMobile) {
    maxPendingRequests =
      deviceMemoryGB !== undefined && deviceMemoryGB >= 4
        ? MAX_PENDING_REQUESTS_MOBILE
        : MAX_PENDING_REQUESTS_MOBILE_LOW;
  }

  const sse = getDefaultSseMultiplierRange({ isMobile, deviceMemoryGB });

  return {
    cacheBytes: getDefaultCacheBytes({ isMobile, deviceMemoryGB }),
    maxWorkerHeapBytes,
    fontBudgetBytes,
    maxPendingRequests,
    sseMultiplierMin: sse.min,
    sseMultiplierMax: sse.max,
  };
}

export type SseMultiplierRange = { min: number; max: number };

/**
 * Default memory-pressure SSE multiplier range for the current device.
 * Desktop rests at 1.0 (no base degrade). Mobile keeps a resting base >1 so
 * far tiles are always coarser, and a higher ceiling so the pressure degrade
 * can shed more of the visible set before the tab is killed.
 */
export function getDefaultSseMultiplierRange(
  inputs?: DefaultCacheBytesInputs,
): SseMultiplierRange {
  const isMobile = inputs?.isMobile ?? isMobileDevice();
  const deviceMemoryGB =
    inputs?.deviceMemoryGB ??
    (typeof navigator === "undefined"
      ? undefined
      : (navigator as NavigatorWithDeviceMemory).deviceMemory);

  if (!isMobile) return { min: 1.0, max: 16.0 };
  // Only mobiles reporting >= 4GB get the lighter mobile preset; unknown
  // deviceMemory (iOS Safari) stays on the more aggressive one.
  return deviceMemoryGB !== undefined && deviceMemoryGB >= 4
    ? { min: 4.0, max: 32.0 }
    : { min: 8.0, max: 64.0 };
}

/**
 * LOD fog settings: a distance-based screen-space-error relaxation used by
 * the tile traversals (far tiles tolerate a larger error and stay coarser,
 * near tiles keep full resolution). This never affects visual fog rendering.
 */
export type LodFogSettings = {
  enabled: boolean;
  /** Distance scale of the relaxation ramp (2.0e-4 ≈ 63% strength at 5km). */
  density: number;
  /** Maximum SSE relaxation (in pixels) at far distance. */
  sseFactor: number;
};

/** Engine default (matches the Rust-side startup values). */
export const LOD_FOG_DESKTOP: LodFogSettings = {
  enabled: true,
  density: 2.0e-4,
  sseFactor: 2.0,
};
/** Desktop reporting < 4GB device memory: slightly coarser far tiles. */
export const LOD_FOG_DESKTOP_LOW_MEMORY: LodFogSettings = {
  enabled: true,
  density: 2.5e-4,
  sseFactor: 3.0,
};
/** Mobile with >= 4GB device memory. */
export const LOD_FOG_MOBILE: LodFogSettings = {
  enabled: true,
  density: 1.0e-2,
  sseFactor: 6.0,
};
/** Low-memory or unknown mobile (iOS Safari has no deviceMemory): far
 * scenery runs markedly coarser to keep the working set small. */
export const LOD_FOG_MOBILE_LOW_MEMORY: LodFogSettings = {
  enabled: true,
  density: 1.0e-1,
  sseFactor: 12.0,
};

/**
 * Default LOD fog settings for the current device, scaled by the reported
 * device memory: low-memory devices get a stronger distance-based LOD
 * degrade so the tile working set stays small.
 */
export function getDefaultLodFog(
  inputs?: DefaultCacheBytesInputs,
): LodFogSettings {
  const isMobile = inputs?.isMobile ?? isMobileDevice();
  const deviceMemoryGB =
    inputs?.deviceMemoryGB ??
    (typeof navigator === "undefined"
      ? undefined
      : (navigator as NavigatorWithDeviceMemory).deviceMemory);

  if (isMobile) {
    return deviceMemoryGB !== undefined && deviceMemoryGB >= 4
      ? LOD_FOG_MOBILE
      : LOD_FOG_MOBILE_LOW_MEMORY;
  }
  return deviceMemoryGB !== undefined && deviceMemoryGB < 4
    ? LOD_FOG_DESKTOP_LOW_MEMORY
    : LOD_FOG_DESKTOP;
}

/**
 * Dynamic screen-space-error settings (CesiumJS `dynamicScreenSpaceError`
 * equivalent): tilted, street-level horizon views tolerate a larger error for
 * far tiles. Zero effect looking straight down; fades out as the camera
 * climbs past `maxHeight` meters. Never affects visual rendering, only tile
 * LOD selection.
 *
 * Plain-object shape derived from the engine's `DynamicSse` class per the
 * WASM API policy (the class itself is constructed internally and consumed by
 * `Core.setDynamicSse`; see the field docs there).
 */
export type DynamicSseSettings = Required<NormalizeWASMClass<EngineDynamicSse>>;

/**
 * Engine default (matches the Rust-side startup values / CesiumJS defaults).
 * Ref: https://github.com/CesiumGS/cesium/blob/9e93c9b6aa44a8a490f5ed9aa175a7e92348aaa2/packages/engine/Source/Scene/Cesium3DTileset.js#L433-L521
 */
export const DYNAMIC_SSE_DEFAULT: DynamicSseSettings = {
  enabled: true,
  density: 2.0e-4,
  sseFactor: 24.0,
  heightFalloff: 0.25,
  minHeight: 0,
  maxHeight: 8000,
};

/** Default dynamic-SSE settings (device-independent for now). */
export function getDefaultDynamicSse(): DynamicSseSettings {
  return DYNAMIC_SSE_DEFAULT;
}

/** Sun shadow settings that depend on the device. */
export type SunShadowDefaults = {
  shadowCascadeCount?: number;
  shadowMapSize?: number;
  shadowFade?: boolean;
  shadowFar?: number;
};

/** Every caster draws once per cascade, and fading samples two cascades. */
const SUN_SHADOW_MOBILE: SunShadowDefaults = {
  shadowCascadeCount: 2,
  shadowMapSize: 1024,
  shadowFade: false,
  shadowFar: 1e4,
};

/**
 * Default sun shadow settings for the current device. Empty on desktop, where
 * the light's own defaults apply.
 */
export function getDefaultSunShadow(
  inputs?: Pick<DefaultCacheBytesInputs, "isMobile">,
): SunShadowDefaults {
  return (inputs?.isMobile ?? isMobileDevice()) ? SUN_SHADOW_MOBILE : {};
}

/**
 * Gets an appropriate pixel ratio for the current device.
 * Mobile devices are capped at 2 by default (see
 * {@link MOBILE_DEFAULT_MAX_PIXEL_RATIO}), and at 1 when mobileOptimization
 * is enabled; an explicit `override` (the `pixelRatio` option) bypasses both.
 *
 * @param options - Configuration options for pixel ratio
 * @returns Pixel ratio appropriate for the device
 */
export function getDevicePixelRatio(options?: DevicePixelRatioOptions): number {
  if (typeof options?.override === "number") {
    return options.override;
  }

  if (typeof window === "undefined") {
    return 1;
  }

  const deviceRatio = window.devicePixelRatio ?? 1;

  if (isMobileDevice()) {
    const cap = options?.mobileOptimization
      ? MOBILE_MAX_PIXEL_RATIO
      : MOBILE_DEFAULT_MAX_PIXEL_RATIO;
    return Math.min(deviceRatio, cap);
  }

  return deviceRatio;
}
