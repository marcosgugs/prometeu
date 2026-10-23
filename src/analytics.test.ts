import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./ipc", () => ({ invoke: vi.fn(() => Promise.resolve()) }));

import { invoke } from "./ipc";
import { t, use } from "./i18n";
import { labelKey, trackClicks, viewScreen } from "./analytics";

use("en");
beforeEach(() => vi.mocked(invoke).mockClear());

type Spec = { tag?: string; id?: string; role?: string; aria?: string; title?: string; text?: string; t?: string };
type Node = Element & { spec: Spec };

/** Only what analytics reads from an element; tests run without a DOM. `closest` understands the
 * tag, `[role=…]` and `tag[type=…]` selectors analytics uses. */
function node(spec: Spec, parent: Node | null = null): Node {
  const attributes: Record<string, string | undefined> = { role: spec.role, "aria-label": spec.aria, title: spec.title };
  const el = {
    spec, id: spec.id ?? "", tagName: (spec.tag ?? "div").toUpperCase(), parentElement: parent,
    dataset: { t: spec.t }, textContent: spec.text ?? "",
    getAttribute: (name: string) => attributes[name] ?? null,
    querySelector: () => null,
    closest(selector: string) {
      for (let at: Node | null = el; at; at = at.parentElement as Node | null) {
        if (selector.split(",").some(part => matches(at!, part))) return at;
      }
      return null;
    },
  } as unknown as Node;
  return el;
}

function matches(el: Node, selector: string) {
  const role = /^\[role=(\w+)\]$/.exec(selector);
  if (role) return el.spec.role === role[1];
  return el.tagName.toLowerCase() === selector && !selector.includes("[");
}

/** A document whose static IDs are the given nodes; returns a function that clicks a node. */
function page(stable: Node[]) {
  let listener: (event: { target: Node }) => void = () => {};
  trackClicks({
    querySelectorAll: () => stable,
    addEventListener: (_: string, run: typeof listener) => { listener = run; },
  } as unknown as Document);
  return (target: Node) => listener({ target });
}

const sent = () => vi.mocked(invoke).mock.calls.map(([, args]) => (args as { event: unknown }).event);

describe("click labels", () => {
  // Shared translations resolve to the first key in the catalog; `area` tells them apart.
  it("sends the catalog key whose translation the label equals", () => {
    expect(labelKey(node({ title: t("top.settings") }))).toBe("top.settings");
    expect(labelKey(node({ text: "  Desk \n" }))).toBe("rail.desk");
    expect(labelKey(node({ t: "nav.back" }))).toBe("nav.back");
  });

  it("never turns visible text outside the catalog into a target", () => {
    expect(labelKey(node({ text: "fix login bug in acme-payments" }))).toBeNull();
    expect(labelKey(node({ aria: "/Users/someone/repo", t: "not.a.key" }))).toBeNull();
  });
});

describe("click capture", () => {
  it("records the control, its label key and its static region", () => {
    const rail = node({ id: "rail" });
    const click = page([rail]);
    const settings = node({ tag: "button", aria: t("top.settings") }, rail);
    click(node({ tag: "span" }, settings));
    expect(sent()).toEqual([{ name: "ui_clicked", control: "button", target: "top.settings", area: "rail" }]);
  });

  it("marks clicks inside menus and maps their role", () => {
    const click = page([node({ id: "rail" })]);
    const menu = node({ role: "menu" });
    click(node({ tag: "button", role: "menuitem", text: t("nav.back") }, menu));
    expect(sent()).toEqual([{ name: "ui_clicked", control: "menuitem", target: "nav.back", area: "menu" }]);
  });

  it("drops labels and IDs created after startup", () => {
    const tiles = node({ id: "tiles" });
    const click = page([tiles]);
    click(node({ tag: "a", id: "workspace-acme-payments", text: "acme-payments" }, tiles));
    expect(sent()).toEqual([{ name: "ui_clicked", control: "link", target: null, area: "tiles" }]);
  });

  it("ignores clicks outside controls", () => {
    const click = page([]);
    click(node({ text: "agent output" }));
    expect(sent()).toEqual([]);
  });
});

describe("screen views", () => {
  it("counts changes, not repeats", () => {
    viewScreen("desk");
    viewScreen("desk");
    viewScreen("workspace");
    viewScreen("workspace");
    viewScreen("desk");
    expect(sent().map(event => (event as { screen: string }).screen)).toEqual(["desk", "workspace", "desk"]);
  });
});
