use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

const SCHEMA_VERSION: u32 = 1;

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct InviteOptions {
    pub rw: bool,
    pub note: Option<String>,
    pub addresses: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum InviteStatus {
    Pending,
    Redeemed { at: i64, by_device_id: String },
    Revoked { at: i64 },
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ActiveInvite {
    pub id: String,
    pub issued_at: i64,
    pub expires_at: i64,
    pub options: InviteOptions,
    pub status: InviteStatus,
}

#[derive(Serialize, Deserialize, Debug)]
struct StoreFile {
    schema_version: u32,
    invites: Vec<ActiveInvite>,
    /// Code-IDs that this device has redeemed locally (replay protection on redeemer side).
    consumed_codes: Vec<String>,
    /// Map von consumed-code-ID auf consumed_at unix-time. Brauchen wir damit
    /// wir nach Invite-MAX_EXPIRY (30 Tage) Codes purgen können — vorher
    /// hatten wir nur die naked-Vec mit truncate auf 200, das war single-use-
    /// Bypass-fähig bei vielen Pairings. Jetzt: kein truncate, dafür TTL.
    #[serde(default)]
    consumed_at: std::collections::HashMap<String, i64>,
}

impl Default for StoreFile {
    fn default() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            invites: Vec::new(),
            consumed_codes: Vec::new(),
            consumed_at: std::collections::HashMap::new(),
        }
    }
}

pub struct InviteStore {
    path: PathBuf,
    inner: Mutex<StoreFile>,
}

#[derive(Debug)]
pub enum InviteError {
    Locked,
    NotFound,
    AlreadyRedeemed,
    AlreadyRevoked,
    Expired,
    Io(std::io::Error),
    Serde(serde_json::Error),
}

impl std::fmt::Display for InviteError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Locked => write!(f, "store lock poisoned"),
            Self::NotFound => write!(f, "invite not found"),
            Self::AlreadyRedeemed => write!(f, "invite already redeemed"),
            Self::AlreadyRevoked => write!(f, "invite already revoked"),
            Self::Expired => write!(f, "invite expired"),
            Self::Io(e) => write!(f, "io: {e}"),
            Self::Serde(e) => write!(f, "serde: {e}"),
        }
    }
}

impl std::error::Error for InviteError {}

impl From<std::io::Error> for InviteError {
    fn from(e: std::io::Error) -> Self {
        Self::Io(e)
    }
}

impl From<serde_json::Error> for InviteError {
    fn from(e: serde_json::Error) -> Self {
        Self::Serde(e)
    }
}

pub fn setup(app: &AppHandle) -> Result<InviteStore, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;
    fs::create_dir_all(&app_data).map_err(|e| format!("mkdir: {e}"))?;
    let path = app_data.join("invites.json");
    let store_file = load_or_init(&path).map_err(|e| format!("load: {e}"))?;
    Ok(InviteStore {
        path,
        inner: Mutex::new(store_file),
    })
}

fn load_or_init(path: &Path) -> Result<StoreFile, InviteError> {
    if !path.exists() {
        let s = StoreFile::default();
        save_atomic(path, &s)?;
        set_perms_600(path);
        return Ok(s);
    }
    let raw = fs::read_to_string(path)?;
    match serde_json::from_str::<StoreFile>(&raw) {
        Ok(parsed) => Ok(parsed),
        Err(e) => {
            // Backup the corrupt file so the user can recover by hand instead of
            // silently losing the issuer-secret + consumed-codes list.
            let backup = path.with_extension(format!("json.corrupt.{}", now_unix()));
            let _ = fs::rename(path, &backup);
            eprintln!(
                "[invites] ERR: invites.json corrupted ({e}); backed up to {} and starting fresh",
                backup.display()
            );
            let s = StoreFile::default();
            save_atomic(path, &s)?;
            set_perms_600(path);
            Ok(s)
        }
    }
}

fn save_atomic(path: &Path, store: &StoreFile) -> Result<(), InviteError> {
    let tmp = path.with_extension("json.tmp");
    let json = serde_json::to_string_pretty(store)?;
    {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(json.as_bytes())?;
        f.sync_all()?;
    }
    set_perms_600(&tmp);
    fs::rename(&tmp, path)?;
    Ok(())
}

#[cfg(unix)]
fn set_perms_600(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
}

#[cfg(not(unix))]
fn set_perms_600(_: &Path) {}

fn now_unix() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

impl InviteStore {
    fn with_save<F, R>(&self, f: F) -> Result<R, InviteError>
    where
        F: FnOnce(&mut StoreFile) -> Result<R, InviteError>,
    {
        let mut guard = self.inner.lock().map_err(|_| InviteError::Locked)?;
        let result = f(&mut guard)?;
        save_atomic(&self.path, &guard)?;
        Ok(result)
    }

    fn with_read<F, R>(&self, f: F) -> Result<R, InviteError>
    where
        F: FnOnce(&StoreFile) -> R,
    {
        let guard = self.inner.lock().map_err(|_| InviteError::Locked)?;
        Ok(f(&guard))
    }

    // refresh_expired() was previously called on every list() — that wrote the file
    // each time even though nothing changed. UI + decoder both filter expired entries
    // already; expired records get GC'd by invite_purge_expired (called on app start).
}

#[derive(Deserialize)]
pub struct CreateInput {
    /// Frontend-generated UUID — same value baked into the signed code payload.
    /// Pflicht damit Frontend & Rust dieselbe ID kennen (sonst Revoke/mark_redeemed broken).
    pub id: String,
    pub options: InviteOptions,
    pub expires_at: i64,
}

