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
import { normalizeIgnores } from "./unreal";

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
  /** Geteilte .stignore-Liste (ohne die ignore_hidden-Muster) — alle Geräte
   * übernehmen sie, damit überall dieselben Dateien ignoriert werden.
   * Fehlt sie, bleibt die lokale .stignore wie sie ist. */
  ignores?: string[] | null;
  /** true = aus dem automatischen Abgleich (Vereinigung der Gerätelisten),
   * darf ergänzt werden. false = bewusst gesetzt, gilt exakt. */
  ignores_seed?: boolean;
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
  //
  // WICHTIG: Ignores NUR schreiben, wenn sie sich wirklich ändern. Jedes
  // setFolderIgnores löst in Syncthing einen Rescan aus — bei 26-GB-Unreal-
  // Ordnern Minuten CPU auf JEDEM Gerät, und die Replikation läuft bei jeder
  // Tag-Änderung. Vorher wurde hier bedingungslos geschrieben (Rescan-Sturm).
  const current = await getFolderIgnores(ep, folder.id).catch(() => ({
    ignore: null,
    expanded: null,
  }));
  if (current.ignore !== null) {
    // Bei API-Aussetzer (ignore === null) KEINESFALLS schreiben — sonst würde
    // die .stignore geleert und z.B. DerivedDataCache plötzlich mitsyncen.
    // Geteilte Liste (falls vorhanden) ist die Wahrheit, sonst die lokale.
    const base = Array.isArray(defaults.ignores) ? defaults.ignores : current.ignore;
    const userPatterns = withoutHidden(normalizeIgnores(base));
    const nextIgnores = defaults.ignore_hidden
      ? [...HIDDEN_PATTERNS, ...userPatterns]
      : userPatterns;
    if (nextIgnores.join("\n") !== current.ignore.join("\n")) {
      await setFolderIgnores(ep, folder.id, nextIgnores);
    }
  }

  // ─ versioning ─
  // Fresh folder fetch um stale-reference (z.B. devices[] vom Replication-Hook) zu vermeiden.
  const fresh = await getConfig(ep);
  const currentFolder = fresh.folders.find((f) => f.id === folder.id);
  if (!currentFolder) {
    throw new Error(`folder ${folder.id} not found in syncthing config`);
  }

  // Auch hier: PUT nur bei echter Änderung (Folder-PUT startet den Ordner in
  // Syncthing neu → erneuter Scan).
  const wantType = defaults.trashcan ? "trashcan" : "";
  const wantDays = String(defaults.trashcan_cleanout_days);
  const haveType = currentFolder.versioning?.type ?? "";
  const haveDays = currentFolder.versioning?.params?.cleanoutDays;
  const unchanged =
    haveType === wantType && (wantType !== "trashcan" || haveDays === wantDays);
  if (unchanged) return;

  const updatedFolder: Folder = {
    ...currentFolder,
    versioning: defaults.trashcan
      ? {
          type: "trashcan",
          params: {
            cleanoutDays: wantDays,
          },
        }
      : { type: "" },
  };
  await putFolder(ep, updatedFolder);
}

// ── Geteilte Ignore-Liste ──────────────────────────────────────
//
// Die .stignore ist in Syncthing pro Gerät und synct nicht mit. Unterschiedliche
// Listen auf den Geräten führen zu Fehlern wie "directory has been deleted on a
// remote device but is not empty" (Gerät A ignoriert *.lib, löscht den für es
// leeren Ordner, Gerät B hat darin Dateien). Deshalb liegt die Liste geteilt in
// .syncomat/folder-defaults.json (`ignores`) und jedes Gerät übernimmt sie.
//
// Umstellung bestehender Ordner (jedes Gerät genau einmal pro Ordner): die
// eigene Liste wird mit der geteilten VEREINIGT. Vereinigung ist reihenfolge-
// unabhängig, also landen alle Geräte beim selben Ergebnis, und nichts, was
// bisher irgendwo ignoriert war (z.B. DerivedDataCache), wird plötzlich gesynct.

const SEEDED_LS_PREFIX = "syncomat.sharedIgnores.v1:";

const isSeeded = (id: FolderID) => {
  try {
    return localStorage.getItem(SEEDED_LS_PREFIX + id) !== null;
  } catch {
    return false;
  }
};

/** Ordner gilt auf diesem Gerät als umgestellt — kein eigener Abgleich mehr.
 * Beim Verknüpfen eines angebotenen Ordners setzen: dort kommt die geteilte
 * Liste per Sync, eine eigene würde sie sonst als "neuere" überschreiben. */
