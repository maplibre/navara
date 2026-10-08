/**
 * Top-right controls help for the curated gallery examples (pages/examples/*):
 * a "?" button that toggles a card listing the example's input bindings.
 * Presentation only — no Navara API here.
 */

const CONTROLS_CSS = `
.example-controls-help {
  position: fixed;
  top: 12px;
  right: 12px;
  z-index: 20;
  font-family: system-ui, sans-serif;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 5px;
}
.example-controls-help__toggle {
  width: 22px;
  height: 22px;
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
  color: #eaeef4;
  background: rgba(20, 24, 31, 0.8);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 50%;
  cursor: pointer;
}
.example-controls-help__toggle:hover {
  background: rgba(40, 46, 57, 0.9);
}
.example-controls-help__card {
  min-width: 132px;
  padding: 7px 9px;
  font-size: 10px;
  line-height: 1.35;
  color: #d7dce4;
  background: rgba(20, 24, 31, 0.8);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 7px;
  backdrop-filter: blur(4px);
}
.example-controls-help__title {
  margin-bottom: 5px;
  font-size: 9px;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: #9aa3b0;
}
.example-controls-help__row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 1px 0;
}
.example-controls-help__row kbd {
  font-family: ui-monospace, Menlo, monospace;
  font-size: 9px;
  color: #ffffff;
}
`;

/** One row of the card: what the input does, then the input itself. */
export type ControlBinding = [label: string, input: string];

export type ControlsHelp = {
  /** Expand the card. */
  show(): void;
  /** Collapse the card back to just the "?" button. */
  hide(): void;
  /** Replace the card's title and rows. */
  setBindings(title: string, bindings: ControlBinding[]): void;
};

/**
 * Adds the "?" button and its card (shown initially) to the top-right corner.
 */
export const addControlsHelp = (
  title: string,
  bindings: ControlBinding[],
): ControlsHelp => {
  const style = document.createElement("style");
  style.textContent = CONTROLS_CSS;
  document.head.appendChild(style);

  const root = document.createElement("div");
  root.className = "example-controls-help";

  const card = document.createElement("div");
  card.className = "example-controls-help__card";
  const setBindings = (title: string, bindings: ControlBinding[]) => {
    card.innerHTML =
      `<div class="example-controls-help__title">${title}</div>` +
      bindings
        .map(
          ([label, input]) =>
            `<div class="example-controls-help__row"><span>${label}</span><kbd>${input}</kbd></div>`,
        )
        .join("");
  };
  setBindings(title, bindings);

  const toggle = document.createElement("button");
  toggle.className = "example-controls-help__toggle";
  toggle.textContent = "?";
  toggle.title = "Toggle controls";
  toggle.onclick = () => {
    card.style.display = card.style.display === "none" ? "" : "none";
  };

  root.append(toggle, card);
  document.body.appendChild(root);

  return {
    show() {
      card.style.display = "";
    },
    hide() {
      card.style.display = "none";
    },
    setBindings,
  };
};
