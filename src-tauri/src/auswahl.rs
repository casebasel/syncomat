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
//!   abgeglichen wurde, nie Geschütztes (Autosaves, .waechter …). Jede zu
//!   löschende Datei muss mit dem Index übereinstimmen (Grösse und
//!   Änderungszeit wie im globalen Stand, den das NAS vollständig hat) —
//!   weicht eine ab oder fehlt sie im Index, wird gar nichts gelöscht.
//! - Vergrössern: nur in Bereiche, in denen lokal nichts liegt („Streuner“).
//!
//! Muster: wie in der .stignore ohne führenden „/“ (gelten in jeder Tiefe,
//! samt Inhalt), `*` als einziger Platzhalter, `(?i)` für Gross/klein egal.

use serde::Serialize;
use unicode_normalization::UnicodeNormalization;
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
        let teile: Vec<String> = s.split('/').map(|t| t.to_string()).collect();
        // Nur `*` als Platzhalter verstanden; alles andere (`?`, `[`, `{`, `**`
        // mittendrin) → nicht verstanden (Aufrufer entscheidet, ob das ein Fehler ist).
        if teile.iter().any(|t| t.is_empty() || t.contains("**") || t.contains(['?', '[', ']', '{', '}', '\\'])) {
            return None;
        }
        // Syncthing vergleicht auf Windows und macOS immer ohne Gross/klein.
        let ci = ci || cfg!(any(windows, target_os = "macos"));
        let teile = if ci { teile.into_iter().map(|t| t.to_lowercase()).collect() } else { teile };
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

/// Änderungszeit in ms seit 1970 (wie im Syncthing-Index, `modTime`).
fn zeit_ms(m: &fs::Metadata) -> i64 {
    m.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(-1)
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
            // NFC wie im Syncthing-Index — macOS liefert Namen teils zerlegt (NFD).
            let name: String = e.file_name().to_string_lossy().nfc().collect();
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

/// Stand einer Datei im globalen Index: (Grösse, Änderungszeit in ms).
pub type Index = std::collections::HashMap<String, (u64, i64)>;

#[derive(Serialize, Debug, Default)]
pub struct AuswahlPruefung {
    /// Würden beim Verkleinern hier gelöscht (abgeglichen, jetzt abgewählt).
    pub entfernen_anzahl: u64,
    pub entfernen_bytes: u64,
    /// Zu löschende Dateien ohne Wegwerf (für die Gegenprobe bei Syncthing).
    pub entfernen_pfade: Vec<String>,
    /// Zu löschende Dateien, die NICHT dem Index entsprechen (fehlen dort,
    /// andere Grösse oder Zeit) — dann wird nichts gelöscht.
    pub abweichend: Vec<String>,
    pub abweichend_anzahl: u64,
    /// Liegen lokal in einem Bereich, der neu dazukäme.
    pub streuner: Vec<String>,
    pub streuner_anzahl: u64,
    /// Alle Streuner (bis STREUNER_MAX) — für die Einzelprüfung bei Syncthing.
    pub streuner_alle: Vec<String>,
}

const STREUNER_MAX: usize = 2000;

struct Regeln {
    schutz: Vec<Muster>,
    wegwerf: Vec<Muster>,
}

impl Regeln {
    /// Ein geschütztes Muster, das hier nicht verstanden wird, ist ein Fehler
    /// (sonst würde Geschütztes gelöscht). Ein unverstandenes Wegwerf-Muster
    /// wird nur nicht als Wegwerf behandelt — das ist die vorsichtige Seite.
    fn neu(schutz: &[String], wegwerf: &[String]) -> Result<Self, String> {
        let mut s = Vec::new();
        for m in schutz {
            match Muster::neu(m) {
                Some(x) => s.push(x),
                None => return Err(format!("Geschütztes Muster nicht verstanden: {m}")),
            }
        }
        Ok(Self { schutz: s, wegwerf: wegwerf.iter().filter_map(|w| Muster::neu(w)).collect() })
    }
    fn trifft(liste: &[Muster], rel: &str) -> bool {
        let teile: Vec<&str> = rel.split('/').collect();
        liste.iter().any(|m| m.trifft(&teile))
    }
}

/// Entspricht die Datei dem Index? Gleiche Grösse, Zeit innerhalb der
/// Toleranz des Dateisystems (NTFS 1 ms, exFAT 20 ms — speichert nur 10 ms genau).
fn wie_im_index(d: &Datei, index: &Index, toleranz_ms: i64) -> bool {
    match index.get(&d.rel) {
        Some(&(gr, zeit)) => gr == d.bytes && d.zeit >= 0 && (zeit - d.zeit).abs() <= toleranz_ms,
        None => false,
    }
}

/// Toleranz begrenzen: nie unter 1 ms, nie über 2 s.
fn toleranz(t: Option<i64>) -> i64 {
    t.unwrap_or(1).clamp(1, 2000)
}

fn pruefen_intern(
    dateien: &[Datei],
    alt: &[String],
    neu: &[String],
    r: &Regeln,
    index: Option<&Index>,
    toleranz_ms: i64,
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
            if !wegwerf {
                p.entfernen_pfade.push(d.rel.clone());
                if let Some(ix) = index {
                    if !wie_im_index(d, ix, toleranz_ms) {
                        p.abweichend_anzahl += 1;
                        if p.abweichend.len() < BEISPIELE {
                            p.abweichend.push(d.rel.clone());
                        }
                    }
                }
            }
        } else if in_neu && !in_alt && !wegwerf {
            p.streuner_anzahl += 1;
            if p.streuner.len() < BEISPIELE {
                p.streuner.push(d.rel.clone());
            }
            if p.streuner_alle.len() < STREUNER_MAX {
                p.streuner_alle.push(d.rel.clone());
            }
        }
    }
    (p, weg)
}