export function markIgnoresSeeded(id: FolderID): void {
  try {
    localStorage.setItem(SEEDED_LS_PREFIX + id, String(Date.now()));
  } catch {
    // ohne Storage läuft der Abgleich beim nächsten Start erneut — harmlos
  }
}

function withoutHidden(lines: string[]): string[] {
  const managed = new Set([...HIDDEN_PATTERNS, ...HIDDEN_PATTERNS_LEGACY]);
  return lines.filter((p) => !managed.has(p));
}

function union(a: string[], b: string[]): string[] {
  const seen = new Set(a);
  return [...a, ...b.filter((l) => !seen.has(l))];
}

const sameList = (a: string[], b: string[]) => a.join("\n") === b.join("\n");

/**
 * Ignore-Liste geteilt ablegen (übrige Einstellungen bleiben erhalten).
 * `seed=false`: bewusst gesetzte Liste (Preset beim Anlegen/Optimieren), gilt
 * auf allen Geräten exakt.
 */
export async function writeSharedIgnores(
  folderPath: string,
  myDeviceId: string,
  ignores: string[],
  seed = false,
): Promise<FolderDefaultsFile> {
  const file = await folderSettingsRead(folderPath);
  const settings: FolderDefaults = {
    ...(file?.settings ?? DEFAULT_FOLDER_DEFAULTS),
    ignores: withoutHidden(ignores),
    ignores_seed: seed,
  };
  return folderSettingsWrite(folderPath, myDeviceId, settings);
}

/** Lokale Liste mit einer geteilten Abgleich-Liste vereinigen (ohne geteilte
 * Liste: die lokale wird zur geteilten). Gibt die neu geschriebene Datei
 * zurück, "unchanged" wenn nichts dazukam, null bei API-Aussetzer (dann wird
 * nichts geschrieben — sonst landet eine leere Liste im Cluster). */
async function mergeLocalInto(
  ep: Endpoint,
  f: Folder,
  myDeviceId: string,
  shared: string[] | null,
): Promise<FolderDefaultsFile | null | "unchanged"> {
  const cur = await getFolderIgnores(ep, f.id).catch(() => ({ ignore: null }));
  if (cur.ignore === null) return null;
  const local = withoutHidden(normalizeIgnores(cur.ignore));
  const sharedNorm = shared ? normalizeIgnores(shared) : null;
  const merged = sharedNorm ? union(sharedNorm, local) : local;
  if (shared && sameList(merged, shared)) return "unchanged";
  return writeSharedIgnores(f.path, myDeviceId, merged, true);
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
          let file = await folderSettingsRead(f.path);

          // Einmalige Umstellung auf die geteilte Ignore-Liste. Läuft VOR
          // jedem Übernehmen fremder Listen, sonst wäre die eigene Liste schon
          // überschrieben, bevor sie in die Vereinigung eingeht.
          if (!isSeeded(f.id)) {
            const shared = file?.settings.ignores;
            if (Array.isArray(shared) && file?.settings.ignores_seed === false) {
              // Bewusst gesetzte Liste existiert schon → einfach übernehmen.
              markIgnoresSeeded(f.id);
            } else {
              const res = await mergeLocalInto(
                ep,
                f,
                myDeviceId,
                Array.isArray(shared) ? shared : null,
              );
              if (res === null) continue; // API-Aussetzer → nächste Runde
              markIgnoresSeeded(f.id);
              if (res !== "unchanged") {
                await applyFolderDefaults(ep, f, res.settings);
                appliedRef.current.set(f.id, res.updated_at);
                saveAppliedMap(appliedRef.current);
                console.log(`[shared-ignores] ${f.id}: Liste abgeglichen`);
                continue;
              }
            }
            // "unchanged": die geteilte Liste fremder Geräte unten normal
            // übernehmen (lastApplied ist noch nicht gesetzt).
            appliedRef.current.delete(f.id);
          }

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
          // Abgleich-Liste eines anderen Geräts: eigene Einträge ergänzen,
          // falls etwas fehlt (Vereinigung → alle landen beim selben Stand).
          if (file.settings.ignores_seed && Array.isArray(file.settings.ignores)) {
            const res = await mergeLocalInto(ep, f, myDeviceId, file.settings.ignores);
            if (res === null) continue;
            if (res !== "unchanged") file = res;
          }
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
