//! Auswahl der Unterordner eines Abo-Ordners ändern — die Dateiseite.
//!
//! Syncthing gleicht nur ab, was die Auswahl-Schicht der .stignore durchlässt
//! (siehe src/lib/abo.ts, `auswahlSchicht`). Wird die Auswahl kleiner, bleiben
//! die abgewählten Dateien lokal liegen und sind danach ignoriert. Werden sie
//! nie gelöscht, kommen sie beim nächsten Vergrössern als „neue lokale
//! Änderung“ zurück und können auf dem NAS längst gelöschte oder neuere
//! Dateien überschreiben. Darum (live geprüft auf i9, 07.11.2026):
//!
//! - Verkleinern: erst wenn das NAS alles von hier hat, dann Ignore setzen,
//!   dann HIER löschen, was abgeglichen war und jetzt abgewählt ist. Gelöscht
//!   wird nur, was die alte Auswahl abdeckte — nie etwas, das ohnehin nie
//!   abgeglichen wurde, nie Geschütztes (Autosaves, .waechter …). Ist eine
//!   betroffene Datei jünger als die Prüfung, wird gar nichts gelöscht.
//! - Vergrössern: nur in Bereiche, in denen lokal nichts liegt („Streuner“).
//!
//! Muster: wie in der .stignore ohne führenden „/“ (gelten in jeder Tiefe,
//! samt Inhalt), `*` als einziger Platzhalter, `(?i)` für Gross/klein egal.

use serde::Serialize;
use std::{
    fs,
    path::{Component, Path, PathBuf},
    time::UNIX_EPOCH,
};

const BEISPIELE: usize = 20;

/// Ein Muster als Folge von Namens-Platzhaltern (z. B. `Saved/Autosaves`).
struct Muster {
    teile: Vec<String>,
    gross_klein_egal: bool,
}

impl Muster {
    fn neu(roh: &str) -> Option<Self> {
        let mut s = roh.trim();
        let mut ci = false;
        loop {
            if let Some(r) = s.strip_prefix("(?d)") {
                s = r;
            } else if let Some(r) = s.strip_prefix("(?i)") {
                s = r;
                ci = true;
            } else {
                break;
            }
        }
        let s = s.strip_prefix("**/").unwrap_or(s);
        if s.is_empty() || s.starts_with("//") || s.starts_with('/') || s.starts_with('!') {
            return None;
        }
        let teile: Vec<String> = s
            .split('/')
            .map(|t| if ci { t.to_lowercase() } else { t.to_string() })
            .collect();
        if teile.iter().any(|t| t.is_empty() || t == "**") {
            return None;
        }
        Some(Self { teile, gross_klein_egal: ci })
    }

    /// Trifft eine zusammenhängende Folge von Pfadteilen (Inhalt eingeschlossen).
    fn trifft(&self, teile: &[&str]) -> bool {
        let n = self.teile.len();
        if teile.len() < n {
            return false;
        }
        (0..=teile.len() - n).any(|start| {
            self.teile.iter().enumerate().all(|(i, m)| {
                let t = teile[start + i];
                if self.gross_klein_egal {
                    glob(m, &t.to_lowercase())
                } else {
                    glob(m, t)
                }
            })
        })
    }
}

/// `*` = beliebig viele Zeichen, sonst exakt.
fn glob(muster: &str, text: &str) -> bool {
    let teile: Vec<&str> = muster.split('*').collect();
    if teile.len() == 1 {
        return muster == text;
    }
    let mut rest = text;
    for (i, t) in teile.iter().enumerate() {
        if i == 0 {
            match rest.strip_prefix(t) {
                Some(r) => rest = r,
                None => return false,
            }
        } else if i == teile.len() - 1 {
            return rest.ends_with(t);
        } else {
            match rest.find(t) {
                Some(p) => rest = &rest[p + t.len()..],
                None => return false,
            }
        }
    }
    true
}

