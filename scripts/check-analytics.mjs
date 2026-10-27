import assert from "node:assert/strict";
import { createServer } from "vite";
import { chromium } from "@playwright/test";

// Component contract check: real DOM selectors, portals and controls, with no app or backend.
const server = await createServer({ configFile: false, optimizeDeps: { noDiscovery: true }, server: { host: "127.0.0.1", port: 0 }, logLevel: "error" });
let browser;
try {
  await server.listen();
  browser = await chromium.launch();
  const page = await browser.newPage();
  await page.route("**/__analytics_check", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Analytics controls</title>" }));
  await page.goto(`${server.resolvedUrls.local[0]}__analytics_check`);
  const result = await page.evaluate(async () => {
    const ui = await import("/packages/design-system/src/ui.ts");
    const menu = await import("/packages/design-system/src/menu.ts");
    const { searchablePicker } = await import("/packages/design-system/src/search-picker.ts");
    const { feedbackWidget } = await import("/packages/design-system/src/feedback.ts");
    const { trackClicks, unidentifiedControls } = await import("/src/analytics.ts");
    const captured = [], problems = [];
    trackClicks(document, event => captured.push(event));
    const inspect = label => problems.push(...unidentifiedControls().map(({ element, missing }) => ({ label, tag: element.tagName, target: element.dataset.track, missing })));
    const area = ui.identifyArea(document.createElement("section"), "settings"); document.body.append(area);
    const disabled = ui.button("Unavailable"); disabled.disabled = true; area.append(disabled); disabled.click();
    const opener = ui.button("Private workspace name", undefined, "ghost", "settings.open"); area.append(opener); opener.click();
    const toggle = ui.toggle("Enabled", false, "settings.enabled"); area.append(toggle.label); toggle.control.click();
    const text = ui.input("private value", false, "settings.name"); area.append(ui.field("Name", text)); text.click();
    const choice = ui.select("private-id", [["private-id", "Private project"]], { track: "settings.choice" });
    area.append(choice.root); choice.control.click(); inspect("select menu");
    document.querySelector('[data-track="settings.choice.option"]').click();
    const more = ui.menuButton("More", () => [{ label: "Nested", track: "settings.nested", sub: [{ label: "Remove", track: "settings.remove", run() {} }] }], "settings.more");
    area.append(more); more.click(); document.querySelector('[data-track="settings.nested"]').click(); inspect("nested menu");
    document.querySelector('[data-track="settings.remove"]').click();
    opener.focus();
    const dialog = ui.formDialog({ title: "Edit", save: "Save", cancel: "Cancel", track: "settings.edit", submit: async () => {}, error: String });
    dialog.body.append(ui.input("private description", true, "settings.description")); dialog.open(); inspect("dialog"); dialog.cancel.click();
    searchablePicker(opener, { track: "settings.project", label: "Project", searchPlaceholder: "Search", empty: "Empty", items: [{ key: "private-id", label: "Private project", secondary: { label: "Favorite", pressed: false, run() {} } }], select() {}, refresh: { label: "Refresh", run() {} }, additional: { label: "All", checked: false, change() {} } });
    inspect("picker"); document.querySelector('[data-track="settings.project.search"]').click();
    document.querySelector('[data-track="settings.project.secondary"]').click();
    document.querySelector('[data-track="settings.project.filter"]').click();
    document.querySelector('[data-track="settings.project.select"]').click(); menu.close();
    const labels = Object.fromEntries(["trigger", "title", "kind", "problem", "idea", "other", "description", "attach", "capture", "remove", "send", "close", "privacy", "publicReport", "publicReportHint", "invalidImage", "empty", "success"].map(key => [key, key]));
    const feedback = feedbackWidget({ labels, submit: async () => {}, capture: async () => undefined, error: String, publicIssue: "https://example.test/private" });
    feedback.trigger.click(); inspect("feedback"); feedback.destroy();
    disabled.disabled = false; const diagnostics = unidentifiedControls().map(item => item.missing); disabled.click(); disabled.remove();
    const invalid = ui.button("Private", undefined, "ghost", "/Users/private/project"); area.append(invalid); invalid.click(); invalid.remove();
    const noArea = ui.button("Save", undefined, "ghost", "settings.save"); document.body.append(noArea); noArea.click(); noArea.remove();
    return { captured, problems, diagnostics };
  });
  assert.deepEqual(result.problems, [], "Every representative rendered control must have target and area");
  assert.deepEqual(result.diagnostics, [["target"]], "Unclicked missing controls must remain visible to diagnostics");
  assert.ok(result.captured.length >= 12);
  for (const event of result.captured) {
    assert.equal(event.name, "ui_clicked");
    assert.match(event.target, /^(settings|feedback)\./);
    assert.ok(["settings", "feedback"].includes(event.area));
    assert.ok(!JSON.stringify(event).includes("private"));
  }
  assert.ok(result.captured.some(event => event.target === "settings.enabled" && event.control === "checkbox"));
  assert.ok(result.captured.some(event => event.target === "settings.remove" && event.area === "settings"));
  assert.ok(result.captured.some(event => event.target === "settings.edit.cancel" && event.area === "settings"));
  assert.ok(!result.captured.some(event => event.target === "settings.save"));
  console.log(`Analytics component coverage: ${result.captured.length} named clicks; menus, dialog, fields, toggle, picker and feedback have target + area.`);
} finally {
  await browser?.close();
  await server.close();
}
