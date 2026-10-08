/**
 * Controls help for the person-view example: the shared "?" card, switched
 * between the character's and the map camera's bindings. Presentation only —
 * no Navara API here.
 */

import {
  addControlsHelp,
  type ControlBinding,
} from "../../../../helpers/controlsHelp";

// The character walks on the terrain here (collision mode "ground"), so the
// ascend / descend keys are left out — they do nothing in that mode.
const WALKING_BINDINGS: ControlBinding[] = [
  ["Move", "W / S"],
  ["Turn", "A / D"],
  ["Dash", "Shift"],
  ["First ⇄ third person", "V"],
  ["Free orbit", "Alt + drag"],
  ["Release the camera", "Esc"],
];

// While the plugin is stopped none of the above does anything, so the card
// shows what is actually being driven instead: the map camera.
const RELEASED_BINDINGS: ControlBinding[] = [
  ["Orbit", "Drag"],
  ["Zoom", "Scroll"],
  ["Back to the character", "Esc"],
];

export type ControlsHelp = {
  /** Collapse the card back to just the "?" button. */
  hide(): void;
  /**
   * Switch the card between walking the character and driving the map camera,
   * revealing it again on the way out so the key back is never hidden.
   */
  setReleased(released: boolean): void;
};

export const createControlsHelp = (): ControlsHelp => {
  const help = addControlsHelp("Controls", WALKING_BINDINGS);
  return {
    hide: help.hide,
    setReleased(released: boolean) {
      if (released) {
        help.setBindings("Camera", RELEASED_BINDINGS);
        help.show();
      } else {
        help.setBindings("Controls", WALKING_BINDINGS);
      }
    },
  };
};
