use super::*;
use std::io::{Read, Write};
use std::sync::mpsc;

fn open(script: &str) -> StartedTerminal {
    let mut command = CommandBuilder::new("/bin/sh");
    command.args(["-c", script]);
    UnixTerminalFactory
        .open(command, TerminalSize { cols: 80, rows: 24 })
        .unwrap()
}
fn drain(mut reader: Box<dyn Read + Send>) -> mpsc::Receiver<Vec<u8>> {
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let mut all = vec![];
        let mut buf = [0; 1024];
        while let Ok(n) = reader.read(&mut buf) {
            if n == 0 {
                break;
            }
            all.extend_from_slice(&buf[..n]);
        }
        let _ = tx.send(all);
    });
    rx
}
#[test]
fn terminal_output_exit_code_and_repeated_wait_are_retained() {
    let mut terminal = open("printf service-output; exit 7");
    let output = drain(terminal.output)
        .recv_timeout(Duration::from_secs(5))
        .unwrap();
    assert_eq!(terminal.waiter.wait().unwrap(), 7);
    assert_eq!(terminal.waiter.wait().unwrap(), 7);
    assert!(!terminal.control.running());
    assert_eq!(output, b"service-output");
    terminal.control.close();
}
#[test]
fn terminal_input_and_resizing_reach_the_child() {
    let mut terminal = open("read value; printf 'answer=%s size=' \"$value\"; stty size");
    terminal
        .control
        .resize(TerminalSize { cols: 93, rows: 37 })
        .unwrap();
    terminal.input.write_all(b"hello\n").unwrap();
    terminal.input.flush().unwrap();
    let output = drain(terminal.output)
        .recv_timeout(Duration::from_secs(5))
        .unwrap();
    assert!(String::from_utf8_lossy(&output).contains("answer=hello size=37 93"));
    assert_eq!(terminal.waiter.wait().unwrap(), 0);
}
#[test]
fn output_eof_does_not_disable_shutdown_of_a_live_terminal_child() {
    let mut command = CommandBuilder::new("/bin/sh");
    command.args(["-c", "trap '' HUP TERM; printf ready; exec sleep 30"]);
    // End the injected reader after the readiness marker. Native PTYs differ in when
    // they report EOF for a live session; shutdown must remain independent of either.
    let mut terminal = open_with_streams(
        command,
        TerminalSize { cols: 80, rows: 24 },
        |master, closing| {
            let (reader, writer) = blocking_streams(master, closing)?;
            Ok((Box::new(reader.take(5)), writer))
        },
    )
    .unwrap();
    let output = drain(terminal.output)
        .recv_timeout(Duration::from_secs(5))
        .unwrap();
    assert_eq!(output, b"ready");
    assert!(terminal.control.running());
    assert!(running(terminal.control.system_id()));
    terminal.control.close();
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(terminal.waiter.wait());
    });
    assert!(rx.recv_timeout(Duration::from_secs(5)).unwrap().is_ok());
    assert!(!terminal.control.running());
}
fn running(pid: u32) -> bool {
    let out = std::process::Command::new("ps")
        .args(["-o", "stat=", "-p", &pid.to_string()])
        .output()
        .unwrap();
    let stat = String::from_utf8_lossy(&out.stdout).trim().to_string();
    !stat.is_empty() && !stat.starts_with('Z')
}
#[test]
fn closing_a_terminal_stops_its_group_and_reaps_its_leader() {
    let mut terminal =
        open("trap '' HUP; nohup sleep 30 >/dev/null 2>&1 & echo CHILD=$!; exec sleep 30");
    let mut reader = std::io::BufReader::new(terminal.output);
    let mut line = String::new();
    std::io::BufRead::read_line(&mut reader, &mut line).unwrap();
    let child: u32 = line.trim().strip_prefix("CHILD=").unwrap().parse().unwrap();
    let pid = terminal.control.system_id();
    let drained = drain(Box::new(reader));
    terminal.control.close();
    drained.recv_timeout(Duration::from_secs(5)).unwrap();
    terminal.waiter.wait().unwrap();
    let deadline = Instant::now() + Duration::from_secs(2);
    while running(child) && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(20));
    }
    assert!(!running(pid));
    assert!(!running(child));
}
#[test]
fn abandoning_the_terminal_waiter_kills_and_reaps() {
    let terminal = open("exec sleep 30");
    let pid = terminal.control.system_id();
    let drained = drain(terminal.output);
    drop(terminal.waiter);
    drained.recv_timeout(Duration::from_secs(5)).unwrap();
    assert!(!terminal.control.running());
    assert!(!running(pid));
}
fn eventually(condition: impl Fn() -> bool) -> bool {
    let deadline = Instant::now() + Duration::from_secs(5);
    while !condition() && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(20));
    }
    condition()
}
#[test]
fn a_running_command_is_told_apart_from_a_shell_waiting_for_input() {
    // With job control, as in an interactive shell, a command gets its own group and the
    // terminal; `true` keeps the shell from replacing itself with the command.
    let job = open("set -m; sleep 30; true");
    let job_output = drain(job.output);
    // `exec` replaces the shell with the command, which keeps the shell's process and group.
    let replaced = open("exec sleep 30");
    let replaced_output = drain(replaced.output);
    // The shell itself waiting for input cuts nothing off.
    let waiting = open("read value");
    let waiting_output = drain(waiting.output);
    assert!(eventually(|| job.control.running_command()));
    assert!(eventually(|| replaced.control.running_command()));
    assert!(!waiting.control.running_command());
    for (control, mut waiter, output) in [
        (job.control, job.waiter, job_output),
        (replaced.control, replaced.waiter, replaced_output),
        (waiting.control, waiting.waiter, waiting_output),
    ] {
        control.close();
        output.recv_timeout(Duration::from_secs(5)).unwrap();
        waiter.wait().unwrap();
    }
}

