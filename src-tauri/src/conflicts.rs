use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
};
use walkdir::{DirEntry, WalkDir};

/// Syncthing nennt Conflict-Files nach diesem Schema:
///   <original>.sync-conflict-YYYYMMDD-HHMMSS-<DEVICE_FRAGMENT>.<ext>
///
/// Beispiel: `Notes.sync-conflict-20260608-090000-WINDEVID.md`
/// Wir parsen Original-Name + Peer-Fragment + Timestamp wieder raus.
const CONFLICT_MARKER: &str = ".sync-conflict-";

/// Subtrees die wir NIE walken — sind dev-/build-artefakt-Verzeichnisse
/// in denen niemals Konflikt-Files auftauchen sollten. Pruning hier rettet
/// Unreal-Projekte mit DerivedDataCache (10-50GB) + Intermediate (100k+ Files)
/// vor 60s-Polling-Crashes.
const PRUNE_DIRS: &[&str] = &[
    "DerivedDataCache",
    "Intermediate",
    "Saved",
    "Binaries",
    "Build",
    ".git",
    "node_modules",
    ".stversions",
    ".stfolder",
    ".syncomat",
    "target",
    ".vs",
    ".vscode",
    ".idea",
    "__pycache__",
    ".next",
    "dist",
    "build",
];

/// Hard-Cap auf scanned entries pro list-call. Schützt UI-Thread auch wenn
/// Pruning versagt (z.B. flacher Folder mit Millionen Files).
const MAX_SCAN_ENTRIES: usize = 100_000;

