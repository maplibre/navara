import { describe, it, expect, vi, afterEach } from "vitest";

import { AttributionPlugin } from "./index";

// Importing the real @navaramap/core touches WASM/os at module load, which fails
// in the test environment. AttributionPlugin only needs `Plugin` as a runtime
// base class (everything else it imports is type-only), so stub the module.
/* eslint-disable @typescript-eslint/no-extraneous-class */
vi.mock("@navaramap/core", () => ({
  Plugin: class Plugin {},
}));
/* eslint-enable @typescript-eslint/no-extraneous-class */

type Handler = (arg?: unknown) => void;

function makeLayer(id: string) {
  const handlers = new Map<string, Set<Handler>>();
  return {
    id,
    on: vi.fn((e: string, cb: Handler) => {
      const set = handlers.get(e) ?? new Set<Handler>();
      set.add(cb);
      handlers.set(e, set);
    }),
    off: vi.fn((e: string, cb: Handler) => {
      handlers.get(e)?.delete(cb);
    }),
    emit(e: string, arg: unknown) {
      handlers.get(e)?.forEach((cb) => cb(arg));
    },
  };
}
type FakeLayer = ReturnType<typeof makeLayer>;

function makeView(
  layers: Record<string, FakeLayer> = {},
  container: HTMLElement = document.body.appendChild(
    document.createElement("div"),
  ),
) {
  const handlers = new Map<string, Set<Handler>>();
  return {
    canvas: container.appendChild(document.createElement("canvas")),
    camera: { zoom: 10 },
    on: vi.fn((e: string, cb: Handler) => {
      const set = handlers.get(e) ?? new Set<Handler>();
      set.add(cb);
      handlers.set(e, set);
    }),
    off: vi.fn((e: string, cb: Handler) => {
      handlers.get(e)?.delete(cb);
    }),
    findLayerById: vi.fn((id: string): FakeLayer | undefined => layers[id]),
  };
}

const created: AttributionPlugin[] = [];
async function setup(layers?: Record<string, FakeLayer>) {
  const view = makeView(layers);
  const plugin = new AttributionPlugin();
  created.push(plugin);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await plugin.init(view as any, {} as any);
  return { plugin, view };
}

afterEach(() => {
  created.forEach((p) => p.dispose());
  created.length = 0;
  document.body.replaceChildren();
});

const q = (sel: string): Element | null => document.querySelector(sel);
const isHidden = (sel: string): boolean =>
  q(sel)?.hasAttribute("hidden") ?? true;

/** All top-level source names currently rendered in the list. */
function allTopLevelCredits(): string[] {
  return Array.from(
    document.querySelectorAll(
      ".navara-attr-list > li.navara-attr-item > .navara-attr-name",
    ),
  ).map((el) => el.textContent?.trim() ?? "");
}

/**
 * User-added top-level credits, i.e. everything except the built-in "Navara"
 * credit that is always shown first.
 */
function topLevelCredits(): string[] {
  return allTopLevelCredits().filter((name) => name !== "Navara");
}

/** Nested sub-credit texts (zoom-banded children + dynamic layer credits). */
function subCredits(): string[] {
  return Array.from(document.querySelectorAll(".navara-attr-related > li")).map(
    (el) => el.textContent?.trim() ?? "",
  );
}

describe("AttributionPlugin set management", () => {
  it("renders added sources and drops exact duplicates", async () => {
    const { plugin } = await setup();
    plugin.add([{ attribution: "A" }, { attribution: "B" }]);
    plugin.add([{ attribution: "A" }]); // duplicate — should not double
    expect(topLevelCredits()).toEqual(["A", "B"]);
  });

  it("remove drops a structurally-matching entry and ignores unmatched", async () => {
    const { plugin } = await setup();
    plugin.add([{ attribution: "A" }, { attribution: "B" }]);
    plugin.remove([{ attribution: "A" }]);
    expect(topLevelCredits()).toEqual(["B"]);
    plugin.remove([{ attribution: "does-not-exist" }]);
    expect(topLevelCredits()).toEqual(["B"]);
  });

  it("clear drops user credits but keeps the dock + Navara; hides the logo frame", async () => {
    const { plugin } = await setup();
    plugin.add([{ attribution: "A", logo: "/a.png" }]);
    expect(isHidden(".navara-attr-dock")).toBe(false);
    expect(
      document.querySelectorAll(".navara-attr-logoframe img"),
    ).toHaveLength(1);

    plugin.clear();
    expect(topLevelCredits()).toEqual([]);
    // Dock and the built-in Navara credit stay; the logo frame hides (no logos).
    expect(isHidden(".navara-attr-dock")).toBe(false);
    expect(allTopLevelCredits()).toEqual(["Navara"]);
    expect(isHidden(".navara-attr-logoframe")).toBe(true);
  });
});

