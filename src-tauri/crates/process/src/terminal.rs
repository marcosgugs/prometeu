//! Native PTYs with one owner for group signaling and child reaping.
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use prometeu_core::lock::lock;
use prometeu_core::process::{ProcessControl, ShutdownPolicy};
use prometeu_core::terminal::{
    StartedTerminal, TerminalControl, TerminalError, TerminalFactory, TerminalSize, TerminalWait,
};
use std::io::{self, Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// Handles of the terminal or multiplexer that launched Prometeu, and markers of an agent session
/// it may run under. They describe where Prometeu came from, never one of its own terminals.
const LAUNCHER_ENV: &[&str] = &[
    "ITERM_SESSION_ID",
    "LC_TERMINAL",
    "LC_TERMINAL_VERSION",
    "KITTY_WINDOW_ID",
    "WEZTERM_PANE",
    "WT_SESSION",
    "TERM_SESSION_ID",
    "TMUX",
    "TMUX_PANE",
    "STY",
    "ZELLIJ",
    "ZELLIJ_SESSION_NAME",
    "ZELLIJ_PANE_ID",
    "CLAUDECODE",
    "CLAUDE_CODE_ENTRYPOINT",
    "CLAUDE_CODE_SESSION_ID",
    "CLAUDE_CODE_CHILD_SESSION",
    "CLAUDE_CODE_MESSAGING_TOKEN",
    "CLAUDE_CODE_SSE_PORT",
    "CODEX_THREAD_ID",
];

/// A dock shell or script runs in Prometeu's own terminal: it presents itself as Prometeu and
/// carries neither the launching terminal's identity nor a parent agent's session. `version` is
/// the app's, when the host knows it. Apply before the workspace variables, which it leaves alone.
pub fn own_terminal(command: &mut CommandBuilder, version: Option<&str>) {
    for key in LAUNCHER_ENV {
        command.env_remove(key);
    }
    command.env("TERM", "xterm-256color");
    command.env("TERM_PROGRAM", "Prometeu");
    match version {
        Some(version) => command.env("TERM_PROGRAM_VERSION", version),
        None => command.env_remove("TERM_PROGRAM_VERSION"),
    }
}

pub struct UnixTerminalFactory;
impl TerminalFactory<CommandBuilder> for UnixTerminalFactory {
    fn open(
        &self,
        command: CommandBuilder,
        size: TerminalSize,
    ) -> Result<StartedTerminal, TerminalError> {
        open_with_streams(command, size, blocking_streams)
    }
}
/// For hosts that need to cancel a blocked input worker without relying on slave closure.
pub struct ResponsiveTerminalFactory;
impl TerminalFactory<CommandBuilder> for ResponsiveTerminalFactory {
    fn open(
        &self,
        command: CommandBuilder,
        size: TerminalSize,
    ) -> Result<StartedTerminal, TerminalError> {
        open_with_streams(command, size, responsive_streams)
    }
}
type Streams = (Box<dyn Read + Send>, Box<dyn Write + Send>);
type OpenStreams = fn(&dyn MasterPty, Arc<AtomicBool>) -> Result<Streams, TerminalError>;
fn open_with_streams(
    command: CommandBuilder,
    size: TerminalSize,
    streams: OpenStreams,
) -> Result<StartedTerminal, TerminalError> {
    let pair = native_pty_system()
        .openpty(native_size(size))
        .map_err(|e| TerminalError::Open(e.to_string()))?;
    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|e| TerminalError::Spawn(e.to_string()))?;
    let group = Arc::new(Group {
        pid: child.process_id().unwrap_or(0),
        child: Mutex::new(ChildState {
            child: Some(child),
            exit: None,
        }),
        running: AtomicBool::new(true),
    });
    let waiter = Waiter(group.clone());
    drop(pair.slave);
    let closing = Arc::new(AtomicBool::new(false));
    let (output, input) = streams(pair.master.as_ref(), closing.clone())?;
    Ok(StartedTerminal {
        input,
        output,
        control: Arc::new(Control {
            master: Mutex::new(pair.master),
            group,
            closing,
        }),
        waiter: Box::new(waiter),
    })
}
fn blocking_streams(master: &dyn MasterPty, _: Arc<AtomicBool>) -> Result<Streams, TerminalError> {
    let output = master
        .try_clone_reader()
        .map_err(|e| TerminalError::Reader(e.to_string()))?;
    let input = master
        .take_writer()
        .map_err(|e| TerminalError::Writer(e.to_string()))?;
    Ok((output, input))
}
fn responsive_streams(
    master: &dyn MasterPty,
    closing: Arc<AtomicBool>,
) -> Result<Streams, TerminalError> {
    let fd = master
        .as_raw_fd()
        .ok_or_else(|| TerminalError::Writer("PTY descriptor unavailable".into()))?;
    // SAFETY: the master owns this live descriptor; cloned streams share its file description.
    let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
    if flags < 0 || unsafe { libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK) } < 0 {
        return Err(TerminalError::Writer(
            io::Error::last_os_error().to_string(),
        ));
    }
    let (reader, writer) = blocking_streams(master, closing.clone())?;
    Ok((
        Box::new(ResponsiveReader {
            reader,
            closing: closing.clone(),
        }),
        Box::new(ResponsiveWriter { writer, closing }),
    ))
}
struct ResponsiveReader {
    reader: Box<dyn Read + Send>,
    closing: Arc<AtomicBool>,
}
impl Read for ResponsiveReader {
    fn read(&mut self, bytes: &mut [u8]) -> io::Result<usize> {
        loop {
            match self.reader.read(bytes) {
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                    if self.closing.load(Ordering::Acquire) {
                        return Ok(0);
                    }
                    std::thread::sleep(Duration::from_millis(10));
                }
                Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
                result => return result,
            }
        }
    }
}
struct ResponsiveWriter {
    writer: Box<dyn Write + Send>,
    closing: Arc<AtomicBool>,
}
impl Write for ResponsiveWriter {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        loop {
            if self.closing.load(Ordering::Acquire) {
                return Err(io::Error::new(
                    io::ErrorKind::BrokenPipe,
                    "terminal input cancelled",
                ));
            }
            match self.writer.write(bytes) {
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                    std::thread::sleep(Duration::from_millis(10))
                }
                Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
                result => return result,
            }
        }
    }
    fn flush(&mut self) -> io::Result<()> {
        self.writer.flush()
    }
}

