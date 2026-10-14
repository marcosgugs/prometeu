//! The frontend owns relay transport and the security scope schema. The backend stores
//! team.json and team-security.json privately outside localStorage. Identity and trust
//! survive leaving a team.

use crate::{i18n, paths};
use serde::Serialize;
use serde_json::Value;
use std::{io::Read, path::Path, sync::Mutex};

static SECURITY_LOCK: Mutex<()> = Mutex::new(());
const MAX_SECURITY_BYTES: usize = 8 * 1024 * 1024;

fn security_error(path: &Path, cause: impl Into<String>) -> String {
    i18n::ta(
        "err.team.write",
        &[
            ("path", path.display().to_string()),
            ("cause", cause.into()),
        ],
    )
}

fn validate_security(state: &Value) -> bool {
    state.is_object()
        && state.get("version").and_then(Value::as_u64) == Some(1)
        && state.get("scopes").is_some_and(Value::is_object)
}

fn read_security(path: &Path) -> Result<Option<Value>, String> {
    let file = match std::fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(security_error(path, error.to_string())),
    };
    let mut body = Vec::new();
    file.take((MAX_SECURITY_BYTES + 1) as u64)
        .read_to_end(&mut body)
        .map_err(|error| security_error(path, error.to_string()))?;
    if body.len() > MAX_SECURITY_BYTES {
        return Err(security_error(path, "Security state exceeds size limit"));
    }
    let state: Value = serde_json::from_slice(&body)
        .map_err(|_| security_error(path, "Invalid security state"))?;
    if !validate_security(&state) {
        return Err(security_error(path, "Invalid security state"));
    }
    Ok(Some(state))
}

fn write_security(path: &Path, state: &Value) -> Result<(), String> {
    if !validate_security(state) {
        return Err(security_error(path, "Invalid security state"));
    }
    let body =
        serde_json::to_string(state).map_err(|_| security_error(path, "Invalid security state"))?;
    if body.len() > MAX_SECURITY_BYTES {
        return Err(security_error(path, "Security state exceeds size limit"));
    }
    // Invalid storage never authorizes recreating identities or erasing trust.
    read_security(path)?;
    paths::write_private(path, &body).map_err(|error| security_error(path, error))
}

#[tauri::command]
pub fn team_security() -> Result<Option<Value>, String> {
    let path = paths::team_path().with_file_name("team-security.json");
    let _guard = SECURITY_LOCK
        .lock()
        .map_err(|_| security_error(&path, "Security state lock unavailable"))?;
    read_security(&path)
}

#[tauri::command]
pub fn team_security_set(state: Value) -> Result<(), String> {
    let path = paths::team_path().with_file_name("team-security.json");
    let _guard = SECURITY_LOCK
        .lock()
        .map_err(|_| security_error(&path, "Security state lock unavailable"))?;
    write_security(&path, &state)
}

/// Return stored team configuration and the local username as a suggested display name.
#[derive(Serialize)]
pub struct TeamFile {
    pub config: Option<Value>,
    pub default_name: String,
}

#[tauri::command]
pub fn team_config() -> TeamFile {
    let config = std::fs::read_to_string(paths::team_path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok());
    let default_name = std::env::var("USER").unwrap_or_default();
    TeamFile {
        config,
        default_name,
    }
}

/// None leaves the team by removing its configuration file.
#[tauri::command]
pub fn team_config_set(config: Option<Value>) -> Result<(), String> {
    set_config(&paths::team_path(), config)
}

