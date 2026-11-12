export const FONT = "13px system-ui, sans-serif";
export const PANEL_BACKGROUND = "rgba(20, 24, 28, 0.6)";

/**
 * Bottom-center time slider: a play button, a range input, a label showing
 * the selected time and a playback rate select. Presentation only — the
 * example reacts through `onChange`, and `setEnabled` turns it off while time
 * does not apply.
 */
export const addTimeSlider = (options: {
  max: number;
  value: number;
  step?: number;
  /**
   * Slider units advanced per second while playing, at the current value;
   * omit to hide the button and the rate select.
   */
  playSpeed?: (value: number) => number;
  /** Multiples of `playSpeed` to choose from, with 1 as the default. */
  rates?: number[];
  format: (value: number) => string;
  /** Tooltip of the label, for what the time counts from. */
  title?: string;
  /** The label while disabled. */
  disabledLabel: string;
  onChange: (value: number) => void;
}) => {
  const bar = document.createElement("div");
  Object.assign(bar.style, {
    position: "fixed",
    bottom: "24px",
    left: "50%",
    transform: "translateX(-50%)",
    display: "flex",
    alignItems: "center",
    gap: "12px",
    width: "min(640px, calc(100vw - 32px))",
    boxSizing: "border-box",
    padding: "10px 16px",
    color: "#fff",
    background: PANEL_BACKGROUND,
    backdropFilter: "blur(8px)",
    borderRadius: "10px",
    font: FONT,
    fontVariantNumeric: "tabular-nums",
  } satisfies Partial<CSSStyleDeclaration>);

  const step = options.step ?? 1;
  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = "0";
  slider.max = String(options.max);
  slider.step = String(step);
  slider.value = String(options.value);
  Object.assign(slider.style, {
    flex: "1 1 0",
    minWidth: "0",
    margin: "0",
    cursor: "pointer",
  } satisfies Partial<CSSStyleDeclaration>);

  const label = document.createElement("span");
  Object.assign(label.style, {
    flex: "0 0 auto",
    whiteSpace: "nowrap",
    textAlign: "right",
  } satisfies Partial<CSSStyleDeclaration>);
  if (options.title) label.title = options.title;
  label.textContent = options.format(options.value);

  // The input snaps its value to `step`, so playback advances this instead.
  let current = options.value;
  const set = (value: number) => {
    current = value;
    slider.value = String(value);
    label.textContent = options.format(value);
    options.onChange(value);
  };
  slider.oninput = () => set(Number(slider.value));

  let pause = () => {};
  let button: HTMLButtonElement | undefined;
  let rateSelect: HTMLSelectElement | undefined;
  let rate = 1;
  if (options.playSpeed !== undefined) {
    const speed = options.playSpeed;
    const play = document.createElement("button");
    button = play;
    Object.assign(play.style, {
      flex: "0 0 auto",
      width: "28px",
      height: "28px",
      padding: "0",
      color: "inherit",
      background: "none",
      border: "none",
      cursor: "pointer",
      font: "inherit",
    } satisfies Partial<CSSStyleDeclaration>);
    let playing = false;
    let last = 0;
    let frame = 0;
    const tick = (now: number) => {
      // The first frame's timestamp can precede the click.
      const elapsed = Math.max(now - last, 0) / 1000;
      const next = current + elapsed * speed(current) * rate;
      last = now;
      set(next >= options.max ? 0 : next);
      frame = requestAnimationFrame(tick);
    };
    const render = () => (play.textContent = playing ? "❚❚" : "▶");
    pause = () => {
      playing = false;
      cancelAnimationFrame(frame);
      render();
    };
    play.onclick = () => {
      playing = !playing;
      render();
      // Cancel the pending frame, so a quick pause and resume runs one loop.
      cancelAnimationFrame(frame);
      if (playing) {
        last = performance.now();
        frame = requestAnimationFrame(tick);
      }
    };
    render();
    bar.append(play);

    const rates = options.rates ?? [0.5, 1, 2, 4, 8];
    const select = document.createElement("select");
    rateSelect = select;
    select.title = "Playback speed";
    Object.assign(select.style, {
      flex: "0 0 auto",
      appearance: "none",
      padding: `2px ${RATE_INSET + CHEVRON_WIDTH + 6}px 2px ${RATE_INSET}px`,
      color: "inherit",
      backgroundColor: "rgba(255, 255, 255, 0.12)",
      backgroundImage: CHEVRON,
      backgroundRepeat: "no-repeat",
      backgroundPosition: `right ${RATE_INSET}px center`,
      border: "none",
      borderRadius: "6px",
      cursor: "pointer",
      font: "inherit",
    } satisfies Partial<CSSStyleDeclaration>);
    for (const r of rates) {
      select.append(new Option(`${r}×`, String(r), false, r === 1));
    }
    select.onchange = () => (rate = Number(select.value));
  }

  bar.append(slider, label);
  if (rateSelect) bar.append(rateSelect);
  document.body.appendChild(bar);

  // The label keeps the width of its widest text, so the slider's track
  // stays put as the time changes.
  const probe = document.createElement("span");
  Object.assign(probe.style, {
    position: "absolute",
    visibility: "hidden",
    whiteSpace: "nowrap",
    font: FONT,
    fontVariantNumeric: "tabular-nums",
  } satisfies Partial<CSSStyleDeclaration>);
  document.body.appendChild(probe);
  let widest = 0;
  for (const text of [
    options.disabledLabel,
    ...Array.from({ length: Math.floor(options.max / step) + 1 }, (_, i) =>
      options.format(i * step),
    ),
  ]) {
    probe.textContent = text;
    widest = Math.max(widest, probe.getBoundingClientRect().width);
  }
  probe.remove();
  label.style.width = `${Math.ceil(widest)}px`;

  return {
    /** Greys the slider out and pauses it, or brings it back. */
    setEnabled: (enabled: boolean) => {
      if (!enabled) pause();
      slider.disabled = !enabled;
      if (button) button.disabled = !enabled;
      if (rateSelect) rateSelect.disabled = !enabled;
      for (const control of [slider, button, rateSelect]) {
        if (control) control.style.cursor = enabled ? "pointer" : "default";
      }
      bar.style.opacity = enabled ? "1" : "0.5";
      bar.title = enabled ? "" : "The coloring shows the flood as a whole.";
      label.textContent = enabled
        ? options.format(current)
        : options.disabledLabel;
    },
  };
};

