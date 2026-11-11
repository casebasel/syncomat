//! Lokaler Papierkorb je Rechner (Marlon/stage-system 11.11.2026).
//!
//! Die neuere Fassung gewinnt ohne Konfliktkopie im Projekt. Was dieser Rechner
//! dabei verliert — von fern überschrieben, von fern gelöscht, oder die
//! unterlegene Fassung eines Konflikts — bleibt 30 Tage in einem versteckten
//! Papierkorb AUSSERHALB des Projekts: nicht sichtbar, nicht abgeglichen.
//!
//! Ort: pro Laufwerk `.syncomat-papierkorb/<Ordner-ID>` — gleiches Laufwerk wie
//! der Ordner, also verschieben statt kopieren (schnell, kein Platz auf C:).
//! - Windows: `X:\.syncomat-papierkorb\…` (versteckt)
//! - macOS: im Home `~/.syncomat-papierkorb/…`, auf externen Laufwerken
//!   `/Volumes/<Name>/.syncomat-papierkorb/…`
//! Nie im Marketplace-Ordner (Unreal fände die Plugins sonst doppelt).
//!
//! Die Papierkörbe von Syncthing (Ordner-Versionierung „trashcan“ mit diesem
//! Ablageort) und das Wegräumen neuer Konfliktkopien (lib/conflicts.ts)
//! benutzen denselben Ort. Leeren: Syncthing nach `cleanoutDays`; Reste von
//! Ordnern, die es hier nicht mehr gibt, räumt `papierkorb_aufraeumen` weg.

use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::{Duration, SystemTime};

pub const NAME: &str = ".syncomat-papierkorb";

fn home() -> Option<PathBuf> {
    std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")).map(PathBuf::from)
}

fn voll(root: &str) -> PathBuf {
    match root.strip_prefix("~/").or_else(|| root.strip_prefix("~\\")) {
        Some(rest) => home().map(|h| h.join(rest)).unwrap_or_else(|| PathBuf::from(root)),
        None => PathBuf::from(root),
    }
}

/// Ordner-ID als Verzeichnisname (nur harmlose Zeichen).
fn sicherer_name(id: &str) -> String {
    id.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' }).collect()
}

/// Basis des Papierkorbs für einen Ordnerpfad (ohne Ordner-ID).
fn basis(ordner: &Path) -> Result<PathBuf, String> {
    #[cfg(windows)]
    {
        // Laufwerksbuchstabe aus dem (kanonischen) Pfad, z. B. `\\?\D:\…` → `D:\`.
        for c in ordner.components() {
            if let Component::Prefix(p) = c {
                use std::path::Prefix;
                if let Prefix::Disk(d) | Prefix::VerbatimDisk(d) = p.kind() {
                    return Ok(PathBuf::from(format!("{}:\\", d as char)).join(NAME));
                }
            }
        }
        Err(format!("{}: kein Laufwerksbuchstabe (Netzlaufwerk?) — kein Papierkorb.", ordner.display()))
    }
    #[cfg(not(windows))]
    {
        if let Some(h) = home() {
            if ordner.starts_with(&h) {
                return Ok(h.join(NAME));
            }
        }
        let teile: Vec<Component> = ordner.components().collect();
        if teile.len() >= 3 && teile[1].as_os_str() == "Volumes" {
            return Ok(PathBuf::from("/Volumes").join(teile[2].as_os_str()).join(NAME));
        }
        home().map(|h| h.join(NAME)).ok_or_else(|| "kein Home-Verzeichnis".to_string())
    }
}

#[cfg(windows)]
fn verstecken(p: &Path) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let _ = std::process::Command::new("attrib")
        .arg("+h")
        .arg(p)
        .creation_flags(CREATE_NO_WINDOW)
        .status();
}

