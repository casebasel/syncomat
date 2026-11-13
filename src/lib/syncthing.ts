import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";

// ============================================================
// Types — only the fields we actually read in the UI.
// ============================================================

export type Endpoint = { url: string; api_key: string };
export type DeviceID = string; // 56 chars, dash-separated groups
export type FolderID = string;

export type SystemStatus = {
  myID: DeviceID;
  uptime: number;
  cpuPercent: number;
};

export type Connection = {
  connected: boolean;
  address: string;
  clientVersion: string;
  inBytesTotal: number;
  outBytesTotal: number;
};

export type Connections = {
  connections: Record<DeviceID, Connection>;
  total: { inBytesTotal: number; outBytesTotal: number };
};

export type FolderVersioning = {
  type: "" | "trashcan" | "simple" | "staggered" | "external";
  params?: Record<string, string>;
  /** Ablageort der Versionen (leer = `.stversions` im Ordner). */
  fsPath?: string;
  fsType?: string;
  cleanupIntervalS?: number;
};

export type Folder = {
  id: FolderID;
  label: string;
  path: string;
  type: "sendreceive" | "sendonly" | "receiveonly";
  paused: boolean;
  /** introducedBy: von wem vorgestellt (leer = selbst eingetragen, z. B. der NAS-Hub) */
  devices: { deviceID: DeviceID; introducedBy?: DeviceID }[];
  versioning?: FolderVersioning;
  ignorePerms?: boolean;
  /** WICHTIG: nicht setzen — Syncthing auto-detected pro folder.path.
   * Hardcoded auf true bricht silent Windows-Peer-Sync (NTFS = case-insensitive). */
  caseSensitiveFS?: boolean;
  /** Tuning-Felder für Unreal-Scale (siehe tuneFolderForSize) */
  rescanIntervalS?: number;
  fsWatcherEnabled?: boolean;
  fsWatcherDelayS?: number;
  blockPullOrder?: "standard" | "random" | "alphabetic" | "smallestFirst" | "largestFirst" | "oldestFirst" | "newestFirst" | "inOrder";
  copiers?: number;
  hashers?: number;
  weakHashThresholdPct?: number;
  maxConflicts?: number;
  scanProgressIntervalS?: number;
  minDiskFree?: { value: number; unit: string };
};

export type FolderError = { path: string; error: string };
export type FolderErrorList = { folder: FolderID; errors: FolderError[] };
export type FolderIgnores = { ignore: string[] | null; expanded: string[] | null };

export type Device = {
  deviceID: DeviceID;
  name: string;
  addresses: string[];
  introducer: boolean;
  /** true = Vorstellungen dieses Geräts nehmen nie etwas zurück (keine
   * Geräte/Freigaben entfernen). Seit v0.9.44 überall an. */
  skipIntroductionRemovals?: boolean;
  autoAcceptFolders: boolean;
  paused: boolean;
  /** Ordner-Angebote dieses Geräts, die wir dauerhaft abgelehnt haben —
   * Syncthing zeigt sie dann nicht mehr als "pending" (auch wenn Auto-Share
   * sie weiter teilt). */
  ignoredFolders?: { id: FolderID; label: string; time: string }[];
};

export type Config = { folders: Folder[]; devices: Device[] };

/** Ausschnitt der globalen Syncthing-Optionen, den wir anfassen. */
export type Options = {
  /** true = Syncthing senkt seine eigene Prozess-Priorität (Default). Auf
   * dedizierten Sync-Workstations bremst das Hashen + Ziehen spürbar. */
  setLowPriority?: boolean;
  maxFolderConcurrency?: number;
};

export type PendingFolder = {
  folderID: FolderID;
  offeredBy: Record<
    DeviceID,
    { time: string; label: string; receiveEncrypted: boolean }
  >;
};

export type PendingDevice = {
  deviceID: DeviceID;
  time: string;
  address: string;
  name: string;
};

export type FolderStatus = {
  state: string;
  globalBytes: number;
  localBytes: number;
  needBytes: number;
  errors: number;
  /** Veralteter Doppelname von `errors` (gleicher Wert) — NICHT addieren,
   * sonst erscheint jede Fehlerzahl doppelt (bis v0.9.12). */
  pullErrors: number;
  localFiles: number;
  globalFiles: number;
  /** Fehlende Dateien/Löschungen von den anderen Geräten. */
  needFiles?: number;
  needDeletes?: number;
  /** Nur bei „Nur empfangen“: lokale Abweichungen, die „Zurücksetzen“ verwirft. */
  receiveOnlyTotalItems?: number;
  /** Fehler des GANZEN Ordners (z. B. „folder marker missing", „folder path
   * missing"). Syncthing hält den Ordner dann an, `state` bleibt dabei oft
   * „idle" und `errors` 0 — bis v0.9.14 sah Syncomat das nicht und zeigte
   * wochenlang „Wartet" (x5950, Marketplace 5.7, Okt. 2026). */
  error?: string;
};

/** Konfliktkopien je Datei: keine. Wie Resilio mit ausgeschaltetem Archiv
 * gewinnt die neuere Fassung, die ältere wird verworfen (`moveForConflict` in
 * lib/model/folder_sendrecv.go). Marlon 11.11.2026: keine Kopien — für den
 * Ernstfall gibt es das NAS mit ZFS-Snapshots. v0.9.16–0.9.38 behielten 1. */
export const MAX_CONFLICTS = 0;

/** Interner Syncthing-Ordner für syncomat selbst (Versionen, Steuerinfos).
 * Liegt im App-Datenordner, wird an alle Geräte geteilt und nie als Nutzer-
 * Ordner angezeigt. Siehe lib/internChannel.ts. */
