import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef } from "react";
import {
  getConfig,
  getFolderIgnores,
  getFolderStatus,
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
 * Ordner-Löschen blockieren würden (sonst "delete dir: contains ignored files").
 *
 * `!/.syncomat` MUSS vorne stehen (Syncthing: erstes passendes Muster gewinnt):
 * `(?d).*` trifft sonst auch `.syncomat/` — dann syncen Tags, Papierkorb,
 * geteilte Ignore-Liste und Netzwerk-Hinweise für diesen Ordner nicht mehr
 * (bis v0.9.12, Audit 06.10.2026). */
export const SYNCOMAT_DIR_EXCEPTION = "!/.syncomat";
const HIDDEN_PATTERNS = [
  SYNCOMAT_DIR_EXCEPTION,
  "(?d).*",
  "(?d).DS_Store",
  "(?d)Thumbs.db",
  "(?d)desktop.ini",
];
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

/** Einstellungen aus dem lokalen Ist-Zustand ableiten — als Ausgangswert, wenn
 * noch keine folder-defaults.json existiert. NICHT einfach DEFAULT_FOLDER_DEFAULTS
 * nehmen: das würde einen vorhandenen Papierkorb clusterweit abschalten. */
export function defaultsFromLocal(folder: Folder, localIgnores: string[] | null): FolderDefaults {
  const v = folder.versioning;
  const ign = localIgnores ?? [];
  return {
    ...DEFAULT_FOLDER_DEFAULTS,
    trashcan: v?.type === "trashcan",
    trashcan_cleanout_days: Number(v?.params?.cleanoutDays ?? 0) || 0,
    ignore_hidden: ign.includes("(?d).*") || ign.includes(".*"),
  };
}

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

const stripD = (l: string) => l.trim().replace(/^\(\?d\)/, "");

/** Vereinigung zweier Ignore-Listen. Nur echte Muster (keine Kommentare/
 * Leerzeilen), Duplikate auch über `(?d)` hinweg erkannt. Neue Negationen
 * (`!…`) kommen nach VORNE — in Syncthing gewinnt das erste passende Muster,
 * hinten angehängt wären sie wirkungslos. */
function union(a: string[], b: string[]): string[] {
  const seen = new Set(a.map(stripD));
  const extra = b.filter((l) => {
    const t = l.trim();
    return t !== "" && !t.startsWith("//") && !seen.has(stripD(l));
  });
  const negs = extra.filter((l) => l.trim().startsWith("!"));
  const rest = extra.filter((l) => !l.trim().startsWith("!"));
  return [...negs, ...a, ...rest];
}

const sameList = (a: string[], b: string[]) => a.join("\n") === b.join("\n");

/** Ordner vollständig synchron? Nur dann darf der Erst-Abgleich eine neue
 * folder-defaults.json anlegen — sonst ist die Datei der anderen Geräte evtl.
 * nur noch nicht angekommen und würde als "neuere" überschrieben. */
async function isFullySynced(ep: Endpoint, f: Folder): Promise<boolean> {
  const st = await getFolderStatus(ep, f.id).catch(() => null);
  return !!st && st.state === "idle" && st.needBytes === 0;
}

/** Eindeutige Kennung einer Dateiversion — statt Zeitstempel über Geräte
 * hinweg zu vergleichen (Uhren weichen ab, gleiche Sekunde möglich). */
const fileVersionKey = (file: FolderDefaultsFile) => `${file.updated_by}:${file.updated_at}`;

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
  /** Ausgangswerte, falls noch keine Datei existiert (siehe defaultsFromLocal). */
  fallback: FolderDefaults = DEFAULT_FOLDER_DEFAULTS,
): Promise<FolderDefaultsFile> {
  const file = await folderSettingsRead(folderPath);
  const settings: FolderDefaults = {
    ...(file?.settings ?? fallback),
    ignores: withoutHidden(ignores),
    ignores_seed: seed,
  };
  return folderSettingsWrite(folderPath, myDeviceId, settings);
}

/**
 * Preset bewusst für alle Geräte setzen ("Anlegen" mit Preset, "Optimieren"):
 * geteilt ablegen und lokal über applyFolderDefaults anwenden — NICHT roh per
 * setFolderIgnores, sonst fehlen lokal die Hidden-Muster (ignore_hidden) und
 * das Gerät weicht von den anderen ab. Fällt das Schreiben der Datei aus,
 * wenigstens lokal setzen.
 */
