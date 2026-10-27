/**
 * Bottom-center time slider: a range input plus a label showing the selected
 * time. Presentation only — the example reacts through `onChange`.
 */
export const addTimeSlider = (options: {
  max: number;
  value: number;
  format: (value: number) => string;
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
    width: "min(560px, calc(100vw - 32px))",
    boxSizing: "border-box",
    padding: "8px 14px",
    color: "#fff",
    background: "rgba(20, 24, 28, 0.6)",
    backdropFilter: "blur(8px)",
    borderRadius: "10px",
    font: "13px system-ui, sans-serif",
    fontVariantNumeric: "tabular-nums",
  } satisfies Partial<CSSStyleDeclaration>);

  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = "0";
  slider.max = String(options.max);
  slider.step = "1";
  slider.value = String(options.value);
  Object.assign(slider.style, { flex: "1 1 auto", cursor: "pointer" });

  const label = document.createElement("span");
  label.style.whiteSpace = "nowrap";
  label.textContent = options.format(options.value);

  slider.oninput = () => {
    const value = Number(slider.value);
    label.textContent = options.format(value);
    options.onChange(value);
  };

  bar.append(slider, label);
  document.body.appendChild(bar);
};
