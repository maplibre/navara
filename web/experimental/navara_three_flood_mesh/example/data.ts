/**
 * A water-surface series and how the example stages it: an entry of
 * `datasets.json`. Each optional field turns on the staging it describes.
 */
export type FloodDataset = {
  label: string;
  /**
   * The Zarr group, relative to `public/` (the build copies it in), or
   * absolute where it is hosted elsewhere.
   */
  url: string;
  /** Where the data comes from and how it was built. Not shown. */
  notes?: string;
  /** `false` keeps the dataset off the built site, for data not published. */
  publish?: boolean;
  attribution: string;
  attributionUrl?: string;
  /** What the elapsed time counts from; the first step without it. */
  since?: string;
  /** When the elapsed time counts from, if before the first step. */
  origin?: string;
  /** The step shown first; the first without it. */
  startStep?: number;
  /** The water's color; muddy brown, as a river flood, without it. */
  waterColor?: string;
  /**
   * The mesh's `showUnderground`, for shallow water a terrain that differs
   * from the simulation's ground would hide; the toggle turns it off and on.
   * The `showUnderground` query parameter overrides it.
   */
  showUnderground?: number;
  /** The levee breach, where the source data gives it. */
  breach?: { lng: number; lat: number };
  camera: {
    lng: number;
    lat: number;
    height: number;
    heading: number;
    pitch: number;
  };
  /**
   * Heavy rain at the start, which stops over `rainStops` hours after the
   * first step and leaves white clouds; the sky then clears over `clears`
   * hours. Staging only: the simulations carry no weather. A clear sky
   * without it.
   */
  weather?: { rainStops: [number, number]; clears: [number, number] };
};

/** Where the example is served from, which the datasets' URLs count from. */
const BASE = new URL(import.meta.env.BASE_URL, location.href);

/**
 * The datasets of `datasets.json`, in its order, with their URLs resolved.
 * The built site's copy lists only the published ones.
 */
export const loadFloodDatasets = async () => {
  const response = await fetch(new URL("datasets.json", BASE));
  if (!response.ok) {
    throw new Error(`Failed to load datasets.json: ${response.status}`);
  }
  const datasets = (await response.json()) as Record<string, FloodDataset>;
  return Object.fromEntries(
    Object.entries(datasets).map(([key, dataset]) => [
      key,
      { ...dataset, url: new URL(dataset.url, BASE).href },
    ]),
  );
};