#[test]
fn dock_terminals_drop_the_launching_terminal_and_agent_and_present_prometeu() {
    let mut command = CommandBuilder::new("sh");
    for (key, value) in [
        ("CLAUDECODE", "1"),
        ("CLAUDE_CODE_SESSION_ID", "parent"),
        ("CODEX_THREAD_ID", "thread"),
        ("TMUX", "/tmp/tmux-501/default,1,0"),
        ("TMUX_PANE", "%1"),
        ("ITERM_SESSION_ID", "w0t0p0"),
        ("ZELLIJ", "0"),
        ("TERM", "xterm-ghostty"),
        ("TERM_PROGRAM", "iTerm.app"),
        ("TERM_PROGRAM_VERSION", "3.5"),
        ("HOME", "/Users/person"),
    ] {
        command.env(key, value);
    }
    own_terminal(&mut command, Some("1.2.3"));
    command.env("PROMETEU_WORKSPACE_PATH", "/worktree");
    command.env("PORT", "4100");
    let value = |key: &str| {
        command
            .get_env(key)
            .map(|value| value.to_str().unwrap().to_owned())
    };
    for key in LAUNCHER_ENV {
        assert_eq!(value(key), None, "{key}");
    }
    assert_eq!(value("TERM").as_deref(), Some("xterm-256color"));
    assert_eq!(value("TERM_PROGRAM").as_deref(), Some("Prometeu"));
    assert_eq!(value("TERM_PROGRAM_VERSION").as_deref(), Some("1.2.3"));
    assert_eq!(value("HOME").as_deref(), Some("/Users/person"));
    assert_eq!(
        value("PROMETEU_WORKSPACE_PATH").as_deref(),
        Some("/worktree")
    );
    assert_eq!(value("PORT").as_deref(), Some("4100"));

    // A host that does not know the app version claims none rather than the outer terminal's.
    let mut command = CommandBuilder::new("sh");
    command.env("TERM_PROGRAM_VERSION", "3.5");
    own_terminal(&mut command, None);
    assert_eq!(command.get_env("TERM_PROGRAM_VERSION"), None);
}
