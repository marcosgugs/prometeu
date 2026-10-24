import { iconButton } from "./components/icon-button";
import { icon } from "./icons";
import { button, input } from "./ui";
import { h, template } from "./util";

// Both providers use the compact Linear controls. The legacy md class also styles Markdown.
export function issueAction(label: string, run: () => void) {
  const control = button(label, run, "ghost", "issues.action");
  control.classList.remove("md");
  return control;
}

export function issueTab(label: string, run: () => void) {
  const control = issueAction(label, run);
  control.dataset.track = "issues.tab";
  control.classList.add("tab", "itab");
  control.setAttribute("role", "tab");
  const count = h("span", "c"); count.hidden = true;
  control.replaceChildren(h("span", "", label), count);
  return control;
}

export function issueSearch(label: string) {
  const root = template("label", "ifind", icon("search", 14));
  const control = input("", false, "issues.search"); control.spellcheck = false;
  control.placeholder = label; control.setAttribute("aria-label", label);
  root.append(control);
  return { root, control };
}

export function issueRefresh(label: string, run: () => void) {
  const control = iconButton({ track: "issues.refresh", label, glyph: "rotate", run, size: 18 });
  control.classList.remove("md");
  return control;
}

export function issueFilter(label: string, count: number, selected: boolean, run: () => void) {
  const control = issueAction(label, run);
  control.dataset.track = "issues.filter";
  control.classList.add("tpill"); control.classList.toggle("on", selected);
  control.setAttribute("aria-pressed", String(selected));
  control.append(h("span", "c", String(count)));
  return control;
}