/// Deckt die Auswahl den Pfad ab? Leere Auswahl = ganzes Projekt.
/// Gleiche Bedeutung wie `auswahlSchicht`: gewählt sind die Pfade samt
/// Inhalt, `.syncomat` immer; alles andere (auch Dateien in den Elternordnern
/// der Gewählten und im Projektstamm) nicht.
///
/// Auf Windows und macOS vergleicht Syncthing Ignore-Muster ohne Rücksicht
/// auf Gross/klein — hier genauso, sonst hielte Rust eine Datei für abgewählt,
/// die Syncthing noch abgleicht (ihr Löschen reiste dann zum NAS).
fn abgedeckt(rel: &str, auswahl: &[String]) -> bool {
    let norm = |x: &str| if cfg!(any(windows, target_os = "macos")) { x.to_lowercase() } else { x.to_string() };
    let rel = norm(rel);
    if auswahl.is_empty() || rel == ".syncomat" || rel.starts_with(".syncomat/") {
        return true;
    }
    auswahl.iter().any(|s| {
        let s = norm(s);
        rel == s || (rel.len() > s.len() && rel.starts_with(s.as_str()) && rel.as_bytes()[s.len()] == b'/')
    })
}

fn auswahl_gueltig(auswahl: &[String]) -> Result<(), String> {
    for p in auswahl {
        let ok = !p.is_empty()
            && p.len() <= 2048
            && !p.contains('\\')
            && p.split('/').all(|t| {
                !t.is_empty() && t != "." && t != ".." && !t.starts_with('.') && t.trim() == t && !t.contains(':')
            });
        if !ok {
            return Err(format!("Ungültiger Auswahl-Pfad: {p}"));
        }
    }
    Ok(())
}

/// Wurzel prüfen: existierender Syncthing-Ordner (mit .stfolder), kein
/// Laufwerks- oder Systemstamm.
fn wurzel(root: &str) -> Result<PathBuf, String> {
    let p = fs::canonicalize(root).map_err(|e| format!("{root}: {e}"))?;
    let normale = p.components().filter(|c| matches!(c, Component::Normal(_))).count();
    if normale < 1 {
        return Err(format!("{root}: ein Laufwerks- oder Systemstamm wird nie bearbeitet."));
    }
    if !p.is_dir() {
        return Err(format!("{root} ist kein Ordner."));
    }
    if !p.join(".stfolder").is_dir() {
        return Err(format!("{root} ist kein Syncthing-Ordner (.stfolder fehlt)."));
    }
    Ok(p)
}

fn ist_verknuepfung(m: &fs::Metadata) -> bool {
    if m.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
        if m.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return true;
        }
    }
    false
}

/// Jüngste Zeit einer Datei in ms (Änderung, auf Windows/macOS auch Anlage —
/// eine hineinkopierte Datei behält ihr altes Änderungsdatum).
fn zeit_ms(m: &fs::Metadata) -> i64 {
    let ms = |t: std::io::Result<std::time::SystemTime>| {
        t.ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0)
    };
    ms(m.modified()).max(ms(m.created()))
}

struct Datei {
    rel: String,
    pfad: PathBuf,
    bytes: u64,
    zeit: i64,
}

