use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

const SUBDIR: &str = ".syncomat";
const FILENAME: &str = "folder-defaults.json";
const SCHEMA_VERSION: u32 = 1;

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct FolderDefaults {
    /// "true" = versteckte Dateien (Pattern wie .*) werden ignoriert
    pub ignore_hidden: bool,
    /// "true" = Trashcan-Versioning: gelöschte Files landen im Papierkorb
    pub trashcan: bool,
    /// Wie viele Tage Papierkorb-Items behalten werden (0 = forever)
    pub trashcan_cleanout_days: u32,
    /// Cluster-Wide Deletion-Request: wenn true, alle Syncomat-Instanzen
    /// die diese Defaults sehen, zeigen dem User eine Confirm-Bestätigung
    /// "auch hier aus Syncomat entfernen?". Files bleiben überall lokal.
    #[serde(default)]
    pub deletion_requested: bool,
    /// Welches Gerät die Cluster-Deletion getriggert hat (für UI)
    #[serde(default)]
    pub deletion_requested_by: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct FolderDefaultsFile {
    pub schema_version: u32,
    pub updated_at: i64,
    pub updated_by: String,
    pub settings: FolderDefaults,
}

fn now_unix() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn defaults_path(folder_path: &Path) -> PathBuf {
    folder_path.join(SUBDIR).join(FILENAME)
}

#[tauri::command]
pub fn folder_settings_read(folder_path: String) -> Result<Option<FolderDefaultsFile>, String> {
    let path = defaults_path(Path::new(&folder_path));
    if !path.exists() {
        return Ok(None);
    }
    let raw = match fs::read_to_string(&path) {
        Ok(s) => s,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("read: {e}")),
    };
    // Korrupte JSON (partial write von concurrent Syncthing-Sync) → graceful None
    // statt 30s-Spam von parse-errors im Replication-Hook.
    match serde_json::from_str::<FolderDefaultsFile>(&raw) {
        Ok(parsed) => Ok(Some(parsed)),
        Err(e) => {
            eprintln!(
                "[folder_settings] {} unparseable ({e}), treating as missing",
                path.display()
            );
            Ok(None)
        }
    }
}

#[tauri::command]
pub fn folder_settings_write(
    folder_path: String,
    updated_by: String,
    settings: FolderDefaults,
) -> Result<FolderDefaultsFile, String> {
    let base = Path::new(&folder_path);
    if !base.exists() || !base.is_dir() {
        return Err(format!("folder path does not exist or is not a directory: {folder_path}"));
    }
    let dir = base.join(SUBDIR);
    fs::create_dir_all(&dir).map_err(|e| format!("mkdir {}: {e}", dir.display()))?;
    let path = dir.join(FILENAME);

    let file = FolderDefaultsFile {
        schema_version: SCHEMA_VERSION,
        updated_at: now_unix(),
        updated_by,
        settings,
    };

    let tmp = path.with_extension("json.tmp");
    let json = serde_json::to_string_pretty(&file).map_err(|e| format!("serialize: {e}"))?;
    {
        let mut f = fs::File::create(&tmp).map_err(|e| format!("create tmp: {e}"))?;
        f.write_all(json.as_bytes()).map_err(|e| format!("write: {e}"))?;
        f.sync_all().map_err(|e| format!("fsync: {e}"))?;
    }
    fs::rename(&tmp, &path).map_err(|e| format!("rename: {e}"))?;

    Ok(file)
}
