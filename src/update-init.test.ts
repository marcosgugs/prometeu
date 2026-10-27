import { afterEach, expect, it, vi } from "vitest";

const host = vi.hoisted(() => ({ linux: false, track: vi.fn() }));
const button = vi.hoisted(() => ({
  dataset: {}, textContent: "", title: "", disabled: false, hidden: true,
  classList: { toggle: vi.fn() }, addEventListener: vi.fn(),
}));
vi.mock("./platform", async (original) => ({ ...await original<object>(), get linux() { return host.linux; } }));
vi.mock("./util", async (original) => ({ ...await original<object>(), $: () => button }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: async () => "0.13.0", getBundleType: vi.fn() }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn(async () => null) }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));
vi.mock("./analytics", () => ({ track: host.track }));

import { getBundleType } from "@tauri-apps/api/app";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { init } from "./update";

afterEach(() => {
  vi.clearAllMocks();
  vi.clearAllTimers();
  vi.useRealTimers();
});

it.each([
  [false, null, true],
  [true, "appimage", true],
  [true, "deb", false],
  [true, "rpm", false],
  [true, null, false],
  [true, "error", false],
])("starts updater only for supported installations (linux=%s, bundle=%s)", async (linux, bundle, enabled) => {
  vi.useFakeTimers();
  vi.mocked(getBundleType).mockReset();
  host.linux = linux;
  if (bundle === "error") vi.mocked(getBundleType).mockRejectedValueOnce(new Error("Unavailable"));
  else vi.mocked(getBundleType).mockResolvedValueOnce(bundle as Awaited<ReturnType<typeof getBundleType>>);

  await init(vi.fn(), async () => true);
  await vi.advanceTimersByTimeAsync(0);
  expect(check).toHaveBeenCalledTimes(enabled ? 1 : 0);
  expect(getBundleType).toHaveBeenCalledTimes(linux ? 1 : 0);
  expect(button.disabled).toBe(!enabled);
  await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
  expect(check).toHaveBeenCalledTimes(enabled ? 2 : 0);
  expect(host.track).not.toHaveBeenCalled();
});

it("records restart intent before the process replacement can settle", async () => {
  vi.useFakeTimers();
  host.linux = false;
  vi.mocked(check).mockResolvedValue({ version: "0.34.0", downloadAndInstall: async () => {} } as Awaited<ReturnType<typeof check>>);
  vi.mocked(relaunch).mockImplementation(() => new Promise(() => {}));
  await init(vi.fn(), async () => true);
  await vi.advanceTimersByTimeAsync(0);
  expect(button.dataset).toEqual({ track: "update.install" });
  const click = button.addEventListener.mock.calls.find(([event]) => event === "click")![1] as () => void;
  click();
  await vi.advanceTimersByTimeAsync(0);
  expect(host.track).toHaveBeenCalledWith({ name: "update_action_used", action: "install" });
  expect(button.dataset).toEqual({ track: "update.restart" });
  click();
  // Restarting waits for the answer to whether local work may be cut off.
  await vi.advanceTimersByTimeAsync(0);
  expect(relaunch).toHaveBeenCalledOnce();
  expect(host.track).toHaveBeenLastCalledWith({ name: "update_action_used", action: "restart" });
});
