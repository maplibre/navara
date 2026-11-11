/**
 * Plain DOM buttons for the curated gallery examples (pages/examples/*).
 *
 * Gallery demos keep their on-map UI to a few minimal buttons that match the
 * neutral basemap, instead of a Tweakpane panel (Tweakpane stays on the
 * dev/debug pages). Buttons stack in a fixed bar at the top-left corner.
 *
 * The returned element is a plain HTMLButtonElement: reflect state from the
 * example by assigning `textContent`, `disabled` and `onclick` directly, so
 * the example code stays free of styling concerns.
 */

const BUTTON_BAR_CLASS = "example-button-bar";
const BUTTON_CLASS = "example-button";
const SLIDER_CLASS = "example-slider";
const SWITCH_CLASS = "example-switch";
const READOUT_CLASS = "example-readout";
const CHECKBOX_CLASS = "example-checkbox";

const BUTTON_CSS = `
.${BUTTON_BAR_CLASS} {
  position: fixed;
  top: 16px;
  left: 16px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  /* Wrap onto more rows on a narrow screen instead of running off it. */
  max-width: calc(100vw - 32px);
  font-family: system-ui, sans-serif;
}
.${BUTTON_BAR_CLASS}--right {
  left: auto;
  right: 16px;
  justify-content: flex-end;
}
.${BUTTON_CLASS} {
  padding: 8px 14px;
  font-size: 13px;
  color: #333;
  background: #fff;
  border: 1px solid #d4d7da;
  border-radius: 8px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
  cursor: pointer;
}
.${BUTTON_CLASS}:hover:not(:disabled) {
  background: #f5f6f7;
}
.${BUTTON_CLASS}:disabled {
  opacity: 0.5;
  cursor: default;
}
.${SLIDER_CLASS} {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  font-size: 13px;
  color: #333;
  background: #fff;
  border: 1px solid #d4d7da;
  border-radius: 8px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
}
.${SLIDER_CLASS} input[type="range"] {
  cursor: pointer;
}
.${SLIDER_CLASS} .value {
  min-width: 3.5em;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.${SWITCH_CLASS} {
  display: flex;
  overflow: hidden;
  background: #fff;
  border: 1px solid #d4d7da;
  border-radius: 8px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
}
.${SWITCH_CLASS} button {
  padding: 8px 14px;
  font-size: 13px;
  color: #333;
  background: transparent;
  border: none;
  border-left: 1px solid #e5e7e9;
  cursor: pointer;
}
.${SWITCH_CLASS} button:first-child {
  border-left: none;
}
.${SWITCH_CLASS} button:hover[aria-pressed="false"] {
  background: #f5f6f7;
}
.${SWITCH_CLASS} button[aria-pressed="true"] {
  color: #fff;
  background: #0091ff;
  cursor: default;
}
.${READOUT_CLASS} {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  font-size: 13px;
  color: #333;
  background: #fff;
  border: 1px solid #d4d7da;
  border-radius: 8px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
}
.${READOUT_CLASS} .value {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.${CHECKBOX_CLASS} {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  font-size: 13px;
  color: #333;
  background: #fff;
  border: 1px solid #d4d7da;
  border-radius: 8px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
  cursor: pointer;
}
.${CHECKBOX_CLASS} input[type="checkbox"] {
  accent-color: #0091ff;
  cursor: pointer;
}
`;

let buttonBar: HTMLDivElement | undefined;

const ensureButtonBar = (): HTMLDivElement => {
  if (buttonBar) return buttonBar;
  const style = document.createElement("style");
  style.textContent = BUTTON_CSS;
  document.head.appendChild(style);
  buttonBar = document.createElement("div");
  buttonBar.className = BUTTON_BAR_CLASS;
  document.body.appendChild(buttonBar);
  return buttonBar;
};

/**
 * Appends a styled button to the shared top-left button bar and returns it.
 * The bar and its stylesheet are created on the first call.
 */