/// Was eine Änderung der Auswahl hier bedeuten würde. Ändert nichts.
/// Mit `index` wird jede zu löschende Datei gegen den Index geprüft.
#[tauri::command]
pub fn auswahl_pruefen(
    root: String,
    alt: Vec<String>,
    neu: Vec<String>,
    schutz: Vec<String>,
    wegwerf: Vec<String>,
    index: Option<Index>,
    toleranz_ms: Option<i64>,
) -> Result<AuswahlPruefung, String> {
    auswahl_gueltig(&alt)?;
    auswahl_gueltig(&neu)?;
    let alt: Vec<String> = alt.iter().map(|p| p.nfc().collect()).collect();
    let neu: Vec<String> = neu.iter().map(|p| p.nfc().collect()).collect();
    let w = wurzel(&root)?;
    let d = dateien(&w)?;
    Ok(pruefen_intern(&d, &alt, &neu, &Regeln::neu(&schutz, &wegwerf)?, index.as_ref(), toleranz(toleranz_ms)).0)
}

#[derive(Serialize, Debug, Default)]
pub struct AuswahlEntfernt {
    pub geloescht: u64,
    pub bytes: u64,
    /// Dateien, die nicht gelöscht werden konnten (z. B. geöffnet).
    pub fehler: Vec<String>,
}

/// Ist `rel` ein Elternordner eines gewählten Pfads? (Gross/klein wie `abgedeckt`.)
fn ist_ahn(rel: &str, auswahl: &[String]) -> bool {
    let norm = |x: &str| if cfg!(any(windows, target_os = "macos")) { x.to_lowercase() } else { x.to_string() };
    let r = format!("{}/", norm(rel));
    auswahl.iter().any(|s| norm(s).starts_with(&r))
}

