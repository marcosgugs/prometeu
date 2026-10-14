//! Byte-for-byte copies of state files Prometeu could not read, kept before anything replaces
//! them.
use crate::paths;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// Distinct copies kept per file; the oldest are pruned after a new copy is written.
const KEEP: usize = 5;

/// The private folder next to the state files in `root`.
pub fn folder(root: &Path) -> PathBuf {
    root.join("recovery")
}

/// Copy `bytes` to `<label>-<millis>.json` unless an identical copy is already there. The caller
/// must not replace the original when this fails.
pub fn keep(folder: &Path, label: &str, bytes: &[u8]) -> Result<(), String> {
    let copies = copies(folder, label);
    if copies
        .iter()
        .any(|copy| std::fs::read(copy).is_ok_and(|kept| kept == bytes))
    {
        return Ok(());
    }
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    paths::write_private_bytes(&folder.join(format!("{label}-{stamp:013}.json")), bytes)?;
    // With the new copy, only the newest KEEP remain.
    for old in copies.iter().rev().skip(KEEP - 1) {
        let _ = std::fs::remove_file(old);
    }
    Ok(())
}

/// Existing copies of one label, oldest first. Stamps have a fixed width, so names sort by time.
fn copies(folder: &Path, label: &str) -> Vec<PathBuf> {
    let mut found: Vec<PathBuf> = std::fs::read_dir(folder)
        .into_iter()
        .flatten()
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .and_then(|name| {
                    name.strip_prefix(label)?
                        .strip_prefix('-')?
                        .strip_suffix(".json")
                })
                .is_some_and(|stamp| !stamp.is_empty() && stamp.bytes().all(|b| b.is_ascii_digit()))
        })
        .collect();
    found.sort();
    found
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temporary_folder() -> PathBuf {
        std::env::temp_dir()
            .join(format!("prometeu-recovery-{}", uuid::Uuid::new_v4()))
            .join("recovery")
    }

    #[test]
    fn identical_bytes_are_kept_once_and_labels_do_not_mix() {
        let folder = temporary_folder();
        keep(&folder, "board", b"{broken").unwrap();
        keep(&folder, "board", b"{broken").unwrap();
        keep(&folder, "board-backup", b"{broken").unwrap();
        assert_eq!(copies(&folder, "board").len(), 1);
        assert_eq!(copies(&folder, "board-backup").len(), 1);
        assert_eq!(
            std::fs::read(&copies(&folder, "board")[0]).unwrap(),
            b"{broken"
        );
        std::fs::remove_dir_all(folder.parent().unwrap()).unwrap();
    }

    #[test]
    fn only_the_newest_distinct_copies_remain() {
        let folder = temporary_folder();
        for n in 0..KEEP + 2 {
            keep(&folder, "board", format!("{{broken {n}").as_bytes()).unwrap();
            // Distinct millisecond stamps keep the order of the copies.
            std::thread::sleep(std::time::Duration::from_millis(2));
        }
        let kept: Vec<String> = copies(&folder, "board")
            .iter()
            .map(|copy| std::fs::read_to_string(copy).unwrap())
            .collect();
        let expected: Vec<String> = (2..KEEP + 2).map(|n| format!("{{broken {n}")).collect();
        assert_eq!(kept, expected);
        std::fs::remove_dir_all(folder.parent().unwrap()).unwrap();
    }
}