/// A team.json that does not parse reads as "no team". Copy it aside before joining replaces it or
/// leaving removes it; a file that cannot be read at all blocks both.
fn keep_unreadable(path: &Path) -> Result<(), String> {
    match std::fs::read(path) {
        Ok(bytes) if serde_json::from_slice::<Value>(&bytes).is_err() => {
            let root = path.parent().unwrap_or(Path::new("."));
            crate::recovery::keep(&crate::recovery::folder(root), "team", &bytes)
        }
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

fn set_config(path: &Path, config: Option<Value>) -> Result<(), String> {
    let wrap = |cause: String| {
        i18n::ta(
            "err.team.write",
            &[("path", path.display().to_string()), ("cause", cause)],
        )
    };
    keep_unreadable(path).map_err(wrap)?;
    match config {
        None => match std::fs::remove_file(path) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(wrap(e.to_string())),
        },
        Some(value) => {
            if value.get("cloud").is_some() {
                if let Ok(previous) = std::fs::read_to_string(path) {
                    if serde_json::from_str::<Value>(&previous)
                        .ok()
                        .is_some_and(|old| old.get("cloud").is_none())
                    {
                        let backup = path
                            .with_file_name(format!("team-legacy-{}.json", uuid::Uuid::new_v4()));
                        paths::write_private(&backup, &previous).map_err(wrap)?;
                    }
                }
            }
            let body = serde_json::to_string_pretty(&value).map_err(|e| wrap(e.to_string()))?;
            paths::write_private(path, &body).map_err(wrap)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn security_state_is_private_and_independent_of_team_membership() {
        let dir = std::env::temp_dir().join(format!("prometeu-security-{}", uuid::Uuid::new_v4()));
        let path = dir.join("team-security.json");
        assert_eq!(read_security(&path).unwrap(), None);
        let state = json!({"version": 1, "scopes": {"organization:one": {"key": "private"}}});
        write_security(&path, &state).unwrap();
        let config = dir.join("team.json");
        paths::write_private(&config, "{}").unwrap();
        std::fs::remove_file(&config).unwrap();
        assert_eq!(read_security(&path).unwrap(), Some(state.clone()));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
            assert_eq!(
                std::fs::metadata(&dir).unwrap().permissions().mode() & 0o777,
                0o700
            );
        }
        for invalid in [
            Value::Null,
            json!({"version": 2, "scopes": {}}),
            json!({"version": 1, "scopes": []}),
        ] {
            assert!(write_security(&path, &invalid).is_err());
            assert_eq!(read_security(&path).unwrap(), Some(state.clone()));
        }
        let oversized = json!({"version": 1, "scopes": {"key": "x".repeat(MAX_SECURITY_BYTES)}});
        assert!(write_security(&path, &oversized).is_err());
        assert_eq!(read_security(&path).unwrap(), Some(state));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn an_unreadable_team_file_is_kept_before_it_is_replaced_or_removed() {
        let dir = std::env::temp_dir().join(format!("prometeu-team-{}", uuid::Uuid::new_v4()));
        let path = dir.join("team.json");
        let kept = || -> Vec<String> {
            std::fs::read_dir(crate::recovery::folder(&dir))
                .into_iter()
                .flatten()
                .flatten()
                .map(|entry| std::fs::read_to_string(entry.path()).unwrap())
                .collect()
        };
        paths::write_private(&path, "{\"team\":").unwrap();
        // Without a place for the copy, the unreadable file stays as it is.
        paths::write_private(&crate::recovery::folder(&dir), "").unwrap();
        assert!(set_config(&path, Some(json!({"team": "new"}))).is_err());
        assert!(set_config(&path, None).is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{\"team\":");
        std::fs::remove_file(crate::recovery::folder(&dir)).unwrap();

        set_config(&path, Some(json!({"team": "new"}))).unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(&std::fs::read_to_string(&path).unwrap()).unwrap(),
            json!({"team": "new"})
        );
        assert_eq!(kept(), vec!["{\"team\":"]);
        // A readable file is replaced or removed without another copy.
        set_config(&path, None).unwrap();
        assert!(!path.exists());
        paths::write_private(&path, "not json").unwrap();
        set_config(&path, None).unwrap();
        assert!(!path.exists());
        let mut all = kept();
        all.sort();
        assert_eq!(all, vec!["not json", "{\"team\":"]);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn unreadable_or_invalid_security_state_never_resets_or_leaks_contents() {
        let dir = std::env::temp_dir().join(format!("prometeu-security-{}", uuid::Uuid::new_v4()));
        let path = dir.join("team-security.json");
        let valid = json!({"version": 1, "scopes": {}});
        for body in [
            "private-secret",
            "{\"version\":2,\"scopes\":{}}",
            "{\"version\":1,\"scopes\":null}",
        ] {
            paths::write_private(&path, body).unwrap();
            let error = read_security(&path).unwrap_err();
            assert!(!error.contains("private-secret"));
            assert!(write_security(&path, &valid).is_err());
            assert_eq!(std::fs::read_to_string(&path).unwrap(), body);
        }
        paths::write_private(&path, &"x".repeat(MAX_SECURITY_BYTES + 1)).unwrap();
        assert!(read_security(&path).is_err());
        assert!(write_security(&path, &valid).is_err());
        assert_eq!(
            std::fs::metadata(&path).unwrap().len(),
            (MAX_SECURITY_BYTES + 1) as u64
        );
        std::fs::remove_file(&path).unwrap();
        std::fs::create_dir(&path).unwrap();
        assert!(read_security(&path).is_err());
        assert!(write_security(&path, &valid).is_err());
        assert!(path.is_dir());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