export const INTERN_FOLDER_ID = "syncomat-intern";

/** Kanal des Speicher-Wächters (geraete.json, inhalt/…): am Hub sendonly,
 * auf jedem Rechner receiveonly im App-Datenordner. Siehe lib/waechterKanal.ts. */
export const WAECHTER_FOLDER_ID = "syncomat-waechter";

/** Ordner von syncomat selbst — nie als Nutzer-Ordner zeigen oder teilen. */
export const istSystemOrdner = (id: string) => id === INTERN_FOLDER_ID || id === WAECHTER_FOLDER_ID;

/** Ordner-Fehler aus dem Status, oder null. Immer hierüber prüfen, nie nur
 * `state` oder `errors` (das sind Datei-Fehler). */
export function folderError(s: FolderStatus | null | undefined): string | null {
  const e = s?.error?.trim();
  return e ? e : null;
}

/** Ordner-Fehler in Werkzeug-Deutsch: was passiert ist + was zu tun ist. */
export function describeFolderError(raw: string): { title: string; action: string } {
  if (/folder marker missing/i.test(raw)) {
    return {
      title: "Ordner-Marke .stfolder fehlt — Sync angehalten",
      action:
        "Passiert z. B. nach „Überprüfen“ im Epic Launcher. syncomat repariert das in " +
        "der nächsten Minute selbst: Ist der Ordner vollständig, legt es die Marke neu " +
        "an. Fehlt viel, holt es die fehlenden Dateien von den anderen zurück, ohne " +
        "dort etwas zu löschen.",
    };
  }
  if (/insufficient space|not enough free space|free space/i.test(raw)) {
    return {
      title: "Zu wenig Platz — Laden angehalten",
      action:
        "Auf diesem Laufwerk sind weniger als 50 GB frei (feste Reserve). Syncthing lädt weiter, " +
        "sobald Platz frei ist: Papierkorb leeren, Teile des Abos abwählen oder Daten verschieben.",
    };
  }
  if (/folder path missing/i.test(raw)) {
    return {
      title: "Ordner-Pfad nicht erreichbar — Sync angehalten",
      action: "Laufwerk anschliessen bzw. Pfad wiederherstellen. Nicht neu anlegen.",
    };
  }
  return { title: "Ordner-Fehler — Sync angehalten", action: raw };
}

export type SyncEvent = {
  id: number;
  globalID: number;
  time: string;
  type: string;
  data: unknown;
};

// ============================================================
// Helpers
// ============================================================

export function shortDeviceID(id: DeviceID): string {
  if (id.length <= 16) return id;
  return `${id.slice(0, 7)}…${id.slice(-7)}`;
}

// ============================================================
// REST primitive
// ============================================================

