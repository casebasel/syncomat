use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
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
    issuer_secret: String,
    invites: Vec<ActiveInvite>,
    /// Code-IDs that this device has redeemed locally (replay protection on redeemer side).
    consumed_codes: Vec<String>,
}

impl Default for StoreFile {
    fn default() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            issuer_secret: generate_secret_base64url(),
            invites: Vec::new(),
            consumed_codes: Vec::new(),
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
    let parsed: StoreFile = serde_json::from_str(&raw).unwrap_or_else(|_| {
        eprintln!("[invites] WARN: invites.json corrupted, starting fresh (existing data lost)");
        StoreFile::default()
    });
    Ok(parsed)
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

fn generate_secret_base64url() -> String {
    let mut bytes = [0u8; 32];
    bytes[..16].copy_from_slice(Uuid::new_v4().as_bytes());
    bytes[16..].copy_from_slice(Uuid::new_v4().as_bytes());
    URL_SAFE_NO_PAD.encode(bytes)
}

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

    fn refresh_expired(&self) -> Result<(), InviteError> {
        let now = now_unix();
        self.with_save(|store| {
            for invite in store.invites.iter_mut() {
                if matches!(invite.status, InviteStatus::Pending) && invite.expires_at < now {
                    // Don't mutate — we'll let the UI filter / decoder reject expired ones.
                    // (Could move to a separate "expired" status if we want auditability.)
                }
            }
            Ok(())
        })
    }
}

#[derive(Deserialize)]
pub struct CreateInput {
    pub options: InviteOptions,
    pub expires_at: i64,
}

#[tauri::command]
pub fn invite_create(
    state: tauri::State<'_, InviteStore>,
    input: CreateInput,
) -> Result<ActiveInvite, String> {
    let now = now_unix();
    if input.expires_at <= now {
        return Err("expires_at must be in the future".into());
    }
    if input.expires_at - now > 30 * 24 * 3600 {
        return Err("expires_at must be at most 30 days from now".into());
    }
    if let Some(note) = &input.options.note {
        if note.len() > 40 {
            return Err("note must be at most 40 chars".into());
        }
    }
    if input.options.addresses.len() > 4 {
        return Err("at most 4 addresses".into());
    }
    let invite = ActiveInvite {
        id: Uuid::now_v7().to_string(),
        issued_at: now,
        expires_at: input.expires_at,
        options: input.options,
        status: InviteStatus::Pending,
    };
    let clone = invite.clone();
    state
        .with_save(|store| {
            store.invites.push(invite);
            Ok(())
        })
        .map_err(|e| e.to_string())?;
    Ok(clone)
}

#[tauri::command]
pub fn invite_list(state: tauri::State<'_, InviteStore>) -> Result<Vec<ActiveInvite>, String> {
    let _ = state.refresh_expired();
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

#[tauri::command]
pub fn invite_get_issuer_secret(state: tauri::State<'_, InviteStore>) -> Result<String, String> {
    state
        .with_read(|s| s.issuer_secret.clone())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn invite_check_consumed(
    state: tauri::State<'_, InviteStore>,
    id: String,
) -> Result<bool, String> {
    state
        .with_read(|s| s.consumed_codes.contains(&id))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn invite_mark_consumed(
    state: tauri::State<'_, InviteStore>,
    id: String,
) -> Result<(), String> {
    state
        .with_save(|store| {
            if !store.consumed_codes.contains(&id) {
                store.consumed_codes.push(id);
            }
            // Keep list bounded — only the last 200 redemptions.
            if store.consumed_codes.len() > 200 {
                let drop = store.consumed_codes.len() - 200;
                store.consumed_codes.drain(0..drop);
            }
            Ok(())
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn invite_purge_expired(state: tauri::State<'_, InviteStore>) -> Result<u32, String> {
    let now = now_unix();
    let cutoff = now - 7 * 24 * 3600;
    state
        .with_save(|store| {
            let before = store.invites.len();
            store.invites.retain(|i| match &i.status {
                InviteStatus::Pending => i.expires_at > now,
                InviteStatus::Redeemed { at, .. } | InviteStatus::Revoked { at } => *at > cutoff,
            });
            Ok((before - store.invites.len()) as u32)
        })
        .map_err(|e| e.to_string())
}
