const SECONDS_PER_UNIT: Record<string, number> = {
  "": 1,
  s: 1,
  m: 60,
  h: 3600,
};

/** Seconds in `value`, a number with an optional unit `s`, `m` or `h`. */
export const parseDuration = (value: string) => {
  const match = /^(\d+(?:\.\d+)?)([smh]?)$/.exec(value);
  if (!match) throw new Error(`Not a duration: ${value}`);
  return Number(match[1]) * SECONDS_PER_UNIT[match[2]];
};

/**
 * Indices of increasing `times` kept from the first on, each the first at
 * least `interval` after the one kept before.
 */
export const thinTimes = (times: ArrayLike<number>, interval: number) => {
  const kept: number[] = [];
  for (let k = 0; k < times.length; k++) {
    if (!kept.length || times[k] - times[kept[kept.length - 1]] >= interval) {
      kept.push(k);
    }
  }
  return kept;
};
