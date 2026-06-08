use serde::Serialize;
use std::{fs, net::TcpListener, path::Path, sync::Mutex};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};
use uuid::Uuid;

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
    let port = pick_free_port()?;
    let url = format!("http://127.0.0.1:{port}");

    let (mut rx, child) = app
        .shell()
        .sidecar("syncthing")?
        .args([
            "serve".to_string(),
            format!("--home={}", home.to_string_lossy()),
            format!("--gui-address={url}"),
            format!("--gui-apikey={api_key}"),
            "--no-browser".to_string(),
            "--no-restart".to_string(),
            "--no-upgrade".to_string(),
        ])
        // STMONITORED=yes tells Syncthing it is already supervised — skip its
        // own monitor/main fork. Without this, kill() leaves the inner main
        // process orphaned and the lockfile blocks the next start.
        .env("STMONITORED", "yes")
        .spawn()?;

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
        let shutdown_ok = try_graceful_shutdown(&endpoint);
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
}

fn try_graceful_shutdown(endpoint: &SyncthingEndpoint) -> bool {
    // Mini-HTTP-Call ohne async runtime — wir sind in shutdown, kein tokio.
    // Nutze std::net::TcpStream + manuelles HTTP/1.0 (paar bytes, kein Risk).
    let url = endpoint.url.replace("http://", "");
    let addr = match url.parse::<std::net::SocketAddr>() {
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
        endpoint.api_key
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