let panel: HTMLDivElement | undefined;

/** The top-left column the selects and the legend stack in, created once. */
const topLeftPanel = () => {
  if (panel) return panel;
  panel = document.createElement("div");
  Object.assign(panel.style, {
    position: "fixed",
    top: "16px",
    left: "16px",
    display: "flex",
    flexDirection: "column",
    alignItems: "stretch",
    gap: "8px",
    color: "#fff",
    font: FONT,
  } satisfies Partial<CSSStyleDeclaration>);
  document.body.appendChild(panel);
  return panel;
};

const SELECT_INSET = 10;
const RATE_INSET = 8;
const CHEVRON_WIDTH = 10;
const CHEVRON = `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${CHEVRON_WIDTH}" height="6" viewBox="0 0 10 6"><path d="M1 1l4 4 4-4" fill="none" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
)}")`;

/** A select in the top-left panel, below what is there; presentation only. */
export const addSelect = (options: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) => {
  const select = document.createElement("select");
  Object.assign(select.style, {
    boxSizing: "border-box",
    // The native arrow hugs the edge; the chevron sits as far in as the text.
    appearance: "none",
    padding: `6px ${SELECT_INSET + CHEVRON_WIDTH + 8}px 6px ${SELECT_INSET}px`,
    color: "inherit",
    backgroundColor: PANEL_BACKGROUND,
    backgroundImage: CHEVRON,
    backgroundRepeat: "no-repeat",
    backgroundPosition: `right ${SELECT_INSET}px center`,
    backdropFilter: "blur(8px)",
    border: "none",
    borderRadius: "8px",
    font: "inherit",
  } satisfies Partial<CSSStyleDeclaration>);
  for (const { value, label } of options.options) {
    select.append(new Option(label, value, false, value === options.value));
  }
  select.onchange = () => options.onChange(select.value);
  topLeftPanel().appendChild(select);
};

