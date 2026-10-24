import { beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({ invoke: vi.fn(), control: null as HTMLInputElement | null }));
const element = () => ({ append() {}, setAttribute() {}, dataset: {} });
vi.mock("./util", () => ({ h: () => element() }));
vi.mock("./i18n", () => ({ t: (key: string) => key, fromBack: String }));
vi.mock("./ipc", () => ({ invoke: state.invoke }));
vi.mock("./ui", () => ({
  toggle: (_label: string, checked: boolean) => {
    state.control = { ...element(), checked, disabled: false } as unknown as HTMLInputElement;
    return { control: state.control, label: element() };
  },
}));
import { analyticsRow, loadAnalytics } from "./analytics-settings";

beforeEach(() => { state.invoke.mockReset(); });

test("loads consent and saves explicit changes while preventing concurrent updates", async () => {
  state.invoke.mockResolvedValueOnce(false);
  await loadAnalytics();
  const say = vi.fn();
  const redraw = () => analyticsRow(say, redraw);
  redraw();
  expect(state.control!.checked).toBe(false);
  expect(state.control!.disabled).toBe(false);
  let finish!: (enabled: boolean) => void;
  state.invoke.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  state.control!.checked = true;
  const saved = state.control!.onchange!.call(state.control!, {} as Event);
  expect(state.invoke).toHaveBeenLastCalledWith("analytics_set_enabled", { enabled: true });
  expect(state.control!.disabled).toBe(true);
  state.control!.onchange!.call(state.control!, {} as Event);
  expect(state.invoke).toHaveBeenCalledTimes(2);
  finish(true);
  await saved;
  expect(state.control!.checked).toBe(true);
  expect(state.control!.disabled).toBe(false);

  state.invoke.mockResolvedValueOnce(false);
  state.control!.checked = false;
  await state.control!.onchange!.call(state.control!, {} as Event);
  expect(state.invoke).toHaveBeenLastCalledWith("analytics_set_enabled", { enabled: false });
  expect(state.control!.checked).toBe(false);
});

test("failed saves restore the previous choice and report the error", async () => {
  state.invoke.mockResolvedValueOnce(true);
  await loadAnalytics();
  const say = vi.fn();
  const redraw = () => analyticsRow(say, redraw);
  redraw();
  state.invoke.mockRejectedValueOnce("storage error");
  state.control!.checked = false;
  await state.control!.onchange!.call(state.control!, {} as Event);
  expect(state.control!.checked).toBe(true);
  expect(state.control!.disabled).toBe(false);
  expect(say).toHaveBeenCalledWith("storage error", true);
});

test("unsupported backends cannot enable tracking", async () => {
  state.invoke.mockRejectedValueOnce("unsupported");
  await loadAnalytics();
  analyticsRow(vi.fn(), vi.fn());
  expect(state.control!.checked).toBe(false);
  expect(state.control!.disabled).toBe(true);
  state.control!.checked = true;
  await state.control!.onchange!.call(state.control!, {} as Event);
  expect(state.invoke).toHaveBeenCalledTimes(1);
});
