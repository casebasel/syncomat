use serde::Serialize;
use std::{fs, net::TcpListener, path::Path, sync::Mutex};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};
use uuid::Uuid;

#[cfg(windows)]
use std::os::windows::process::CommandExt;
// CREATE_NO_WINDOW — verhindert kurz aufblitzende Konsolenfenster beim
// powershell/taskkill-Aufruf während des App-Starts.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Clone, Serialize)]
pub struct SyncthingEndpoint {
    pub url: String,
    pub api_key: String,
}

pub struct SyncthingState {
    pub endpoint: SyncthingEndpoint,
    child: Mutex<Option<CommandChild>>,
}

pub fn spawn(app: &AppHandle) -> Result<SyncthingState, Box<dyn std::error::Error>> {
    let app_data = app.path().app_data_dir()?;
    let home = app_data.join("syncthing-home");
    fs::create_dir_all(&home)?;

    let api_key = read_or_generate_api_key(&app_data.join("api-key.txt"))?;

    // Selbst-Heilung: einen aus einem früheren App-Run verwaisten syncthing
    // sauber beenden BEVOR wir neu starten. Tritt auf wenn unser cleanup() umgangen
    // wurde (Updater-Relaunch, Crash, harter Quit) — dann hält der Alte die
    // leveldb-Sperre, der neue syncthing startet nicht, und die App hängt ewig auf
    // "Sync-Dienst startet noch". Graceful-Shutdown flusht zudem die Config, damit
    // frisch gepairte Geräte/Freigaben nicht verloren gehen.
    kill_stale_syncthing(&app_data, &home, &api_key);

    let port = pick_free_port()?;
    let url = format!("http://127.0.0.1:{port}");

    // SECURITY (Audit): API-Key + GUI-Address kommen über ENV statt argv.
    // Auf Unix/macOS sind argv via `ps aux` / /proc/<pid>/cmdline für andere
    // User des Systems lesbar — ENV-Vars sind privater (auch wenn nicht
    // perfekt geschützt). Plus: matched what Syncthing's docs recommend.
    let (mut rx, child) = app
        .shell()
        .sidecar("syncthing")?
        .args([
            "serve".to_string(),
            format!("--home={}", home.to_string_lossy()),
            "--no-browser".to_string(),
            "--no-restart".to_string(),
            "--no-upgrade".to_string(),
        ])
        .env("STMONITORED", "yes")
        .env("STGUIAPIKEY", &api_key)
        .env("STGUIADDRESS", &url)
        .spawn()?;

    // Laufzeit-Info (pid + port) persistieren, damit der NÄCHSTE App-Start einen
    // evtl. verwaisten syncthing gezielt graceful beenden kann. Wird in cleanup()
    // bei sauberem Beenden wieder gelöscht.
    let _ = fs::write(
        app_data.join("syncthing-runtime.json"),
        format!("{{\"pid\":{},\"port\":{}}}", child.pid(), port),
    );

    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut ready_emitted = false;
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) | CommandEvent::Stderr(bytes) => {
                    let line = String::from_utf8_lossy(&bytes);
                    print!("[syncthing] {line}");
                    if !ready_emitted && line.contains("GUI and API listening") {
                        let _ = handle.emit("syncthing://ready", ());
                        ready_emitted = true;
                    }
                }
                CommandEvent::Error(e) => eprintln!("[syncthing-spawn-error] {e}"),
                CommandEvent::Terminated(p) => println!("[syncthing] terminated {p:?}"),
                _ => {}
            }
        }
    });

    Ok(SyncthingState {
        endpoint: SyncthingEndpoint { url, api_key },
        child: Mutex::new(Some(child)),
    })
}

pub fn cleanup(app: &AppHandle) {
    let Some(state) = app.try_state::<SyncthingState>() else { return };
    let endpoint = state.endpoint.clone();
    let Ok(mut guard) = state.child.lock() else { return };
    if let Some(child) = guard.take() {
        // Graceful: HTTP POST /rest/system/shutdown → Syncthing schreibt seinen
        // leveldb-Index sauber raus + flush. Bei SIGKILL kann der Index für
        // große Folders corrupt werden → next-start = full rescan (Stunden).
        // Aktuell synchronous via blocking call; akzeptabel weil cleanup() im
        // shutdown-Path läuft.
        let shutdown_ok =
            try_graceful_shutdown(&endpoint.url.replace("http://", ""), &endpoint.api_key);
        if shutdown_ok {
            println!("[syncthing] graceful shutdown sent, waiting up to 8s");
            // Give Syncthing up to 8s to flush its leveldb + exit
            for _ in 0..80 {
                std::thread::sleep(std::time::Duration::from_millis(100));
                // Probe: nach erfolgreichem shutdown sollte unser child schon down sein.
                // Wir können hier nicht try_wait nutzen (CommandChild hat keine).
                // Stattdessen: bei graceful shutdown verlassen wir uns drauf dass
                // Syncthing innerhalb 8s den Prozess beendet — wenn nicht, fallback.
            }
        }
        // Final fallback: hard kill falls graceful nicht ging oder Syncthing hängt
        match child.kill() {
            Ok(()) => println!("[syncthing] stopped"),
            Err(e) => eprintln!("[syncthing-cleanup] kill failed: {e}"),
        }
    }
    // Sauber beendet -> Runtime-Marker löschen, damit der nächste Start nicht
    // versucht einen längst toten Prozess zu killen.
    if let Ok(dir) = app.path().app_data_dir() {
        let _ = fs::remove_file(dir.join("syncthing-runtime.json"));
    }
}

