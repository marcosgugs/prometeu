//! Terminal sessions: local shells owned by the app, not by a workspace or a project (ADR 0096).
//! Hosts validate folders and run the shell; these rules only keep the board's records.
use crate::board::{Board, TerminalSession};

/// Keeps session ids apart from workspace UUIDs and project paths.
pub const PREFIX: &str = "terminal-";

pub fn create(board: &mut Board, folder: &str) -> TerminalSession {
    let session = TerminalSession {
        id: format!("{PREFIX}{}", uuid::Uuid::new_v4()),
        folder: folder.into(),
        name: None,
    };
    board.terminals.push(session.clone());
    session
}

/// A blank name clears the person's name, so the folder's name shows again. Returns whether the
/// board changed.
pub fn rename(board: &mut Board, id: &str, name: Option<&str>) -> bool {
    let name = name.map(str::trim).filter(|name| !name.is_empty());
    match board.terminals.iter_mut().find(|session| session.id == id) {
        Some(session) if session.name.as_deref() != name => {
            session.name = name.map(Into::into);
            true
        }
        _ => false,
    }
}

/// Returns whether a session was removed.
pub fn remove(board: &mut Board, id: &str) -> bool {
    let before = board.terminals.len();
    board.terminals.retain(|session| session.id != id);
    board.terminals.len() != before
}

pub fn find<'a>(board: &'a Board, id: &str) -> Option<&'a TerminalSession> {
    board.terminals.iter().find(|session| session.id == id)
}

impl TerminalSession {
    /// The person's name wins over the folder's name; the root folder shows its path.
    pub fn title(&self) -> String {
        self.name.clone().unwrap_or_else(|| {
            std::path::Path::new(&self.folder)
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_else(|| self.folder.clone())
        })
    }
}

#[cfg(test)]
mod tests;
