import { type BufferGeometry } from "three";

import {
  createDracoGeometry,
  type DracoDecodeConfig,
} from "../loaders/dracoGeometry";

import { queueTask } from "./queueTask";

/** `buffer` is transferred to the worker and detached on return. */
export async function decodeDracoAsync(
  buffer: ArrayBuffer,
  config: DracoDecodeConfig,
): Promise<BufferGeometry> {
  const result = await queueTask("decodeDraco", [buffer, config], {
    transfer: [buffer],
  });
  return createDracoGeometry(result);
}