/// Alle Dateien unter der Wurzel (ohne Verknüpfungen, ohne Syncthing-Eigenes).
fn dateien(wurzel: &Path) -> Result<Vec<Datei>, String> {
    let mut out = Vec::new();
    let mut stapel = vec![(wurzel.to_path_buf(), String::new())];
    while let Some((dir, rel)) = stapel.pop() {
        let eintraege = fs::read_dir(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
        for e in eintraege {
            let e = e.map_err(|e| format!("{}: {e}", dir.display()))?;
            let name = e.file_name().to_string_lossy().into_owned();
            if rel.is_empty() && matches!(name.as_str(), ".stfolder" | ".stversions" | ".stignore") {
                continue;
            }
            let m = fs::symlink_metadata(e.path()).map_err(|err| format!("{}: {err}", e.path().display()))?;
            if ist_verknuepfung(&m) {
                continue;
            }
            let r = if rel.is_empty() { name } else { format!("{rel}/{name}") };
            if m.is_dir() {
                stapel.push((e.path(), r));
            } else if m.is_file() {
                out.push(Datei { rel: r, pfad: e.path(), bytes: m.len(), zeit: zeit_ms(&m) });
            }
        }
    }
    out.sort_by(|a, b| a.rel.cmp(&b.rel));
    Ok(out)
}

#[derive(Serialize, Debug, Default)]
pub struct AuswahlPruefung {
    /// Würden beim Verkleinern hier gelöscht (abgeglichen, jetzt abgewählt).
    pub entfernen_anzahl: u64,
    pub entfernen_bytes: u64,
    /// Einige davon (für die Gegenprobe bei Syncthing und die Anzeige).
    pub entfernen_beispiele: Vec<String>,
    /// Davon jünger als `seit_ms` — dann wird nichts gelöscht.
    pub neuere: Vec<String>,
    /// Liegen lokal in einem Bereich, der neu dazukäme.
    pub streuner: Vec<String>,
    pub streuner_anzahl: u64,
}

struct Regeln {
    schutz: Vec<Muster>,
    wegwerf: Vec<Muster>,
}

impl Regeln {
    fn neu(schutz: &[String], wegwerf: &[String]) -> Self {
        Self {
            schutz: schutz.iter().filter_map(|s| Muster::neu(s)).collect(),
            wegwerf: wegwerf.iter().filter_map(|s| Muster::neu(s)).collect(),
        }
    }
    fn trifft(liste: &[Muster], rel: &str) -> bool {
        let teile: Vec<&str> = rel.split('/').collect();
        liste.iter().any(|m| m.trifft(&teile))
    }
}

fn pruefen_intern(
    dateien: &[Datei],
    alt: &[String],
    neu: &[String],
    r: &Regeln,
    seit_ms: Option<i64>,
) -> (AuswahlPruefung, Vec<usize>) {
    let mut p = AuswahlPruefung::default();
    let mut weg = Vec::new();
    for (i, d) in dateien.iter().enumerate() {
        if Regeln::trifft(&r.schutz, &d.rel) {
            continue;
        }
        let in_alt = abgedeckt(&d.rel, alt);
        let in_neu = abgedeckt(&d.rel, neu);
        let wegwerf = Regeln::trifft(&r.wegwerf, &d.rel);
        if in_alt && !in_neu {
            p.entfernen_anzahl += 1;
            p.entfernen_bytes += d.bytes;
            weg.push(i);
            if !wegwerf && p.entfernen_beispiele.len() < BEISPIELE {
                p.entfernen_beispiele.push(d.rel.clone());
            }
            if let Some(seit) = seit_ms {
                if !wegwerf && d.zeit > seit && p.neuere.len() < BEISPIELE {
                    p.neuere.push(d.rel.clone());
                }
            }
        } else if in_neu && !in_alt && !wegwerf {
            p.streuner_anzahl += 1;
            if p.streuner.len() < BEISPIELE {
                p.streuner.push(d.rel.clone());
            }
        }
    }
    (p, weg)
}

/// Was eine Änderung der Auswahl hier bedeuten würde. Ändert nichts.
#[tauri::command]
pub fn auswahl_pruefen(
    root: String,
    alt: Vec<String>,
    neu: Vec<String>,
    schutz: Vec<String>,
    wegwerf: Vec<String>,
    seit_ms: Option<i64>,
) -> Result<AuswahlPruefung, String> {
    auswahl_gueltig(&alt)?;
    auswahl_gueltig(&neu)?;
    let w = wurzel(&root)?;
    let d = dateien(&w)?;
    Ok(pruefen_intern(&d, &alt, &neu, &Regeln::neu(&schutz, &wegwerf), seit_ms).0)
}

#[derive(Serialize, Debug, Default)]
pub struct AuswahlEntfernt {
    pub geloescht: u64,
    pub bytes: u64,
    /// Dateien, die nicht gelöscht werden konnten (z. B. geöffnet).
    pub fehler: Vec<String>,
}

/// Löscht HIER, was die alte Auswahl abdeckte und die neue nicht mehr —
/// erst NACHDEM Syncthing die neue Auswahl übernommen hat (dann sind diese
/// Pfade ignoriert, das Löschen reist nicht mit). Ist eine betroffene Datei
/// jünger als `seit_ms`, wird nichts gelöscht.
#[tauri::command]
pub fn auswahl_entfernen(
    root: String,
    alt: Vec<String>,
    neu: Vec<String>,
    schutz: Vec<String>,
    wegwerf: Vec<String>,
    seit_ms: i64,
) -> Result<AuswahlEntfernt, String> {
    auswahl_gueltig(&alt)?;
    auswahl_gueltig(&neu)?;
    // macOS liefert Namen zerlegt (NFD), Syncthing vergleicht zusammengesetzt
    // (NFC) — ohne Normalisierung könnte ein gewählter Pfad als abgewählt
    // gelten. Abos gibt es nur auf den Windows-Rechnern (D:).
    if cfg!(target_os = "macos") {
        return Err("Auswahl ändern geht nur auf den Windows-Rechnern.".into());
    }
    if alt == neu {
        return Ok(AuswahlEntfernt::default());
    }
    let w = wurzel(&root)?;
    let d = dateien(&w)?;
    let (p, weg) = pruefen_intern(&d, &alt, &neu, &Regeln::neu(&schutz, &wegwerf), Some(seit_ms));
    if !p.neuere.is_empty() {
        return Err(format!(
            "Nichts gelöscht: {} Datei(en) in den abgewählten Ordnern sind neuer als die Prüfung, z. B. {}.",
            p.neuere.len(),
            p.neuere[0]
        ));
    }
    let mut out = AuswahlEntfernt::default();
    let mut ordner = std::collections::BTreeSet::new();
    for i in weg {
        let f = &d[i];
        // Gegenprobe: der Pfad liegt wirklich unter der Wurzel.
        if !f.pfad.starts_with(&w) {
            out.fehler.push(f.rel.clone());
            continue;
        }
        match fs::remove_file(&f.pfad) {
            Ok(()) => {
                out.geloescht += 1;
                out.bytes += f.bytes;
                let mut p = f.pfad.parent();
                while let Some(dir) = p {
                    if dir == w || !dir.starts_with(&w) {
                        break;
                    }
                    ordner.insert(dir.to_path_buf());
                    p = dir.parent();
                }
            }
            Err(e) => out.fehler.push(format!("{}: {e}", f.rel)),
        }
    }
    // Leer gewordene Ordner von tief nach flach entfernen (nur leere).
    let mut ordner: Vec<PathBuf> = ordner.into_iter().collect();
    ordner.sort_by_key(|p| std::cmp::Reverse(p.components().count()));
    for dir in ordner {
        let rel = dir.strip_prefix(&w).map(|r| r.to_string_lossy().replace('\\', "/")).unwrap_or_default();
        if rel.is_empty() || abgedeckt(&rel, &neu) || neu.iter().any(|s| s.starts_with(&format!("{rel}/"))) {
            continue;
        }
        let _ = fs::remove_dir(&dir);
    }
    Ok(out)
}

/// Leerer Arbeitsordner, um nur das Inhaltsverzeichnis eines Projekts zu
/// holen (für den Ordnerbaum, wenn dieser Rechner das Projekt nicht führt):
/// `<app_local_data>/inhalt/<folder_id>`. Nie auf D:, nie in einem Projekt.
#[tauri::command]
pub fn inhalt_ordner_pfad(app: tauri::AppHandle, folder_id: String) -> Result<String, String> {
    use tauri::Manager;
    let ok = folder_id.len() <= 80
        && folder_id.starts_with("dz-")
        && folder_id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_');
    if !ok {
        return Err(format!("Ungültige Ordner-ID {folder_id}"));
    }
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("app_local_data_dir: {e}"))?
        .join("inhalt");
    fs::create_dir_all(&dir).map_err(|e| format!("mkdir {}: {e}", dir.display()))?;
    Ok(dir.join(folder_id).to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(v: &[&str]) -> Vec<String> {
        v.iter().map(|x| x.to_string()).collect()
    }

    struct Tmp(PathBuf);
    impl Tmp {
        fn neu() -> Self {
            use std::sync::atomic::{AtomicU32, Ordering};
            static N: AtomicU32 = AtomicU32::new(0);
            let p = std::env::temp_dir().join(format!(
                "syncomat-auswahl-test-{}-{}",
                std::process::id(),
                N.fetch_add(1, Ordering::SeqCst)
            ));
            fs::create_dir_all(&p).unwrap();
            Self(p)
        }
        fn path(&self) -> &Path {
            &self.0
        }
    }
    impl Drop for Tmp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn projekt() -> Tmp {
        let t = Tmp::neu();
        let r = t.path();
        for f in [
            ".stfolder/x.txt",
            "00_PRODUKTION/briefing.txt",
            "03_UNREAL/P/Content/a.bin",
            "03_UNREAL/P/Intermediate/x.bin",
            "03_UNREAL/P/Saved/Autosaves/auto.bin",
            "04_SHOTS/SQ010/SH0010/plate.bin",
            "04_SHOTS/SQ020/SH0010/plate.bin",
            "04_SHOTS/notiz.txt",
            "wurzel.txt",
            ".syncomat/update/X.json",
        ] {
            let p = r.join(f);
            fs::create_dir_all(p.parent().unwrap()).unwrap();
            fs::write(p, b"x").unwrap();
        }
        t
    }

    fn schutz() -> Vec<String> {
        s(&[".waechter", "**/Saved/Autosaves", "**/Saved/Logs", "**/Saved/Config"])
    }
    fn wegwerf() -> Vec<String> {
        s(&["(?d)(?i)Thumbs.db", "(?d)*.tmp", "(?d)Intermediate", "(?d).vs"])
    }

    #[test]
    fn glob_und_muster() {
        assert!(glob("*.tmp", "a.tmp"));
        assert!(!glob("*.tmp", "a.tmpx"));
        assert!(glob("._*", "._x"));
        assert!(glob("*~", "a~"));
        let m = Muster::neu("(?d)(?i)Thumbs.db").unwrap();
        assert!(m.trifft(&["a", "THUMBS.DB"]));
        let m = Muster::neu("**/Saved/Autosaves").unwrap();
        assert!(m.trifft(&["03", "P", "Saved", "Autosaves", "x"]));
        assert!(!m.trifft(&["03", "P", "Saved", "MovieRenders"]));
        assert!(Muster::neu("// Kommentar").is_none());
        assert!(Muster::neu("!/03").is_none());
    }

    #[test]
    fn abdeckung_wie_ignore_schicht() {
        let a = s(&["03_UNREAL", "04_SHOTS/SQ010/SH0010"]);
        assert!(abgedeckt("03_UNREAL/P/x", &a));
        assert!(abgedeckt("04_SHOTS/SQ010/SH0010/plate.bin", &a));
        assert!(!abgedeckt("04_SHOTS/notiz.txt", &a));
        assert!(!abgedeckt("04_SHOTS/SQ010/SH00100/x", &a));
        assert!(!abgedeckt("wurzel.txt", &a));
        assert!(abgedeckt(".syncomat/update/X.json", &a));
        assert!(abgedeckt("irgendwas", &[]));
    }

    #[test]
    fn verkleinern_loescht_nur_abgewaehltes() {
        let t = projekt();
        let root = t.path().to_string_lossy().into_owned();
        let neu = s(&["03_UNREAL", "04_SHOTS/SQ010/SH0010"]);
        let p = auswahl_pruefen(root.clone(), vec![], neu.clone(), schutz(), wegwerf(), None).unwrap();
        assert_eq!(p.entfernen_anzahl, 4, "{p:?}"); // briefing, SQ020-plate, notiz, wurzel
        assert!(p.streuner.is_empty());
        let r = auswahl_entfernen(root, vec![], neu, schutz(), wegwerf(), i64::MAX).unwrap();
        assert_eq!(r.geloescht, 4);
        let w = t.path();
        assert!(!w.join("00_PRODUKTION").exists());
        assert!(!w.join("04_SHOTS/SQ020").exists());
        assert!(!w.join("wurzel.txt").exists());
        assert!(w.join("04_SHOTS/SQ010/SH0010/plate.bin").exists());
        assert!(w.join("03_UNREAL/P/Saved/Autosaves/auto.bin").exists());
        assert!(w.join(".stfolder/x.txt").exists());
        assert!(w.join(".syncomat/update/X.json").exists());
    }

    #[test]
    fn nie_loeschen_was_nie_abgeglichen_war() {
        let t = projekt();
        let root = t.path().to_string_lossy().into_owned();
        // alt: nur 03_UNREAL — 00_PRODUKTION liegt lokal, war aber ignoriert
        let r = auswahl_entfernen(root, s(&["03_UNREAL", "00_PRODUKTION"]), s(&["03_UNREAL"]), schutz(), wegwerf(), i64::MAX)
            .unwrap();
        assert_eq!(r.geloescht, 1); // nur briefing.txt
        assert!(t.path().join("04_SHOTS/notiz.txt").exists());
        assert!(t.path().join("wurzel.txt").exists());
    }

    #[test]
    fn neuere_datei_verhindert_jedes_loeschen() {
        let t = projekt();
        let root = t.path().to_string_lossy().into_owned();
        let e = auswahl_entfernen(root, vec![], s(&["03_UNREAL"]), schutz(), wegwerf(), 0).unwrap_err();
        assert!(e.contains("Nichts gelöscht"), "{e}");
        assert!(t.path().join("00_PRODUKTION/briefing.txt").exists());
    }

    #[test]
    fn vergroessern_findet_streuner() {
        let t = projekt();
        let root = t.path().to_string_lossy().into_owned();
        let p = auswahl_pruefen(root.clone(), s(&["03_UNREAL"]), s(&["03_UNREAL", "04_SHOTS"]), schutz(), wegwerf(), None)
            .unwrap();
        assert_eq!(p.streuner_anzahl, 3);
        assert_eq!(p.entfernen_anzahl, 0);
        fs::remove_dir_all(t.path().join("04_SHOTS")).unwrap();
        let p = auswahl_pruefen(root, s(&["03_UNREAL"]), s(&["03_UNREAL", "04_SHOTS"]), schutz(), wegwerf(), None).unwrap();
        assert_eq!(p.streuner_anzahl, 0);
    }

    #[test]
    fn wurzel_ohne_stfolder_abgelehnt() {
        let t = Tmp::neu();
        let e = auswahl_pruefen(t.path().to_string_lossy().into_owned(), vec![], s(&["a"]), vec![], vec![], None).unwrap_err();
        assert!(e.contains(".stfolder"));
        assert!(auswahl_gueltig(&s(&["../x"])).is_err());
        assert!(auswahl_gueltig(&s(&["a/.git"])).is_err());
        assert!(auswahl_gueltig(&s(&["C:/x"])).is_err());
    }
}
