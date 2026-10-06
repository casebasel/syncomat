use serde::Serialize;
use std::{
    fs,
    net::TcpListener,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::Duration,
};
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

/// Gesetzt, sobald die App beendet wird — dann ist ein beendetes Syncthing
/// gewollt und wird NICHT neu gestartet.
static SHUTTING_DOWN: AtomicBool = AtomicBool::new(false);

/// Wartezeiten zwischen Neustart-Versuchen nach einem Absturz (Sekunden).
/// Der letzte Wert gilt für alle weiteren Versuche.
const RESTART_BACKOFF_S: [u64; 5] = [2, 5, 15, 30, 60];

/// Startet den Syncthing-Prozess. Ausgelagert, damit der Supervisor ihn nach
/// einem Absturz mit identischem Port + API-Key neu starten kann (das Frontend
/// behält so seinen Endpoint).
fn launch(
    app: &AppHandle,
    home: &Path,
    url: &str,
    api_key: &str,
) -> Result<(tauri::async_runtime::Receiver<CommandEvent>, CommandChild), String> {
    // SECURITY (Audit): API-Key + GUI-Address kommen über ENV statt argv.
    // Auf Unix/macOS sind argv via `ps aux` / /proc/<pid>/cmdline für andere
    // User des Systems lesbar — ENV-Vars sind privater (auch wenn nicht
    // perfekt geschützt). Plus: matched what Syncthing's docs recommend.
    let (rx, child) = app
        .shell()
        .sidecar("syncthing")
        .map_err(|e| e.to_string())?
        .args([
            "serve".to_string(),
            format!("--home={}", home.to_string_lossy()),
            "--no-browser".to_string(),
            "--no-restart".to_string(),
            "--no-upgrade".to_string(),
        ])
        .env("STMONITORED", "yes")
        .env("STGUIAPIKEY", api_key)
        .env("STGUIADDRESS", url)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok((rx, child))
}

fn write_runtime_file(app_data: &Path, pid: u32, port: u16) {
    // Laufzeit-Info (pid + port) persistieren, damit der NÄCHSTE App-Start einen
    // evtl. verwaisten syncthing gezielt graceful beenden kann. Wird in cleanup()
    // bei sauberem Beenden wieder gelöscht.
    let _ = fs::write(
        app_data.join("syncthing-runtime.json"),
        format!("{{\"pid\":{pid},\"port\":{port}}}"),
    );
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

    let (rx, child) = launch(app, &home, &url, &api_key)?;
    write_runtime_file(&app_data, child.pid(), port);

    // Supervisor: liest die Ausgabe und startet Syncthing nach einem Absturz neu.
    // Vorher (bis v0.9.12) wurde ein beendetes Syncthing nur geloggt — die App
    // zeigte weiter "aktuell", obwohl nichts mehr synchronisierte (--no-restart
    // verhindert den eigenen Neustart von Syncthing).
    let handle = app.clone();
    let (home2, url2, key2) = (home.clone(), url.clone(), api_key.clone());
    tauri::async_runtime::spawn(async move {
        supervise(handle, rx, app_data, home2, url2, key2, port).await;
    });

    Ok(SyncthingState {
        endpoint: SyncthingEndpoint { url, api_key },
        child: Mutex::new(Some(child)),
    })
}

async fn supervise(
    app: AppHandle,
    mut rx: tauri::async_runtime::Receiver<CommandEvent>,
    app_data: PathBuf,
    home: PathBuf,
    url: String,
    api_key: String,
    port: u16,
) {
    let mut attempt: usize = 0;
    loop {
        let mut ready_emitted = false;
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) | CommandEvent::Stderr(bytes) => {
                    let line = String::from_utf8_lossy(&bytes);
                    print!("[syncthing] {line}");
                    if !ready_emitted && line.contains("GUI and API listening") {
                        let _ = app.emit("syncthing://ready", ());
                        ready_emitted = true;
                        attempt = 0; // läuft wieder stabil -> Backoff zurücksetzen
                    }
                }
                CommandEvent::Error(e) => eprintln!("[syncthing-spawn-error] {e}"),
                CommandEvent::Terminated(p) => {
                    println!("[syncthing] terminated {p:?}");
                    break;
                }
                _ => {}
            }
        }

        if SHUTTING_DOWN.load(Ordering::SeqCst) {
            return;
        }
        // Unerwartet beendet -> Frontend informieren (setzt "bereit" zurück und
        // zeigt "Sync-Dienst startet"), dann mit Backoff neu starten, bis es klappt.
        let _ = app.emit("syncthing://terminated", ());
        loop {
            let wait = RESTART_BACKOFF_S[attempt.min(RESTART_BACKOFF_S.len() - 1)];
            attempt += 1;
            eprintln!("[syncthing] unerwartet beendet — Neustart in {wait}s (Versuch {attempt})");
            let _ = tauri::async_runtime::spawn_blocking(move || {
                std::thread::sleep(Duration::from_secs(wait))
            })
            .await;
            if SHUTTING_DOWN.load(Ordering::SeqCst) {
                return;
            }
            match launch(&app, &home, &url, &api_key) {
                Ok((new_rx, child)) => {
                    write_runtime_file(&app_data, child.pid(), port);
                    if let Some(state) = app.try_state::<SyncthingState>() {
                        if let Ok(mut guard) = state.child.lock() {
                            *guard = Some(child);
                        }
                    }
                    rx = new_rx;
                    break;
                }
                Err(e) => eprintln!("[syncthing] Neustart fehlgeschlagen: {e}"),
            }
        }
    }
}

pub fn cleanup(app: &AppHandle) {
    SHUTTING_DOWN.store(true, Ordering::SeqCst);
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
            // Sobald der API-Port keine Verbindung mehr annimmt, ist Syncthing
            // beendet -> nicht unnötig die vollen 8s warten (jeder Quit/Update hing).
            let addr = endpoint.url.replace("http://", "").parse::<std::net::SocketAddr>().ok();
            for _ in 0..80 {
                std::thread::sleep(Duration::from_millis(100));
                if let Some(a) = addr {
                    if std::net::TcpStream::connect_timeout(&a, Duration::from_millis(200)).is_err() {
                        break;
                    }
                }
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