#[tauri::command]
pub fn invite_create(
    state: tauri::State<'_, InviteStore>,
    input: CreateInput,
) -> Result<ActiveInvite, String> {
    let now = now_unix();
    if Uuid::parse_str(&input.id).is_err() {
        return Err("id must be a valid UUID".into());
    }
    if input.expires_at <= now {
        return Err("expires_at must be in the future".into());
    }
    if input.expires_at - now > 30 * 24 * 3600 {
        return Err("expires_at must be at most 30 days from now".into());
    }
    if let Some(note) = &input.options.note {
        if note.chars().count() > 40 {
            return Err("note must be at most 40 characters".into());
        }
    }
    if input.options.addresses.len() > 4 {
        return Err("at most 4 addresses".into());
    }
    let invite = ActiveInvite {
        id: input.id,
        issued_at: now,
        expires_at: input.expires_at,
        options: input.options,
        status: InviteStatus::Pending,
    };
    let clone = invite.clone();
    state
        .with_save(|store| {
            if store.invites.iter().any(|i| i.id == invite.id) {
                return Err(InviteError::NotFound); // misuse but matches surface area
            }
            store.invites.push(invite);
            Ok(())
        })
        .map_err(|e| e.to_string())?;
    Ok(clone)
}

#[tauri::command]
pub fn invite_list(state: tauri::State<'_, InviteStore>) -> Result<Vec<ActiveInvite>, String> {
    state
        .with_read(|s| {
            let mut v = s.invites.clone();
            v.sort_by_key(|i| std::cmp::Reverse(i.issued_at));
            v
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn invite_find(
    state: tauri::State<'_, InviteStore>,
    id: String,
) -> Result<Option<ActiveInvite>, String> {
    state
        .with_read(|s| s.invites.iter().find(|i| i.id == id).cloned())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn invite_mark_redeemed(
    state: tauri::State<'_, InviteStore>,
    id: String,
    peer_device_id: String,
) -> Result<(), String> {
    state
        .with_save(|store| {
            let invite = store
                .invites
                .iter_mut()
                .find(|i| i.id == id)
                .ok_or(InviteError::NotFound)?;
            match &invite.status {
                InviteStatus::Redeemed { .. } => return Err(InviteError::AlreadyRedeemed),
                InviteStatus::Revoked { .. } => return Err(InviteError::AlreadyRevoked),
                InviteStatus::Pending => {}
            }
            if invite.expires_at < now_unix() {
                return Err(InviteError::Expired);
            }
            invite.status = InviteStatus::Redeemed {
                at: now_unix(),
                by_device_id: peer_device_id,
            };
            Ok(())
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn invite_revoke(state: tauri::State<'_, InviteStore>, id: String) -> Result<(), String> {
    state
        .with_save(|store| {
            let invite = store
                .invites
                .iter_mut()
                .find(|i| i.id == id)
                .ok_or(InviteError::NotFound)?;
            match &invite.status {
                InviteStatus::Revoked { .. } => return Err(InviteError::AlreadyRevoked),
                _ => {}
            }
            invite.status = InviteStatus::Revoked { at: now_unix() };
            Ok(())
        })
        .map_err(|e| e.to_string())
}

// (Sprint #2) invite_check_consumed entfernt — toter Command (nie aufgerufen)
// + TOCTOU-Falle neben dem atomaren invite_consume_once.

/// Atomically check-and-mark a code as consumed.
/// Returns true if the code was newly added (caller may proceed), false if it was
/// already consumed (caller must abort). Closes the TOCTOU window between a separate
/// check + mark.
#[tauri::command]
pub fn invite_consume_once(
    state: tauri::State<'_, InviteStore>,
    id: String,
) -> Result<bool, String> {
    state
        .with_save(|store| {
            if store.consumed_codes.contains(&id) {
                return Ok(false);
            }
            store.consumed_codes.push(id.clone());
            store.consumed_at.insert(id, now_unix());
            // KEIN truncate mehr — purge_expired räumt anhand TTL auf
            Ok(true)
        })
        .map_err(|e| e.to_string())
}

/// Rollback for consume_once when downstream PUT calls fail — frees the code so the
/// user can retry the redemption.
#[tauri::command]
pub fn invite_release_consumed(
    state: tauri::State<'_, InviteStore>,
    id: String,
) -> Result<(), String> {
    state
        .with_save(|store| {
            store.consumed_codes.retain(|x| x != &id);
            store.consumed_at.remove(&id);
            Ok(())
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn invite_purge_expired(state: tauri::State<'_, InviteStore>) -> Result<u32, String> {
    let now = now_unix();
    let cutoff = now - 7 * 24 * 3600;
    // Consumed-Codes-TTL: 90 Tage. Auch wenn die original invite_expiry typisch
    // <= 30 Tage ist, give us a safety margin (Clock-Skew, manually-issued
    // codes mit langer Expiry). Replay-Schutz bleibt voll erhalten solange
    // ein Code in store.consumed_codes ist.
    let consumed_cutoff = now - 90 * 24 * 3600;
    state
        .with_save(|store| {
            let before = store.invites.len();
            store.invites.retain(|i| match &i.status {
                InviteStatus::Pending => i.expires_at > now,
                InviteStatus::Redeemed { at, .. } | InviteStatus::Revoked { at } => *at > cutoff,
            });
            // Consumed-codes purgen — TTL-basiert statt naked truncate
            let expired_ids: Vec<String> = store
                .consumed_at
                .iter()
                .filter(|(_, at)| **at < consumed_cutoff)
                .map(|(id, _)| id.clone())
                .collect();
            for id in &expired_ids {
                store.consumed_at.remove(id);
            }
            store.consumed_codes.retain(|c| !expired_ids.contains(c));
            Ok((before - store.invites.len()) as u32)
        })
        .map_err(|e| e.to_string())
}