/** A labeled checkbox in the top-left panel, below what is there. */
export const addToggle = (options: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) => {
  const row = document.createElement("label");
  Object.assign(row.style, {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    boxSizing: "border-box",
    padding: `6px ${SELECT_INSET}px`,
    background: PANEL_BACKGROUND,
    backdropFilter: "blur(8px)",
    borderRadius: "8px",
    cursor: "pointer",
  } satisfies Partial<CSSStyleDeclaration>);
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = options.checked;
  Object.assign(input.style, {
    margin: "0",
    accentColor: "#4fc3f7",
    cursor: "pointer",
  } satisfies Partial<CSSStyleDeclaration>);
  input.onchange = () => options.onChange(input.checked);
  row.append(input, options.label);
  topLeftPanel().appendChild(row);
};

export type Legend = {
  title: string;
  /** Classes, top to bottom. */
  rows?: { color: string; label: string }[];
  /** A gradient from the first color to the last, labeled at the ends. */
  gradient?: { colors: string[]; from: string; to: string };
};

/** A legend in the top-left panel, below what is there; `show(null)` hides it. */
export const addLegend = () => {
  const box = document.createElement("div");
  Object.assign(box.style, {
    display: "none",
    flexDirection: "column",
    gap: "6px",
    boxSizing: "border-box",
    padding: "10px 12px",
    background: PANEL_BACKGROUND,
    backdropFilter: "blur(8px)",
    borderRadius: "8px",
    fontSize: "12px",
  } satisfies Partial<CSSStyleDeclaration>);
  topLeftPanel().appendChild(box);
  return (legend: Legend | null) => {
    box.replaceChildren();
    box.style.display = legend ? "flex" : "none";
    if (!legend) return;
    const title = document.createElement("div");
    title.textContent = legend.title;
    title.style.fontWeight = "600";
    box.append(title);
    for (const { color, label } of legend.rows ?? []) {
      const row = document.createElement("div");
      Object.assign(row.style, {
        display: "flex",
        alignItems: "center",
        gap: "8px",
      } satisfies Partial<CSSStyleDeclaration>);
      const swatch = document.createElement("span");
      Object.assign(swatch.style, {
        flex: "0 0 auto",
        width: "14px",
        height: "14px",
        background: color,
        borderRadius: "3px",
      } satisfies Partial<CSSStyleDeclaration>);
      row.append(swatch, label);
      box.append(row);
    }
    if (legend.gradient) {
      const bar = document.createElement("div");
      Object.assign(bar.style, {
        height: "12px",
        borderRadius: "3px",
        background: `linear-gradient(to right, ${legend.gradient.colors.join(", ")})`,
      } satisfies Partial<CSSStyleDeclaration>);
      const labels = document.createElement("div");
      Object.assign(labels.style, {
        display: "flex",
        justifyContent: "space-between",
        gap: "12px",
      } satisfies Partial<CSSStyleDeclaration>);
      for (const text of [legend.gradient.from, legend.gradient.to]) {
        const span = document.createElement("span");
        span.textContent = text;
        labels.append(span);
      }
      box.append(bar, labels);
    }
  };
};

/**
 * A panel in the top-right corner showing lines of text; `show(null)` hides
 * it. Presentation only.
 */
export const addInfo = () => {
  const box = document.createElement("div");
  Object.assign(box.style, {
    position: "fixed",
    top: "16px",
    right: "16px",
    display: "none",
    flexDirection: "column",
    gap: "4px",
    boxSizing: "border-box",
    maxWidth: "min(320px, calc(100vw - 32px))",
    padding: "10px 12px",
    color: "#fff",
    background: PANEL_BACKGROUND,
    backdropFilter: "blur(8px)",
    borderRadius: "8px",
    font: FONT,
    fontSize: "12px",
    fontVariantNumeric: "tabular-nums",
  } satisfies Partial<CSSStyleDeclaration>);
  document.body.appendChild(box);
  return (lines: string[] | null) => {
    box.replaceChildren(
      ...(lines ?? []).map((text) => {
        const line = document.createElement("div");
        line.textContent = text;
        return line;
      }),
    );
    box.style.display = lines ? "flex" : "none";
  };
};
