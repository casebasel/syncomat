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
import { notifyTagsChanged } from "./tags";

/** Pattern die WIR setzen wenn ignore_hidden=true. Wird beim toggle-off
 * gezielt rausgefiltert; user-erstellte Patterns bleiben unberührt.
 * (?d)-Prefix: erlaubt Syncthing, diese Hidden-Files zu löschen wenn sie ein
 * Ordner-Löschen blockieren würden (sonst "delete dir: contains ignored files"). */
const HIDDEN_PATTERNS = ["(?d).*", "(?d).DS_Store", "(?d)Thumbs.db", "(?d)desktop.ini"];
/** Alte un-prefixed Varianten (Folders von vor dem (?d)-Fix) — beim toggle-off
 * mit rausfiltern, damit nichts liegen bleibt. */
const HIDDEN_PATTERNS_LEGACY = [".*", ".DS_Store", "Thumbs.db", "desktop.ini"];

export type FolderDefaults = {
  ignore_hidden: boolean;
  trashcan: boolean;
  trashcan_cleanout_days: number;
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
  const managed = new Set([...HIDDEN_PATTERNS, ...HIDDEN_PATTERNS_LEGACY]);
  const userPatterns = (current.ignore ?? []).filter((p) => !managed.has(p));
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
// Persistente Tracking-Map in localStorage. Verhindert dass useFolderSettings-
// Replication beim App-Start (frischer Ref-Cache) jeden peer-applied Setting
// nochmal applied — was setFolderIgnores + putFolder triggert und einen Full-
// Rescan auf jedem Unreal-Folder auslöst (50+ Min Initial-Hash).
const APPLIED_LS_KEY = "syncomat.folderSettings.applied";

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

export function useFolderSettingsReplication(
  ep: Endpoint | null,
  ready: boolean,
  folders: Folder[],
  myDeviceId: string | null,
  intervalMs = 30_000,
): void {
  const appliedRef = useRef<Map<FolderID, number>>(loadAppliedMap());

  useEffect(() => {
    if (!ep || !ready || !myDeviceId) return;
    let cancelled = false;

    const checkAll = async () => {
      let sawTagUpdate = false;
      for (const f of folders) {
        if (cancelled) return;
        try {
          const file = await folderSettingsRead(f.path);
          if (!file) continue;
          // Tag-Detection: jeder file-Read mit Tags ist ein Signal an useFolderTags
          // dass die UI refreshed werden sollte (auch wenn updated_by=self, weil
          // wir den Tag dann eben gerade geschrieben haben).
          if (file.settings.tags && file.settings.tags.length > 0) {
            sawTagUpdate = true;
          }
          // Wenn WIR sie geschrieben haben → nur als "seen" markieren, nicht applizieren.
          if (file.updated_by === myDeviceId) {
            appliedRef.current.set(f.id, file.updated_at);
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
      // Nach dem Loop: wenn wir irgendwo Tags gesehen haben (peer-update oder
      // self), useFolderTags benachrichtigen — der pollt sonst nur alle 15s.
      if (sawTagUpdate) notifyTagsChanged();
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