fn native_size(size: TerminalSize) -> PtySize {
    PtySize {
        cols: size.cols,
        rows: size.rows,
        pixel_width: 0,
        pixel_height: 0,
    }
}
struct ChildState {
    child: Option<Box<dyn Child + Send + Sync>>,
    exit: Option<u32>,
}
struct Group {
    pid: u32,
    child: Mutex<ChildState>,
    running: AtomicBool,
}
impl Group {
    fn signal(&self, signal: i32) {
        let mut state = lock(&self.child);
        let Some(child) = state.child.as_mut() else {
            return;
        };
        if self.pid == 0 {
            if signal == libc::SIGKILL {
                let _ = child.kill();
            }
            return;
        }
        // SAFETY: portable-pty starts a dedicated session. Its unreaped leader reserves the PID;
        // signaling and try_wait use the same lock, so no signal can race PID retirement.
        unsafe {
            libc::killpg(self.pid as libc::pid_t, signal);
        }
    }
    fn wait(&self) -> Result<u32, String> {
        loop {
            {
                let mut state = lock(&self.child);
                if let Some(code) = state.exit {
                    return Ok(code);
                }
                if let Some(exit) = state
                    .child
                    .as_mut()
                    .expect("unreaped terminal")
                    .try_wait()
                    .map_err(|e| e.to_string())?
                {
                    let code = exit.exit_code();
                    state.exit = Some(code);
                    state.child = None;
                    self.running.store(false, Ordering::Release);
                    return Ok(code);
                }
            }
            std::thread::sleep(Duration::from_millis(20));
        }
    }
}
impl ProcessControl for Group {
    fn system_id(&self) -> u32 {
        self.pid
    }
    fn running(&self) -> bool {
        self.running.load(Ordering::Acquire)
    }
    fn interrupt(&self) {
        self.signal(libc::SIGINT);
    }
    fn terminate(&self) {
        self.signal(libc::SIGTERM);
    }
    fn kill(&self) {
        self.signal(libc::SIGKILL);
    }
    fn wait_exit(&self, timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;
        while self.running() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(20));
        }
        !self.running()
    }
}
struct Control {
    master: Mutex<Box<dyn MasterPty + Send>>,
    group: Arc<Group>,
    closing: Arc<AtomicBool>,
}
impl TerminalControl for Control {
    fn resize(&self, size: TerminalSize) -> Result<(), String> {
        lock(&self.master)
            .resize(native_size(size))
            .map_err(|e| e.to_string())
    }
    fn running(&self) -> bool {
        self.group.running()
    }
    /// An interactive shell moves each job into its own process group and hands it the terminal,
    /// so a foreground group other than the shell's own is a command still running.
    fn foreground_job(&self) -> bool {
        lock(&self.master)
            .process_group_leader()
            .is_some_and(|leader| u32::try_from(leader).ok() != Some(self.group.pid))
    }
    fn system_id(&self) -> u32 {
        self.group.pid
    }
    fn close(&self) {
        if self.closing.swap(true, Ordering::Relaxed) {
            return;
        }
        self.group.signal(libc::SIGHUP);
        let group = self.group.clone();
        std::thread::spawn(move || ShutdownPolicy::TERMINAL.shutdown(group.as_ref()));
    }
}
struct Waiter(Arc<Group>);
impl TerminalWait for Waiter {
    fn wait(&mut self) -> Result<u32, String> {
        self.0.wait()
    }
}
impl Drop for Waiter {
    fn drop(&mut self) {
        self.0.kill();
        let _ = self.0.wait();
    }
}

#[cfg(test)]
mod tests;
