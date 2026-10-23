import type { EvaluationStatus } from "./evaluation";
import { fromBack, t } from "./i18n";
import { icon } from "./icons";
import { invoke } from "./ipc";
import { button, field, notice, password } from "./ui";
import { h, template } from "./util";

/// Settings for the optional TypeSafe key. The key field is write-only: after saving, the screen
/// shows only whether a key exists. Test sends one fixed synthetic request, never user data.
let status: EvaluationStatus = { configured: false, enabled: false, problem: null };
let feedback = "";
/// Lives outside the render so leaving and reopening Settings cannot start a second paid request.
let busy = false;

/// A missing or older backend keeps the key unconfigured.
export async function loadTypesafe() {
  try { status = await invoke("typesafe_status"); }
  catch { status = { configured: false, enabled: false, problem: null }; }
}

const TEST = {
  context: "Fix the error shown when the login button is pressed.",
  questions: [{ id: "task_kind", prompt: "What kind of task is the request?", outcomes: ["bug_fix", "feature"] }],
};

export function typesafeRows(say: (text: string, isError?: boolean) => void, redraw: () => void): HTMLElement[] {
  const row = template("div", "setrow typesafe-heading", `<span class="glyph">${icon("sparkles", 18)}</span><div class="txt"><b>TypeSafe</b><span></span></div>`);
  row.querySelector(".txt span")!.textContent = t("typesafe.pitch");

  const key = password("", { show: t("typesafe.key.show"), hide: t("typesafe.key.hide") });
  key.control.placeholder = t("typesafe.key.placeholder");
  key.control.autocomplete = "off";
  key.control.spellcheck = false;
  key.control.dataset.focus = "typesafe-key";
  const controls = () => [save, remove, test];
  const run = async (work: () => Promise<string>) => {
    if (busy) return;
    busy = true;
    controls().forEach(control => { control.disabled = true; });
    try { feedback = await work(); }
    catch (error) { feedback = ""; say(fromBack(error), true); }
    finally { busy = false; }
    redraw();
  };
  const save = button(t(status.configured ? "typesafe.key.replace" : "typesafe.key.save"), () => {
    if (!key.control.value.trim()) { key.control.focus(); return; }
    const replacing = status.configured;
    void run(async () => {
      status = await invoke("typesafe_save_key", { key: key.control.value });
      return t(replacing ? "typesafe.key.replaced" : "typesafe.key.saved");
    });
  });
  save.dataset.focus = "typesafe-save";
  const remove = button(t("typesafe.key.remove"), () => void run(async () => {
    status = await invoke("typesafe_remove_key");
    return t("typesafe.key.removed");
  }), "ghost");
  remove.dataset.focus = "typesafe-remove";
  remove.hidden = !status.configured;
  // The enable flag only gates `context_evaluate`, and Test is its only caller.
  const test = button(t("typesafe.test"), () => void run(async () => {
    if (!status.enabled) status = await invoke("typesafe_set_enabled", { enabled: true });
    const result = await invoke("context_evaluate", { request: TEST });
    return t("typesafe.test.ok", { model: result.model ?? t("typesafe.test.unknownModel") });
  }), "ghost");
  test.dataset.focus = "typesafe-test";
  test.hidden = !status.configured;
  key.control.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); save.click(); } });
  const keyRow = h("div", "typesafe-key");
  controls().forEach(control => { control.disabled = busy; });
  keyRow.append(key.root, save, test, remove);

  const rows: HTMLElement[] = [row, field(t("typesafe.key"), keyRow, t(status.configured ? "typesafe.key.configured" : "typesafe.key.missing"))];
  if (status.problem) rows.push(notice(fromBack(status.problem), "warning"));
  if (feedback) {
    const done = h("p", "ui-hint", feedback);
    done.setAttribute("role", "status");
    rows.push(done);
  }
  return rows;
}
