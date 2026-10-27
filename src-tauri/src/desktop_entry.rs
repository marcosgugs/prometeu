//! Linux docks pair a window with the desktop entry whose StartupWMClass or file name matches the
//! window class, and draw a generic icon when none does. Packages install `Prometeu.desktop`; a
//! downloaded AppImage installs nothing, so every AppImage launch keeps a user entry that starts
//! that file (ADR 0055).

use std::ffi::{OsStr, OsString};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

/// The largest bundle icon, 256 px.
const ICON: &[u8] = include_bytes!("../icons/128x128@2x.png");

struct Launcher {
    id: String,
    name: String,
    class: String,
    appimage: PathBuf,
}

/// Packages own their entry, and other builds have no file a menu could start again.
#[cfg(target_os = "linux")]
pub fn install(app: &tauri::AppHandle) {
    use tauri::utils::{config::BundleType, platform::bundle_type};
    if bundle_type() != Some(BundleType::AppImage) {
        return;
    }
    let appimage = mounted_appimage(std::env::var_os("APPIMAGE"), std::env::var_os("APPDIR"));
    // GTK names the X11 window class, and the Wayland app ID, after the program.
    let (Some(appimage), Some(data), Some(class)) =
        (appimage, dirs::data_dir(), gtk::glib::prgname())
    else {
        return;
    };
    let launcher = Launcher {
        id: app.config().identifier.clone(),
        name: app.package_info().name.clone(),
        class: class.to_string(),
        appimage,
    };
    if let Err(error) = integrate(&data, &launcher) {
        eprintln!("AppImage desktop entry: {error}");
    }
}

/// The runtime mounts the AppImage at `$TMPDIR/.mount_*` and names the file in `APPIMAGE`.
/// `--appimage-extract-and-run` unpacks it elsewhere because FUSE is missing, so a menu could not
/// start the file again.
fn mounted_appimage(appimage: Option<OsString>, appdir: Option<OsString>) -> Option<PathBuf> {
    let mounted = appdir
        .as_deref()
        .map(Path::new)
        .and_then(Path::file_name)
        .and_then(OsStr::to_str)
        .is_some_and(|name| name.starts_with(".mount_"));
    let appimage = PathBuf::from(appimage?);
    (mounted && appimage.is_absolute() && appimage.is_file()).then_some(appimage)
}

fn integrate(data: &Path, launcher: &Launcher) -> io::Result<()> {
    let applications = data.join("applications");
    let own = applications.join(format!("{}.desktop", launcher.id));
    // AppImageLauncher and Gear Lever write their own entry for the file; ours would list it twice.
    if integrated_elsewhere(&applications, &own, &launcher.appimage) {
        return match fs::remove_file(&own) {
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
            result => result,
        };
    }
    let icon = data
        .join("icons/hicolor/256x256/apps")
        .join(format!("{}.png", launcher.id));
    let Some(entry) = entry(launcher, &icon) else {
        return Ok(());
    };
    // The entry names the icon, so the icon goes first.
    write_changed(&icon, ICON)?;
    write_changed(&own, entry.as_bytes())
}

fn integrated_elsewhere(applications: &Path, own: &Path, appimage: &Path) -> bool {
    let Ok(entries) = fs::read_dir(applications) else {
        return false;
    };
    entries.flatten().map(|entry| entry.path()).any(|path| {
        path != own
            && path
                .extension()
                .is_some_and(|extension| extension == "desktop")
            && fs::read_to_string(&path).is_ok_and(|text| starts(&text, appimage))
    })
}

/// Whether an Exec line of the entry, including its actions', starts exactly this file.
fn starts(entry: &str, file: &Path) -> bool {
    entry.lines().any(|line| {
        line.split_once('=')
            .is_some_and(|(key, value)| key.trim() == "Exec" && Path::new(&program(value)) == file)
    })
}

