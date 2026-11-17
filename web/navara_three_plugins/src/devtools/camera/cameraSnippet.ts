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

/** Allowed values per key; every value must also be finite. */
const RANGES: Partial<Record<keyof CameraSnapshot, [number, number]>> = {
  lng: [-180, 180],
  lat: [-90, 90],
  // Below the deepest seafloor is inside the Earth.
  height: [-12_000, Infinity],
  fov: [1, 179],
};

export type ParsedCamera =
  { camera: Partial<CameraSnapshot> } | { error: string };

/**
 * Reads the camera from text such as a JS object, JSON or a
 * `view.setCamera({ … })` call. It takes the `key: number` pairs of the
 * outermost object that has `lng`, `lat` and `height` (the first one, when
 * several), so nested objects and comments are skipped. The other keys are
 * returned only when present. An `error` when no object has the required
 * keys or a value is out of range.
 */
export function parseCameraSnippet(text: string): ParsedCamera {
  const objects = readObjects(text);
  const found = objects
    .filter((o) => REQUIRED.every((key) => key in o.values))
    .sort((a, b) => a.depth - b.depth)[0];
  if (!found) return { error: "Needs lng, lat and height" };
  for (const key of KEYS) {
    const value = found.values[key];
    if (value === undefined) continue;
    const [min, max] = RANGES[key] ?? [-Infinity, Infinity];
    if (!Number.isFinite(value) || value < min || value > max) {
      return { error: `${key} out of range` };
    }
  }
  return { camera: found.values };
}

type ObjectPairs = { depth: number; values: Partial<CameraSnapshot> };

const NAME = /[A-Za-z_$][\w$]*/y;
const NUMBER = /(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/y;

/**
 * The camera keys set to a number in each `{ … }` of `text` (the text
 * outside any braces counts as one more object, at depth 0), in the order
 * the objects open. Keys may be bare or quoted; a key's first value wins.
 */
function readObjects(text: string): ObjectPairs[] {
  const objects: ObjectPairs[] = [{ depth: 0, values: {} }];
  const stack = [objects[0]];
  // The last key read, while waiting for its `:` and number.
  let key: keyof CameraSnapshot | undefined;
  let colon = false;
  let sign = 1;
  let i = 0;
  const isKey = (name: string): name is keyof CameraSnapshot =>
    (KEYS as readonly string[]).includes(name);
  const readKey = (name: string) => {
    key = isKey(name) ? name : undefined;
    colon = false;
    sign = 1;
  };
  while (i < text.length) {
    const c = text[i];
    if (/\s/.test(c)) {
      i++;
    } else if (text.startsWith("//", i)) {
      const end = text.indexOf("\n", i);
      i = end < 0 ? text.length : end;
    } else if (text.startsWith("/*", i)) {
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? text.length : end + 2;
    } else if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      let name = "";
      while (j < text.length && text[j] !== c) {
        if (text[j] === "\\") j++;
        name += text[j] ?? "";
        j++;
      }
      readKey(name);
      i = j + 1;
    } else if (key && !colon && c === ":") {
      colon = true;
      i++;
    } else if (key && colon && (c === "-" || c === "+") && sign === 1) {
      sign = c === "-" ? -1 : 1;
      i++;
    } else if (((NAME.lastIndex = i), NAME.test(text))) {
      readKey(text.slice(i, NAME.lastIndex));
      i = NAME.lastIndex;
    } else if (((NUMBER.lastIndex = i), NUMBER.test(text))) {
      const values = stack[stack.length - 1].values;
      if (key && colon && !(key in values)) {
        values[key] = sign * Number(text.slice(i, NUMBER.lastIndex));
      }
      key = undefined;
      i = NUMBER.lastIndex;
    } else {
      if (c === "{") {
        const object = { depth: stack.length, values: {} };
        objects.push(object);
        stack.push(object);
      } else if (c === "}" && stack.length > 1) {
        stack.pop();
      }
      key = undefined;
      i++;
    }
  }
  return objects;
}
