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
use tauri::Manager;

const SUBDIR: &str = ".syncomat";
const HINTS_DIR: &str = "net-hints";
/// Weitere Arten von Pro-Gerät-Dateien nach demselben Muster (eine Datei pro
/// Node unter `.syncomat/<art>/<deviceID>.json`). Feste Liste: das Frontend darf
/// keine beliebigen Pfade wählen.
const NOTE_KINDS: &[&str] = &["update", "abos", "wunsch"];

fn note_dir(kind: &str) -> Result<&'static str, String> {
    NOTE_KINDS
        .iter()
        .copied()
        .find(|k| *k == kind)
        .ok_or_else(|| format!("unknown note kind: {kind}"))
}

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
    write_note(&folder_path, HINTS_DIR, &device_id, &content)
}

/// Schreibt die Datei DIESES Nodes für eine weitere Art (siehe NOTE_KINDS),
/// z. B. `.syncomat/update/<deviceID>.json`.
#[tauri::command]
pub fn device_note_write(
    folder_path: String,
    kind: String,
    device_id: String,
    content: String,
) -> Result<(), String> {
    write_note(&folder_path, note_dir(&kind)?, &device_id, &content)
}

/// Liest alle Dateien einer weiteren Art (siehe NOTE_KINDS) eines Ordners.
#[tauri::command]
pub fn device_notes_read_all(folder_path: String, kind: String) -> Result<Vec<String>, String> {
    read_notes(&folder_path, note_dir(&kind)?)
}

fn write_note(folder_path: &str, sub: &str, device_id: &str, content: &str) -> Result<(), String> {
    let base = Path::new(&folder_path);
    if !base.is_dir() {
        return Err(format!("folder path is not a directory: {folder_path}"));
    }
    let safe = safe_name(device_id);
    if safe.is_empty() {
        return Err("empty device_id".into());
    }
    let dir = base.join(SUBDIR).join(sub);
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
    read_notes(&folder_path, HINTS_DIR)
}

fn read_notes(folder_path: &str, sub: &str) -> Result<Vec<String>, String> {
    let dir = Path::new(folder_path).join(SUBDIR).join(sub);
    let Ok(entries) = fs::read_dir(&dir) else {
        return Ok(vec![]);
    };
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let p = entry.path();
        let name = entry.file_name();
        let name = name.to_string_lossy();
        // Reste still wegräumen: sync-conflict-Varianten (pro Node eine Datei,
        // Konflikte sind hier nie gewollt) und liegengebliebene .tmp-Halbschreibungen.
        if name.contains(".sync-conflict-") || name.ends_with(".json.tmp") {
            let _ = fs::remove_file(&p);
            continue;
        }
        if !name.ends_with(".json") {
            continue;
        }
        if let Ok(s) = fs::read_to_string(&p) {
            out.push(s);
        }
    }
    Ok(out)
}

/// Pfad des internen Syncthing-Ordners `syncomat-intern` (im App-Datenordner,
/// nicht bei den Nutzerdaten). Legt das Verzeichnis an, falls es fehlt. Über
/// diesen Ordner reisen Versionen und Steuerinfos an alle syncomat-Geräte —
/// auch an Geräte, die (noch) keinen Nutzer-Ordner abonniert haben.
#[tauri::command]
pub fn intern_folder_path(app: tauri::AppHandle) -> Result<String, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?
        .join("intern");
    fs::create_dir_all(&dir).map_err(|e| format!("mkdir {}: {e}", dir.display()))?;
    Ok(dir.to_string_lossy().into_owned())
}

/// Ordner des Kanals `syncomat-waechter` (nur lesen: der Wächter schreibt am
/// Hub, die Rechner empfangen). Wie der interne Kanal im App-Datenordner.
#[tauri::command]
pub fn waechter_folder_path(app: tauri::AppHandle) -> Result<String, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?
        .join("waechter");
    fs::create_dir_all(&dir).map_err(|e| format!("mkdir {}: {e}", dir.display()))?;
    Ok(dir.to_string_lossy().into_owned())
}

/// Eine Datei aus dem Wächter-Kanal lesen: nur `geraete.json` oder
/// `inhalt/<folder-id>.json`; None, wenn es sie (noch) nicht gibt.
#[tauri::command]
pub fn waechter_lesen(app: tauri::AppHandle, rel: String) -> Result<Option<String>, String> {
    let erlaubt = rel == "geraete.json"
        || (rel.starts_with("inhalt/")
            && rel.ends_with(".json")
            && rel["inhalt/".len()..rel.len() - 5]
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
    if !erlaubt {
        return Err(format!("nicht erlaubt: {rel}"));
    }
    let p = Path::new(&waechter_folder_path(app)?).join(&rel);
    match fs::read_to_string(&p) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("{}: {e}", p.display())),
    }
}