/// Unchanged files stay untouched, so a launch does not wake the desktop's directory monitors.
/// Changes land through a rename, so the desktop never reads half a file.
fn write_changed(path: &Path, bytes: &[u8]) -> io::Result<()> {
    if fs::read(path).is_ok_and(|current| current == bytes) {
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp = path.with_file_name(format!(".{}.tmp", uuid::Uuid::new_v4()));
    let written = fs::write(&tmp, bytes).and_then(|()| fs::rename(&tmp, path));
    if written.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    written
}

/// The icon is an absolute path, so a stale icon theme cache cannot hide it. TryExec hides the
/// entry once the AppImage is gone.
fn entry(launcher: &Launcher, icon: &Path) -> Option<String> {
    // GLib checks that Exec names an existing program before it expands `%%`, so it rejects the
    // entry for any path holding a `%`.
    let appimage = key_path(&launcher.appimage).filter(|path| !path.contains('%'))?;
    let icon = key_path(icon)?;
    Some(format!(
        "[Desktop Entry]\n\
         Type=Application\n\
         Name={name}\n\
         Exec={exec}\n\
         TryExec={try_exec}\n\
         Icon={icon}\n\
         StartupWMClass={class}\n\
         Categories=Development;\n\
         Terminal=false\n",
        name = launcher.name,
        exec = exec_arg(appimage),
        try_exec = escape(appimage),
        icon = escape(icon),
        class = launcher.class,
    ))
}

/// Desktop entry values are single lines of UTF-8.
fn key_path(path: &Path) -> Option<&str> {
    path.to_str()
        .filter(|text| !text.chars().any(char::is_control))
}

/// The string escape for values without control characters.
fn escape(value: &str) -> String {
    value.replace('\\', "\\\\")
}

/// Inside Exec quotes, `"`, `` ` ``, `$` and `\` take a backslash; the string escape then doubles
/// every backslash.
fn exec_arg(path: &str) -> String {
    let mut quoted = String::from('"');
    for c in path.chars() {
        if matches!(c, '"' | '`' | '$' | '\\') {
            quoted.push('\\');
        }
        quoted.push(c);
    }
    quoted.push('"');
    escape(&quoted)
}

/// The program an Exec value starts, read like GLib: the string escape first, then the first word
/// with shell quoting. AppImageLauncher writes double quotes; Gear Lever writes `shlex` single
/// quotes.
fn program(exec: &str) -> String {
    let exec = unescape(exec);
    let mut chars = exec.trim_start().chars();
    let mut word = String::new();
    while let Some(c) = chars.next() {
        match c {
            c if c.is_whitespace() => break,
            '\'' => word.extend(chars.by_ref().take_while(|&c| c != '\'')),
            '"' => {
                while let Some(c) = chars.next() {
                    match c {
                        '"' => break,
                        '\\' => match chars.next() {
                            Some(next @ ('"' | '`' | '$' | '\\')) => word.push(next),
                            next => {
                                word.push('\\');
                                word.extend(next);
                            }
                        },
                        c => word.push(c),
                    }
                }
            }
            '\\' => word.extend(chars.next()),
            c => word.push(c),
        }
    }
    word
}

/// Undoes `\s`, `\n`, `\t`, `\r` and `\\`; other backslashes stay for the quoting to read.
fn unescape(value: &str) -> String {
    let mut chars = value.chars();
    let mut text = String::new();
    while let Some(c) = chars.next() {
        if c != '\\' {
            text.push(c);
            continue;
        }
        match chars.next() {
            Some('s') => text.push(' '),
            Some('n') => text.push('\n'),
            Some('t') => text.push('\t'),
            Some('r') => text.push('\r'),
            Some('\\') => text.push('\\'),
            next => {
                text.push('\\');
                text.extend(next);
            }
        }
    }
    text
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp() -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("prometeu-desktop-entry-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn launcher(appimage: &Path) -> Launcher {
        Launcher {
            id: "co.prometeu.desktop".into(),
            name: "Prometeu".into(),
            class: "Prometeu".into(),
            appimage: appimage.into(),
        }
    }

    #[test]
    fn the_entry_starts_the_appimage_and_claims_its_windows() {
        let data = temp();
        let appimage = data.join("Prometeu_x86_64.AppImage");
        integrate(&data, &launcher(&appimage)).unwrap();

        let icon = data.join("icons/hicolor/256x256/apps/co.prometeu.desktop.png");
        assert_eq!(fs::read(&icon).unwrap(), ICON);
        let entry =
            fs::read_to_string(data.join("applications/co.prometeu.desktop.desktop")).unwrap();
        assert!(entry.starts_with("[Desktop Entry]\nType=Application\nName=Prometeu\n"));
        assert!(entry.contains(&format!("\nExec=\"{}\"\n", appimage.display())));
        assert!(entry.contains(&format!("\nTryExec={}\n", appimage.display())));
        assert!(entry.contains(&format!("\nIcon={}\n", icon.display())));
        assert!(entry.contains("\nStartupWMClass=Prometeu\n"));
        // No temporary file is left beside the entry.
        assert_eq!(fs::read_dir(data.join("applications")).unwrap().count(), 1);
        fs::remove_dir_all(data).unwrap();
    }

    #[test]
    fn a_moved_appimage_moves_the_entry() {
        let data = temp();
        integrate(&data, &launcher(&data.join("old/Prometeu.AppImage"))).unwrap();
        integrate(&data, &launcher(&data.join("new/Prometeu.AppImage"))).unwrap();

        let entry =
            fs::read_to_string(data.join("applications/co.prometeu.desktop.desktop")).unwrap();
        assert!(entry.contains("/new/Prometeu.AppImage"));
        assert!(!entry.contains("/old/"));
        fs::remove_dir_all(data).unwrap();
    }

    #[test]
    fn an_integration_tool_keeps_the_only_entry() {
        let data = temp();
        let appimage = data.join("Applications/Prometeu.AppImage");
        let own = data.join("applications/co.prometeu.desktop.desktop");
        integrate(&data, &launcher(&appimage)).unwrap();
        assert!(own.exists());
        let tool = data.join("applications/appimagekit_0123-Prometeu.desktop");
        fs::write(
            &tool,
            format!("[Desktop Entry]\nExec={} %U\n", appimage.display()),
        )
        .unwrap();

        integrate(&data, &launcher(&appimage)).unwrap();
        assert!(!own.exists());
        assert!(tool.exists());
        // Later launches find nothing left to remove.
        integrate(&data, &launcher(&appimage)).unwrap();
        fs::remove_dir_all(data).unwrap();
    }

    #[test]
    fn a_launcher_for_a_similar_name_keeps_the_entry() {
        let data = temp();
        let appimage = data.join("Prometeu.AppImage");
        let own = data.join("applications/co.prometeu.desktop.desktop");
        integrate(&data, &launcher(&appimage)).unwrap();
        let old = data.join("applications/appimagekit_0123-Prometeu.desktop");
        fs::write(
            &old,
            format!("[Desktop Entry]\nExec={}.old\n", appimage.display()),
        )
        .unwrap();

        integrate(&data, &launcher(&appimage)).unwrap();
        assert!(own.exists());
        fs::remove_dir_all(data).unwrap();
    }

    #[test]
    fn program_reads_the_first_exec_word_like_glib() {
        let path = r#"/a b/$x "q" `b` back\slash;&.AppImage"#;
        assert_eq!(program(&exec_arg(path)), path);
        // AppImageLauncher, then Gear Lever's shlex quoting.
        assert_eq!(
            program(r#""/a b/Prometeu.AppImage" %U"#),
            "/a b/Prometeu.AppImage"
        );
        assert_eq!(
            program(r#"'/a b/it'"'"'s.AppImage' --no-sandbox"#),
            "/a b/it's.AppImage"
        );
    }

    #[test]
    fn only_a_mounted_appimage_file_gets_an_entry() {
        let dir = temp();
        let file = dir.join("Prometeu.AppImage");
        fs::write(&file, b"").unwrap();
        let mount = || Some(OsString::from("/tmp/.mount_PrometAbCdEf"));

        assert_eq!(
            mounted_appimage(Some(file.clone().into()), mount()),
            Some(file.clone())
        );
        let extracted = Some(OsString::from("/tmp/appimage_extracted_0123"));
        assert_eq!(mounted_appimage(Some(file.clone().into()), extracted), None);
        assert_eq!(mounted_appimage(Some(file.into()), None), None);
        assert_eq!(
            mounted_appimage(Some("Prometeu.AppImage".into()), mount()),
            None
        );
        assert_eq!(
            mounted_appimage(Some(dir.join("gone").into()), mount()),
            None
        );
        assert_eq!(mounted_appimage(None, mount()), None);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn exec_quotes_reserved_characters() {
        assert_eq!(
            exec_arg("/home/a b/x.AppImage"),
            r#""/home/a b/x.AppImage""#
        );
        assert_eq!(exec_arg(r#"/a$b"c`d\e"#), r#""/a\\$b\\"c\\`d\\\\e""#);
    }

    #[test]
    fn unrepresentable_paths_get_no_entry() {
        let icon = Path::new("/icon.png");
        assert!(entry(&launcher(Path::new("/a\nb.AppImage")), icon).is_none());
        assert!(entry(&launcher(Path::new("/100%.AppImage")), icon).is_none());
        assert!(entry(
            &launcher(Path::new("/x.AppImage")),
            Path::new("/i\tcon.png")
        )
        .is_none());
    }
}
