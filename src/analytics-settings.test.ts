import { afterEach, beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({ invoke: vi.fn(), formDialog: vi.fn(), control: null as HTMLInputElement | null, target: undefined as string | undefined }));
const element = () => ({ append() {}, setAttribute() {}, querySelector: () => ({ prepend() {} }), classList: { add() {} }, dataset: {} });
vi.mock("./util", () => ({ h: () => element() }));
vi.mock("./i18n", () => ({ t: (key: string) => key, fromBack: String }));
vi.mock("./ipc", () => ({ invoke: state.invoke }));
vi.mock("./ui", () => ({
  formDialog: state.formDialog,
  card: () => element(),
  toggle: (_label: string, checked: boolean, target?: string) => {
    state.target = target;
    state.control = { ...element(), checked, disabled: false } as unknown as HTMLInputElement;
    return { control: state.control, label: element() };
  },
}));
import { analyticsRow, askAnalyticsConsent, loadAnalytics } from "./analytics-settings";

beforeEach(() => {
  state.invoke.mockReset();
  state.formDialog.mockReset();
  vi.stubGlobal("document", { activeElement: null, body: {} });
});
afterEach(() => vi.unstubAllGlobals());

test.each([false, "unsupported"])("does not prompt for a saved choice or unsupported backend: %s", async result => {
  if (result === false) state.invoke.mockResolvedValueOnce(false);
  else state.invoke.mockRejectedValueOnce(result);
  await askAnalyticsConsent();
  expect(state.formDialog).not.toHaveBeenCalled();
  expect(state.invoke).toHaveBeenCalledExactlyOnceWith("analytics_needs_consent");
});

test.each([true, false])("first-run choice persists %s and leaves failed saves retryable", async share => {
  const dialog = { root: element(), body: element(), save: { onclick: () => {} }, cancel: { type: "button", onclick: () => {} }, open: vi.fn() };
  state.formDialog.mockReturnValue(dialog);
  state.invoke.mockResolvedValueOnce(true);
  const prompt = askAnalyticsConsent();
  await vi.waitFor(() => expect(dialog.open).toHaveBeenCalledOnce());
  const options = state.formDialog.mock.calls[0][0];
  expect(state.invoke).toHaveBeenCalledTimes(1);
  expect(dialog.cancel.type).toBe("submit");
  (share ? dialog.save : dialog.cancel).onclick();
  state.invoke.mockRejectedValueOnce("storage error");
  await expect(options.submit()).rejects.toBe("storage error");
  state.invoke.mockResolvedValueOnce(share);
  await options.submit();
  expect(state.invoke).toHaveBeenLastCalledWith("analytics_set_enabled", { enabled: share });
  options.closed();
  await prompt;
  analyticsRow(vi.fn(), vi.fn());
  expect(state.control!.checked).toBe(share);
});

test("Escape defers the prompt without persisting consent", async () => {
  const dialog = { root: element(), body: element(), save: {}, cancel: {}, open: vi.fn() };
  state.formDialog.mockReturnValue(dialog);
  state.invoke.mockResolvedValueOnce(true);
  const prompt = askAnalyticsConsent();
  await vi.waitFor(() => expect(dialog.open).toHaveBeenCalledOnce());
  state.formDialog.mock.calls[0][0].closed();
  await prompt;
  expect(state.invoke).toHaveBeenCalledTimes(1);
});

test("loads consent and saves explicit changes while preventing concurrent updates", async () => {
  state.invoke.mockResolvedValueOnce(false);
  await loadAnalytics();
  const say = vi.fn();
  const redraw = () => analyticsRow(say, redraw);
  const row = redraw();
  expect(row.dataset.trackArea).toBe("settings.privacy");
  expect(state.target).toBe("settings.analytics.enabled");
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
