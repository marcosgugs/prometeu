import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ invoke: vi.fn(), track: vi.fn(), say: vi.fn() }));
vi.mock("./ipc", () => ({ invoke: state.invoke }));
vi.mock("./analytics", () => ({ track: state.track }));
vi.mock("./agents", () => ({ descriptor: () => ({ authMethods: [{ id: "browser" }] }), descriptors: () => [] }));
vi.mock("./i18n", () => ({ t: (key: string) => key, fromBack: String }));
import { add, init, update } from "./accounts";

beforeEach(() => {
  state.invoke.mockReset(); state.track.mockClear(); state.say.mockClear();
  update({ accounts: [], active: {}, login: null });
  init({ say: state.say, quota: () => "" });
});

it("records login start before authentication settles, including cancelled attempts", async () => {
  let reject!: (error: Error) => void;
  state.invoke.mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
  add("claude");
  expect(state.track).toHaveBeenCalledExactlyOnceWith({ name: "provider_account_action_used", provider: "claude", action: "login_start" });
  expect(state.track.mock.invocationCallOrder[0]).toBeLessThan(state.invoke.mock.invocationCallOrder[0]);
  add("claude");
  expect(state.track).toHaveBeenCalledTimes(1);
  reject(new Error("Cancelled"));
  await vi.waitFor(() => expect(state.say).toHaveBeenCalledWith("Error: Cancelled", true));
  expect(state.track).toHaveBeenCalledTimes(1);
});
