import { describe, expect, it } from "vitest";

import { LABEL_ROWS, LabelDataTexture, LabelRow } from "./labelData";

/** The texel index the shader's `readLabel(slot, row)` resolves to. */
const texelIndex = (slot: number, row: number) => slot * LABEL_ROWS + row;

const dataOf = (store: LabelDataTexture) =>
  store.texture.image.data as unknown as Float32Array;

describe("LabelDataTexture", () => {
  it("creates a float RGBA texture sized to hold the initial capacity", () => {
    const store = new LabelDataTexture(16);
    const { width, height } = store.texture.image;

    expect(width * height).toBeGreaterThanOrEqual(16 * LABEL_ROWS);
    expect(store.size.x).toBe(width);
    expect(store.size.y).toBe(height);
    expect(dataOf(store).length).toBe(width * height * 4);
  });

  it("writes a row at the address the shader reads", () => {
    const store = new LabelDataTexture(8);
    store.setRow(3, LabelRow.BOX, 0.25, 0.5, 0.75, 0.5);

    const base = texelIndex(3, LabelRow.BOX) * 4;
    expect(Array.from(dataOf(store).slice(base, base + 4))).toEqual([
      0.25, 0.5, 0.75, 0.5,
    ]);
  });

  it("keeps rows of the same label independent", () => {
    const store = new LabelDataTexture(4);
    store.setRow(2, LabelRow.BOX, 1, 2, 3, 4);
    store.setRow(2, LabelRow.STATE, 5, 6, 7, 8);

    const box = texelIndex(2, LabelRow.BOX) * 4;
    const state = texelIndex(2, LabelRow.STATE) * 4;
    expect(Array.from(dataOf(store).slice(box, box + 4))).toEqual([1, 2, 3, 4]);
    expect(Array.from(dataOf(store).slice(state, state + 4))).toEqual([
      5, 6, 7, 8,
    ]);
  });

  it("setComponent touches only its channel", () => {
    const store = new LabelDataTexture(4);
    store.setRow(1, LabelRow.STATE, 1, 2, 3, 4);
    store.setComponent(1, LabelRow.STATE, 0, 0.5);

    const base = texelIndex(1, LabelRow.STATE) * 4;
    expect(Array.from(dataOf(store).slice(base, base + 4))).toEqual([
      0.5, 2, 3, 4,
    ]);
    expect(store.getComponent(1, LabelRow.STATE, 0)).toBe(0.5);
    expect(store.getComponent(1, LabelRow.STATE, 2)).toBe(3);
  });

  it("clearSlot zeroes exactly one label's rows", () => {
    const store = new LabelDataTexture(4);
    store.setRow(0, LabelRow.BOX, 9, 9, 9, 9);
    store.setRow(1, LabelRow.BOX, 7, 7, 7, 7);
    store.setRow(2, LabelRow.BOX, 5, 5, 5, 5);

    store.clearSlot(1);

    expect(store.getComponent(0, LabelRow.BOX, 0)).toBe(9);
    expect(store.getComponent(1, LabelRow.BOX, 0)).toBe(0);
    expect(store.getComponent(2, LabelRow.BOX, 0)).toBe(5);
  });

  describe("ensureCapacity", () => {
    it("is a no-op while the request fits", () => {
      const store = new LabelDataTexture(16);
      const before = store.texture;

      expect(store.ensureCapacity(16)).toBe(false);
      expect(store.texture).toBe(before);
    });

    // The allocation is padded out to whole texture rows, and that padding is
    // usable space — 17 labels round up to 2 rows, which address 32. Growing
    // at 18 would mean an allocate + copy + texture recreate (and a full GPU
    // re-upload) while free slots were still sitting in the buffer.
    it("uses the row padding before growing", () => {
      const store = new LabelDataTexture(17);
      const before = store.texture;

      expect(store.capacity).toBeGreaterThan(17);
      expect(store.ensureCapacity(18)).toBe(false);
      expect(store.ensureCapacity(store.capacity)).toBe(false);
      expect(store.texture).toBe(before);

      // ...and the padded slots are genuinely addressable.
      const last = store.capacity - 1;
      store.setRow(last, LabelRow.BOX, 1, 2, 3, 4);
      expect(store.getComponent(last, LabelRow.BOX, 3)).toBe(4);
      expect(texelIndex(last, LABEL_ROWS - 1) * 4 + 3).toBeLessThan(
        dataOf(store).length,
      );

      // One past the padded capacity is what actually triggers the grow.
      expect(store.ensureCapacity(store.capacity + 1)).toBe(true);
    });

    it("reports a capacity the texture can really back", () => {
      for (const requested of [1, 2, 16, 32, 40, 64, 128]) {
        const store = new LabelDataTexture(requested);
        const { width, height } = store.texture.image;
        expect(store.capacity).toBeGreaterThanOrEqual(requested);
        // Every row of every label must land inside the texture.
        expect(store.capacity * LABEL_ROWS).toBeLessThanOrEqual(width * height);
        expect(dataOf(store).length).toBe(width * height * 4);
      }
    });

    it("grows, replaces the texture, and preserves existing data", () => {
      const store = new LabelDataTexture(2);
      store.setRow(0, LabelRow.BOX, 1, 2, 3, 4);
      store.setRow(1, LabelRow.STATE, 5, 6, 7, 8);
      const before = store.texture;

      expect(store.ensureCapacity(40)).toBe(true);
      expect(store.texture).not.toBe(before);
      expect(store.capacity).toBeGreaterThanOrEqual(40);

      // Addresses are stable across a grow: the width is fixed, so only the
      // height changes and previously written texels keep their index.
      expect(store.getComponent(0, LabelRow.BOX, 1)).toBe(2);
      expect(store.getComponent(1, LabelRow.STATE, 3)).toBe(8);

      // ...and the new tail is addressable.
      store.setRow(39, LabelRow.BOX, 11, 12, 13, 14);
      expect(store.getComponent(39, LabelRow.BOX, 0)).toBe(11);
    });

    it("reports the grown dimensions through size", () => {
      const store = new LabelDataTexture(2);
      const heightBefore = store.size.y;

      store.ensureCapacity(500);

      expect(store.size.y).toBeGreaterThan(heightBefore);
      expect(store.size.x).toBe(store.texture.image.width);
      expect(store.size.y).toBe(store.texture.image.height);
      expect(dataOf(store).length).toBe(store.size.x * store.size.y * 4);
    });

    it("keeps the highest addressable slot inside the buffer", () => {
      const store = new LabelDataTexture(3);
      store.ensureCapacity(100);

      const last = texelIndex(store.capacity - 1, LABEL_ROWS - 1) * 4 + 3;
      expect(last).toBeLessThan(dataOf(store).length);
    });
  });

  // `needsUpdate` is a write-only setter that bumps `version`, so the upload
  // request is only observable through the version counter.
  it("flags the texture for upload on every write", () => {
    const store = new LabelDataTexture(4);

    let version = store.texture.version;
    store.setRow(0, LabelRow.BOX, 1, 1, 1, 1);
    expect(store.texture.version).toBeGreaterThan(version);

    version = store.texture.version;
    store.setComponent(0, LabelRow.STATE, 0, 1);
    expect(store.texture.version).toBeGreaterThan(version);

    version = store.texture.version;
    store.clearSlot(0);
    expect(store.texture.version).toBeGreaterThan(version);

    version = store.texture.version;
    store.markDirty();
    expect(store.texture.version).toBeGreaterThan(version);
  });
});
