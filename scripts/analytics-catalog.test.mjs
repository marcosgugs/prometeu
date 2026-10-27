import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("catalog extracts authored identities, preserves composed gaps, and rejects stale output", () => {
  const root = mkdtempSync(join(tmpdir(), "prometeu-analytics-catalog-"));
  try {
    for (const directory of ["src", "packages/design-system/src", "docs/contracts"]) mkdirSync(join(root, directory), { recursive: true });
    writeFileSync(join(root, "index.html"), '<button data-track="workspace.open">Private title</button><h1 data-t="heading">Heading</h1>');
    writeFileSync(join(root, "src/example.ts"), `
      button("Private label", run, "ghost", "workspace.open");
      const item = { label: "Private file", track: folder ? "file.folder" : "file.open" };
      row.dataset.track = authoredPrefix + ".select";
      input.value = "/private/project";
      menuButton("Private project", () => items, "resources.add");
      ui.password("Private password", labels, "typesafe.key");
      passwordToggle(control, labels, visible ? "secret.show" : "secret.hide");
      empty("Private title", "Private body", ["Private action", run, "workspace.create"]);
      empty(title, description, [label, run, failed ? "issues.refresh" : "issues.connect"] as const);
      empty(title, description, failed ? [label, run, "github.refresh"] : [label, run, "github.connect"]);
      menuButton(label, items, inherited ? "resources.defaults" : suppliedTrack);
      password(value, labels, authoredPrefix + ".password");
      empty(title, description, [label, run, authoredPrefix + ".retry"]);
      empty(title, description, suppliedAction);

    `);
    writeFileSync(join(root, "src/workspace-changes.ts"), `
      import { button as uiButton, input as uiInput } from "./ui";
      function button(label, run, disabled = false, className = "", track) {
        return uiButton(label, run, "ghost", track);
      }
      function iconButton(label, glyph, run, disabled, track) {}
      button("Private label", run, false, "pri", "git.conflict.resolve");
      button("Private label", run, false, "ghost");
      iconButton("Private label", "rotate", run, false, "git.refresh");
      uiButton("Private label", run, "ghost", "shared.action");
      uiInput("Private value", true, "git.conflict.result");
    `);
    writeFileSync(join(root, "src/action-settings.ts"), `
      const button = (key, run) => ui.button(t(key), run, undefined, key);
      const field = (key, control) => ui.field(t(key), control, undefined, key);
      const checkbox = (key, checked) => ui.checkbox(t(key), checked, key);
      button("actions.newCommand", run);
      field("actions.scope", control);
      checkbox("actions.inherit", true);
      ui.button("Private label", run, "ghost", "shared.action");
    `);
    writeFileSync(join(root, "src/mcp.ts"), `
      function field(options) { return ui.input(options.value, false, options.label); }
      field({ label: "mcp.field.command", value: "Private executable", on: save });
    `);
    writeFileSync(join(root, "src/plugins.ts"), `
      function area(options) { return ui.input(options.value, true, options.label); }
      area({ label: "plugin.make.prompt", value: "Private prompt", on: save });
    `);
    writeFileSync(join(root, "src/statusbar.ts"), `
      function toggle(which, anchor, event) {}
      toggle("usage", anchor, "pointer");
    `);
    writeFileSync(join(root, "src/example.test.ts"), 'button("Test only", run, "ghost", "test.only");');
    writeFileSync(join(root, "src/analytics-events.ts"), 'export type FeatureEvent = {name:"file_opened"; kind:"text"|"image"} | {name:"terminal_opened"};');
    const script = resolve("scripts/analytics-catalog.mjs");
    const run = (...args) => spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: "utf8" });
    const generated = run();
    assert.equal(generated.status, 0, generated.stderr);
    const catalog = JSON.parse(readFileSync(join(root, "docs/contracts/product-analytics-catalog.json"), "utf8"));
    assert.deepEqual(catalog.controls.map(control => control.target), [
      "actions.inherit", "actions.newCommand", "actions.scope", "file.folder", "file.open", "git.conflict.resolve", "git.conflict.result", "git.refresh",
      "github.connect", "github.refresh", "issues.connect", "issues.refresh", "mcp.field.command", "plugin.make.prompt",
      "resources.add", "resources.defaults", "secret.hide", "secret.show", "shared.action", "typesafe.key", "workspace.create", "workspace.open",
    ].sort((a, b) => a.localeCompare(b)));
    assert.deepEqual(catalog.controls.find(control => control.target === "shared.action").sources, ["src/action-settings.ts", "src/workspace-changes.ts"]);
    assert.deepEqual(catalog.controls.find(control => control.target === "workspace.open").sources, ["index.html", "src/example.ts"]);
    assert.deepEqual(catalog.composed.filter(item => item.source === "src/example.ts").map(item => item.expression).sort(), [
      '(suppliedAction)[2]', 'authoredPrefix + ".password"', 'authoredPrefix + ".retry"', 'authoredPrefix + ".select"',
      'inherited ? "resources.defaults" : suppliedTrack',
    ]);
    assert.ok(catalog.composed.some(item => item.expression === "options.label"));
    assert.ok(!catalog.composed.some(item => item.source === "src/statusbar.ts"));
    assert.ok(!JSON.stringify(catalog).includes("Private"));
    assert.ok(!JSON.stringify(catalog).includes("/private/project"));
    assert.deepEqual(catalog.feature_events.map(event => event.name), ["file_opened", "terminal_opened"]);
    assert.equal(run("--check").status, 0);
    writeFileSync(join(root, "index.html"), '<button data-track="workspace.close">Close</button>');
    assert.notEqual(run("--check").status, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
