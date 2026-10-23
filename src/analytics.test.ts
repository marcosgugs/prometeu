import { describe, expect, it, vi } from "vitest";

vi.mock("./ipc", () => ({ invoke: vi.fn() }));

import { t, use } from "./i18n";
import { labelKey } from "./analytics";

use("en");

/** Only the attributes labelKey reads; tests run without a DOM. */
function control(label: { aria?: string; title?: string; text?: string; t?: string }) {
  return {
    dataset: { t: label.t },
    getAttribute: (name: string) => (name === "aria-label" ? label.aria : name === "title" ? label.title : null) ?? null,
    querySelector: () => null,
    textContent: label.text ?? "",
  } as unknown as Element;
}

describe("click labels", () => {
  // Shared translations resolve to the first key in the catalog; `area` tells them apart.
  it("sends the catalog key whose translation the label equals", () => {
    expect(labelKey(control({ title: t("top.settings") }))).toBe("top.settings");
    expect(labelKey(control({ text: "  Desk \n" }))).toBe("rail.desk");
    expect(labelKey(control({ t: "nav.back" }))).toBe("nav.back");
  });

  it("never turns visible text outside the catalog into a target", () => {
    expect(labelKey(control({ text: "fix login bug in acme-payments" }))).toBeNull();
    expect(labelKey(control({ aria: "/Users/someone/repo", t: "not.a.key" }))).toBeNull();
  });
});