/// Beendet einen evtl. noch laufenden syncthing aus einem früheren App-Run.
/// Graceful (HTTP-Shutdown -> Config-Flush) wenn möglich, sonst hard kill.
/// PID-Reuse-Schutz: killt nur wenn der Prozess wirklich UNSER syncthing ist
/// (Command-Line enthält unseren home-Pfad).
fn kill_stale_syncthing(app_data: &Path, home: &Path, api_key: &str) {
    let runtime_file = app_data.join("syncthing-runtime.json");
    let Ok(contents) = fs::read_to_string(&runtime_file) else {
        return;
    };
    let (Some(pid), Some(port)) = (parse_json_u32(&contents, "pid"), parse_json_u32(&contents, "port"))
    else {
        let _ = fs::remove_file(&runtime_file);
        return;
    };
    if !pid_is_our_syncthing(pid, home) {
        // Längst tot oder PID anderweitig vergeben -> nichts killen.
        let _ = fs::remove_file(&runtime_file);
        return;
    }
    println!("[sidecar] verwaister syncthing (pid {pid}, port {port}) gefunden -> beende vor Neustart");
    // 1) Graceful: flusht die Config (sonst gehen frisch gepairte Geräte verloren).
    if try_graceful_shutdown(&format!("127.0.0.1:{port}"), api_key) {
        std::thread::sleep(std::time::Duration::from_millis(2500));
    }
    // 2) Hard-kill-Fallback, falls er noch lebt.
    if pid_is_our_syncthing(pid, home) {
        kill_pid(pid);
        std::thread::sleep(std::time::Duration::from_millis(500));
    }
    let _ = fs::remove_file(&runtime_file);
}

/// Mini-Parser für {"pid":123,"port":456} — kein serde_json nötig.
fn parse_json_u32(s: &str, key: &str) -> Option<u32> {
    let pat = format!("\"{key}\":");
    let start = s.find(&pat)? + pat.len();
    let rest = &s[start..];
    let end = rest
        .find(|c: char| !c.is_ascii_digit() && c != ' ')
        .unwrap_or(rest.len());
    rest[..end].trim().parse().ok()
}

/// Prüft (cross-platform, ohne extra Crate) ob `pid` lebt UND unser syncthing ist.
fn pid_is_our_syncthing(pid: u32, home: &Path) -> bool {
    let home_str = home.to_string_lossy();
    #[cfg(unix)]
    {
        if let Ok(out) = std::process::Command::new("ps")
            .args(["-p", &pid.to_string(), "-o", "command="])
            .output()
        {
            let cmd = String::from_utf8_lossy(&out.stdout);
            return cmd.contains("syncthing") && cmd.contains(home_str.as_ref());
        }
    }
    #[cfg(windows)]
    {
        if let Ok(out) = std::process::Command::new("powershell")
            .args([
                "-NoProfile",
                "-Command",
                &format!("(Get-CimInstance Win32_Process -Filter 'ProcessId={pid}').CommandLine"),
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
        {
            let cmd = String::from_utf8_lossy(&out.stdout);
            return cmd.contains("syncthing") && cmd.contains(home_str.as_ref());
        }
    }
    false
}

/// Hartes Beenden per PID (Fallback wenn graceful nicht griff).
fn kill_pid(pid: u32) {
    #[cfg(unix)]
    {
        let _ = std::process::Command::new("kill")
            .args(["-9", &pid.to_string()])
            .status();
    }
    #[cfg(windows)]
    {
        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/PID", &pid.to_string()])
            .creation_flags(CREATE_NO_WINDOW)
            .status();
    }
}

fn try_graceful_shutdown(addr_str: &str, api_key: &str) -> bool {
    // Mini-HTTP-Call ohne async runtime — wir sind in shutdown, kein tokio.
    // Nutze std::net::TcpStream + manuelles HTTP/1.0 (paar bytes, kein Risk).
    let addr = match addr_str.parse::<std::net::SocketAddr>() {
        Ok(a) => a,
        Err(_) => return false,
    };
    let mut stream = match std::net::TcpStream::connect_timeout(
        &addr,
        std::time::Duration::from_secs(2),
    ) {
        Ok(s) => s,
        Err(_) => return false,
    };
    let _ = stream.set_write_timeout(Some(std::time::Duration::from_secs(2)));
    let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(2)));
    use std::io::Write;
    let req = format!(
        "POST /rest/system/shutdown HTTP/1.0\r\n\
         Host: 127.0.0.1\r\n\
         X-API-Key: {}\r\n\
         Content-Length: 0\r\n\
         Connection: close\r\n\r\n",
        api_key
    );
    stream.write_all(req.as_bytes()).is_ok()
}

#[tauri::command]
pub fn syncthing_endpoint(state: tauri::State<'_, SyncthingState>) -> SyncthingEndpoint {
    state.endpoint.clone()
}

fn read_or_generate_api_key(path: &Path) -> std::io::Result<String> {
    if let Ok(existing) = fs::read_to_string(path) {
        let trimmed = existing.trim();
        if !trimmed.is_empty() {
            return Ok(trimmed.to_string());
        }
    }
    let key = Uuid::new_v4().to_string();
    fs::write(path, &key)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
    }
    Ok(key)
}

fn pick_free_port() -> std::io::Result<u16> {
    let listener = TcpListener::bind("127.0.0.1:0")?;
    let port = listener.local_addr()?.port();
    drop(listener);
    Ok(port)
}
