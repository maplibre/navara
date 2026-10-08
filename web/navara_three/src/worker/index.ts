import { registerTasks } from "@navaramap/worker";

import { computeVertexNormals } from "./tasks/computeVertexNormals";
import { decodeDraco } from "./tasks/decodeDraco";
import { toCreasedNormals } from "./tasks/toCreasedNormals";

const tasks = {
  toCreasedNormals,
  computeVertexNormals,
  decodeDraco,
};

export type Tasks = typeof tasks;

registerTasks(tasks);
