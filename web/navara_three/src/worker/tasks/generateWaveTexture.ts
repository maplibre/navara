import { transfer } from "@navaramap/worker";

import { encodeWaveTexture } from "../../water/waveTexture";

export function generateWaveTexture() {
  const data = encodeWaveTexture();
  return transfer(data, [data.buffer]);
}
