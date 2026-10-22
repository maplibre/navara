import type ThreeView from "@navaramap/three";
import type { GeographicExtent, HeightRange } from "@navaramap/three";

/**
 * Keeps the volume heights of one extent current: computed by `volume` from
 * {@link ThreeView.sampleTerrainHeightRange} when the extent is set, then
 * from the engine's observer. Calls `onChange` whenever they are recomputed,
 * including for a new extent.
 */
export class GroundVolumeWatch {
  /** `[min, max]`, or `undefined` while no extent is watched. */
  heights?: [number, number];
  /**
   * The terrain heights `heights` were computed from, or `undefined` while no
   * extent is watched.
   */
  terrainHeights?: HeightRange;
  private readonly view: ThreeView;
  private readonly volume: (
    range: HeightRange,
    extent: GeographicExtent,
  ) => [number, number];
  private readonly onChange: () => void;
  private unobserve?: () => void;

  constructor(
    view: ThreeView,
    volume: (range: HeightRange, extent: GeographicExtent) => [number, number],
    onChange: () => void,
  ) {
    this.view = view;
    this.volume = volume;
    this.onChange = onChange;
  }

  /** Watches `extent`, or stops watching when it is `undefined`. */
  watch(extent: GeographicExtent | undefined) {
    this.unobserve?.();
    this.unobserve = undefined;
    this.terrainHeights = undefined;
    this.heights = undefined;
    if (!extent) return;

    // The ellipsoid surface until the engine has a terrain quadtree.
    this.update(
      this.view.sampleTerrainHeightRange(extent) ?? { min: 0, max: 0 },
      extent,
    );
    // The observer's first event usually repeats this range and is skipped.
    this.onChange();
    this.unobserve = this.view.observeTerrainHeightRange(extent, (range) => {
      if (
        this.terrainHeights?.min === range.min &&
        this.terrainHeights.max === range.max
      ) {
        return;
      }
      this.update(range, extent);
      this.onChange();
    });
  }

  private update(range: HeightRange, extent: GeographicExtent) {
    this.terrainHeights = range;
    this.heights = this.volume(range, extent);
  }
}
