//! Project registration does not create or remove workspaces or project files.
use crate::board::{Board, Project};
pub fn register(board: &mut Board, project: Project) -> Project {
    if let Some(existing) = board.projects.iter().find(|p| p.path == project.path) {
        return existing.clone();
    }
    board.projects.push(project.clone());
    project
}
pub fn remove(board: &mut Board, id: &str) {
    board.projects.retain(|p| p.id != id);
}

/// Folder names are trimmed; an empty or absent name takes the projects out of their folder.
/// Unknown IDs are ignored.
pub fn group(projects: &mut [Project], ids: &[String], group: Option<&str>) {
    let group = group.map(str::trim).filter(|g| !g.is_empty());
    for p in projects.iter_mut().filter(|p| ids.contains(&p.id)) {
        p.group = group.map(Into::into);
    }
}

/// Concurrently registered projects keep their relative order after the requested IDs.
pub fn reorder(projects: &mut [Project], ids: &[String]) {
    projects.sort_by_key(|p| ids.iter().position(|id| *id == p.id).unwrap_or(ids.len()));
}