/// Löscht HIER, was die alte Auswahl abdeckte und die neue nicht mehr —
/// erst NACHDEM Syncthing die neue Auswahl übernommen hat (dann sind diese
/// Pfade ignoriert, das Löschen reist nicht mit). Entspricht auch nur eine
/// betroffene Datei nicht dem `index` (Stand, den das NAS vollständig hat),
/// wird nichts gelöscht.
#[tauri::command]
pub fn auswahl_entfernen(
    root: String,
    alt: Vec<String>,
    neu: Vec<String>,
    schutz: Vec<String>,
    wegwerf: Vec<String>,
    index: Index,
    toleranz_ms: Option<i64>,
) -> Result<AuswahlEntfernt, String> {
    auswahl_gueltig(&alt)?;
    auswahl_gueltig(&neu)?;
    // Namen kommen NFC-normalisiert aus `dateien` (macOS: NFD auf der Platte),
    // die Auswahl ebenso — Vergleich wie bei Syncthing.
    let alt: Vec<String> = alt.iter().map(|p| p.nfc().collect()).collect();
    let neu: Vec<String> = neu.iter().map(|p| p.nfc().collect()).collect();
    if alt == neu {
        return Ok(AuswahlEntfernt::default());
    }
    let w = wurzel(&root)?;
    let d = dateien(&w)?;
    let (p, weg) = pruefen_intern(&d, &alt, &neu, &Regeln::neu(&schutz, &wegwerf)?, Some(&index), toleranz(toleranz_ms));
    if p.abweichend_anzahl > 0 {
        return Err(format!(
            "Nichts gelöscht: {} Datei(en) in den abgewählten Ordnern sind nicht im Stand, den das NAS hat (neu, verschoben, geändert oder gesperrt), z. B. {}.",
            p.abweichend_anzahl, p.abweichend[0]
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
    // Leer gewordene Ordner von tief nach flach entfernen (nur leere, nie
    // gewählte und nie Elternordner von Gewähltem).
    let mut ordner: Vec<PathBuf> = ordner.into_iter().collect();
    ordner.sort_by_key(|p| std::cmp::Reverse(p.components().count()));
    for dir in ordner {
        let rel = dir.strip_prefix(&w).map(|r| r.to_string_lossy().replace('\\', "/")).unwrap_or_default();
        if rel.is_empty() || abgedeckt(&rel, &neu) || ist_ahn(&rel, &neu) {
            continue;
        }
        let _ = fs::remove_dir(&dir);
    }
    Ok(out)
}

#[derive(Serialize, Debug, Default)]
pub struct MusterTreffer {
    pub anzahl: u64,
    pub beispiele: Vec<String>,
}

/// Dateien, die eines der `muster` treffen, aber keines der `ausser` — z. B.
/// beim Rollenwechsel: was die alte Rolle schützte (nur lokal) und die neue
/// abgleichen würde. Ändert nichts.
#[tauri::command]
pub fn muster_treffer(root: String, muster: Vec<String>, ausser: Vec<String>) -> Result<MusterTreffer, String> {
    let w = wurzel(&root)?;
    let r = Regeln::neu(&muster, &ausser)?; // schutz = muster, wegwerf-Feld = ausser
    let ausser: Vec<Muster> = ausser.iter().filter_map(|m| Muster::neu(m)).collect();
    let mut out = MusterTreffer::default();
    for d in dateien(&w)? {
        if Regeln::trifft(&r.schutz, &d.rel) && !Regeln::trifft(&ausser, &d.rel) {
            out.anzahl += 1;
            if out.beispiele.len() < BEISPIELE {
                out.beispiele.push(d.rel);
            }
        }
    }
    Ok(out)
}

#[derive(Serialize, Debug, Default)]
pub struct OrdnerGeleert {
    pub geloescht: u64,
    pub bytes: u64,
    /// Lokale Dateien, die NICHT dem Stand auf dem NAS entsprechen (nie
    /// abgeglichen, geschützt, geändert) — bleiben liegen.
    pub behalten: Vec<String>,
    pub behalten_anzahl: u64,
    /// Ordner ganz weg (nichts mehr übrig).
    pub ordner_weg: bool,
    pub fehler: Vec<String>,
}

/// Abo-Ordner, die VOR dem Herausnehmen aus Syncthing geprüft wurden (mit
/// .stfolder). Syncthing entfernt .stfolder beim Herausnehmen — danach würde
/// `wurzel` den Ordner nicht mehr als Syncthing-Ordner erkennen (render,
/// 08.11.2026: „.stfolder fehlt“, nichts gelöscht).
static VORGEMERKT: std::sync::Mutex<Vec<PathBuf>> = std::sync::Mutex::new(Vec::new());

/// Vor „Abo beenden“ mit Löschen: Ordner prüfen (Syncthing-Ordner, kein
/// Laufwerksstamm) und für `abo_ordner_leeren` vormerken.
#[tauri::command]
pub fn abo_ordner_vormerken(root: String) -> Result<(), String> {
    let w = wurzel(&root)?;
    let mut v = VORGEMERKT.lock().map_err(|_| "Sperre".to_string())?;
    if !v.contains(&w) {
        v.push(w);
    }
    Ok(())
}

/// Wurzel für das Leeren: vorgemerkt (dann darf .stfolder fehlen) oder noch
/// ein Syncthing-Ordner.
fn wurzel_zum_leeren(root: &str) -> Result<PathBuf, String> {
    let p = fs::canonicalize(root).map_err(|e| format!("{root}: {e}"))?;
    let mut v = VORGEMERKT.lock().map_err(|_| "Sperre".to_string())?;
    if let Some(i) = v.iter().position(|x| *x == p) {
        v.remove(i);
        if p.is_dir() && p.components().filter(|c| matches!(c, Component::Normal(_))).count() >= 1 {
            return Ok(p);
        }
    }
    drop(v);
    wurzel(root)
}

/// Nach „Abo beenden“ (Ordner ist schon aus Syncthing genommen — Löschen
/// reist nirgends hin): löscht im Abo-Ordner nur, was nachweislich auf dem
/// NAS ist (Grösse und Zeit wie im Index) und Wegwerf (Caches, OS-Reste).
/// Alles andere bleibt und wird gemeldet. Leere Ordner und am Ende der
/// Ordner selbst (samt .stfolder/.stignore) werden entfernt, wenn nichts
/// übrig ist.
#[tauri::command]
pub fn abo_ordner_leeren(
    root: String,
    wegwerf: Vec<String>,
    index: Index,
    toleranz_ms: Option<i64>,
) -> Result<OrdnerGeleert, String> {
    let w = wurzel_zum_leeren(&root)?;
    let tol = toleranz(toleranz_ms);
    let regeln = Regeln::neu(&[], &wegwerf)?;
    let d = dateien(&w)?;
    let mut out = OrdnerGeleert::default();
    let mut ordner = std::collections::BTreeSet::new();
    for f in &d {
        let weg = Regeln::trifft(&regeln.wegwerf, &f.rel) || wie_im_index(f, &index, tol);
        if !weg || !f.pfad.starts_with(&w) {
            out.behalten_anzahl += 1;
            if out.behalten.len() < BEISPIELE {
                out.behalten.push(f.rel.clone());
            }
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
            Err(e) => {
                out.behalten_anzahl += 1;
                out.fehler.push(format!("{}: {e}", f.rel));
            }
        }
    }
    let mut ordner: Vec<PathBuf> = ordner.into_iter().collect();
    ordner.sort_by_key(|p| std::cmp::Reverse(p.components().count()));
    for dir in ordner {
        let _ = fs::remove_dir(&dir);
    }
    // Auch schon vorher leere Unterordner (ausser Syncthing-Eigenem) weg.
    fn leere_weg(dir: &Path, stamm: bool) {
        if let Ok(it) = fs::read_dir(dir) {
            for e in it.flatten() {
                let n = e.file_name().to_string_lossy().into_owned();
                if stamm && matches!(n.as_str(), ".stfolder" | ".stversions") {
                    continue;
                }
                if let Ok(m) = fs::symlink_metadata(e.path()) {
                    if m.is_dir() && !ist_verknuepfung(&m) {
                        leere_weg(&e.path(), false);
                        let _ = fs::remove_dir(e.path());
                    }
                }
            }
        }
    }
    leere_weg(&w, true);
    if out.behalten_anzahl == 0 {
        // Nur noch Syncthing-Eigenes übrig → ganz weg.
        let rest: Vec<String> = fs::read_dir(&w)
            .map_err(|e| format!("{}: {e}", w.display()))?
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        if rest.iter().all(|n| matches!(n.as_str(), ".stfolder" | ".stignore" | ".stversions" | ".syncomat")) {
            for n in &rest {
                let q = w.join(n);
                let _ = if q.is_dir() { fs::remove_dir_all(&q) } else { fs::remove_file(&q) };
            }
            out.ordner_weg = fs::remove_dir(&w).is_ok();
        }
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

    /// Index wie Syncthing ihn hätte: alle Dateien mit ihrem jetzigen Stand.
    fn index_von(t: &Tmp) -> Index {
        dateien(t.path()).unwrap().into_iter().map(|d| (d.rel, (d.bytes, d.zeit))).collect()
    }

    #[test]
    fn verkleinern_loescht_nur_abgewaehltes() {
        let t = projekt();
        let root = t.path().to_string_lossy().into_owned();
        let neu = s(&["03_UNREAL", "04_SHOTS/SQ010/SH0010"]);
        let p = auswahl_pruefen(root.clone(), vec![], neu.clone(), schutz(), wegwerf(), Some(index_von(&t)), None).unwrap();
        assert_eq!(p.entfernen_anzahl, 4, "{p:?}"); // briefing, SQ020-plate, notiz, wurzel
        assert_eq!(p.abweichend_anzahl, 0);
        assert!(p.streuner.is_empty());
        let r = auswahl_entfernen(root, vec![], neu, schutz(), wegwerf(), index_von(&t), None).unwrap();
        assert_eq!(r.geloescht, 4);
        let w = t.path();
        assert!(!w.join("00_PRODUKTION").exists());
        assert!(!w.join("04_SHOTS/SQ020").exists());
        assert!(!w.join("wurzel.txt").exists());
        assert!(w.join("04_SHOTS").is_dir(), "Elternordner von Gewähltem bleibt");
        assert!(w.join("04_SHOTS/SQ010/SH0010/plate.bin").exists());
        assert!(w.join("03_UNREAL/P/Saved/Autosaves/auto.bin").exists());
        assert!(w.join(".stfolder/x.txt").exists());
        assert!(w.join(".syncomat/update/X.json").exists());
    }

    #[test]
    fn nie_loeschen_was_nie_abgeglichen_war() {
        let t = projekt();
        let root = t.path().to_string_lossy().into_owned();
        // alt: 03_UNREAL + 00_PRODUKTION — 04_SHOTS und wurzel.txt liegen lokal, waren aber ignoriert
        let r = auswahl_entfernen(root, s(&["03_UNREAL", "00_PRODUKTION"]), s(&["03_UNREAL"]), schutz(), wegwerf(), index_von(&t), None)
            .unwrap();
        assert_eq!(r.geloescht, 1); // nur briefing.txt
        assert!(t.path().join("04_SHOTS/notiz.txt").exists());
        assert!(t.path().join("wurzel.txt").exists());
    }

    #[test]
    fn datei_nicht_im_index_verhindert_jedes_loeschen() {
        let t = projekt();
        let root = t.path().to_string_lossy().into_owned();
        let mut ix = index_von(&t);
        ix.remove("00_PRODUKTION/briefing.txt"); // z. B. hineinverschoben, nie gescannt
        let e = auswahl_entfernen(root.clone(), vec![], s(&["03_UNREAL"]), schutz(), wegwerf(), ix, None).unwrap_err();
        assert!(e.contains("Nichts gelöscht"), "{e}");
        assert!(t.path().join("00_PRODUKTION/briefing.txt").exists());
        assert!(t.path().join("04_SHOTS/notiz.txt").exists(), "auch keine andere Datei gelöscht");
    }

    #[test]
    fn geaenderte_datei_verhindert_jedes_loeschen() {
        let t = projekt();
        let root = t.path().to_string_lossy().into_owned();
        let ix = index_von(&t);
        fs::write(t.path().join("04_SHOTS/notiz.txt"), b"lokal geaendert, laenger").unwrap();
        let e = auswahl_entfernen(root.clone(), vec![], s(&["03_UNREAL"]), schutz(), wegwerf(), ix.clone(), None).unwrap_err();
        assert!(e.contains("Nichts gelöscht"), "{e}");
        // nur die Zeit anders (gleiche Grösse)
        let mut ix2 = index_von(&t);
        ix2.get_mut("04_SHOTS/notiz.txt").unwrap().1 -= 5_000;
        assert!(auswahl_entfernen(root, vec![], s(&["03_UNREAL"]), schutz(), wegwerf(), ix2, None).is_err());
        assert!(t.path().join("00_PRODUKTION/briefing.txt").exists());
    }

    #[test]
    fn exfat_toleranz() {
        let t = projekt();
        let root = t.path().to_string_lossy().into_owned();
        let mut ix = index_von(&t);
        for v in ix.values_mut() {
            v.1 += 8; // exFAT speichert nur 10 ms genau
        }
        assert!(auswahl_entfernen(root.clone(), vec![], s(&["03_UNREAL"]), schutz(), wegwerf(), ix.clone(), None).is_err());
        assert!(auswahl_entfernen(root, vec![], s(&["03_UNREAL"]), schutz(), wegwerf(), ix, Some(20)).is_ok());
        assert_eq!(toleranz(Some(99_999)), 2000);
        assert_eq!(toleranz(Some(0)), 1);
    }

    #[test]
    fn ordner_leeren_nur_gesichertes() {
        let t = projekt();
        let root = t.path().to_string_lossy().into_owned();
        let mut ix = index_von(&t);
        ix.remove("04_SHOTS/notiz.txt"); // nie auf dem NAS
        ix.remove("03_UNREAL/P/Saved/Autosaves/auto.bin");
        ix.remove("03_UNREAL/P/Intermediate/x.bin"); // Wegwerf: darf weg
        let r = abo_ordner_leeren(root.clone(), wegwerf(), ix, None).unwrap();
        assert_eq!(r.behalten_anzahl, 2, "{r:?}");
        assert!(!r.ordner_weg);
        assert!(t.path().join("04_SHOTS/notiz.txt").exists());
        assert!(t.path().join("03_UNREAL/P/Saved/Autosaves/auto.bin").exists());
        assert!(!t.path().join("00_PRODUKTION").exists());
        assert!(!t.path().join("03_UNREAL/P/Intermediate").exists());
        // Rest weg → alles gesichert → Ordner verschwindet ganz.
        fs::remove_file(t.path().join("04_SHOTS/notiz.txt")).unwrap();
        fs::remove_dir_all(t.path().join("03_UNREAL")).unwrap();
        let r = abo_ordner_leeren(root, wegwerf(), index_von(&t), None).unwrap();
        assert!(r.ordner_weg, "{r:?}");
        assert!(!t.path().exists());
    }

    #[test]
    fn leeren_nach_entferntem_stfolder() {
        let t = projekt();
        let root = t.path().to_string_lossy().into_owned();
        let ix = index_von(&t);
        // ohne Vormerken und ohne .stfolder: abgelehnt
        fs::remove_dir_all(t.path().join(".stfolder")).unwrap();
        assert!(abo_ordner_leeren(root.clone(), wegwerf(), ix.clone(), None).is_err());
        // vorgemerkt (vorher mit .stfolder), dann .stfolder weg: erlaubt
        fs::create_dir_all(t.path().join(".stfolder")).unwrap();
        abo_ordner_vormerken(root.clone()).unwrap();
        fs::remove_dir_all(t.path().join(".stfolder")).unwrap();
        let r = abo_ordner_leeren(root.clone(), wegwerf(), ix.clone(), None).unwrap();
        assert!(r.geloescht > 0, "{r:?}");
        // Vormerkung gilt nur einmal
        assert!(abo_ordner_leeren(root, wegwerf(), ix, None).is_err() || !t.path().exists());
    }

    #[test]
    fn wegwerf_muss_nicht_im_index_sein() {
        let t = projekt();
        let root = t.path().to_string_lossy().into_owned();
        let mut ix = index_von(&t);
        ix.remove("03_UNREAL/P/Intermediate/x.bin");
        let r = auswahl_entfernen(root, vec![], s(&["04_SHOTS"]), schutz(), wegwerf(), ix, None).unwrap();
        assert!(!t.path().join("03_UNREAL/P/Intermediate/x.bin").exists());
        assert!(t.path().join("03_UNREAL/P/Saved/Autosaves/auto.bin").exists());
        assert!(r.geloescht >= 4);
    }

    #[test]
    fn umlaute_und_sonderzeichen() {
        let t = Tmp::neu();
        let r = t.path();
        for f in [".stfolder/x", "05_ÜBERGABE/Kunde (final)/a.txt", "05_ÜBERGABE/lose.txt", "08_A&B, Co's/d.txt", "09_Café/Straße/f.txt"] {
            let p = r.join(f);
            fs::create_dir_all(p.parent().unwrap()).unwrap();
            fs::write(p, b"x").unwrap();
        }
        let root = r.to_string_lossy().into_owned();
        let neu = s(&["05_ÜBERGABE/Kunde (final)", "09_Café/Straße"]);
        let ix = index_von(&t);
        let p = auswahl_pruefen(root.clone(), vec![], neu.clone(), schutz(), wegwerf(), Some(ix.clone()), None).unwrap();
        assert_eq!(p.entfernen_anzahl, 2, "{p:?}"); // lose.txt + d.txt
        auswahl_entfernen(root, vec![], neu, schutz(), wegwerf(), ix, None).unwrap();
        assert!(r.join("05_ÜBERGABE/Kunde (final)/a.txt").exists());
        assert!(r.join("09_Café/Straße/f.txt").exists());
        assert!(!r.join("05_ÜBERGABE/lose.txt").exists());
        assert!(!r.join("08_A&B, Co's").exists());
    }

    #[test]
    fn zerlegte_namen_auf_der_platte() {
        let t = Tmp::neu();
        let r = t.path();
        let nfd: String = "05_ÜBERGABE".nfd().collect();
        for f in [".stfolder/x".to_string(), format!("{nfd}/a.txt"), "06_X/b.txt".to_string()] {
            let p = r.join(&f);
            fs::create_dir_all(p.parent().unwrap()).unwrap();
            fs::write(p, b"x").unwrap();
        }
        let root = r.to_string_lossy().into_owned();
        let ix = index_von(&t);
        assert!(ix.contains_key("05_ÜBERGABE/a.txt"), "Index-Schlüssel in NFC: {:?}", ix.keys());
        // Auswahl in NFC: die NFD-Datei auf der Platte gilt als gewählt, wird nicht gelöscht.
        let r2 = auswahl_entfernen(root, vec![], s(&["05_ÜBERGABE"]), schutz(), wegwerf(), ix, None).unwrap();
        assert_eq!(r2.geloescht, 1); // nur 06_X/b.txt
        assert!(r.join(format!("{nfd}/a.txt")).exists());
    }

    #[test]
    fn unverstandenes_schutzmuster_ist_fehler() {
        let t = projekt();
        let root = t.path().to_string_lossy().into_owned();
        let e = auswahl_pruefen(root, vec![], s(&["03_UNREAL"]), s(&["Saved/Auto?saves"]), wegwerf(), None, None).unwrap_err();
        assert!(e.contains("nicht verstanden"), "{e}");
    }

    #[test]
    fn rollenwechsel_findet_freigelegtes() {
        let t = projekt();
        let p = t.path().join("03_UNREAL/P/Saved/MovieRenders/r.exr");
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(&p, b"x").unwrap();
        let root = t.path().to_string_lossy().into_owned();
        // render → arbeitsplatz: „Saved“ fällt weg, Autosaves bleibt geschützt
        let m = muster_treffer(root, s(&["Saved"]), s(&["**/Saved/Autosaves", "**/Saved/Config"])).unwrap();
        assert_eq!(m.anzahl, 1, "{m:?}");
        assert_eq!(m.beispiele[0], "03_UNREAL/P/Saved/MovieRenders/r.exr");
    }

    #[test]
    fn vergroessern_findet_streuner() {
        let t = projekt();
        let root = t.path().to_string_lossy().into_owned();
        let p = auswahl_pruefen(root.clone(), s(&["03_UNREAL"]), s(&["03_UNREAL", "04_SHOTS"]), schutz(), wegwerf(), None, None)
            .unwrap();
        assert_eq!(p.streuner_anzahl, 3);
        assert_eq!(p.entfernen_anzahl, 0);
        fs::remove_dir_all(t.path().join("04_SHOTS")).unwrap();
        let p = auswahl_pruefen(root, s(&["03_UNREAL"]), s(&["03_UNREAL", "04_SHOTS"]), schutz(), wegwerf(), None, None).unwrap();
        assert_eq!(p.streuner_anzahl, 0);
    }

    #[test]
    fn wurzel_ohne_stfolder_abgelehnt() {
        let t = Tmp::neu();
        let e = auswahl_pruefen(t.path().to_string_lossy().into_owned(), vec![], s(&["a"]), vec![], vec![], None, None).unwrap_err();
        assert!(e.contains(".stfolder"));
        assert!(auswahl_gueltig(&s(&["../x"])).is_err());
        assert!(auswahl_gueltig(&s(&["a/.git"])).is_err());
        assert!(auswahl_gueltig(&s(&["C:/x"])).is_err());
    }
}
