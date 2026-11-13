import ThreeView from "@navaramap/three";

import { run, type CustomDescriptions } from "./run";

const view = new ThreeView<CustomDescriptions>({
  shadow: true,
  animation: true,
});
run(view);
