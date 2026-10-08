import { expect, it, vi } from "vitest";

import { decodeDracoAsync } from "./decodeDracoAsync";
import { queueTask } from "./queueTask";

vi.mock("./queueTask", () => ({ queueTask: vi.fn() }));

it("decodes on the worker pool and transfers the input buffer", async () => {
  vi.mocked(queueTask).mockResolvedValue({
    index: null,
    attributes: [
      {
        name: "position",
        array: new Float32Array([1, 2, 3]),
        itemSize: 3,
        stride: 3,
      },
    ],
  });
  const buffer = new ArrayBuffer(4);
  const config = {
    attributeIDs: { position: 0 },
    attributeTypes: { position: "Float32Array" as const },
  };

  const geometry = await decodeDracoAsync(buffer, config);

  expect(queueTask).toHaveBeenCalledWith("decodeDraco", [buffer, config], {
    transfer: [buffer],
  });
  expect(geometry.getAttribute("position").array).toEqual(
    new Float32Array([1, 2, 3]),
  );
});
