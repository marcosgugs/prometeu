import { invoke } from "./ipc";
import { fromBack, t } from "./i18n";
import type { BoardRecovery } from "./types";
import { formDialog, notice } from "./ui";
import { h } from "./util";

/// Ask the backend once per start whether saved workspaces came from the backup or started empty,
/// and say where the unreadable originals were kept. Backends without the command report nothing.
export async function announceBoardRecovery() {
  const recovery = await invoke("board_recovery").catch(() => null);
  if (recovery) openBoardRecovery(recovery);
}

function openBoardRecovery(recovery: BoardRecovery) {
  const dialog = formDialog({
    title: t(`boardRecovery.${recovery.source}.title`),
    save: t("boardRecovery.open"),
    cancel: t("boardRecovery.close"),
    error: fromBack,
    submit: () => invoke("board_recovery_open"),
  });
  dialog.body.append(h("p", "ui-hint", t(`boardRecovery.${recovery.source}`)));
  if (recovery.folder) dialog.body.append(h("p", "ui-hint", t("boardRecovery.kept")), h("code", "", recovery.folder));
  else dialog.save.hidden = true;
  if (recovery.error) dialog.body.append(notice(t("boardRecovery.blocked", { cause: recovery.error }), "error"));
  dialog.open();
}
