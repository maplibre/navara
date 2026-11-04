import { registerTasks } from "@navaramap/worker";

import { computeVertexNormals } from "./tasks/computeVertexNormals";
import { decodeDraco } from "./tasks/decodeDraco";
import { generateWaveTexture } from "./tasks/generateWaveTexture";
import { toCreasedNormals } from "./tasks/toCreasedNormals";

const tasks = {
  toCreasedNormals,
  computeVertexNormals,
  decodeDraco,
  generateWaveTexture,
};

export type Tasks = typeof tasks;

registerTasks(tasks);
