// Cluster-weite 10GbE-Adress-Hints. Jeder Node schreibt SEINE bekannten schnellen
// Adressen in eine EIGENE Datei `.syncomat/net-hints/<deviceID>.json` — pro Node
// eine Datei, darum NIE Merge-Konflikte (anders als die eine folder-defaults.json).
// Syncthing synct `.syncomat/` eh mit → die Hints propagieren cluster-weit, und
// jeder Node liest alle Dateien + merged. So kennt jeder Node die schnelle Adresse
// jedes Geräts, auch ohne es je selbst über 10GbE gesehen zu haben.
use std::{
    fs,
    io::Write,
    path::Path,
};

const SUBDIR: &str = ".syncomat";
const HINTS_DIR: &str = "net-hints";

/// Geräte-ID auf dateinamen-sichere Zeichen reduzieren (Syncthing-IDs sind
/// alphanumerisch + Bindestriche, also passiert hier real nichts — reiner Schutz).
fn safe_name(device_id: &str) -> String {
    device_id
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '-')
        .collect()
}

/// Schreibt die Hints DIESES Nodes als `.syncomat/net-hints/<deviceID>.json`.
/// `content` ist das fertige JSON vom Frontend (atomar via tmp+rename).
#[tauri::command]
pub fn network_hints_write(
    folder_path: String,
    device_id: String,
    content: String,
) -> Result<(), String> {
    let base = Path::new(&folder_path);
    if !base.is_dir() {
        return Err(format!("folder path is not a directory: {folder_path}"));
    }
    let safe = safe_name(&device_id);
    if safe.is_empty() {
        return Err("empty device_id".into());
    }
    let dir = base.join(SUBDIR).join(HINTS_DIR);
    fs::create_dir_all(&dir).map_err(|e| format!("mkdir {}: {e}", dir.display()))?;
    let path = dir.join(format!("{safe}.json"));

    let tmp = path.with_extension("json.tmp");
    {
        let mut f = fs::File::create(&tmp).map_err(|e| format!("create tmp: {e}"))?;
        f.write_all(content.as_bytes())
            .map_err(|e| format!("write: {e}"))?;
        f.sync_all().map_err(|e| format!("fsync: {e}"))?;
    }
    fs::rename(&tmp, &path).map_err(|e| format!("rename: {e}"))?;
    Ok(())
}

/// Liest ALLE `.syncomat/net-hints/*.json` eines Ordners (von allen Nodes, die
/// diesen Ordner teilen) als rohe JSON-Strings zurück. Das Frontend parst +
/// merged. Fehlt das Verzeichnis → leere Liste (kein Fehler).
#[tauri::command]
pub fn network_hints_read_all(folder_path: String) -> Result<Vec<String>, String> {
    let dir = Path::new(&folder_path).join(SUBDIR).join(HINTS_DIR);
    let Ok(entries) = fs::read_dir(&dir) else {
        return Ok(vec![]);
    };
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let p = entry.path();
        // .json (aber keine .json.tmp Halbschreibungen + keine sync-conflict-Reste)
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if !name.ends_with(".json") || name.contains(".sync-conflict-") {
            continue;
        }
        if let Ok(s) = fs::read_to_string(&p) {
            out.push(s);
        }
    }
    Ok(out)
}