export const addButton = (
  label: string,
  onClick?: () => void,
): HTMLButtonElement => {
  const button = document.createElement("button");
  button.className = BUTTON_CLASS;
  button.textContent = label;
  if (onClick) button.onclick = onClick;
  ensureButtonBar().appendChild(button);
  return button;
};

/**
 * Appends a segmented switch to the shared button bar: one labeled segment per
 * option, the selected one highlighted. `onChange` fires with the index of the
 * newly picked option (never for the already-selected one), so the example only
 * states what each option does — not the DOM wiring.
 *
 * `align: "right"` puts the control bar in the top-right corner instead, for
 * pages whose top-left holds something the controls would sit on top of.
 */
export const addSwitch = (
  labels: string[],
  selectedIndex: number,
  onChange: (index: number) => void,
  options: { align?: "left" | "right" } = {},
): void => {
  const wrapper = document.createElement("div");
  wrapper.className = SWITCH_CLASS;

  const segments = labels.map((label, index) => {
    const segment = document.createElement("button");
    segment.textContent = label;
    segment.setAttribute("aria-pressed", String(index === selectedIndex));
    segment.onclick = () => {
      if (segment.getAttribute("aria-pressed") === "true") return;
      for (const other of segments) {
        other.setAttribute("aria-pressed", String(other === segment));
      }
      onChange(index);
    };
    wrapper.appendChild(segment);
    return segment;
  });

  const bar = ensureButtonBar();
  bar.classList.toggle(`${BUTTON_BAR_CLASS}--right`, options.align === "right");
  bar.appendChild(wrapper);
};

/**
 * Appends a labeled read-only value chip to the shared button bar and returns
 * the value element. The example reflects state by assigning `textContent` to
 * the returned element, so no formatting or DOM wiring leaks into main.ts.
 */
export const addReadout = (
  label: string,
  initialValue = "—",
): HTMLSpanElement => {
  const wrapper = document.createElement("div");
  wrapper.className = READOUT_CLASS;

  const name = document.createElement("span");
  name.textContent = label;

  const value = document.createElement("span");
  value.className = "value";
  value.textContent = initialValue;

  wrapper.append(name, value);
  ensureButtonBar().appendChild(wrapper);
  return value;
};

/**
 * Appends a labeled checkbox to the shared button bar and returns the input.
 * `onChange` fires with the new checked state, so the example only states what
 * the toggle does — not the DOM wiring.
 */
export const addCheckbox = (
  label: string,
  checked: boolean,
  onChange: (checked: boolean) => void,
): HTMLInputElement => {
  const wrapper = document.createElement("label");
  wrapper.className = CHECKBOX_CLASS;

  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  input.onchange = () => onChange(input.checked);

  const name = document.createElement("span");
  name.textContent = label;

  wrapper.append(input, name);
  ensureButtonBar().appendChild(wrapper);
  return input;
};

/**
 * Appends a labeled range slider to the shared button bar. The live value
 * (with `unit`) is shown next to the track and `onInput` fires on every drag,
 * so the example only states what to do with the value — not the DOM wiring.
 */
export const addSlider = (
  label: string,
  options: {
    min: number;
    max: number;
    value: number;
    step?: number;
    unit?: string;
  },
  onInput: (value: number) => void,
): HTMLInputElement => {
  const wrapper = document.createElement("label");
  wrapper.className = SLIDER_CLASS;

  const name = document.createElement("span");
  name.textContent = label;

  const input = document.createElement("input");
  input.type = "range";
  input.min = String(options.min);
  input.max = String(options.max);
  input.step = String(options.step ?? 1);
  input.value = String(options.value);

  const readout = document.createElement("span");
  readout.className = "value";
  const unit = options.unit ?? "";
  const render = (value: number) => {
    readout.textContent = `${value}${unit}`;
  };
  render(options.value);

  input.oninput = () => {
    const value = Number(input.value);
    render(value);
    onInput(value);
  };

  wrapper.append(name, input, readout);
  ensureButtonBar().appendChild(wrapper);
  return input;
};
