import { fromBack, t } from "./i18n";
import { icon } from "./icons";
import { invoke } from "./ipc";
import { card, formDialog, toggle } from "./ui";
import { h } from "./util";
import "./analytics-settings.css";

let enabled: boolean | null = null;
let busy = false;

export async function loadAnalytics() {
  try { enabled = await invoke("analytics_enabled"); }
  catch { enabled = null; }
}

export async function askAnalyticsConsent() {
  if (!await invoke("analytics_needs_consent").catch(() => false)) return;
  await new Promise<void>(resolve => {
    let share = true;
    const dialog = formDialog({
      track: "analytics.consent", area: "analytics",
      title: t("analytics.consent.title"), save: t("analytics.consent.accept"), cancel: t("analytics.consent.decline"),
      error: fromBack, closed: resolve,
      submit: async () => { enabled = await invoke("analytics_set_enabled", { enabled: share }); },
    });
    dialog.root.classList.add("analytics-consent");
    const illustration = h("div", "analytics-consent-art");
    illustration.setAttribute("aria-hidden", "true");
    illustration.innerHTML = `<span class="analytics-consent-bubble">${icon("message-square", 22)}</span><span class="analytics-consent-flame">${icon("flame", 60)}</span><span class="analytics-consent-signal">${icon("signal", 22)}</span><span class="analytics-consent-spark">${icon("sparkles", 18)}</span>`;
    dialog.root.querySelector(".sheettop")!.prepend(illustration);
    // Both choices use the form's pending state and inline save errors. Escape defers the question.
    dialog.cancel.type = "submit";
    dialog.cancel.onclick = () => { share = false; };
    dialog.save.onclick = () => { share = true; };
    dialog.body.append(
      h("p", "analytics-consent-intro", t("analytics.consent.intro")),
      card(t("analytics.consent.privacy"), h("p", "ui-hint", t("analytics.consent.excluded"))),
      h("p", "ui-hint", t("analytics.consent.change")),
    );
    dialog.open();
  });
}

export function analyticsRow(say: (text: string, isError?: boolean) => void, redraw: () => void): HTMLElement {
  const row = h("div", "setrow");
  row.dataset.trackArea = "settings.privacy";
  const copy = h("div", "txt");
  const hint = h("span", "", t(enabled === null ? "analytics.unavailable" : "analytics.description"));
  hint.id = "analytics-description";
  copy.append(h("b", "", t("analytics.title")), hint);
  const choice = toggle(t("analytics.enabled"), enabled === true, "settings.analytics.enabled");
  choice.control.dataset.focus = "analytics-enabled";
  choice.control.setAttribute("aria-describedby", hint.id);
  choice.control.disabled = enabled === null || busy;
  choice.control.onchange = async () => {
    if (busy || enabled === null) return;
    const next = choice.control.checked;
    const focused = document.activeElement === choice.control;
    busy = true;
    redraw();
    try { enabled = await invoke("analytics_set_enabled", { enabled: next }); }
    catch (error) { say(fromBack(error), true); }
    finally {
      busy = false;
      // Disabled replacements cannot receive focus; remember it until saving finishes,
      // but do not take it back if the person moved to another control while waiting.
      const restoreFocus = focused && document.activeElement === document.body;
      redraw();
      if (restoreFocus) document.querySelector<HTMLInputElement>('[data-focus="analytics-enabled"]')?.focus({ preventScroll: true });
    }
  };
  const action = h("div", "act");
  action.append(choice.label);
  row.append(copy, action);
  return row;
}
