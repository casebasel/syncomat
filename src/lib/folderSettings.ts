import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef } from "react";
import {
  getConfig,
  getFolderIgnores,
  putFolder,
  setFolderIgnores,
  type Endpoint,
  type Folder,
  type FolderID,
} from "./syncthing";

/** Pattern die WIR setzen wenn ignore_hidden=true. Wird beim toggle-off
 * gezielt rausgefiltert; user-erstellte Patterns bleiben unberührt. */
const HIDDEN_PATTERNS = [".*", ".DS_Store", "Thumbs.db", "desktop.ini"];

export type FolderDefaults = {
  ignore_hidden: boolean;
  trashcan: boolean;
  trashcan_cleanout_days: number;
  /** Cluster-Wide Deletion-Request. Wenn ein Peer das auf true setzt,
   * sehen andere Syncomat-Instanzen einen "auch hier entfernen?" Banner. */
  deletion_requested?: boolean;
  deletion_requested_by?: string | null;
  /** User-definierte Tags zum Gruppieren / Filtern. Werden zwischen
   * Geräten geshared via folder-defaults.json. */
  tags?: string[];
};

export type FolderDefaultsFile = {
  schema_version: number;
  updated_at: number;
  updated_by: string;
  settings: FolderDefaults;
};

export const DEFAULT_FOLDER_DEFAULTS: FolderDefaults = {
  ignore_hidden: false,
  trashcan: false,
  trashcan_cleanout_days: 0,
  deletion_requested: false,
  deletion_requested_by: null,
  tags: [],
};

// ── Tauri-Command-Wrapper ──────────────────────────────────────

export const folderSettingsRead = (folderPath: string) =>
  invoke<FolderDefaultsFile | null>("folder_settings_read", { folderPath });

export const folderSettingsWrite = (
  folderPath: string,
  updatedBy: string,
  settings: FolderDefaults,
) =>
  invoke<FolderDefaultsFile>("folder_settings_write", {
    folderPath,
    updatedBy,
    settings,
  });

// ── Apply settings to Syncthing config ─────────────────────────

/**
 * Schreibt die Defaults in die lokale Syncthing-Folder-Config:
 * - ignore_hidden → .stignore (merged mit existing user-Patterns)
 * - trashcan → folder.versioning
 *
 * Holt sich vor dem PUT den FRISCHEN folder aus Syncthings config —
 * nicht den vom Caller übergebenen, der könnte stale sein (Replication-Hook).
 */
export async function applyFolderDefaults(
  ep: Endpoint,
  folder: Folder,
  defaults: FolderDefaults,
): Promise<void> {
  // ─ ignore patterns ─
  // Merge: existing user patterns minus HIDDEN_PATTERNS, dann ggf. HIDDEN_PATTERNS rein.
  const current = await getFolderIgnores(ep, folder.id).catch(() => ({
    ignore: null,
    expanded: null,
  }));
  const userPatterns = (current.ignore ?? []).filter(
    (p) => !HIDDEN_PATTERNS.includes(p),
  );
  const nextIgnores = defaults.ignore_hidden
    ? [...HIDDEN_PATTERNS, ...userPatterns]
    : userPatterns;
  await setFolderIgnores(ep, folder.id, nextIgnores);

  // ─ versioning ─
  // Fresh folder fetch um stale-reference (z.B. devices[] vom Replication-Hook) zu vermeiden.
  const fresh = await getConfig(ep);
  const currentFolder = fresh.folders.find((f) => f.id === folder.id);
  if (!currentFolder) {
    throw new Error(`folder ${folder.id} not found in syncthing config`);
  }

  const updatedFolder: Folder = {
    ...currentFolder,
    versioning: defaults.trashcan
      ? {
          type: "trashcan",
          params: {
            cleanoutDays: String(defaults.trashcan_cleanout_days),
          },
        }
      : { type: "" },
  };
  await putFolder(ep, updatedFolder);
}

// ── Replication-Hook ──────────────────────────────────────────

/**
 * Pollt alle 30s alle Folders auf .syncomat/folder-defaults.json.
 * Wenn die File neuer ist als das was wir zuletzt applied haben UND nicht von
 * uns selbst kommt → applizier auf lokale Syncthing-Config.
 */
export type DeletionSuggestion = {
  folder: Folder;
  by: string;
  at: number;
};

// Persistente Tracking-Maps in localStorage. Verhindert dass useFolderSettings-
// Replication beim App-Start (frischer Ref-Cache) jeden peer-applied Setting
// nochmal applied — was setFolderIgnores + putFolder triggert und einen Full-
// Rescan auf jedem Unreal-Folder auslöst (50+ Min Initial-Hash).
const APPLIED_LS_KEY = "syncomat.folderSettings.applied";
const DELETION_LS_KEY = "syncomat.folderSettings.deletionNotified";

