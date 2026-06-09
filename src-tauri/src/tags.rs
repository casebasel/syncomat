// Lokaler Tags-Store (Sprint #4): Tags sind eine reine UI-Gruppierung und
// leben PRO GERÄT in app_data — NICHT im gesyncten Ordner. Das war die bewusste
// Entscheidung gegen den folder-defaults-Sync-Footgun: nichts, was die App über
// sich selbst weiss, reist je durch den Sync-Kanal.
//
// Format: app_data/folder-tags.json  ->  { "<folderId>": ["tag1", "tag2"], ... }

use std::{collections::HashMap, fs, path::PathBuf, sync::Mutex};
use tauri::{AppHandle, Manager};

pub struct TagStore {
    path: PathBuf,
    inner: Mutex<HashMap<String, Vec<String>>>,
}

pub fn setup(app: &AppHandle) -> Result<TagStore, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("folder-tags.json");
    let inner: HashMap<String, Vec<String>> = fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    Ok(TagStore {
        path,
        inner: Mutex::new(inner),
    })
}

#[tauri::command]
pub fn tags_get_all(
    store: tauri::State<'_, TagStore>,
) -> Result<HashMap<String, Vec<String>>, String> {
    store
        .inner
        .lock()
        .map(|m| m.clone())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn tags_set(
    store: tauri::State<'_, TagStore>,
    folder_id: String,
    tags: Vec<String>,
) -> Result<(), String> {
    let mut m = store.inner.lock().map_err(|e| e.to_string())?;
    if tags.is_empty() {
        m.remove(&folder_id);
    } else {
        m.insert(folder_id, tags);
    }
    let json = serde_json::to_string_pretty(&*m).map_err(|e| e.to_string())?;
    fs::write(&store.path, json).map_err(|e| e.to_string())?;
    Ok(())
}
