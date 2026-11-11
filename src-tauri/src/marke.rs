//! Ordner-Marke `.stfolder` wiederherstellen.
//!
//! Syncthing hält einen Ordner an, wenn `.stfolder` fehlt („folder marker
//! missing“). Auslöser im Studio: „Überprüfen“ im Epic Launcher räumt alles
//! weg, was nicht zur Engine gehört (x5950, Marketplace 5.6, 11.11.2026).
//! Wie bei Resilio soll der Abgleich danach von selbst weiterlaufen — aber nur
//! so, dass ein geleerter Ordner nie als „alles gelöscht“ an die anderen geht.
//! Die Entscheidung trifft lib/marke.ts; hier nur Zählen und Anlegen.

use std::fs;
use std::path::{Component, Path, PathBuf};

fn ordner(root: &str) -> Result<PathBuf, String> {
    // Syncthing erlaubt „~/…“ im Pfad.
    let voll = match root.strip_prefix("~/").or_else(|| root.strip_prefix("~\\")) {
        Some(rest) => std::env::var_os("HOME")
            .or_else(|| std::env::var_os("USERPROFILE"))
            .map(|h| PathBuf::from(h).join(rest))
            .unwrap_or_else(|| PathBuf::from(root)),
        None => PathBuf::from(root),
    };
    let p = fs::canonicalize(&voll).map_err(|e| format!("{root}: {e}"))?;
    let normale = p.components().filter(|c| matches!(c, Component::Normal(_))).count();
    if normale < 1 {
        return Err(format!("{root}: ein Laufwerks- oder Systemstamm wird nie bearbeitet."));
    }
    if !p.is_dir() {
        return Err(format!("{root} ist kein Ordner."));
    }
    Ok(p)
}

/// Dateien unter `p` zählen (ohne Verknüpfungen, ohne Syncthing-Eigenes im Stamm).
fn zaehlen(p: &Path) -> u64 {
    let mut n = 0;
    let mut stapel = vec![(p.to_path_buf(), true)];
    while let Some((dir, stamm)) = stapel.pop() {
        let Ok(it) = fs::read_dir(&dir) else { continue };
        for e in it.flatten() {
            let name = e.file_name();
            if stamm && matches!(name.to_str(), Some(".stfolder" | ".stversions" | ".stignore")) {
                continue;
            }
            let Ok(m) = fs::symlink_metadata(e.path()) else { continue };
            if m.file_type().is_symlink() {
                continue;
            }
            if m.is_dir() {
                stapel.push((e.path(), false));
            } else if m.is_file() {
                n += 1;
            }
        }
    }
    n
}

#[derive(serde::Serialize)]
pub struct MarkeStand {
    /// Pfad existiert (sonst: Laufwerk weg — nie anfassen).
    pub vorhanden: bool,
    pub marke: bool,
    pub dateien: u64,
}

#[tauri::command]
pub fn marke_stand(root: String) -> Result<MarkeStand, String> {
    let Ok(p) = ordner(&root) else {
        return Ok(MarkeStand { vorhanden: false, marke: false, dateien: 0 });
    };
    Ok(MarkeStand { vorhanden: true, marke: p.join(".stfolder").is_dir(), dateien: zaehlen(&p) })
}

#[tauri::command]
pub fn marke_anlegen(root: String) -> Result<(), String> {
    let p = ordner(&root)?;
    let m = p.join(".stfolder");
    if m.is_dir() {
        return Ok(());
    }
    fs::create_dir(&m).map_err(|e| format!("{}: {e}", m.display()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zaehlt_ohne_eigenes() {
        let t = std::env::temp_dir().join(format!("syncomat-marke-{}", std::process::id()));
        let _ = fs::remove_dir_all(&t);
        fs::create_dir_all(t.join("a/b")).unwrap();
        fs::create_dir_all(t.join(".stversions")).unwrap();
        fs::write(t.join("a/x"), "1").unwrap();
        fs::write(t.join("a/b/y"), "1").unwrap();
        fs::write(t.join(".stignore"), "").unwrap();
        fs::write(t.join(".stversions/z"), "1").unwrap();
        let s = marke_stand(t.to_string_lossy().into()).unwrap();
        assert!(s.vorhanden && !s.marke && s.dateien == 2);
        marke_anlegen(t.to_string_lossy().into()).unwrap();
        assert!(marke_stand(t.to_string_lossy().into()).unwrap().marke);
        assert!(!marke_stand(t.join("fehlt").to_string_lossy().into()).unwrap().vorhanden);
        fs::remove_dir_all(&t).unwrap();
    }
}
