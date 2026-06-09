// Remote-Syncthing-Nodes (z.B. der TrueNAS-Hub) — Zugangsdaten persistent in
// app_data, mode 0600 (wie invites.json). Syncomats API-Schicht ist bereits
// endpoint-parametrisiert; ein Remote ist also nur ein weiterer {url, api_key}.
// Phase B: damit kann Syncomat dem NAS Ordner anbieten + den Pfad dort setzen,
// ohne dass man die rohe Syncthing-Web-UI des NAS anfassen muss.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use tauri::{AppHandle, Manager};
use uuid::Uuid;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct RemoteNode {
    pub id: String,
    pub name: String,
    pub url: String,
    pub api_key: String,
}

fn store_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).ok();
    Ok(dir.join("remotes.json"))
}

fn read_all(app: &AppHandle) -> Vec<RemoteNode> {
    let Ok(p) = store_path(app) else {
        return vec![];
    };
    let Ok(raw) = fs::read_to_string(&p) else {
        return vec![];
    };
    serde_json::from_str(&raw).unwrap_or_default()
}

fn write_all(app: &AppHandle, nodes: &[RemoteNode]) -> Result<(), String> {
    let p = store_path(app)?;
    let json = serde_json::to_string_pretty(nodes).map_err(|e| e.to_string())?;
    fs::write(&p, json).map_err(|e| format!("write remotes: {e}"))?;
    set_perms_600(&p);
    Ok(())
}

#[cfg(unix)]
fn set_perms_600(p: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = fs::set_permissions(p, fs::Permissions::from_mode(0o600));
}
#[cfg(not(unix))]
fn set_perms_600(_: &Path) {}

#[tauri::command]
pub fn remotes_list(app: AppHandle) -> Result<Vec<RemoteNode>, String> {
    Ok(read_all(&app))
}

#[tauri::command]
pub fn remotes_add(
    app: AppHandle,
    name: String,
    url: String,
    api_key: String,
) -> Result<RemoteNode, String> {
    let url = url.trim().trim_end_matches('/').to_string();
    if url.is_empty() || api_key.trim().is_empty() {
        return Err("url und api_key dürfen nicht leer sein".into());
    }
    let mut nodes = read_all(&app);
    // Dedup nach URL: ein NAS = ein Eintrag (überschreibt Key/Name).
    nodes.retain(|n| n.url != url);
    let node = RemoteNode {
        id: Uuid::new_v4().to_string(),
        name: if name.trim().is_empty() {
            url.clone()
        } else {
            name.trim().to_string()
        },
        url,
        api_key: api_key.trim().to_string(),
    };
    nodes.push(node.clone());
    write_all(&app, &nodes)?;
    Ok(node)
}

#[tauri::command]
pub fn remotes_remove(app: AppHandle, id: String) -> Result<(), String> {
    let mut nodes = read_all(&app);
    nodes.retain(|n| n.id != id);
    write_all(&app, &nodes)
}
