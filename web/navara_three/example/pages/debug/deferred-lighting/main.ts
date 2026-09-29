import ThreeView from "@navaramap/three";

import { run, type CustomDescriptions } from "./run";

const view = new ThreeView<CustomDescriptions>({
  debug: true,
  shadow: true,
  // On-demand rendering would not redraw after a pane toggle.
  animation: true,
});
run(view);