fn is_pruned(entry: &DirEntry) -> bool {
    if entry.depth() == 0 {
        return false; // root nie prunen
    }
    match entry.file_name().to_str() {
        Some(name) => PRUNE_DIRS.iter().any(|p| name.eq_ignore_ascii_case(p)),
        None => false,
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ConflictItem {
    /// Pfad der Konflikt-Datei relativ zum Folder-Root
    pub conflict_rel: String,
    /// Pfad der Original-Datei relativ zum Folder-Root (kann auch fehlen)
    pub original_rel: String,
    /// Existiert die Original-Datei noch?
    pub original_exists: bool,
    /// Bytes
    pub conflict_size: u64,
    pub original_size: u64,
    /// Modified-Time unix-seconds
    pub conflict_mtime: i64,
    pub original_mtime: i64,
    /// Device-Fragment aus Filename (z.B. "WINDEVID")
    pub peer_fragment: String,
    /// Timestamp aus Filename (z.B. "20260608-090000")
    pub when: String,
}

fn parse_conflict_filename(file_name: &str) -> Option<(String, String, String)> {
    // Sucht ".sync-conflict-" im filename, extrahiert was vor/nach kommt.
    let marker_pos = file_name.find(CONFLICT_MARKER)?;
    let before = &file_name[..marker_pos];
    let after = &file_name[marker_pos + CONFLICT_MARKER.len()..];

    // after sieht aus wie: "20260608-090000-WINDEVID.md" oder ohne ext "20260608-090000-WINDEVID"
    let (when_and_peer, ext) = match after.rfind('.') {
        Some(p) => (&after[..p], &after[p..]),
        None => (after, ""),
    };

    // when_and_peer: "20260608-090000-WINDEVID"
    // Wir trennen am LETZTEN '-' weil device-fragments keine '-' enthalten.
    let last_dash = when_and_peer.rfind('-')?;
    let when = &when_and_peer[..last_dash];
    let peer = &when_and_peer[last_dash + 1..];

    // Validierung: when sollte "YYYYMMDD-HHMMSS" sein → 15 chars + 1 dash
    if when.len() != 15 || when.chars().nth(8) != Some('-') {
        return None;
    }
    if peer.is_empty() {
        return None;
    }

    let original = format!("{before}{ext}");
    Some((original, when.to_string(), peer.to_string()))
}

fn file_meta(path: &Path) -> (u64, i64) {
    let m = match fs::metadata(path) {
        Ok(m) => m,
        Err(_) => return (0, 0),
    };
    let size = m.len();
    let mtime = m
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    (size, mtime)
}

/// Walks subtree on a blocking thread (so es UI-Tasks nicht blockt) und sammelt
/// Conflict-Files. Prunt dev-Artefakt-Verzeichnisse (siehe PRUNE_DIRS), nutzt
/// same_file_system um nicht in gemountete Volumes zu wandern, und stoppt
/// hart bei MAX_SCAN_ENTRIES als Sicherheitsnetz.
#[tauri::command]
pub async fn conflicts_list(folder_path: String) -> Result<Vec<ConflictItem>, String> {
    tauri::async_runtime::spawn_blocking(move || conflicts_list_blocking(&folder_path))
        .await
        .map_err(|e| format!("join error: {e}"))?
}

fn conflicts_list_blocking(folder_path: &str) -> Result<Vec<ConflictItem>, String> {
    let root = Path::new(folder_path);
    if !root.exists() || !root.is_dir() {
        return Err(format!("folder does not exist: {folder_path}"));
    }

    let mut items: Vec<ConflictItem> = Vec::new();
    let mut scanned: usize = 0;

    let walker = WalkDir::new(root)
        .follow_links(false)
        .same_file_system(true)
        .max_depth(30)
        .into_iter()
        .filter_entry(|e| !is_pruned(e));

    for entry in walker.filter_map(|e| e.ok()) {
        scanned += 1;
        if scanned >= MAX_SCAN_ENTRIES {
            // Sicherheits-Cap: Walk abbrechen damit UI nicht stehen bleibt.
            // Bei Unreal-Scale sollte Pruning das verhindern, aber Belt+Suspenders.
            break;
        }
        if !entry.file_type().is_file() {
            continue;
        }
        let file_name = match entry.file_name().to_str() {
            Some(s) => s,
            None => continue,
        };
        // Cheap-check VOR allocs: contains-Test auf dem &str slice, keine PathBuf-Allocation.
        if !file_name.contains(CONFLICT_MARKER) {
            continue;
        }
        let (original_name, when, peer) = match parse_conflict_filename(file_name) {
            Some(t) => t,
            None => continue,
        };
        let conflict_path = entry.path().to_path_buf();
        let rel_dir = conflict_path
            .parent()
            .and_then(|p| p.strip_prefix(root).ok())
            .unwrap_or_else(|| Path::new(""));
        let conflict_rel = rel_dir.join(file_name);
        let original_rel = rel_dir.join(&original_name);
        let original_path = root.join(&original_rel);

        let (csize, cmtime) = file_meta(&conflict_path);
        let original_exists = original_path.exists();
        let (osize, omtime) = if original_exists {
            file_meta(&original_path)
        } else {
            (0, 0)
        };

        items.push(ConflictItem {
            conflict_rel: conflict_rel.to_string_lossy().to_string(),
            original_rel: original_rel.to_string_lossy().to_string(),
            original_exists,
            conflict_size: csize,
            original_size: osize,
            conflict_mtime: cmtime,
            original_mtime: omtime,
            peer_fragment: peer,
            when,
        });
    }

    items.sort_by(|a, b| b.conflict_mtime.cmp(&a.conflict_mtime));
    Ok(items)
}

fn resolve_path(folder_path: &str, rel: &str) -> Result<PathBuf, String> {
    let root = Path::new(folder_path).canonicalize().map_err(|e| e.to_string())?;
    let target = root.join(rel);
    let target_canon = target.canonicalize().map_err(|e| e.to_string())?;
    // Sicherheit: target muss innerhalb von root sein (kein path-traversal via ../)
    if !target_canon.starts_with(&root) {
        return Err("path traversal blocked".into());
    }
    Ok(target_canon)
}

/// Wie resolve_path, aber für Pfade die noch nicht existieren (z.B. rename-destination).
/// Canonicalisiert das Parent-Dir + joined Filename, prüft starts_with(root).
fn resolve_path_for_create(folder_path: &str, rel: &str) -> Result<PathBuf, String> {
    let root = Path::new(folder_path).canonicalize().map_err(|e| e.to_string())?;
    let target = root.join(rel);
    let parent = target
        .parent()
        .ok_or_else(|| "no parent dir".to_string())?;
    let parent_canon = parent.canonicalize().map_err(|e| e.to_string())?;
    if !parent_canon.starts_with(&root) {
        return Err("path traversal blocked".into());
    }
    let file_name = target
        .file_name()
        .ok_or_else(|| "missing filename".to_string())?;
    // Reject obvious ../, absolute, or null bytes in the rel
    let rel_str = rel.replace('\\', "/");
    if rel_str.contains("/../") || rel_str.starts_with("../") || rel_str.contains('\0') {
        return Err("path traversal blocked".into());
    }
    if Path::new(rel).is_absolute() {
        return Err("absolute path not allowed".into());
    }
    Ok(parent_canon.join(file_name))
}

/// "Lokale Version behalten" → löscht NUR die Konflikt-Datei.
/// Die Original-Datei bleibt unverändert, wird beim nächsten Sync mit dem Peer abgeglichen.
#[tauri::command]
pub fn conflicts_keep_local(folder_path: String, conflict_rel: String) -> Result<(), String> {
    let path = resolve_path(&folder_path, &conflict_rel)?;
    fs::remove_file(&path).map_err(|e| format!("delete: {e}"))
}

/// "Remote-Version übernehmen" → ersetzt die Original-Datei mit dem Konflikt-Inhalt.
/// Original wird überschrieben, Konflikt-Datei gelöscht.
#[tauri::command]
pub fn conflicts_take_remote(
    folder_path: String,
    conflict_rel: String,
    original_rel: String,
) -> Result<(), String> {
    let conflict_path = resolve_path(&folder_path, &conflict_rel)?;
    // Destination wird durch rename neu erstellt — daher resolve_path_for_create
    // statt resolve_path. Schliesst Path-Traversal-Hole via crafted original_rel.
    let original_path = resolve_path_for_create(&folder_path, &original_rel)?;
    // fs::rename ist cross-volume-unsafe (ERROR_NOT_SAME_DEVICE auf Windows mit
    // Junction-Points / SMB). Fallback: copy + delete.
    match fs::rename(&conflict_path, &original_path) {
        Ok(()) => Ok(()),
        Err(_) => {
            fs::copy(&conflict_path, &original_path).map_err(|e| format!("copy: {e}"))?;
            fs::remove_file(&conflict_path).map_err(|e| format!("delete-after-copy: {e}"))
        }
    }
}

/// "Beide behalten" → benennt die Konflikt-Datei um in einen menschen-lesbaren Namen.
/// Aus `Notes.sync-conflict-20260608-090000-PEER.md` wird `Notes.von-PEER.md`.
#[tauri::command]
pub fn conflicts_keep_both(
    folder_path: String,
    conflict_rel: String,
    peer_fragment: String,
) -> Result<String, String> {
    let conflict_path = resolve_path(&folder_path, &conflict_rel)?;
    let parent = conflict_path
        .parent()
        .ok_or_else(|| "no parent dir".to_string())?;
    let file_name = conflict_path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "bad filename".to_string())?;

    // Extract original-name parts
    let marker_pos = file_name
        .find(CONFLICT_MARKER)
        .ok_or_else(|| "no conflict marker".to_string())?;
    let before = &file_name[..marker_pos];
    let after_marker = &file_name[marker_pos + CONFLICT_MARKER.len()..];
    let ext = after_marker
        .rfind('.')
        .map(|p| &after_marker[p..])
        .unwrap_or("");

    // Neuer Name: "<before>.von-<peer><ext>" — falls Datei existiert: -2, -3, …
    let safe_peer = peer_fragment
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect::<String>();
    let base = format!("{before}.von-{safe_peer}");
    let mut candidate = parent.join(format!("{base}{ext}"));
    let mut counter = 2;
    while candidate.exists() {
        candidate = parent.join(format!("{base}-{counter}{ext}"));
        counter += 1;
        if counter > 99 {
            return Err("too many name-collisions".into());
        }
    }

    // Auch hier cross-volume-fallback (siehe conflicts_take_remote).
    if let Err(_) = fs::rename(&conflict_path, &candidate) {
        fs::copy(&conflict_path, &candidate).map_err(|e| format!("copy: {e}"))?;
        fs::remove_file(&conflict_path).map_err(|e| format!("delete-after-copy: {e}"))?;
    }
    Ok(candidate.to_string_lossy().to_string())
}
