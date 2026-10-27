import { button, input } from "../primitives";
import { iconButton } from "../icon-button";
import { icon } from "../icons";
import { h } from "../../util";
import { t } from "../../i18n";

/** Owns composer DOM. Drafts, completion, transport, voice and file selection belong to the host. */
export function composer(options: {
  send: () => void; stop: () => void; addFile: () => void; voice: () => void;
  quote: () => void; actions: () => void; voiceAvailable: boolean;
}) {
  const root = h("div", "composer");
  const files = h("div", "cfiles"); files.hidden = true;
  const area = input("", true, "chat.composer.input"); area.rows = 1; area.spellcheck = true;
  area.title = t("chat.input.hint");
  const meta = h("div", "crow composer-meta");
  const withModel = h("span", "with"); withModel.hidden = true;
  const model = button("", undefined, "ghost", "chat.model.open"); model.classList.add("mdl");
  const effort = button("", undefined, "ghost", "chat.effort.open"); effort.classList.add("effort");
  effort.innerHTML = '<span class="bars"><i></i><i></i><i></i><i></i><i></i></span><span class="el"></span>';
  withModel.append(model, effort);
  const watch = button("", undefined, "ghost", "chat.task.watch"); watch.classList.add("sm", "taskwatch"); watch.hidden = true;
  const hint = h("span", "hint"); hint.setAttribute("role", "status");
  meta.append(withModel, watch, hint);
  const tools = h("div", "composer-tools");
  const addFile = iconButton({ track: "chat.addFile", label: t("chat.addFile"), glyph: "plus", run: options.addFile });
  addFile.classList.add("ico", "sm", "addfile"); addFile.hidden = true;
  const mic = iconButton({ track: "chat.voice", label: t("chat.voice"), glyph: "mic", run: options.voice });
  mic.classList.add("ico", "sm", "mic"); mic.hidden = !options.voiceAvailable;
  const actions = button(t("actions.title"), options.actions, "ghost", "actions.title"); actions.classList.add("sm", "actionsbtn");
  actions.innerHTML = `${icon("play", 13)}<span></span>`; actions.querySelector("span")!.textContent = t("actions.title");
  actions.title = t("actions.title"); actions.setAttribute("aria-label", t("actions.title"));
  tools.append(addFile, mic, actions);
  for (const [name, track] of [["mcpbtn", "chat.mcp.open"], ["plugbtn", "chat.plugins.open"], ["skillbtn", "chat.skills.open"]]) {
    const control = button("", undefined, "ghost", track); control.classList.add("sm", name);
    control.append(h("span", "")); control.hidden = true; tools.append(control);
  }
  const controls = h("div", "composer-controls");
  const remote = button(t("remoteControl.label"), undefined, "ghost", "remoteControl.label"); remote.classList.add("remotebtn"); remote.hidden = true;
  remote.innerHTML = `${icon("globe", 14)}<span></span>`; remote.setAttribute("aria-label", t("remoteControl.label"));
  const stop = iconButton({ track: "chat.stop", label: t("chat.stop"), glyph: "square", run: options.stop });
  stop.classList.add("stop"); stop.hidden = true; stop.title = t("chat.stop.title");
  const send = iconButton({ track: "chat.send", label: t("chat.send"), glyph: "arrow-up", run: options.send, variant: "pri", size: 16 });
  send.classList.add("send", "round");
  controls.append(remote, stop, send);
  const toolbar = h("div", "crow composer-toolbar"); toolbar.append(tools, controls);
  const quote = button(t("notes.quoteSelection"), options.quote, "outline", "notes.quoteSelection"); quote.classList.add("quotesel"); quote.hidden = true;
  quote.innerHTML = `${icon("message-square", 12)}<span></span>`;
  quote.querySelector("span")!.textContent = t("notes.quoteSelection"); quote.title = t("notes.quoteSelection.title");
  root.append(files, area, meta, toolbar, quote);
  return { root, area, files, hint, send, stop, addFile, mic, model, effort, withModel };
}

export function attachmentChip(options: { name: string; title: string; removeLabel: string; remove: () => void }) {
  const root = h("span", "injchip");
  const name = h("span", "", options.name); name.title = options.title;
  const remove = iconButton({ track: "chat.attachment.remove", label: options.removeLabel, glyph: "x", size: 12, run: options.remove });
  remove.classList.add("ico", "sm"); root.append(name, remove);
  return root;
}
