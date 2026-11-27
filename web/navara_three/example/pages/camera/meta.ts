import type { DevPageMeta } from "../../helpers/devPageMeta";

export default {
  covers: [
    "crates/navara_camera",
    "crates/navara_input",
    "web/navara_three/src/camera*",
    "web/navara_three/src/input*",
  ],
  lookFor:
    "Panes drive each camera API on GSI terrain over Tokyo (setCamera, move by direction, flyTo with duration/easing/max height/distance, lookAt, rotateAroundAxis, and the spin/zoom/tilt control options): the camera should end where the pane says, the parameter readout should follow `moveend`, and the console logs movestart/move/moveend.",
  params: {},
  evidenceFor: [
    160, 163, 165, 166, 171, 173, 174, 176, 179, 183, 207, 233, 239, 343, 345,
    356, 400, 604, 606, 784,
  ],
} satisfies DevPageMeta;
