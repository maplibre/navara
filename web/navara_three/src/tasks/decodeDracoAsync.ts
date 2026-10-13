import dracoWasmUrl from "draco3d/draco_decoder.wasm?url&no-inline";
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
  // The URL is resolved here, not in the worker: a consuming bundler copies
  // the worker chunk as an opaque asset and never sees its asset references.
  const result = await queueTask(
    "decodeDraco",
    [buffer, config, dracoWasmUrl],
    { transfer: [buffer] },
  );
  return createDracoGeometry(result);
}
