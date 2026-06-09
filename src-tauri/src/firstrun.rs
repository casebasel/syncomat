// "Schon mal eingerichtet?"-Marker (Sprint UX): ein winziges File in app_data,
// das gesetzt wird sobald je Ordner/Geräte existierten. Es ist BEWUSST in
// app_data (NICHT in localStorage oder der syncthing-home), damit es einen
// Config-Wipe übersteht — genau dann wollen wir „leere Config trotz früherer
// Einrichtung" erkennen und einen Recovery-Hinweis zeigen statt dem fröhlichen
// Erststart (der so täte, als wäre alles normal).

use std::fs;
use tauri::{AppHandle, Manager};

fn marker_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(dir.join(".configured"))
}

#[tauri::command]
pub fn config_ever_seen(app: AppHandle) -> Result<bool, String> {
    Ok(marker_path(&app)?.exists())
}

#[tauri::command]
pub fn config_mark_seen(app: AppHandle) -> Result<(), String> {
    let p = marker_path(&app)?;
    if !p.exists() {
        if let Some(parent) = p.parent() {
            fs::create_dir_all(parent).ok();
        }
        fs::write(&p, b"1").map_err(|e| e.to_string())?;
    }
    Ok(())
}