export async function applyPresetEverywhere(
  ep: Endpoint,
  folder: Folder,
  myDeviceId: string,
  patterns: string[],
): Promise<void> {
  try {
    const cur = await getFolderIgnores(ep, folder.id).catch(() => ({ ignore: null }));
    const file = await writeSharedIgnores(
      folder.path,
      myDeviceId,
      patterns,
      false,
      defaultsFromLocal(folder, cur.ignore),
    );
    await applyFolderDefaults(ep, folder, file.settings);
  } catch (e) {
    console.warn("[shared-ignores] geteilte Liste nicht geschrieben, nur lokal", e);
    await setFolderIgnores(ep, folder.id, patterns);
  }
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
  return writeSharedIgnores(
    f.path,
    myDeviceId,
    merged,
    true,
    defaultsFromLocal(f, cur.ignore),
  );
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

/** Folder-ID → Kennung der zuletzt angewendeten Dateiversion (fileVersionKey).
 * Alte Einträge (Zahlen, bis v0.9.12) passen nie → einmal neu anwenden, was
 * dank diff-only-Schreiben folgenlos ist. */
function loadAppliedMap(): Map<FolderID, string> {
  try {
    const raw = localStorage.getItem(APPLIED_LS_KEY);
    if (!raw) return new Map();
    const obj = JSON.parse(raw) as Record<string, unknown>;
    return new Map(Object.entries(obj).map(([k, v]) => [k, String(v)]));
  } catch {
    return new Map();
  }
}

function saveAppliedMap(map: Map<FolderID, string>) {
  try {
    localStorage.setItem(APPLIED_LS_KEY, JSON.stringify(Object.fromEntries(map)));
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
  const appliedRef = useRef<Map<FolderID, string>>(loadAppliedMap());
  // Kein zweiter Durchlauf, solange der vorige noch läuft (viele Ordner,
  // Syncthing beim Hashen langsam) — sonst doppelte Schreib-/Rescan-Vorgänge.
  const runningRef = useRef(false);

  useEffect(() => {
    if (!ep || !ready || !myDeviceId) return;
    let cancelled = false;

    const markApplied = (id: FolderID, file: FolderDefaultsFile) => {
      appliedRef.current.set(id, fileVersionKey(file));
      saveAppliedMap(appliedRef.current);
    };

    const checkFolder = async (f: Folder): Promise<boolean> => {
      let file = await folderSettingsRead(f.path);
      if (cancelled) return false;

      // Umstellung auf die geteilte Ignore-Liste. Läuft VOR jedem Übernehmen
      // fremder Listen, sonst wäre die eigene Liste schon überschrieben, bevor
      // sie in die Vereinigung eingeht. Erneut nötig, wenn eine ältere Version
      // die Datei ohne `ignores` zurückgeschrieben hat.
      const lostShared = file !== null && !Array.isArray(file.settings.ignores);
      if (!isSeeded(f.id) || lostShared) {
        const shared = file?.settings.ignores;
        if (Array.isArray(shared) && file?.settings.ignores_seed === false) {
          // Bewusst gesetzte Liste existiert schon → unten normal übernehmen.
          markIgnoresSeeded(f.id);
        } else {
          // Ohne Datei nur bei vollständig synchronem Ordner anlegen — sonst
          // ist die der anderen Geräte evtl. nur noch nicht angekommen.
          if (file === null && !(await isFullySynced(ep, f))) return false;
          const res = await mergeLocalInto(
            ep,
            f,
            myDeviceId,
            Array.isArray(shared) ? shared : null,
          );
          if (res === null || cancelled) return false; // API-Aussetzer → nächste Runde
          markIgnoresSeeded(f.id);
          if (res !== "unchanged") {
            await applyFolderDefaults(ep, f, res.settings);
            markApplied(f.id, res);
            console.log(`[shared-ignores] ${f.id}: Liste abgeglichen`);
            return (res.settings.tags?.length ?? 0) > 0;
          }
        }
      }

      if (!file) return false;
      const sawTags = (file.settings.tags?.length ?? 0) > 0;
      // Selbst geschrieben → nur als gesehen merken, nicht anwenden.
      if (file.updated_by === myDeviceId) {
        if (appliedRef.current.get(f.id) !== fileVersionKey(file)) markApplied(f.id, file);
        return false;
      }
      if (appliedRef.current.get(f.id) === fileVersionKey(file)) return false;

      // Abgleich-Liste eines anderen Geräts: eigene Einträge ergänzen, falls
      // etwas fehlt (Vereinigung → alle landen beim selben Stand).
      if (file.settings.ignores_seed && Array.isArray(file.settings.ignores)) {
        const res = await mergeLocalInto(ep, f, myDeviceId, file.settings.ignores);
        if (res === null || cancelled) return false;
        if (res !== "unchanged") file = res;
      }
      await applyFolderDefaults(ep, f, file.settings);
      markApplied(f.id, file);
      console.log(`[folder-settings] applied ${f.id} from ${file.updated_by} (${file.updated_at})`);
      // Nur bei einer echten Änderung von außen die Tag-Anzeige neu laden.
      return sawTags;
    };

    const checkAll = async () => {
      if (runningRef.current) return;
      runningRef.current = true;
      let tagsChanged = false;
      try {
        for (const f of folders) {
          if (cancelled) return;
          try {
            if (await checkFolder(f)) tagsChanged = true;
          } catch (e) {
            console.warn(`[folder-settings] check ${f.id} failed:`, e);
          }
        }
      } finally {
        runningRef.current = false;
      }
      // useFolderTags pollt sonst nur alle 15s.
      if (tagsChanged && !cancelled) notifyTagsChanged();
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
