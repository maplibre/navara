/** The camera as the Camera tool shows it; angles and `fov` in degrees. */
export type CameraSnapshot = {
  lng: number;
  lat: number;
  height: number;
  heading: number;
  pitch: number;
  roll: number;
  fov: number;
};

const KEYS = [
  "lng",
  "lat",
  "height",
  "heading",
  "pitch",
  "roll",
  "fov",
] as const satisfies readonly (keyof CameraSnapshot)[];

const REQUIRED = ["lng", "lat", "height"] as const;

/** Decimals kept per key: ~1 cm for lng / lat and height. */
const DECIMALS: Record<keyof CameraSnapshot, number> = {
  lng: 7,
  lat: 7,
  height: 2,
  heading: 3,
  pitch: 3,
  roll: 3,
  fov: 2,
};

/** The camera as a JS object literal, one key per line. */
export function formatCameraSnippet(camera: CameraSnapshot): string {
  const lines = KEYS.map(
    (key) => `  ${key}: ${Number(camera[key].toFixed(DECIMALS[key]))},`,
  );
  return `{\n${lines.join("\n")}\n}`;
}

/**
 * Reads `key: number` pairs from text such as a JS object, JSON or a
 * `view.setCamera({ … })` call. `lng`, `lat` and `height` are required;
 * the other keys are returned only when present. `null` when a required
 * key is missing.
 */
export function parseCameraSnippet(
  text: string,
): Partial<CameraSnapshot> | null {
  const out: Partial<CameraSnapshot> = {};
  for (const key of KEYS) {
    const match = new RegExp(
      String.raw`(?<![\w$])["']?${key}["']?\s*:\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)`,
    ).exec(text);
    if (match) out[key] = Number(match[1]);
  }
  return REQUIRED.every((key) => key in out) ? out : null;
}
