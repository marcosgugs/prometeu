import { describe, expect, it, vi } from "vitest";

const host = vi.hoisted(() => ({ mac: true }));
vi.mock("./platform", async (original) => ({ ...await original<object>(), get mac() { return host.mac; } }));
vi.mock("./analytics", () => ({ track: vi.fn() }));

import { desktopApplicationMenu } from "./appmenu";

/// Record which items the application menu asks for, without building the native menu.
function items() {
  const made: string[] = [];
  const record = (name: string) => {
    made.push(name);
    return Promise.resolve({} as never);
  };
  desktopApplicationMenu({
    native: (item) => record(typeof item === "string" ? item : Object.keys(item)[0]),
    settings: () => record("settings"),
    quit: () => record("app quit"),
  });
  return made;
}

describe("application menu", () => {
  it("quits the Mac through the app's own item, which can ask first", () => {
    host.mac = true;
    expect(items()).toContain("app quit");
    expect(items()).not.toContain("Quit");
  });

  it("adds no quit shortcut where the system has no Quit item", () => {
    host.mac = false;
    expect(items()).not.toContain("app quit");
  });
});
