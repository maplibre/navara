import { FONT, PANEL_BACKGROUND } from "./slider";

const SVG = "http://www.w3.org/2000/svg";
const CHART_WIDTH = 256;
const CHART_HEIGHT = 72;
const ACCENT = "#4fc3f7";

const TONES = {
  wet: { background: "#1e88e5", text: "Under water" },
  dry: { background: "#616161", text: "Dry now" },
  max: { background: "#8e24aa", text: "Highest over the flood" },
  never: { background: "#424242", text: "The water never reaches here" },
};

/** What the pick panel shows; presentation only. */
export type PickContent = {
  lng: number;
  lat: number;
  tone: keyof typeof TONES;
  /** The figure shown large, such as the depth. */
  headline?: { label: string; value: string };
  rows: { label: string; value: string }[];
  /** A value over time, with gaps where it has none. */
  chart?: {
    title: string;
    /** Each value's place along the time axis, 0 to 1. */
    xs: number[];
    values: (number | undefined)[];
    /** Whether the axis starts at the lowest value rather than 0. */
    fromLowest?: boolean;
    /** The time shown, 0 to 1, or none for the flood as a whole. */
    cursor?: number;
    from: string;
    to: string;
  };
};

const element = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  style: Partial<CSSStyleDeclaration>,
  text?: string,
) => {
  const node = document.createElement(tag);
  Object.assign(node.style, style);
  if (text !== undefined) node.textContent = text;
  return node;
};

const svg = <K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Record<string, string | number>,
) => {
  const node = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attributes)) {
    node.setAttribute(key, String(value));
  }
  return node;
};

/** The chart of a value over time: a line with the area below it filled. */
const chartOf = ({
  title,
  xs,
  values,
  fromLowest,
  cursor,
  from,
  to,
}: NonNullable<PickContent["chart"]>) => {
  const box = element("div", {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
  });
  const defined = values.filter((v): v is number => v !== undefined);
  const bottom = fromLowest ? Math.min(...defined) : 0;
  const top = Math.max(...defined, bottom + 0.1);
  const x = (i: number) => xs[i] * CHART_WIDTH;
  const y = (v: number) =>
    CHART_HEIGHT - ((v - bottom) / (top - bottom)) * (CHART_HEIGHT - 4);
  const digits = top - bottom < 10 ? 1 : 0;
  const header = element("div", {
    display: "flex",
    justifyContent: "space-between",
    opacity: "0.8",
  });
  header.append(
    element("span", {}, title),
    element(
      "span",
      {},
      fromLowest
        ? `${bottom.toFixed(digits)} – ${top.toFixed(digits)}`
        : top.toFixed(digits),
    ),
  );
  const chart = svg("svg", {
    width: CHART_WIDTH,
    height: CHART_HEIGHT,
    viewBox: `0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`,
  });
  chart.style.display = "block";
  chart.append(
    svg("line", {
      x1: 0,
      x2: CHART_WIDTH,
      y1: CHART_HEIGHT - 0.5,
      y2: CHART_HEIGHT - 0.5,
      stroke: "rgba(255, 255, 255, 0.3)",
    }),
  );
  // One line and area per run of values, broken where the point is dry.
  let run: number[] = [];
  const flush = () => {
    if (run.length) {
      const line = run.map((i) => `${x(i)},${y(values[i] ?? 0)}`).join(" L");
      chart.append(
        svg("path", {
          d: `M${x(run[0])},${CHART_HEIGHT} L${line} L${x(run[run.length - 1])},${CHART_HEIGHT} Z`,
          fill: ACCENT,
          "fill-opacity": 0.25,
        }),
        svg("path", {
          d: `M${line}`,
          fill: "none",
          stroke: ACCENT,
          "stroke-width": 1.5,
        }),
      );
    }
    run = [];
  };
  values.forEach((v, i) => (v === undefined ? flush() : run.push(i)));
  flush();
  if (cursor !== undefined) {
    chart.append(
      svg("line", {
        x1: cursor * CHART_WIDTH,
        x2: cursor * CHART_WIDTH,
        y1: 0,
        y2: CHART_HEIGHT,
        stroke: "#fff",
        "stroke-width": 1,
        "stroke-dasharray": "3 2",
      }),
    );
  }
  const axis = element("div", {
    display: "flex",
    justifyContent: "space-between",
    opacity: "0.6",
    fontSize: "11px",
  });
  axis.append(element("span", {}, from), element("span", {}, to));
  box.append(header, chart, axis);
  return box;
};

/**
 * A panel in the top-right corner describing the picked point; `show(null)`
 * hides it, and its close button calls `onClose`.
 */
export const addPickPanel = (onClose: () => void) => {
  const panel = element("div", {
    position: "fixed",
    top: "16px",
    right: "16px",
    display: "none",
    flexDirection: "column",
    gap: "8px",
    boxSizing: "border-box",
    width: `${CHART_WIDTH + 24}px`,
    maxWidth: "calc(100vw - 32px)",
    padding: "12px",
    color: "#fff",
    background: PANEL_BACKGROUND,
    backdropFilter: "blur(8px)",
    borderRadius: "10px",
    font: FONT,
    fontSize: "12px",
    fontVariantNumeric: "tabular-nums",
  });
  document.body.appendChild(panel);

  return (content: PickContent | null) => {
    panel.style.display = content ? "flex" : "none";
    if (!content) return;
    const header = element("div", {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
    });
    const close = element(
      "button",
      {
        padding: "0 4px",
        color: "inherit",
        background: "none",
        border: "none",
        cursor: "pointer",
        font: "inherit",
        fontSize: "16px",
        lineHeight: "1",
      },
      "×",
    );
    close.title = "Clear the picked point";
    close.onclick = onClose;
    header.append(
      element(
        "span",
        { fontWeight: "600", letterSpacing: "0.04em" },
        "PICKED POINT",
      ),
      close,
    );
    const where = element(
      "div",
      { opacity: "0.7" },
      `${content.lat.toFixed(5)}° N · ${content.lng.toFixed(5)}° E`,
    );
    const tone = TONES[content.tone];
    const chip = element(
      "span",
      {
        alignSelf: "flex-start",
        padding: "2px 8px",
        background: tone.background,
        borderRadius: "999px",
        fontWeight: "600",
      },
      tone.text,
    );
    panel.replaceChildren(header, where, chip);
    if (content.headline) {
      const headline = element("div", {
        display: "flex",
        alignItems: "baseline",
        gap: "8px",
      });
      headline.append(
        element(
          "span",
          { fontSize: "26px", fontWeight: "700" },
          content.headline.value,
        ),
        element("span", { opacity: "0.7" }, content.headline.label),
      );
      panel.append(headline);
    }
    if (content.rows.length) {
      const table = element("div", {
        display: "grid",
        gridTemplateColumns: "1fr auto",
        columnGap: "12px",
        rowGap: "2px",
      });
      for (const { label, value } of content.rows) {
        table.append(
          element("span", { opacity: "0.7" }, label),
          element("span", { textAlign: "right" }, value),
        );
      }
      panel.append(table);
    }
    if (content.chart) panel.append(chartOf(content.chart));
  };
};