async function api<T = unknown>(
  ep: Endpoint,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${ep.url}${path}`, {
    ...init,
    headers: { ...init?.headers, "X-API-Key": ep.api_key },
  });
  if (!res.ok) {
    throw new Error(`${init?.method ?? "GET"} ${path} → ${res.status} ${res.statusText}`);
  }
  // POST /scan returns empty body
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

// ============================================================
// REST endpoints (Briefing §6)
// ============================================================

export const getStatus = (ep: Endpoint) =>
  api<SystemStatus>(ep, "/rest/system/status");
export const getPing = (ep: Endpoint) =>
  api<{ ping: string }>(ep, "/rest/system/ping");
export const getConnections = (ep: Endpoint) =>
  api<Connections>(ep, "/rest/system/connections");
export const getConfig = (ep: Endpoint) => api<Config>(ep, "/rest/config");

export const getOptions = (ep: Endpoint) => api<Options>(ep, "/rest/config/options");

/** Teil-Update der globalen Optionen (PATCH merged, Rest bleibt). */
export const patchOptions = (ep: Endpoint, partial: Options) =>
  api<void>(ep, "/rest/config/options", {
    method: "PATCH",
    body: JSON.stringify(partial),
    headers: { "Content-Type": "application/json" },
  });

/**
 * Ein angebotenes Folder dauerhaft ablehnen: auf jedem anbietenden Gerät in
 * `ignoredFolders` eintragen. Syncthing nimmt es damit aus der Pending-Liste
 * und bietet es nicht erneut an — selbst wenn Auto-Share es weiter teilt.
 * (Gegenstück zum Verknüpfen; ohne das poppt ein entfernter Ordner ewig
 * wieder als "Verfügbar" auf.)
 */
export async function ignorePendingFolder(
  ep: Endpoint,
  folderID: FolderID,
  label: string,
  offeredBy: DeviceID[],
): Promise<void> {
  const config = await getConfig(ep);
  const time = new Date().toISOString();
  for (const did of offeredBy) {
    const dev = config.devices.find((d) => d.deviceID === did);
    if (!dev) continue;
    const ignored = dev.ignoredFolders ?? [];
    if (ignored.some((f) => f.id === folderID)) continue;
    await patchDevice(ep, did, {
      ignoredFolders: [...ignored, { id: folderID, label, time }],
    });
  }
}

type PendingFoldersRaw = Record<FolderID, { offeredBy: PendingFolder["offeredBy"] }>;
export async function getPendingFolders(ep: Endpoint): Promise<PendingFolder[]> {
  const raw = await api<PendingFoldersRaw>(ep, "/rest/cluster/pending/folders");
  return Object.entries(raw).map(([folderID, v]) => ({
    folderID,
    offeredBy: v.offeredBy,
  }));
}

type PendingDevicesRaw = Record<DeviceID, Omit<PendingDevice, "deviceID">>;
export async function getPendingDevices(ep: Endpoint): Promise<PendingDevice[]> {
  const raw = await api<PendingDevicesRaw>(ep, "/rest/cluster/pending/devices");
  return Object.entries(raw).map(([deviceID, v]) => ({ deviceID, ...v }));
}

export const getFolderStatus = (ep: Endpoint, id: FolderID) =>
  api<FolderStatus>(ep, `/rest/db/status?folder=${encodeURIComponent(id)}`);

/** Abgleich-Stand eines Ordners auf einem anderen Gerät. `remoteState`:
 * "valid" | "paused" | "notSharing" | "unknown" (Syncthing 2). */
export const getRemoteCompletion = (ep: Endpoint, id: FolderID, device: DeviceID) =>
  api<{ completion: number; needItems: number; needDeletes: number; remoteState?: string }>(
    ep,
    `/rest/db/completion?folder=${encodeURIComponent(id)}&device=${encodeURIComponent(device)}`,
  );

/** Inhaltsverzeichnis eines Ordners laut globalem Index (auch für Dateien,
 * die lokal ignoriert sind). Syncthing 1.x liefert ein verschachteltes Objekt,
 * 2.x eine Liste von Einträgen mit children — siehe sumBrowseTopLevel. */
export const getBrowse = (ep: Endpoint, id: FolderID, levels = -1) =>
  api<unknown>(ep, `/rest/db/browse?folder=${encodeURIComponent(id)}&levels=${levels}`);

/** Grösse je Eintrag der obersten Ebene (Ordner und Dateien) aus getBrowse. */
export function sumBrowseTopLevel(tree: unknown): { name: string; bytes: number; ordner: boolean }[] {
  const sum = (node: unknown): number => {
    if (Array.isArray(node)) {
      // 2.x-Liste von Einträgen, oder 1.x-Datei [modTime, size]
      if (node.length === 2 && typeof node[1] === "number" && typeof node[0] === "string") return node[1];
      return node.reduce((a: number, e) => a + sum(e), 0);
    }
    if (node && typeof node === "object") {
      const o = node as Record<string, unknown>;
      if ("type" in o && "name" in o) {
        const self = typeof o.size === "number" && !String(o.type).includes("DIRECTORY") ? o.size : 0;
        return self + (o.children ? sum(o.children) : 0);
      }
      return Object.values(o).reduce((a: number, v) => a + sum(v), 0);
    }
    return 0;
  };
  if (Array.isArray(tree)) {
    return tree.map((e) => {
      const o = e as Record<string, unknown>;
      return { name: String(o.name), bytes: sum(e), ordner: String(o.type).includes("DIRECTORY") };
    });
  }
  if (tree && typeof tree === "object") {
    return Object.entries(tree as Record<string, unknown>).map(([name, v]) => ({
      name,
      bytes: sum(v),
      ordner: !Array.isArray(v),
    }));
  }
  return [];
}

export type BaumKnoten = { name: string; pfad: string; bytes: number; kinder: BaumKnoten[] };

/** Ordnerbaum (nur Ordner) mit Grössen aus getBrowse, bis zu `tiefe` Ebenen. */
export function baumAusBrowse(tree: unknown, tiefe = 8): BaumKnoten[] {
  type Roh = { name: string; ordner: boolean; bytes: number; kinder: unknown };
  const eintraege = (node: unknown): Roh[] => {
    if (Array.isArray(node)) {
      return node.map((e) => {
        const o = e as Record<string, unknown>;
        const ordner = String(o.type).includes("DIRECTORY");
        return { name: String(o.name), ordner, bytes: ordner ? 0 : Number(o.size) || 0, kinder: o.children ?? [] };
      });
    }
    if (node && typeof node === "object") {
      return Object.entries(node as Record<string, unknown>).map(([name, v]) =>
        Array.isArray(v) && v.length === 2 && typeof v[1] === "number"
          ? { name, ordner: false, bytes: v[1] as number, kinder: [] }
          : { name, ordner: true, bytes: 0, kinder: v },
      );
    }
    return [];
  };
  const bau = (node: unknown, prefix: string, rest: number): { knoten: BaumKnoten[]; bytes: number } => {
    let summe = 0;
    const knoten: BaumKnoten[] = [];
    for (const e of eintraege(node)) {
      if (!e.ordner) {
        summe += e.bytes;
        continue;
      }
      const pfad = prefix ? `${prefix}/${e.name}` : e.name;
      const unten = bau(e.kinder, pfad, rest - 1);
      summe += unten.bytes;
      // Versteckte Ordner bleiben im Baum (nicht wählbar, aber sichtbar) —
      // sonst fielen sie beim Aufteilen eines Elternordners still weg.
      // Nur `.syncomat` (Notizen, immer abgeglichen) im Stamm nicht.
      if (!(prefix === "" && e.name === ".syncomat")) knoten.push({ name: e.name, pfad, bytes: unten.bytes, kinder: rest > 1 ? unten.knoten : [] });
    }
    knoten.sort((a, b) => a.name.localeCompare(b.name, "de"));
    return { knoten, bytes: summe };
  };
  return bau(tree, "", tiefe).knoten;
}

/** Bytes einer Auswahl im Baum (leere Auswahl = alles). */
export function bytesDerAuswahl(baum: BaumKnoten[], auswahl: string[], gesamt: number): number {
  if (auswahl.length === 0) return gesamt;
  const finde = (k: BaumKnoten[], pfad: string): BaumKnoten | null => {
    for (const n of k) {
      if (n.pfad === pfad) return n;
      if (pfad.startsWith(n.pfad + "/")) return finde(n.kinder, pfad);
    }
    return null;
  };
  return auswahl.reduce((a, p) => a + (finde(baum, p)?.bytes ?? 0), 0);
}

export const scanFolder = (ep: Endpoint, id: FolderID) =>
  api<void>(ep, `/rest/db/scan?folder=${encodeURIComponent(id)}`, {
    method: "POST",
  });

/**
 * Scan-all: sequential statt parallel. Bei Unreal-Scale (5+ Folders à 100k+
 * Files) löst Promise.all gleichzeitig 5 Full-Tree-Hash-Scans aus → SSD-Queue
 * voll, Syncomat-UI hängt mehrere Minuten. Sequential ist langsamer aber
 * verhindert die DoS-Spirale.
 */
export const scanAllFolders = async (ep: Endpoint, folders: Folder[]) => {
  for (const f of folders) {
    try {
      await scanFolder(ep, f.id);
    } catch (e) {
      console.warn(`[scan] folder ${f.id} failed:`, e);
    }
  }
};

/** Lokale Abweichungen eines „Nur empfangen“-Ordners (gelöscht oder geändert). */
export const getLocalChanged = (ep: Endpoint, id: FolderID, page = 1, perpage = 1000) =>
  api<{ files: { name: string; deleted?: boolean }[] | null }>(
    ep,
    `/rest/db/localchanged?folder=${encodeURIComponent(id)}&page=${page}&perpage=${perpage}`,
  );

/** „Lokale Änderungen zurücksetzen“: holt den Stand der anderen zurück. */
export const revertFolder = (ep: Endpoint, id: FolderID) =>
  api<void>(ep, `/rest/db/revert?folder=${encodeURIComponent(id)}`, { method: "POST" });

export const deletePendingDevice = (ep: Endpoint, id: DeviceID) =>
  api<void>(ep, `/rest/cluster/pending/devices?device=${encodeURIComponent(id)}`, {
    method: "DELETE",
  });

export const deletePendingFolder = (
  ep: Endpoint,
  folderID: FolderID,
  deviceID: DeviceID,
) =>
  api<void>(
    ep,
    `/rest/cluster/pending/folders?folder=${encodeURIComponent(folderID)}&device=${encodeURIComponent(deviceID)}`,
    { method: "DELETE" },
  );

export const putFolder = (ep: Endpoint, folder: Folder) =>
  api<void>(ep, `/rest/config/folders/${encodeURIComponent(folder.id)}`, {
    method: "PUT",
    body: JSON.stringify(folder),
    headers: { "Content-Type": "application/json" },
  });

export const putDevice = (ep: Endpoint, device: Device) =>
  api<void>(ep, `/rest/config/devices/${encodeURIComponent(device.deviceID)}`, {
    method: "PUT",
    body: JSON.stringify(device),
    headers: { "Content-Type": "application/json" },
  });

export const patchDevice = (
  ep: Endpoint,
  deviceID: DeviceID,
  partial: Partial<Device>,
) =>
  api<void>(ep, `/rest/config/devices/${encodeURIComponent(deviceID)}`, {
    method: "PATCH",
    body: JSON.stringify(partial),
    headers: { "Content-Type": "application/json" },
  });

export const deleteFolder = (ep: Endpoint, folderID: FolderID) =>
  api<void>(ep, `/rest/config/folders/${encodeURIComponent(folderID)}`, {
    method: "DELETE",
  });

export const deleteDevice = (ep: Endpoint, deviceID: DeviceID) =>
  api<void>(ep, `/rest/config/devices/${encodeURIComponent(deviceID)}`, {
    method: "DELETE",
  });

// ── Cross-OS support: folder errors + ignores ─────────────────

export const getFolderErrors = (ep: Endpoint, folderID: FolderID) =>
  api<FolderErrorList>(
    ep,
    `/rest/folder/errors?folder=${encodeURIComponent(folderID)}&perpage=200`,
  );

/** Eintrag einer Datei in der Datenbank (lokal und global). */
export type DbDatei = {
  local?: { ignored?: boolean; invalid?: boolean; localFlags?: number; deleted?: boolean; version?: string[] } | null;
  global?: { deleted?: boolean; size?: number; version?: string[] } | null;
  availability?: { id: string }[] | null;
};
export const getDbFile = (ep: Endpoint, folderID: FolderID, file: string) =>
  api<DbDatei>(ep, `/rest/db/file?folder=${encodeURIComponent(folderID)}&file=${encodeURIComponent(file)}`);

/** Verbindung zu einem Gerät kurz trennen und wieder aufnehmen. Danach
 * schickt es seine Ordnerliste neu — nötig, damit ein Angebot wieder als
 * „ausstehend“ erscheint, nachdem hier ein Ordner derselben ID entfernt wurde
 * (Syncthing merkt sich Angebote nur beim Verbindungsaufbau; live auf render). */
const zuletztNeuVerbunden = new Map<DeviceID, number>();
/** Höchstens alle 2 min je Gerät — nie eine Schleife (v0.9.31 auf render). */
const NEU_VERBINDEN_PAUSE_MS = 120_000;
export async function neuVerbinden(ep: Endpoint, alle: DeviceID[]): Promise<void> {
  const jetzt = Date.now();
  const deviceIDs = alle.filter((d) => jetzt - (zuletztNeuVerbunden.get(d) ?? 0) > NEU_VERBINDEN_PAUSE_MS);
  if (deviceIDs.length === 0) return;
  for (const d of deviceIDs) zuletztNeuVerbunden.set(d, jetzt);
  for (const d of deviceIDs) {
    await api<void>(ep, `/rest/system/pause?device=${encodeURIComponent(d)}`, { method: "POST" }).catch(() => {});
  }
  await new Promise((r) => setTimeout(r, 1500));
  for (const d of deviceIDs) {
    await api<void>(ep, `/rest/system/resume?device=${encodeURIComponent(d)}`, { method: "POST" }).catch(() => {});
  }
}

/** Statistik je Ordner — u. a. letzte geänderte Datei (Zeitpunkt). */
export const getFolderStats = (ep: Endpoint) =>
  api<Record<FolderID, { lastFile?: { at?: string; filename?: string }; lastScan?: string }>>(ep, "/rest/stats/folder");

/** Statistik je Gerät — u. a. wann es zuletzt verbunden war. */
export const getDeviceStats = (ep: Endpoint) =>
  api<Record<DeviceID, { lastSeen?: string; lastConnectionDurationS?: number }>>(ep, "/rest/stats/device");

export const getFolderIgnores = (ep: Endpoint, folderID: FolderID) =>
  api<FolderIgnores>(ep, `/rest/db/ignores?folder=${encodeURIComponent(folderID)}`);

/** Verzeichnis-Browser eines (auch entfernten) Syncthing — für den Pfad-Picker
 * beim Ordner-Annehmen auf dem NAS. Gibt Unterverzeichnisse von `current` zurück. */
export const systemBrowse = (ep: Endpoint, current: string) =>
  api<string[]>(ep, `/rest/system/browse?current=${encodeURIComponent(current)}`);

export const setFolderIgnores = (
  ep: Endpoint,
  folderID: FolderID,
  ignore: string[],
) =>
  api<void>(ep, `/rest/db/ignores?folder=${encodeURIComponent(folderID)}`, {
    method: "POST",
    body: JSON.stringify({ ignore }),
    headers: { "Content-Type": "application/json" },
  });

/**
 * Adaptive Folder-Tuning für Unreal-Scale: setzt rescanIntervalS, fsWatcher,
 * Copiers/Hashers basierend auf Folder-Größe + Workload-Detection.
 *
 * Werte basieren auf Syncthing-Doku + Audit-Synthese; siehe Code-Review.
 */
export function tuneFolderForSize(
  folder: Folder,
  bytes: number,
  files: number,
  workload: string,
): Folder {
  const gb = bytes / (1024 * 1024 * 1024);
  const isUnreal = workload === "unreal" || workload === "unreal-plugins";
  let rescanIntervalS: number;
  let fsWatcherDelayS: number;
  let copiers: number | undefined;
  let hashers: number | undefined;
  if (gb >= 50) {
    rescanIntervalS = 7200;
    fsWatcherDelayS = isUnreal ? 30 : 15;
    copiers = 2;
    hashers = 4;
  } else if (gb >= 10) {
    rescanIntervalS = 3600;
    fsWatcherDelayS = isUnreal ? 15 : 10;
    copiers = 2;
    hashers = 4;
  } else if (gb >= 1) {
    rescanIntervalS = 300;
    fsWatcherDelayS = 5;
  } else {
    rescanIntervalS = 60;
    fsWatcherDelayS = 2;
  }
  return {
    ...folder,
    fsWatcherEnabled: true,
    fsWatcherDelayS,
    rescanIntervalS,
    copiers,
    hashers,
    // Unterlegene Fassung eines Konflikts als .sync-conflict-Kopie behalten
    // (siehe MAX_CONFLICTS).
    maxConflicts: MAX_CONFLICTS,
    scanProgressIntervalS: 5,
    // Rechte-Bits NICHT syncen: im Mac/Windows/NAS-Mix erzeugen sie sonst
    // Dauer-Churn ("geändert", obwohl nur der Mode-Bit anders ist) und auf
    // receive-only-Ordnern der NAS "lokal geänderte Elemente".
    ignorePerms: true,
    // Weak-Hash (Rolling-Hash) findet VERSCHOBENE Blöcke — nützt bei
    // Text/Logs, nicht bei Unreal-Binärassets, die komplett neu geschrieben
    // werden, und bei 50k+ kleinen Dateien kostet er nur CPU je Scan → aus (101).
    weakHashThresholdPct: isUnreal || files > 50_000 ? 101 : 25,
    blockPullOrder: isUnreal ? "inOrder" : "standard",
    // caseSensitiveFS NICHT setzen — auto-detect lassen
  };
}

/**
 * Heuristik: ist der Fehler ein Windows-Namens-Problem (illegal char, reserved name)?
 * Syncthing-Fehlertexte sind keyword-basiert; wir fangen die häufigsten.
 *
 * VORSICHT: der naive Regex /[:?*<>|"]/ matched JEDE Go-Style-Fehlermeldung der
 * Form "open /Users/marlon/x: permission denied" — die enthält IMMER einen :.
 * Daher tighter check: keywords ODER illegale chars im FILE-NAME-Teil
 * (nach dem letzten / oder \) — System-Pfad-Doppelpunkte ignorieren.
 */
export function isWindowsNameError(err: string): boolean {
  const s = err.toLowerCase();
  const keyword =
    s.includes("illegal name") ||
    s.includes("illegal char") ||
    s.includes("invalid character") ||
    s.includes("invalid filename") ||
    s.includes("reserved name") ||
    s.includes("invalid path");
  if (keyword) return true;
  // Extrahiere den Filename-Teil und checke ob DER illegale Chars hat.
  // Filename = nach dem letzten Slash, vor dem ersten ":" oder " " (Go-Errors).
  const slash = Math.max(err.lastIndexOf("/"), err.lastIndexOf("\\"));
  const tail = err.slice(slash + 1).split(/[:\s]/)[0] ?? "";
  return /[?*<>|"]/.test(tail) || /:.*[\\\/]/.test(tail);
}

// ============================================================
// Event stream (long-poll on /rest/events)
// ============================================================

export async function* subscribeEvents(
  ep: Endpoint,
  since = 0,
  signal?: AbortSignal,
  /** "/rest/events/disk": lokale und entfernte Datei-Änderungen
   * (LocalChangeDetected, RemoteChangeDetected) — sind im normalen Strom nicht dabei. */
  pfad = "/rest/events",
): AsyncIterable<SyncEvent> {
  while (!signal?.aborted) {
    const res = await fetch(
      `${ep.url}${pfad}?since=${since}&timeout=60`,
      { headers: { "X-API-Key": ep.api_key }, signal },
    );
    if (!res.ok) throw new Error(`/rest/events → ${res.status}`);
    const events = (await res.json()) as SyncEvent[];
    for (const e of events) {
      yield e;
      since = e.id;
    }
  }
}

// ============================================================
// Shared event bus — one subscriber per endpoint, fan-out to listeners.
// ============================================================

export type EventHandler = (e: SyncEvent) => void;

class EventBus {
  private endpoint: Endpoint | null = null;
  private listeners = new Set<EventHandler>();
  private abort: AbortController | null = null;

  setEndpoint(ep: Endpoint | null) {
    if (this.endpoint?.url === ep?.url && this.endpoint?.api_key === ep?.api_key) return;
    this.stop();
    this.endpoint = ep;
    if (ep && this.listeners.size > 0) this.start();
  }

  add(handler: EventHandler) {
    this.listeners.add(handler);
    if (this.endpoint && !this.abort) this.start();
  }

  remove(handler: EventHandler) {
    this.listeners.delete(handler);
    if (this.listeners.size === 0) this.stop();
  }

  private start() {
    if (!this.endpoint || this.abort) return;
    const ctrl = new AbortController();
    this.abort = ctrl;
    void this.loop(this.endpoint, ctrl.signal, "/rest/events");
    // Zweiter Strom: Datei-Änderungen (hier gelöscht/geändert) fürs Protokoll.
    void this.loop(this.endpoint, ctrl.signal, "/rest/events/disk");
  }

  private stop() {
    this.abort?.abort();
    this.abort = null;
  }

  /** Nach einem Neustart von Syncthing beginnen die Event-IDs wieder bei 1 —
   * mit dem alten `since` würde der Long-Poll nur noch leer zurückkommen. */
  restart() {
    if (this.listeners.size === 0) return;
    this.stop();
    this.start();
  }

  private async loop(ep: Endpoint, signal: AbortSignal, pfad: string) {
    let since = 0;
    let backoff = 1000;
    while (!signal.aborted) {
      try {
        for await (const event of subscribeEvents(ep, since, signal, pfad)) {
          for (const h of this.listeners) {
            try {
              h(event);
            } catch (err) {
              console.error("[syncthing] event handler threw", err);
            }
          }
          since = event.id;
          backoff = 1000;
        }
      } catch (e) {
        if (signal.aborted) return;
        console.warn(
          "[syncthing] event stream broken, reconnecting in",
          backoff,
          "ms",
          e,
        );
        await new Promise((r) => setTimeout(r, backoff));
        backoff = Math.min(30_000, backoff * 2);
      }
    }
  }
}

export const bus = new EventBus();

// ============================================================
// React hooks
// ============================================================

export function useEndpoint(): Endpoint | null {
  const [endpoint, setEndpoint] = useState<Endpoint | null>(null);

  useEffect(() => {
    let cancelled = false;
    invoke<Endpoint>("syncthing_endpoint")
      .then((ep) => {
        if (!cancelled) {
          setEndpoint(ep);
          bus.setEndpoint(ep);
        }
      })
      .catch((e) => console.error("[syncthing] endpoint invoke failed", e));
    return () => {
      cancelled = true;
    };
  }, []);

  return endpoint;
}

export function useSyncthingReady(ep: Endpoint | null): boolean {
  const [ready, setReady] = useState(false);
  // Zählt unerwartete Syncthing-Neustarts (Rust-Supervisor startet neu) —
  // jeder Neustart setzt "bereit" zurück, damit die UI nicht weiter "aktuell"
  // zeigt, während nichts synchronisiert, und alle Hooks danach frisch laden.
  const [restarts, setRestarts] = useState(0);

  useEffect(() => {
    const unlistenP = listen("syncthing://terminated", () => {
      console.warn("[syncthing] Sync-Dienst unerwartet beendet — wird neu gestartet");
      setRestarts((n) => n + 1);
    });
    return () => {
      unlistenP.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    if (!ep) return;
    setReady(false);
    if (restarts > 0) bus.restart();

    let cancelled = false;
    const unlistenP = listen("syncthing://ready", () => {
      if (!cancelled) setReady(true);
    });

    // Fallback ping-probe — closes the race when listener registers after event.
    (async () => {
      while (!cancelled) {
        try {
          await getPing(ep);
          if (!cancelled) setReady(true);
          return;
        } catch {
          await new Promise((r) => setTimeout(r, 500));
        }
      }
    })();

    return () => {
      cancelled = true;
      unlistenP.then((fn) => fn());
    };
  }, [ep?.url, ep?.api_key, restarts]);

  return ready;
}

type Loadable<T> = { data: T | null; error: Error | null };

/**
 * Wires an initial fetch plus event-driven revalidation.
 * `shouldRefetch` decides whether a given SyncEvent should trigger a refetch.
 */
function useLoadable<T>(
  ep: Endpoint | null,
  ready: boolean,
  fetcher: (ep: Endpoint) => Promise<T>,
  shouldRefetch: (e: SyncEvent) => boolean,
  deps: unknown[] = [],
): Loadable<T> {
  const [state, setState] = useState<Loadable<T>>({ data: null, error: null });
  const lastDebounce = useRef(0);

  useEffect(() => {
    if (!ep || !ready) return;
    let cancelled = false;

    const refetch = () => {
      fetcher(ep).then(
        (data) => !cancelled && setState({ data, error: null }),
        (error: Error) => !cancelled && setState((s) => ({ ...s, error })),
      );
    };

    refetch();

    const handler: EventHandler = (e) => {
      if (!shouldRefetch(e)) return;
      // 200ms debounce — coalesce burst (ItemFinished etc.)
      const now = Date.now();
      lastDebounce.current = now;
      setTimeout(() => {
        if (lastDebounce.current === now && !cancelled) refetch();
      }, 200);
    };
    bus.add(handler);

    return () => {
      cancelled = true;
      bus.remove(handler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ep?.url, ep?.api_key, ready, ...deps]);

  return state;
}

const NEVER = () => false;
const ON = (...types: string[]) => (e: SyncEvent) => types.includes(e.type);

export const useStatus = (ep: Endpoint | null, ready: boolean) =>
  useLoadable(ep, ready, getStatus, NEVER);

export const useConnections = (ep: Endpoint | null, ready: boolean) =>
  useLoadable(ep, ready, getConnections, ON("DeviceConnected", "DeviceDisconnected"));

export const useConfig = (ep: Endpoint | null, ready: boolean) =>
  useLoadable(ep, ready, getConfig, ON("ConfigSaved"));

export const usePendingFolders = (ep: Endpoint | null, ready: boolean) =>
  useLoadable(ep, ready, getPendingFolders, ON("PendingFoldersChanged"));

export const usePendingDevices = (ep: Endpoint | null, ready: boolean) =>
  useLoadable(ep, ready, getPendingDevices, ON("PendingDevicesChanged"));

export const useFolderStatus = (
  ep: Endpoint | null,
  ready: boolean,
  folderId: FolderID | null,
) =>
  useLoadable(
    ep,
    ready && !!folderId,
    (e) => getFolderStatus(e, folderId!),
    ON("StateChanged", "FolderSummary", "FolderErrors", "ItemFinished", "LocalIndexUpdated"),
    [folderId],
  );

// ── Transfer-Rate (bytes/sec + 1h history) ─────────────────────

export type TransferRateState = {
  inBps: number;
  outBps: number;
  historyIn: number[]; // 1-min buckets, last 60 (newest right)
  historyOut: number[];
};

/**
 * Pollt /rest/system/connections und berechnet Delta-Rates.
 * History: 1-Minuten-Buckets (gemittelt aus 1s-Samples), max 60 Einträge.
 */
export function useTransferRate(
  ep: Endpoint | null,
  ready: boolean,
  samplingMs = 1000,
): TransferRateState {
  const [state, setState] = useState<TransferRateState>({
    inBps: 0,
    outBps: 0,
    historyIn: [],
    historyOut: [],
  });

  // Mutable state outside React renders.
  const probeRef = useRef({
    lastIn: 0,
    lastOut: 0,
    lastT: 0,
    bucketMinute: 0,
    bucketInSum: 0,
    bucketOutSum: 0,
    bucketCount: 0,
    historyIn: [] as number[],
    historyOut: [] as number[],
  });

  useEffect(() => {
    if (!ep || !ready) return;
    let cancelled = false;
    probeRef.current = {
      lastIn: 0,
      lastOut: 0,
      lastT: 0,
      bucketMinute: 0,
      bucketInSum: 0,
      bucketOutSum: 0,
      bucketCount: 0,
      historyIn: [],
      historyOut: [],
    };

    const tick = async () => {
      try {
        const c = await getConnections(ep);
        if (cancelled) return;
        const now = Date.now();
        const inB = c.total?.inBytesTotal ?? 0;
        const outB = c.total?.outBytesTotal ?? 0;
        const p = probeRef.current;

        if (p.lastT > 0) {
          const dtSec = Math.max(0.001, (now - p.lastT) / 1000);
          const inBps = Math.max(0, (inB - p.lastIn) / dtSec);
          const outBps = Math.max(0, (outB - p.lastOut) / dtSec);

          const currentMinute = Math.floor(now / 60_000);
          if (p.bucketMinute === 0) p.bucketMinute = currentMinute;
          if (currentMinute > p.bucketMinute) {
            const inAvg = p.bucketCount > 0 ? p.bucketInSum / p.bucketCount : 0;
            const outAvg = p.bucketCount > 0 ? p.bucketOutSum / p.bucketCount : 0;
            p.historyIn.push(inAvg);
            p.historyOut.push(outAvg);
            if (p.historyIn.length > 60) p.historyIn.shift();
            if (p.historyOut.length > 60) p.historyOut.shift();
            p.bucketMinute = currentMinute;
            p.bucketInSum = 0;
            p.bucketOutSum = 0;
            p.bucketCount = 0;
          }
          p.bucketInSum += inBps;
          p.bucketOutSum += outBps;
          p.bucketCount += 1;

          setState({
            inBps,
            outBps,
            historyIn: [...p.historyIn],
            historyOut: [...p.historyOut],
          });
        }
        p.lastIn = inB;
        p.lastOut = outB;
        p.lastT = now;
      } catch {
        // network blip, ignore
      }
    };

    tick();
    const id = setInterval(tick, samplingMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [ep?.url, ep?.api_key, ready, samplingMs]);

  return state;
}

export type AggregateStatus = {
  state: "idle" | "syncing" | "error";
  needBytes: number;
  errorCount: number;
  /** Ordner, die als Ganzes im Fehler stehen (siehe FolderStatus.error). */
  folderErrors: { id: FolderID; label: string; message: string }[];
  lastUpdate: Date | null;
  localFiles: number;
  localBytes: number;
};

/** Pro-Ordner-Status-Map fürs Tag-Dashboard ("Alle Ordner"-View). Pollt alle
 * Folder alle 3s — aber nur solange das Dashboard gemountet ist (transienter
 * View). Gibt folderId → FolderStatus|null zurück, damit der Aufrufer pro Tag
 * aggregieren UND pro Ordner anzeigen kann. */
export function useFolderStatuses(
  ep: Endpoint | null,
  ready: boolean,
  folders: Folder[],
): Record<string, FolderStatus | null> {
  const [statuses, setStatuses] = useState<Record<string, FolderStatus | null>>({});
  const ids = folders.map((f) => f.id).join(",");
  useEffect(() => {
    if (!ep || !ready || folders.length === 0) {
      setStatuses({});
      return;
    }
    let cancelled = false;
    const refetch = async () => {
      const entries = await Promise.all(
        folders.map(
          async (f) =>
            [f.id, await getFolderStatus(ep, f.id).catch(() => null)] as const,
        ),
      );
      if (!cancelled) setStatuses(Object.fromEntries(entries));
    };
    void refetch();
    const id = setInterval(() => void refetch(), 3000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ep?.url, ep?.api_key, ready, ids]);
  return statuses;
}

export function useAggregateStatus(
  ep: Endpoint | null,
  ready: boolean,
  folders: Folder[],
): AggregateStatus {
  const [agg, setAgg] = useState<AggregateStatus>({
    state: "idle",
    needBytes: 0,
    errorCount: 0,
    folderErrors: [],
    lastUpdate: null,
    localFiles: 0,
    localBytes: 0,
  });
  const ids = folders.map((f) => f.id).join(",");

  useEffect(() => {
    if (!ep || !ready) {
      setAgg({
        state: "idle",
        needBytes: 0,
        errorCount: 0,
        folderErrors: [],
        lastUpdate: null,
        localFiles: 0,
        localBytes: 0,
      });
      return;
    }
    let cancelled = false;

    const refetch = async () => {
      if (folders.length === 0) {
        if (!cancelled)
          setAgg({
            state: "idle",
            needBytes: 0,
            errorCount: 0,
            folderErrors: [],
            lastUpdate: new Date(),
            localFiles: 0,
            localBytes: 0,
          });
        return;
      }
      const results = await Promise.all(
        folders.map((f) => getFolderStatus(ep, f.id).catch(() => null)),
      );
      if (cancelled) return;
      let errorCount = 0;
      let needBytes = 0;
      let localFiles = 0;
      let localBytes = 0;
      const folderErrors: AggregateStatus["folderErrors"] = [];
      results.forEach((s, i) => {
        const msg = folderError(s);
        if (msg) {
          const f = folders[i]!;
          folderErrors.push({ id: f.id, label: f.label || f.id, message: msg });
        }
      });
      for (const s of results) {
        if (!s) continue;
        errorCount += s.errors || 0;
        needBytes += s.needBytes || 0;
        localFiles += s.localFiles || 0;
        localBytes += s.localBytes || 0;
      }
      const state: AggregateStatus["state"] =
        errorCount > 0 || folderErrors.length > 0
          ? "error"
          : needBytes > 0
            ? "syncing"
            : "idle";
      setAgg({
        state,
        needBytes,
        errorCount,
        folderErrors,
        lastUpdate: new Date(),
        localFiles,
        localBytes,
      });
    };

    refetch();

    // Trailing-edge debounce: maxRate Refetch alle 1000ms — sonst löst Syncthing
    // bei Unreal-Scale-Sync (500k Files × ItemFinished/sec) eine HTTP-Request-
    // Flut von Promise.all-Refetches gegen sich selbst aus. Plus: ItemFinished
    // komplett ignorieren — wir verlassen uns auf FolderSummary (Syncthing
    // emittiert es ca. alle 2-3s während Sync läuft).
    let scheduledTimer: ReturnType<typeof setTimeout> | null = null;
    const REFETCH_THROTTLE_MS = 1000;
    const scheduleRefetch = (immediate = false) => {
      if (scheduledTimer) clearTimeout(scheduledTimer);
      scheduledTimer = setTimeout(
        () => {
          scheduledTimer = null;
          void refetch();
        },
        immediate ? 0 : REFETCH_THROTTLE_MS,
      );
    };

    const handler: EventHandler = (e) => {
      // ConfigSaved + FolderErrors → sofort refetch (config-relevant)
      // FolderSummary + StateChanged → debounced refetch
      // ItemFinished → IGNORE (kann tausendfach pro Sekunde feuern)
      if (e.type === "ConfigSaved" || e.type === "FolderErrors") {
        scheduleRefetch(true);
      } else if (e.type === "FolderSummary" || e.type === "StateChanged") {
        scheduleRefetch(false);
      }
    };
    bus.add(handler);
    // Sicherheitsnetz: Ein Ordner kann in den Fehler gehen, ohne dass eines der
    // Events oben feuert (z. B. Marke fehlt beim Start) — darum zusätzlich jede
    // Minute neu lesen.
    const safetyPoll = setInterval(() => scheduleRefetch(false), 60_000);

    return () => {
      cancelled = true;
      bus.remove(handler);
      clearInterval(safetyPoll);
      if (scheduledTimer) clearTimeout(scheduledTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ep?.url, ep?.api_key, ready, ids]);

  return agg;
}