function loadAppliedMap(): Map<FolderID, number> {
  try {
    const raw = localStorage.getItem(APPLIED_LS_KEY);
    if (!raw) return new Map();
    const obj = JSON.parse(raw) as Record<string, number>;
    return new Map(Object.entries(obj));
  } catch {
    return new Map();
  }
}

function saveAppliedMap(map: Map<FolderID, number>) {
  try {
    const obj: Record<string, number> = {};
    for (const [k, v] of map) obj[k] = v;
    localStorage.setItem(APPLIED_LS_KEY, JSON.stringify(obj));
  } catch (e) {
    console.warn("[folder-settings] persist applied-map failed", e);
  }
}

function loadDeletionNotified(): Set<string> {
  try {
    const raw = localStorage.getItem(DELETION_LS_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

function saveDeletionNotified(set: Set<string>) {
  try {
    // Cap: max 100 entries (alte rauswerfen) — wächst sonst unbounded
    const arr = Array.from(set);
    const capped = arr.slice(-100);
    localStorage.setItem(DELETION_LS_KEY, JSON.stringify(capped));
  } catch (e) {
    console.warn("[folder-settings] persist deletion-notified failed", e);
  }
}

export function useFolderSettingsReplication(
  ep: Endpoint | null,
  ready: boolean,
  folders: Folder[],
  myDeviceId: string | null,
  intervalMs = 30_000,
  onDeletionRequest?: (suggestion: DeletionSuggestion) => void,
): void {
  const appliedRef = useRef<Map<FolderID, number>>(loadAppliedMap());
  const deletionNotifiedRef = useRef<Set<string>>(loadDeletionNotified());

  useEffect(() => {
    if (!ep || !ready || !myDeviceId) return;
    let cancelled = false;

    const checkAll = async () => {
      for (const f of folders) {
        if (cancelled) return;
        try {
          const file = await folderSettingsRead(f.path);
          if (!file) continue;
          // Wenn WIR sie geschrieben haben → nur als "seen" markieren, nicht applizieren.
          if (file.updated_by === myDeviceId) {
            appliedRef.current.set(f.id, file.updated_at);
            continue;
          }

          // Cluster-Wide Deletion-Request? → einmalig pro Folder+Timestamp den
          // Banner-Callback feuern. User entscheidet pro Gerät selbst.
          if (file.settings.deletion_requested) {
            // AUTH-CHECK: updated_by muss in folder.devices sein, sonst akzeptieren
            // wir das Signal nicht (Audit-Finding: beliebiger Peer konnte Banner
            // triggern). Sender selbst muss zu den gesharten Geräten zählen.
            const peerAllowed = f.devices.some(
              (d) => d.deviceID === file.updated_by,
            );
            if (!peerAllowed) {
              console.warn(
                `[folder-settings] deletion-request für ${f.id} ignoriert — ` +
                  `updated_by ${file.updated_by} nicht in folder.devices`,
              );
              appliedRef.current.set(f.id, file.updated_at);
              saveAppliedMap(appliedRef.current);
              continue;
            }
            const key = `${f.id}|${file.updated_at}`;
            if (!deletionNotifiedRef.current.has(key)) {
              deletionNotifiedRef.current.add(key);
              saveDeletionNotified(deletionNotifiedRef.current);
              onDeletionRequest?.({
                folder: f,
                by: file.settings.deletion_requested_by ?? file.updated_by,
                at: file.updated_at,
              });
            }
            // Bei deletion-requested NICHT applyFolderDefaults aufrufen —
            // sonst werden ignore_patterns/versioning auf den about-to-delete
            // Folder geschrieben.
            appliedRef.current.set(f.id, file.updated_at);
            saveAppliedMap(appliedRef.current);
            continue;
          }

          const lastApplied = appliedRef.current.get(f.id) ?? 0;
          if (file.updated_at <= lastApplied) continue;
          // Neuer als zuletzt gesehen → applizieren.
          await applyFolderDefaults(ep, f, file.settings);
          appliedRef.current.set(f.id, file.updated_at);
          saveAppliedMap(appliedRef.current);
          console.log(
            `[folder-settings] applied ${f.id} from ${file.updated_by} (${file.updated_at})`,
          );
        } catch (e) {
          console.warn(`[folder-settings] check ${f.id} failed:`, e);
        }
      }
    };

    void checkAll();
    const id = setInterval(checkAll, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    ep?.url,
    ep?.api_key,
    ready,
    myDeviceId,
    folders.map((f) => `${f.id}|${f.path}`).join(","),
    intervalMs,
  ]);
}
