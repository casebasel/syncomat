// Prüfungen für ein Abo (Datenzentrale, Schritt 3): Laufwerk der Rolle und
// Zielordner. Syncomat legt einen Abo-Ordner nur auf einem passenden
// Laufwerk (NTFS/APFS, genug Platz) und nur in ein leeres oder fehlendes Ziel.
use serde::Serialize;
use std::{fs, path::Path};

#[derive(Serialize)]
pub struct DiskInfo {
    pub mount_point: String,
    pub file_system: String,
    pub total_bytes: u64,
    pub available_bytes: u64,
}

/// Laufwerk, auf dem `path` liegt (längster passender Einhängepunkt).
#[tauri::command]
pub fn disk_info(path: String) -> Result<DiskInfo, String> {
    let disks = sysinfo::Disks::new_with_refreshed_list();
    let target = Path::new(&path);
    let target_norm = target.to_string_lossy().to_lowercase();
    disks
        .list()
        .iter()
        .filter(|d| {
            let mp = d.mount_point().to_string_lossy().to_lowercase();
            target_norm.starts_with(&mp)
        })
        .max_by_key(|d| d.mount_point().as_os_str().len())
        .map(|d| DiskInfo {
            mount_point: d.mount_point().to_string_lossy().into_owned(),
            file_system: d.file_system().to_string_lossy().into_owned(),
            total_bytes: d.total_space(),
            available_bytes: d.available_space(),
        })
        .ok_or_else(|| format!("kein Laufwerk für {path} gefunden"))
}

/// Zustand eines Zielordners: "fehlt" | "leer" | "belegt" | "datei".
#[tauri::command]
pub fn path_state(path: String) -> Result<String, String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Ok("fehlt".into());
    }
    if !p.is_dir() {
        return Ok("datei".into());
    }
    let mut it = fs::read_dir(p).map_err(|e| format!("lesen {path}: {e}"))?;
    Ok(if it.next().is_none() { "leer" } else { "belegt" }.into())
}

/// Zielordner anlegen (nur wenn er fehlt oder leer ist — sonst Fehler).
#[tauri::command]
pub fn create_abo_dir(path: String) -> Result<(), String> {
    match path_state(path.clone())?.as_str() {
        "fehlt" => fs::create_dir_all(&path).map_err(|e| format!("anlegen {path}: {e}")),
        "leer" => Ok(()),
        other => Err(format!("Ziel {path} ist {other}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn disk_info_finds_root() {
        let d = disk_info(std::env::temp_dir().to_string_lossy().into_owned()).unwrap();
        assert!(d.total_bytes > 0);
        assert!(!d.mount_point.is_empty());
    }

    #[test]
    fn path_state_and_create() {
        let base = std::env::temp_dir().join(format!("syncomat-abo-test-{}", std::process::id()));
        let p = base.to_string_lossy().into_owned();
        assert_eq!(path_state(p.clone()).unwrap(), "fehlt");
        create_abo_dir(p.clone()).unwrap();
        assert_eq!(path_state(p.clone()).unwrap(), "leer");
        fs::write(base.join("x"), b"1").unwrap();
        assert_eq!(path_state(p.clone()).unwrap(), "belegt");
        assert!(create_abo_dir(p.clone()).is_err());
        fs::remove_dir_all(&base).unwrap();
    }
}
