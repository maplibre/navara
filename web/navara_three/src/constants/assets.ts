// Every bundled asset must be referenced through its own static
// `new URL("<literal>", import.meta.url)` call so that consumers' bundlers
// (Vite/Rollup/webpack) can detect the file and emit it into their build
// output. Runtime-concatenated paths are invisible to bundlers and 404 in
// production builds (#746). The `?no-inline` query opts each file out of
// Vite's lib-mode base64 inlining so our own dist emits it as a fetchable
// asset instead.

export const ATMOSPHERE_TRANSMITTANCE_URL = new URL(
  "../../assets/atmosphere/transmittance.exr?no-inline",
  import.meta.url,
).toString();

export const ATMOSPHERE_SCATTERING_URL = new URL(
  "../../assets/atmosphere/scattering.exr?no-inline",
  import.meta.url,
).toString();

export const ATMOSPHERE_IRRADIANCE_URL = new URL(
  "../../assets/atmosphere/irradiance.exr?no-inline",
  import.meta.url,
).toString();

export const ATMOSPHERE_HIGHER_ORDER_SCATTERING_URL = new URL(
  "../../assets/atmosphere/higher_order_scattering.exr?no-inline",
  import.meta.url,
).toString();

export const ATMOSPHERE_SINGLE_MIE_SCATTERING_URL = new URL(
  "../../assets/atmosphere/single_mie_scattering.exr?no-inline",
  import.meta.url,
).toString();

export const STARS_ASSETS_URL = new URL(
  "../../assets/atmosphere/stars.bin?no-inline",
  import.meta.url,
).toString();

export const CLOUD_LOCAL_WEATHER_URL = new URL(
  "../../assets/cloud/local_weather.png?no-inline",
  import.meta.url,
).toString();

export const CLOUD_SHAPE_URL = new URL(
  "../../assets/cloud/shape.bin?no-inline",
  import.meta.url,
).toString();

export const CLOUD_SHAPE_DETAIL_URL = new URL(
  "../../assets/cloud/shape_detail.bin?no-inline",
  import.meta.url,
).toString();

export const CLOUD_TURBULENCE_URL = new URL(
  "../../assets/cloud/turbulence.png?no-inline",
  import.meta.url,
).toString();

export const STBN_URL = new URL(
  "../../assets/noise/stbn.bin?no-inline",
  import.meta.url,
).toString();

/**
 * Filenames requested by `PrecomputedTexturesLoader` mapped to their
 * statically-resolved URLs. Used to remap directory-relative requests when
 * loading the bundled default atmosphere assets.
 */
export const ATMOSPHERE_TEXTURE_URLS: Record<string, string> = {
  "transmittance.exr": ATMOSPHERE_TRANSMITTANCE_URL,
  "scattering.exr": ATMOSPHERE_SCATTERING_URL,
  "irradiance.exr": ATMOSPHERE_IRRADIANCE_URL,
  "higher_order_scattering.exr": ATMOSPHERE_HIGHER_ORDER_SCATTERING_URL,
  "single_mie_scattering.exr": ATMOSPHERE_SINGLE_MIE_SCATTERING_URL,
};
