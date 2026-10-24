/// <reference types="vite/client" />
import { invoke } from "./ipc";
import type { ProviderId } from "./types";
import type { FeatureEvent } from "./analytics-events";

/** Product events contain only authored identifiers and closed context (ADR 0093). */
export type Control = "button" | "link" | "menuitem" | "tab" | "option" | "checkbox" | "input";
export type Screen = "desk" | "settings" | "issues" | "notifications" | "archived" | "workspace" | "project";
export type ClickEvent = { name: "ui_clicked"; control: Control; target: string; area: string };
export type AnalyticsEvent =
  | { name: "app_opened" }
  | { name: "screen_viewed"; screen: Screen }
  | { name: "workspace_created"; provider: ProviderId; is_worktree: boolean }
  | { name: "conversation_created"; provider: ProviderId }
  | ClickEvent
  | FeatureEvent;

/** Fire and forget: analytics never delays or fails a feature. */
export function track(event: AnalyticsEvent) {
  invoke("analytics_track", { event }).catch(() => {});
}

let shown: Screen | undefined;
export function viewScreen(screen: Screen) {
  if (screen === shown) return;
  shown = screen;
  track({ name: "screen_viewed", screen });
}

const CONTROLS = [
  "[data-track]", "button", "a", "summary", "select:not([aria-hidden=true])", "textarea", "input:not([type=hidden])",
  ...["button", "link", "menuitem", "menuitemcheckbox", "tab", "option", "switch", "checkbox", "radio"].map(role => `[role=${role}]`),
].join(",");
const ROLES: Record<string, Control> = {
  a: "link", link: "link", summary: "button", select: "input", textarea: "input", input: "input",
  switch: "checkbox", checkbox: "checkbox", radio: "checkbox", menuitemcheckbox: "menuitem", menuitem: "menuitem", tab: "tab", option: "option",
};
const TOKEN = /^[A-Za-z0-9._-]{1,80}$/;
const token = (value?: string) => value && TOKEN.test(value) ? value : undefined;
const controlTarget = (element: HTMLElement) => token(element.dataset.track ?? element.dataset.tTitle ?? element.dataset.t);
const disabled = (element: HTMLElement) => element.matches(":disabled,[aria-disabled=true]");
const controlArea = (element: HTMLElement) => token(element.closest<HTMLElement>("[data-track-area]")?.dataset.trackArea);
export type UnidentifiedControl = { element: HTMLElement; missing: ("target" | "area")[] };

function unidentified(element: HTMLElement, target: string | undefined): UnidentifiedControl | undefined {
  const missing: UnidentifiedControl["missing"] = [];
  if (!target) missing.push("target");
  if (!controlArea(element)) missing.push("area");
  return missing.length ? { element, missing } : undefined;
}

/** Inspect enabled controls, including hidden states, without sending their text or DOM to analytics. */
export function unidentifiedControls(root: ParentNode = document): UnidentifiedControl[] {
  return [...root.querySelectorAll<HTMLElement>(`${CONTROLS},[data-track-double-click],[data-track-context-menu]`)].flatMap(element => {
    if (disabled(element)) return [];
    const targets = element.matches(CONTROLS) ? [controlTarget(element)] : [];
    for (const attribute of ["trackDoubleClick", "trackContextMenu"] as const) {
      if (element.dataset[attribute] !== undefined) targets.push(token(element.dataset[attribute]));
    }
    const missing = [...new Set(targets.flatMap(target => unidentified(element, target)?.missing ?? []))];
    return missing.length ? [{ element, missing }] : [];
  });
}

/** Capture authored identities only. Missing coverage remains a local diagnostic, never a fabricated target. */
export function trackClicks(root: Document = document, capture: (event: ClickEvent) => void = track) {
  const listen = (kind: string, attribute?: "trackDoubleClick" | "trackContextMenu") => {
    root.addEventListener(kind, event => {
      const source = event.target as Element | null;
      const element = source?.closest?.<HTMLElement>(attribute
        ? `[data-${attribute === "trackDoubleClick" ? "track-double-click" : "track-context-menu"}]`
        : CONTROLS);
      if (!element || disabled(element)) return;
      const target = attribute ? token(element.dataset[attribute]) : controlTarget(element);
      const problem = unidentified(element, target);
      if (problem) {
        element.dataset.trackMissing = problem.missing.join(" ");
        root.dispatchEvent(new CustomEvent("analytics-unidentified", { detail: problem }));
        if (import.meta.env.DEV) console.warn("Missing authored analytics metadata", problem.missing, element);
        return;
      }
      delete element.dataset.trackMissing;
      const role = element.getAttribute("role") ?? element.tagName.toLowerCase();
      const control = element.matches('input[type="checkbox"], input[type="radio"]') ? "checkbox" : ROLES[role] ?? "button";
      capture({ name: "ui_clicked", control, target: target!, area: controlArea(element)! });
    }, { capture: true });
  };
  listen("click");
  listen("dblclick", "trackDoubleClick");
  listen("contextmenu", "trackContextMenu");
}
