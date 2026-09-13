import { describe, expect, test } from "vitest";

import { BatchTextureLayout, batchBaseIndex } from "./layout";

describe("batchBaseIndex", () => {
  test("maps each attribute row to a contiguous block of batch-row groups", () => {
    // texWidth=4096, batchRowGroups=2, batchId=100, rowIndex=0
    // col=100, batchRow=0, physicalRow=0*2+0=0 → index=(0*4096+100)*4=400
    expect(batchBaseIndex(4096, 2, 100, 0)).toBe(400);
    // rowIndex=1 → physicalRow=1*2+0=2 → (2*4096+100)*4
    expect(batchBaseIndex(4096, 2, 100, 1)).toBe((2 * 4096 + 100) * 4);
  });

  test("wraps batchId to the next physical row within its attribute block", () => {
    // batchId=4096, texWidth=4096 → col=0, batchRow=1
    // rowIndex=0 → physicalRow=0*2+1=1 → (1*4096+0)*4
    expect(batchBaseIndex(4096, 2, 4096, 0)).toBe(4096 * 4);
    // batchId=4200 → col=104, rowIndex=1 → physicalRow=1*2+1=3 → (3*4096+104)*4
    expect(batchBaseIndex(4096, 2, 4200, 1)).toBe((3 * 4096 + 104) * 4);
  });
});

describe("BatchTextureLayout", () => {
  test("allocation is idempotent and scalars fill the oldest free component", () => {
    const layout = new BatchTextureLayout();

    expect(layout.allocateScalar("height")).toEqual({ row: 0, comp: 0 });
    // A vec3 allocated in between takes its own row...
    expect(layout.allocateVec3("color")).toBe(1);
    // ...but the next scalar still packs into the oldest free component.
    expect(layout.allocateScalar("extrudedHeight")).toEqual({
      row: 0,
      comp: 1,
    });
    expect(layout.rows).toBe(2);

    // Re-allocating hands back the existing slots without growing.
    expect(layout.allocateScalar("height")).toEqual({ row: 0, comp: 0 });
    expect(layout.allocateVec3("color")).toBe(1);
    expect(layout.rows).toBe(2);
  });

  test("a scalar reuses the leftover component of a vec3 row", () => {
    const layout = new BatchTextureLayout();

    expect(layout.allocateVec3("color")).toBe(0);
    // color takes comps 0-2, so the first scalar lands in comp 3 of the same row.
    expect(layout.allocateScalar("showOpacity")).toEqual({
      row: 0,
      comp: 3,
    });
    expect(layout.rows).toBe(1);
  });
});
