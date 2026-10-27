//! Terminal sessions owned by the app itself (ADR 0096). The record lives on the board; the shell
//! is an ordinary dock PTY under `<session>:terminal`, so it shares spawning, retained output,
//! status-bar counts and launcher-environment cleanup with workspace and project shells.

use crate::lock::lock;
use crate::state::{publish, Board, TerminalSession};
use crate::{dock, i18n, paths, pty, AppState};
use prometeu_core::terminal_sessions;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, State};

/// Without a folder the session starts in the home folder. A chosen folder is never registered as
/// a project, and creating a session starts no shell: the view opens it at its own size.
#[tauri::command]
pub fn terminal_create(
    app: AppHandle,
    state: State<AppState>,
    folder: Option<String>,
) -> Result<TerminalSession, String> {
    let folder = match folder {
        Some(folder) => existing(Path::new(&folder))?,
        None => paths::home(),
    };
    let session = terminal_sessions::create(&mut lock(&state.board), &folder.display().to_string());
    publish(&app);
    Ok(session)
}

/// A blank name returns the session to its folder's name.
#[tauri::command]
pub fn terminal_rename(app: AppHandle, state: State<AppState>, id: String, name: Option<String>) {
    if terminal_sessions::rename(&mut lock(&state.board), &id, name.as_deref()) {
        publish(&app);
    }
}

/// × and `exit` end a session: its shell stops and the record goes. Quitting the app only stops
/// the shell, so the session is listed again after a restart.
#[tauri::command]
pub fn terminal_close(app: AppHandle, state: State<AppState>, id: String) {
    if close(&state.board, &state.ptys, &id) {
        publish(&app);
    }
}

/// Only a session's own shell stops: an id that is no session leaves every dock alone.
fn close(board: &Mutex<Board>, ptys: &Mutex<HashMap<String, pty::Pty>>, id: &str) -> bool {
    let removed = terminal_sessions::remove(&mut lock(board), id);
    if removed {
        dock::kill_docks(ptys, id);
    }
    removed
}

/// A shell must start where it was asked to: the native PTY would quietly fall back to the home
/// folder when its folder is missing.
pub(crate) fn existing(folder: &Path) -> Result<PathBuf, String> {
    if folder.is_absolute() && folder.is_dir() {
        return Ok(folder.to_path_buf());
    }
    Err(i18n::ta(
        "err.dock.noFolder",
        &[("path", folder.display().to_string())],
    ))
}

/// Shells start in a workspace's worktree, a project's folder or a session's folder. Sessions are
/// not file roots, so only shells resolve them, never the file commands behind `cwd_of`.
pub(crate) fn shell_folder(board: &Board, id: &str) -> Result<PathBuf, String> {
    let folder = crate::session::cwd_in(board, id)
        .or_else(|| terminal_sessions::find(board, id).map(|s| PathBuf::from(&s.folder)))
        .ok_or_else(|| i18n::t("err.session.noWorkspace"))?;
    existing(&folder)
}

#[cfg(test)]
mod tests {
    use super::*;
    use prometeu_core::terminal::{TerminalControl, TerminalEvents, TerminalOutput, TerminalSize};
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;

    struct Shell(AtomicBool);
    impl TerminalControl for Shell {
        fn resize(&self, _: TerminalSize) -> Result<(), String> {
            Ok(())
        }
        fn running(&self) -> bool {
            self.0.load(Ordering::Relaxed)
        }
        fn system_id(&self) -> u32 {
            0
        }
        fn close(&self) {
            self.0.store(false, Ordering::Relaxed);
        }
    }
    struct Silent;
    impl TerminalEvents for Silent {
        fn output(&self, _: &[u8], _: u64) {}
        fn closed(&self, _: Option<u32>) {}
    }

    fn folder(name: &str) -> PathBuf {
        let path =
            std::env::temp_dir().join(format!("prometeu-terminal-{name}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn shells_start_only_in_an_existing_folder() {
        let home = folder("home");
        let gone = home.join("gone");
        let mut board = Board::default();
        let session = terminal_sessions::create(&mut board, &home.display().to_string());
        let deleted = terminal_sessions::create(&mut board, &gone.display().to_string());
        board.projects.push(
            serde_json::from_value(serde_json::json!({
                "id": "/project", "name": "project", "path": home.display().to_string()
            }))
            .unwrap(),
        );

        assert_eq!(shell_folder(&board, &session.id), Ok(home.clone()));
        assert_eq!(shell_folder(&board, "/project"), Ok(home.clone()));
        let missing = i18n::ta("err.dock.noFolder", &[("path", gone.display().to_string())]);
        assert_eq!(shell_folder(&board, &deleted.id), Err(missing.clone()));
        assert_eq!(existing(&gone), Err(missing));
        assert_eq!(
            shell_folder(&board, "unknown"),
            Err(i18n::t("err.session.noWorkspace"))
        );
        // A relative folder would resolve against the app's own working directory.
        assert!(existing(Path::new(".")).is_err());
        std::fs::remove_dir_all(home).unwrap();
    }

    #[test]
    fn closing_a_session_stops_only_its_shell() {
        let mut board = Board::default();
        let session = terminal_sessions::create(&mut board, "/Users/me");
        let other = terminal_sessions::create(&mut board, "/Users/me");
        let board = Mutex::new(board);
        let keys = [
            format!("{}:terminal", session.id),
            format!("{}:terminal", other.id),
            "workspace:terminal".to_string(),
        ];
        let shells = keys.clone().map(|_| Arc::new(Shell(AtomicBool::new(true))));
        let ptys: Mutex<HashMap<_, _>> = Mutex::new(
            keys.iter()
                .zip(&shells)
                .map(|(key, shell)| {
                    let output = Arc::new(TerminalOutput::new(Arc::new(Silent)));
                    let pty = pty::Pty::new(Box::new(std::io::sink()), shell.clone(), output, None);
                    (key.clone(), pty)
                })
                .collect(),
        );
        let running = || shells.each_ref().map(|shell| shell.running());

        assert!(!close(&board, &ptys, "workspace"));
        assert_eq!(running(), [true; 3]);
        assert!(close(&board, &ptys, &session.id));
        assert_eq!(running(), [false, true, true]);
        assert!(!close(&board, &ptys, &session.id));
        assert_eq!(lock(&board).terminals, [other]);
        assert_eq!(lock(&ptys).len(), 2);
    }
}
