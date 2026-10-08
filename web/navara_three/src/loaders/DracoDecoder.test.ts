import { BufferGeometry } from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { decodeDracoAsync } from "../tasks/decodeDracoAsync";

import { DracoDecoder } from "./DracoDecoder";

vi.mock("../tasks/decodeDracoAsync", () => ({ decodeDracoAsync: vi.fn() }));

describe("DracoDecoder", () => {
  const attributeIDs = { position: 0 };
  const attributeTypes = { position: "Float32Array" as const };

  beforeEach(() => {
    vi.mocked(decodeDracoAsync).mockReset();
  });

  it("reports results through GLTFLoader's callback contract", async () => {
    const geometry = new BufferGeometry();
    vi.mocked(decodeDracoAsync).mockResolvedValue(geometry);
    const buffer = new ArrayBuffer(4);
    const callback = vi.fn();
    const onError = vi.fn();

    await new DracoDecoder().decodeDracoFile(
      buffer,
      callback,
      attributeIDs,
      attributeTypes,
      undefined,
      onError,
    );

    expect(decodeDracoAsync).toHaveBeenCalledWith(buffer, {
      attributeIDs,
      attributeTypes,
    });
    expect(callback).toHaveBeenCalledWith(geometry);
    expect(onError).not.toHaveBeenCalled();
  });

  it("forwards callback failures to onError", async () => {
    vi.mocked(decodeDracoAsync).mockResolvedValue(new BufferGeometry());
    const error = new Error("callback failed");
    const onError = vi.fn();

    await new DracoDecoder().decodeDracoFile(
      new ArrayBuffer(4),
      () => {
        throw error;
      },
      attributeIDs,
      attributeTypes,
      undefined,
      onError,
    );

    expect(onError).toHaveBeenCalledWith(error);
  });

  it("forwards worker failures to onError", async () => {
    const error = new Error("decode failed");
    vi.mocked(decodeDracoAsync).mockRejectedValue(error);
    const callback = vi.fn();
    const onError = vi.fn();

    await new DracoDecoder().decodeDracoFile(
      new ArrayBuffer(4),
      callback,
      attributeIDs,
      attributeTypes,
      undefined,
      onError,
    );

    expect(callback).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(error);
  });
});
