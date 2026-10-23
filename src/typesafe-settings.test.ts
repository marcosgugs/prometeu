import { beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({ invoke: vi.fn(), actions: new Map<string, () => unknown>(), labels: [] as string[] }));
const element = () => ({ append() {}, setAttribute() {}, addEventListener() {}, dataset: {}, hidden: false, disabled: false, querySelector: () => ({}) });
vi.mock("./util", () => ({ h: (_tag: string, _cls: string, text?: string) => { if (text) state.labels.push(text); return element(); }, template: () => element() }));
vi.mock("./i18n", () => ({ t: (key: string, args?: Record<string, string>) => args ? `${key} ${JSON.stringify(args)}` : key, fromBack: String }));
vi.mock("./icons", () => ({ icon: () => "" }));
vi.mock("./ipc", () => ({ invoke: state.invoke }));
vi.mock("./ui", () => ({
  field: () => element(), notice: () => element(),
  password: () => ({ root: element(), control: { ...element(), value: "" } }),
  button: (label: string, run: () => unknown) => { state.actions.set(label, run); return element(); },
}));
import { loadTypesafe, typesafeRows } from "./typesafe-settings";

beforeEach(() => { state.invoke.mockReset(); state.actions.clear(); state.labels.length = 0; });

test("test enables a saved key and sends only the fixed synthetic request", async () => {
  state.invoke.mockImplementation(async (command: string) => {
    if (command === "typesafe_status") return { configured: true, enabled: false, problem: null };
    if (command === "typesafe_set_enabled") return { configured: true, enabled: true, problem: null };
    if (command === "context_evaluate") return { answers: [], model: "jev-1.13.0" };
    throw new Error(command);
  });
  await loadTypesafe();
  const redraw = vi.fn();
  typesafeRows(vi.fn(), redraw);
  state.actions.get("typesafe.test")!();
  await vi.waitFor(() => expect(redraw).toHaveBeenCalled());
  expect(state.invoke).toHaveBeenCalledWith("typesafe_set_enabled", { enabled: true });
  const request = state.invoke.mock.calls.find(([command]) => command === "context_evaluate")![1].request;
  expect(request.context).toBe("Fix the error shown when the login button is pressed.");
  typesafeRows(vi.fn(), redraw);
  expect(state.labels).toContain('typesafe.test.ok {"model":"jev-1.13.0"}');
});

test("a rejected key surfaces the backend error", async () => {
  state.invoke.mockImplementation(async (command: string) => {
    if (command === "typesafe_status") return { configured: true, enabled: true, problem: null };
    if (command === "context_evaluate") throw 'i18n:{"code":"err.evaluation.auth"}';
    throw new Error(command);
  });
  await loadTypesafe();
  const say = vi.fn();
  typesafeRows(say, vi.fn());
  state.actions.get("typesafe.test")!();
  await vi.waitFor(() => expect(say).toHaveBeenCalledWith('i18n:{"code":"err.evaluation.auth"}', true));
  expect(state.invoke).not.toHaveBeenCalledWith("typesafe_set_enabled", expect.anything());
});

test("a test still pending after a re-render cannot start another request", async () => {
  let reply!: (value: unknown) => void;
  state.invoke.mockImplementation(async (command: string) => {
    if (command === "typesafe_status") return { configured: true, enabled: true, problem: null };
    if (command === "context_evaluate") return new Promise(resolve => { reply = resolve; });
    throw new Error(command);
  });
  await loadTypesafe();
  const redraw = vi.fn();
  typesafeRows(vi.fn(), redraw);
  state.actions.get("typesafe.test")!();
  typesafeRows(vi.fn(), redraw);
  state.actions.get("typesafe.test")!();
  expect(state.invoke.mock.calls.filter(([command]) => command === "context_evaluate")).toHaveLength(1);
  reply({ answers: [], model: "jev-1.13.0" });
  await vi.waitFor(() => expect(redraw).toHaveBeenCalled());
});
