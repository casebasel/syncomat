import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef } from "react";
import {
  putFolder,
  setFolderIgnores,
  type Endpoint,
  type Folder,
  type FolderID,
} from "./syncthing";

export type FolderDefaults = {
  ignore_hidden: boolean;
  trashcan: boolean;
  trashcan_cleanout_days: number;
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
 * - ignore_hidden → .stignore (über REST setFolderIgnores)
 * - trashcan → folder.versioning
 */
export async function applyFolderDefaults(
  ep: Endpoint,
  folder: Folder,
  defaults: FolderDefaults,
): Promise<void> {
  // Hidden-Files-Pattern. Standard für macOS/Linux: alles was mit '.' beginnt,
  // plus Windows-OS-Schmutz.
  const hiddenPatterns = defaults.ignore_hidden
    ? [".*", ".DS_Store", "Thumbs.db", "desktop.ini"]
    : [];
  await setFolderIgnores(ep, folder.id, hiddenPatterns);

  const updatedFolder: Folder = {
    ...folder,
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
export function useFolderSettingsReplication(
  ep: Endpoint | null,
  ready: boolean,
  folders: Folder[],
  myDeviceId: string | null,
  intervalMs = 30_000,
): void {
  const appliedRef = useRef<Map<FolderID, number>>(new Map());

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
          const lastApplied = appliedRef.current.get(f.id) ?? 0;
          if (file.updated_at <= lastApplied) continue;
          // Neuer als zuletzt gesehen → applizieren.
          await applyFolderDefaults(ep, f, file.settings);
          appliedRef.current.set(f.id, file.updated_at);
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