/// Papierkorb-Ordner für einen Syncthing-Ordner anlegen und seinen Pfad liefern.
#[tauri::command]
pub fn papierkorb_ordner(folder_path: String, folder_id: String) -> Result<String, String> {
    let o = fs::canonicalize(voll(&folder_path)).map_err(|e| format!("{folder_path}: {e}"))?;
    let b = basis(&o)?;
    let neu = !b.exists();
    let ziel = b.join(sicherer_name(&folder_id));
    fs::create_dir_all(&ziel).map_err(|e| format!("{}: {e}", ziel.display()))?;
    #[cfg(windows)]
    if neu {
        verstecken(&b);
    }
    #[cfg(not(windows))]
    let _ = neu;
    // Ohne `\\?\`-Präfix, so wie Syncthing Pfade erwartet.
    let s = ziel.to_string_lossy().to_string();
    Ok(s.strip_prefix(r"\\?\").map(str::to_string).unwrap_or(s))
}

/// Eine Datei aus dem Ordner in den Papierkorb verschieben (gleicher relativer
/// Pfad). Änderungszeit = jetzt, damit die 30 Tage ab heute zählen (wie bei
/// Syncthing selbst).
#[tauri::command]
pub fn in_papierkorb(folder_path: String, rel: String, papierkorb: String) -> Result<(), String> {
    let root = fs::canonicalize(voll(&folder_path)).map_err(|e| format!("{folder_path}: {e}"))?;
    let r = rel.replace('\\', "/");
    if r.is_empty() || r.starts_with('/') || r.split('/').any(|t| t == ".." || t.is_empty()) || r.contains('\0') {
        return Err(format!("ungültiger Pfad: {rel}"));
    }
    let quelle = root.join(&r);
    let quelle = fs::canonicalize(&quelle).map_err(|e| format!("{}: {e}", quelle.display()))?;
    if !quelle.starts_with(&root) || !quelle.is_file() {
        return Err(format!("{rel}: keine Datei in diesem Ordner"));
    }
    let ziel = PathBuf::from(&papierkorb).join(&r);
    if let Some(p) = ziel.parent() {
        fs::create_dir_all(p).map_err(|e| format!("{}: {e}", p.display()))?;
    }
    if fs::rename(&quelle, &ziel).is_err() {
        fs::copy(&quelle, &ziel).map_err(|e| format!("kopieren: {e}"))?;
        fs::remove_file(&quelle).map_err(|e| format!("entfernen: {e}"))?;
    }
    if let Ok(f) = fs::OpenOptions::new().write(true).open(&ziel) {
        let _ = f.set_modified(SystemTime::now());
    }
    Ok(())
}

/// Älter als `tage` (Änderungszeit) löschen, leere Ordner entfernen.
/// Liefert true, wenn `dir` danach leer ist.
fn leeren(dir: &Path, grenze: SystemTime) -> bool {
    let Ok(it) = fs::read_dir(dir) else { return false };
    let mut leer = true;
    for e in it.flatten() {
        let p = e.path();
        let Ok(m) = fs::symlink_metadata(&p) else {
            leer = false;
            continue;
        };
        if m.is_dir() {
            if leeren(&p, grenze) {
                let _ = fs::remove_dir(&p);
            } else {
                leer = false;
            }
        } else if m.modified().map(|t| t < grenze).unwrap_or(false) {
            if fs::remove_file(&p).is_err() {
                leer = false;
            }
        } else {
            leer = false;
        }
    }
    leer
}

/// Papierkörbe von Ordnern, die es hier nicht mehr gibt (Abo beendet), nach
/// `tage` leeren — für die aktiven sorgt Syncthing selbst. `basen` sind die
/// Papierkorb-Pfade der aktiven Ordner; deren Elternordner werden durchsucht.
#[tauri::command]
pub fn papierkorb_aufraeumen(aktive: Vec<String>, tage: u64) -> Result<u32, String> {
    let grenze = SystemTime::now() - Duration::from_secs(tage * 86_400);
    let aktiv: Vec<PathBuf> = aktive.iter().map(PathBuf::from).collect();
    let mut basen: Vec<PathBuf> = aktiv.iter().filter_map(|p| p.parent().map(Path::to_path_buf)).collect();
    basen.sort();
    basen.dedup();
    let mut weg = 0;
    for b in basen {
        if b.file_name().and_then(|n| n.to_str()) != Some(NAME) {
            continue; // nur echte Papierkorb-Basen
        }
        let Ok(it) = fs::read_dir(&b) else { continue };
        for e in it.flatten() {
            let p = e.path();
            if !p.is_dir() || aktiv.iter().any(|a| a == &p) {
                continue;
            }
            if leeren(&p, grenze) && fs::remove_dir(&p).is_ok() {
                weg += 1;
            }
        }
    }
    Ok(weg)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verschieben_und_aufraeumen() {
        let t = std::env::temp_dir().join(format!("syncomat-pk-{}", std::process::id()));
        let _ = fs::remove_dir_all(&t);
        let ordner = t.join("projekt");
        let pk = t.join(NAME);
        fs::create_dir_all(ordner.join("a")).unwrap();
        fs::write(ordner.join("a/x.sync-conflict-20261111-210056-ABC.txt"), "alt").unwrap();
        let aktiv = pk.join("dz-aktiv");
        in_papierkorb(
            ordner.to_string_lossy().into(),
            "a/x.sync-conflict-20261111-210056-ABC.txt".into(),
            aktiv.to_string_lossy().into(),
        )
        .unwrap();
        assert!(aktiv.join("a/x.sync-conflict-20261111-210056-ABC.txt").is_file());
        assert!(!ordner.join("a/x.sync-conflict-20261111-210056-ABC.txt").exists());
        assert!(in_papierkorb(ordner.to_string_lossy().into(), "../x".into(), aktiv.to_string_lossy().into()).is_err());
        // verwaister Papierkorb: frische Datei bleibt, mit 0 Tagen wird alles geleert
        let alt = pk.join("dz-weg");
        fs::create_dir_all(alt.join("b")).unwrap();
        fs::write(alt.join("b/y"), "1").unwrap();
        let a = vec![aktiv.to_string_lossy().to_string()];
        assert_eq!(papierkorb_aufraeumen(a.clone(), 30).unwrap(), 0);
        assert!(alt.join("b/y").exists());
        std::thread::sleep(Duration::from_millis(20));
        assert_eq!(papierkorb_aufraeumen(a, 0).unwrap(), 1);
        assert!(!alt.exists());
        assert!(aktiv.join("a").exists());
        fs::remove_dir_all(&t).unwrap();
    }
}