describe("AttributionPlugin built-in Navara credit", () => {
  it("shows the dock with the Navara credit even with no user credits", async () => {
    await setup();
    expect(q(".navara-attr-dock")).not.toBeNull();
    expect(isHidden(".navara-attr-dock")).toBe(false);
    expect(allTopLevelCredits()).toEqual(["Navara"]);
    // No logos declared, so the logo frame stays hidden.
    expect(isHidden(".navara-attr-logoframe")).toBe(true);
  });

  it("keeps the dock + Navara visible after all user credits are removed", async () => {
    const { plugin } = await setup();
    plugin.add([{ attribution: "A" }]);
    expect(allTopLevelCredits()).toEqual(["Navara", "A"]);
    plugin.remove([{ attribution: "A" }]);
    expect(isHidden(".navara-attr-dock")).toBe(false);
    expect(allTopLevelCredits()).toEqual(["Navara"]);
  });
});

describe("AttributionPlugin popover visibility", () => {
  it("is collapsed by default and show()/hide() toggle card + aria-expanded", async () => {
    const { plugin } = await setup();
    plugin.add([{ attribution: "A" }]);
    expect(isHidden(".navara-attr-card")).toBe(true);
    expect(q(".navara-attr-toggle")?.getAttribute("aria-expanded")).toBe(
      "false",
    );

    plugin.show();
    expect(isHidden(".navara-attr-card")).toBe(false);
    expect(q(".navara-attr-toggle")?.getAttribute("aria-expanded")).toBe(
      "true",
    );

    plugin.hide();
    expect(isHidden(".navara-attr-card")).toBe(true);
    expect(q(".navara-attr-toggle")?.getAttribute("aria-expanded")).toBe(
      "false",
    );
  });

  it("keeps an open/closed intent set before the DOM exists", async () => {
    const view = makeView();
    const plugin = new AttributionPlugin();
    created.push(plugin);
    plugin.show(); // recorded before init/DOM — must not be lost
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await plugin.init(view as any, {} as any);
    plugin.add([{ attribution: "A" }]);
    expect(isHidden(".navara-attr-card")).toBe(false);
  });
});

describe("AttributionPlugin lifecycle", () => {
  it("dispose removes the DOM and clears content", async () => {
    const { plugin } = await setup();
    plugin.add([{ attribution: "A" }]);
    expect(q(".navara-attr-dock")).not.toBeNull();

    plugin.dispose();
    expect(q(".navara-attr-dock")).toBeNull();
    expect(q(".navara-attr-logoframe")).toBeNull();
  });

  it("mounts in the canvas container and positions against it until disposed", async () => {
    const { plugin, view } = await setup();
    const container = view.canvas.parentElement;
    expect(q(".navara-attr-dock")?.parentElement).toBe(container);
    expect(q(".navara-attr-logoframe")?.parentElement).toBe(container);
    expect(container?.style.position).toBe("relative");

    plugin.dispose();
    expect(container?.style.position).toBe("");
  });

  it("anchors to the viewport when the canvas sits directly in <body>", async () => {
    const plugin = new AttributionPlugin();
    created.push(plugin);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await plugin.init(makeView({}, document.body) as any, {} as any);
    expect(
      q(".navara-attr-dock")?.classList.contains("navara-attr-dock--fixed"),
    ).toBe(true);
    expect(document.body.style.position).toBe("");
  });
});

describe("AttributionPlugin dynamic layer credits", () => {
  it("keeps tracked per-feature credits across an unrelated add", async () => {
    const layer = makeLayer("L");
    const { plugin } = await setup({ L: layer });
    plugin.add([{ attribution: "Base", creditLayerId: "L" }]);
    plugin.show(); // sub-credits only render while the popover is open

    layer.emit("featureCreated", { featureSetId: 1n, credit: "DynCredit" });
    expect(subCredits()).toContain("DynCredit");

    // Adding an unrelated static source must not retrack (and wipe) layer L.
    plugin.add([{ attribution: "Extra" }]);
    expect(topLevelCredits()).toEqual(["Base", "Extra"]);
    expect(subCredits()).toContain("DynCredit");
  });
});
