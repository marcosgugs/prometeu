import { fromBack, t } from "./i18n";
import { invoke } from "./ipc";
import { toggle } from "./ui";
import { h } from "./util";

let enabled: boolean | null = null;
let busy = false;

export async function loadAnalytics() {
  try { enabled = await invoke("analytics_enabled"); }
  catch { enabled = null; }
}

export function analyticsRow(say: (text: string, isError?: boolean) => void, redraw: () => void): HTMLElement {
  const row = h("div", "setrow");
  const copy = h("div", "txt");
  const hint = h("span", "", t(enabled === null ? "analytics.unavailable" : "analytics.description"));
  hint.id = "analytics-description";
  copy.append(h("b", "", t("analytics.title")), hint);
  const choice = toggle(t("analytics.enabled"), enabled === true);
  choice.control.dataset.focus = "analytics-enabled";
  choice.control.setAttribute("aria-describedby", hint.id);
  choice.control.disabled = enabled === null || busy;
  choice.control.onchange = async () => {
    if (busy || enabled === null) return;
    const next = choice.control.checked;
    busy = true;
    redraw();
    try { enabled = await invoke("analytics_set_enabled", { enabled: next }); }
    catch (error) { say(fromBack(error), true); }
    finally { busy = false; redraw(); }
  };
  const action = h("div", "act");
  action.append(choice.label);
  row.append(copy, action);
  return row;
}
