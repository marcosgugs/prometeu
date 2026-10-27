import { describe, expect, it, vi } from "vitest";
import type { DockState } from "./types";

// Terminal views need a browser; which shells get a tab depends on dock state alone.
vi.mock("./dock", () => ({}));
vi.mock("./ipc", () => ({ invoke: vi.fn() }));
import { shellTabs } from "./dockbar";

describe("shell tabs", () => {
  it("drop a shell that exited while its owner was off screen", () => {
    const docks: DockState[] = [
      { kind: "terminal-3", alive: true },
      { kind: "terminal-2", alive: false },
      { kind: "terminal", alive: true },
    ];
    expect(shellTabs(docks, [])).toEqual(["terminal", "terminal-3"]);
  });

  it("keep pending shells in number order and leave Setup and Run to the side panel", () => {
    const docks: DockState[] = [
      { kind: "setup", alive: false },
      { kind: "run", alive: true },
      { kind: "terminal-3", alive: true },
    ];
    expect(shellTabs(docks, ["terminal-3", "terminal-2"])).toEqual(["terminal-2", "terminal-3"]);
  });
});
