use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

const SCHEMA_VERSION: u32 = 1;
const FILENAME: &str = "ignored-folders.json";

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct IgnoredFolderEntry {
    pub folder_id: String,
    pub ignored_at: i64,
    /// Letzter bekannter Label des Folders — für die UI "Re-Enable"-Liste,
    /// damit User die ignorierten Ordner als "Footage RAW (ignoriert)" sieht
    /// statt nur die UUID.
    pub last_seen_label: Option<String>,
}

#[derive(Serialize, Deserialize, Debug)]
struct IgnoredFoldersFile {
    schema_version: u32,
    ignored: Vec<IgnoredFolderEntry>,
}

impl Default for IgnoredFoldersFile {
    fn default() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            ignored: Vec::new(),
        }
    }
}

pub struct IgnoredFoldersStore {
    path: PathBuf,
    inner: Mutex<IgnoredFoldersFile>,
}

fn now_unix() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

pub fn setup(app: &AppHandle) -> Result<IgnoredFoldersStore, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;
    fs::create_dir_all(&app_data).map_err(|e| format!("mkdir: {e}"))?;
    let path = app_data.join(FILENAME);
    let file = load_or_init(&path)?;
    Ok(IgnoredFoldersStore {
        path,
        inner: Mutex::new(file),
    })
}

fn load_or_init(path: &Path) -> Result<IgnoredFoldersFile, String> {
    if !path.exists() {
        let f = IgnoredFoldersFile::default();
        save_atomic(path, &f)?;
        return Ok(f);
    }
    let raw = fs::read_to_string(path).map_err(|e| format!("read: {e}"))?;
    match serde_json::from_str::<IgnoredFoldersFile>(&raw) {
        Ok(parsed) => Ok(parsed),
        Err(e) => {
            eprintln!("[ignored_folders] {} unparseable ({e}), starting fresh", path.display());
            let f = IgnoredFoldersFile::default();
            let _ = fs::rename(path, path.with_extension(format!("json.corrupt.{}", now_unix())));
            save_atomic(path, &f)?;
            Ok(f)
        }
    }
}

fn save_atomic(path: &Path, file: &IgnoredFoldersFile) -> Result<(), String> {
    let tmp = path.with_extension("json.tmp");
    let json = serde_json::to_string_pretty(file).map_err(|e| format!("serialize: {e}"))?;
    {
        let mut f = fs::File::create(&tmp).map_err(|e| format!("create tmp: {e}"))?;
        f.write_all(json.as_bytes()).map_err(|e| format!("write: {e}"))?;
        f.sync_all().map_err(|e| format!("fsync: {e}"))?;
    }
    fs::rename(&tmp, path).map_err(|e| format!("rename: {e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

impl IgnoredFoldersStore {
    fn save(&self) -> Result<(), String> {
        let guard = self.inner.lock().map_err(|_| "lock poisoned".to_string())?;
        save_atomic(&self.path, &guard)
    }
}

#[tauri::command]
pub fn ignored_folders_list(
    state: tauri::State<'_, IgnoredFoldersStore>,
) -> Result<Vec<IgnoredFolderEntry>, String> {
    let guard = state.inner.lock().map_err(|_| "lock poisoned".to_string())?;
    let mut v = guard.ignored.clone();
    v.sort_by_key(|e| std::cmp::Reverse(e.ignored_at));
    Ok(v)
}

#[tauri::command]
pub fn ignored_folders_add(
    state: tauri::State<'_, IgnoredFoldersStore>,
    folder_id: String,
    label: Option<String>,
) -> Result<(), String> {
    {
        let mut guard = state.inner.lock().map_err(|_| "lock poisoned".to_string())?;
        if guard.ignored.iter().any(|e| e.folder_id == folder_id) {
            // schon drin — update last_seen_label
            for e in guard.ignored.iter_mut() {
                if e.folder_id == folder_id {
                    if let Some(lbl) = &label {
                        e.last_seen_label = Some(lbl.clone());
                    }
                }
            }
        } else {
            guard.ignored.push(IgnoredFolderEntry {
                folder_id,
                ignored_at: now_unix(),
                last_seen_label: label,
            });
        }
    }
    state.save()
}

#[tauri::command]
pub fn ignored_folders_remove(
    state: tauri::State<'_, IgnoredFoldersStore>,
    folder_id: String,
) -> Result<(), String> {
    {
        let mut guard = state.inner.lock().map_err(|_| "lock poisoned".to_string())?;
        guard.ignored.retain(|e| e.folder_id != folder_id);
    }
    state.save()
}
