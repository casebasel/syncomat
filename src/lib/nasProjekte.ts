import { invoke } from "@tauri-apps/api/core";
import {
  MAX_CONFLICTS,
  deleteFolder,
  getBrowse,
  getFolderStatus,
  getRemoteCompletion,
  sumBrowseTopLevel,
  putFolder,
  setFolderIgnores,
  type DeviceID,
  type Endpoint,
  type Folder,
  type PendingFolder,
} from "./syncthing";
import { isAboFolderId } from "./datenzentrale";
import {
  NAME_RE,
  RESERVE_ANTEIL,
  RESERVE_MIN,
  composeAboIgnores,
  projekteWurzel,
  type GeraeteRolle,
} from "./abo";

// ── Projekte auf dem NAS: Abonnieren mit einem Klick (Marlon, 07.11.2026) ──
//
// Der NAS-Hub bietet jedes Projekt aus tank/Projekte allen syncomat-Rechnern
// an (Ordner `dz-…`). Ein Angebot überträgt nichts. Erst der Klick
// „Abonnieren“ in syncomat lädt das Projekt nach D:\<NAME> — an dem Rechner,
// an dem man sitzt. Kein Auftrag, keine Seite, kein Token nötig.
//
// Sicher, in zwei Stufen:
//   1. Ordner anlegen, ALLES ignoriert → nur das Inhaltsverzeichnis kommt.
//   2. Grösse laut NAS gegen den Platz auf D: prüfen; reicht es, die echten
//      Ignore-Schichten setzen → erst jetzt werden Daten geladen.
// Reicht der Platz nicht, wird der Ordner wieder entfernt (es kam nichts).

export type NasProjekt = { folderId: string; name: string; anbieter: DeviceID[] };

/** Angebote des NAS (und anderer Rechner) für Abo-Ordner, die hier noch nicht
 * eingerichtet sind — eine Zeile je Projekt. */
export function nasProjekte(pending: PendingFolder[], folders: Folder[]): NasProjekt[] {
  const vorhanden = new Set(folders.map((f) => f.id));
  return pending
    .filter((p) => isAboFolderId(p.folderID) && !vorhanden.has(p.folderID))
    .map((p) => {
      const anbieter = Object.keys(p.offeredBy) as DeviceID[];
      const label = Object.values(p.offeredBy)[0]?.label || p.folderID;
      return { folderId: p.folderID, name: label, anbieter };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "de"));
}

export const gb = (n: number) =>
  n >= 1e12 ? `${(n / 1e12).toFixed(1)} TB` : n >= 1e9 ? `${(n / 1e9).toFixed(n >= 1e11 ? 0 : 1)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(0, Math.round(n / 1e3))} KB`;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const AUSWAHL_LS = "syncomat.abo.auswahl";

/** Gemerkte Unterordner-Auswahl je Abo-Ordner (leer = ganzes Projekt). */
export function aboAuswahl(folderId: string): string[] {
  try {
    const m = JSON.parse(localStorage.getItem(AUSWAHL_LS) ?? "{}") as Record<string, string[]>;
    return m[folderId] ?? [];
  } catch {
    return [];
  }
}
function merkeAuswahl(folderId: string, auswahl: string[]) {
  try {
    const m = JSON.parse(localStorage.getItem(AUSWAHL_LS) ?? "{}") as Record<string, string[]>;
    m[folderId] = auswahl;
    localStorage.setItem(AUSWAHL_LS, JSON.stringify(m));
  } catch {
    /* ohne Speicher zeigt die Übersicht „ganz“ statt „Teil“ — der Abgleich selbst ist richtig */
  }
}

export type AboVorbereitung = {
  ziel: string;
  totalBytes: number; // Laufwerk D:
  globalBytes: number; // ganzes Projekt laut NAS
  ordner: { name: string; bytes: number }[]; // erste Ebene, nur Ordner
  dateienOben: number; // Bytes loser Dateien auf oberster Ebene
};

/** Schritt 1: prüfen, Ordner mit „alles ignoriert“ anlegen, Inhaltsverzeichnis
 * holen. Danach liegt nichts auf D: ausser .stfolder/.stignore. Wirft mit einem
 * Satz und räumt dann wieder weg. */
export async function aboVorbereiten(
  ep: Endpoint,
  p: NasProjekt,
  myID: DeviceID,
  rolle: GeraeteRolle,
  onSchritt: (text: string) => void,
): Promise<AboVorbereitung> {
  if (!NAME_RE.test(p.name)) throw new Error(`Projektname „${p.name}“ ist als Ordnername ungültig.`);
  const wurzel = projekteWurzel();
  if (!wurzel) throw new Error("Abonnieren geht nur auf den Windows-Rechnern (Laufwerk D:).");
  const ziel = wurzel + p.name;
  let disk: { file_system: string; total_bytes: number };
  try {
    disk = await invoke("disk_info", { path: ziel });
  } catch {
    throw new Error("Laufwerk D: nicht gefunden.");
  }
  if (!/^ntfs$/i.test(disk.file_system)) throw new Error(`D: ist ${disk.file_system || "unbekannt"} — nötig ist NTFS.`);
  const st = await invoke<string>("path_state", { path: ziel });
  if (st !== "fehlt" && st !== "leer") throw new Error(`${ziel} gibt es schon und ist nicht leer. Bitte umbenennen oder löschen.`);

  onSchritt("Inhaltsverzeichnis holen …");
  await invoke("create_abo_dir", { path: ziel });
  const folder: Folder = {
    id: p.folderId,
    label: p.name,
    path: ziel,
    type: "sendreceive",
    paused: true,
    devices: [{ deviceID: myID }, ...p.anbieter.map((deviceID) => ({ deviceID }))],
    maxConflicts: MAX_CONFLICTS,
    ignorePerms: true,
    fsWatcherEnabled: true,
    fsWatcherDelayS: 2,
    rescanIntervalS: 3600,
  };
  try {
    await putFolder(ep, folder);
    await setFolderIgnores(ep, p.folderId, [...composeAboIgnores([], rolle), "*"]);
    await putFolder(ep, { ...folder, paused: false });
    let globalBytes = -1;
    for (let i = 0; i < 60; i++) {
      await sleep(2000);
      const verbunden = await Promise.all(p.anbieter.map((d) => getRemoteCompletion(ep, p.folderId, d).catch(() => null)));
      const s = await getFolderStatus(ep, p.folderId).catch(() => null);
      if (s && verbunden.some((c) => c?.remoteState === "valid") && s.state === "idle") {
        globalBytes = s.globalBytes;
        break;
      }
    }
    if (globalBytes < 0) throw new Error("Der NAS hat das Inhaltsverzeichnis nicht geschickt (nicht verbunden?). Später nochmals versuchen.");
    const oben = sumBrowseTopLevel(await getBrowse(ep, p.folderId, -1).catch(() => []));
    const ordner = oben
      .filter((e) => e.ordner && !e.name.startsWith(".") && NAME_RE.test(e.name))
      .sort((a, b) => a.name.localeCompare(b.name, "de"));
    const dateienOben = oben.filter((e) => !e.ordner).reduce((a, e) => a + e.bytes, 0);
    return { ziel, totalBytes: disk.total_bytes, globalBytes, ordner, dateienOben };
  } catch (e) {
    await aboAbbrechen(ep, p.folderId, ziel);
    throw e instanceof Error ? e : new Error(String(e));
  }
}

/** Schritt 2: Platz für die Auswahl prüfen, dann laden. Leere Auswahl = ganz. */
export async function aboStarten(
  ep: Endpoint,
  p: NasProjekt,
  v: AboVorbereitung,
  auswahl: string[],
  rolle: GeraeteRolle,
): Promise<void> {
  const bytes = auswahl.length
    ? v.ordner.filter((o) => auswahl.includes(o.name)).reduce((a, o) => a + o.bytes, 0)
    : v.globalBytes;
  const reserve = Math.max(RESERVE_MIN, v.totalBytes * RESERVE_ANTEIL);
  const frei = ((await invoke("disk_info", { path: v.ziel })) as { available_bytes: number }).available_bytes;
  if (frei < bytes + reserve) {
    throw new Error(`Zu wenig Platz auf D:. Nötig ${gb(bytes)}, frei ${gb(frei)} (Reserve ${gb(reserve)}).`);
  }
  await setFolderIgnores(ep, p.folderId, composeAboIgnores(auswahl, rolle));
  merkeAuswahl(p.folderId, auswahl);
}

/** Vorbereitung verwerfen: Ordner aus dem Abgleich, leeres Ziel wieder weg. */
export async function aboAbbrechen(ep: Endpoint, folderId: string, ziel: string): Promise<void> {
  await deleteFolder(ep, folderId).catch(() => {});
  await invoke("remove_unused_abo_dir", { path: ziel }).catch(() => {});
}

/** Ein Projekt ganz abonnieren (beide Schritte ohne Auswahl). */
export async function abonnieren(
  ep: Endpoint,
  p: NasProjekt,
  myID: DeviceID,
  rolle: GeraeteRolle,
  onSchritt: (text: string) => void,
): Promise<void> {
  const v = await aboVorbereiten(ep, p, myID, rolle, onSchritt);
  try {
    await aboStarten(ep, p, v, [], rolle);
  } catch (e) {
    await aboAbbrechen(ep, p.folderId, v.ziel);
    throw e;
  }
}

/** Freier Platz auf D: (für Kopfzeile und Spaltenkopf). null = kein D:. */
export async function freiAufD(): Promise<{ frei: number; total: number } | null> {
  const w = projekteWurzel();
  if (!w) return null;
  try {
    const d = (await invoke("disk_info", { path: w })) as { available_bytes: number; total_bytes: number };
    return { frei: d.available_bytes, total: d.total_bytes };
  } catch {
    return null;
  }
}

/** Abo auf diesem Rechner beenden: nur, wenn alles von hier auf dem NAS ist.
 * Nimmt den Ordner aus dem Abgleich — die Dateien bleiben auf D: liegen
 * (Löschen wirkt danach nirgends mehr, auch nicht auf dem NAS). */
export async function aboBeenden(ep: Endpoint, f: Folder, myID: DeviceID): Promise<string> {
  const s = await getFolderStatus(ep, f.id);
  if (s.state !== "idle") throw new Error("Der Ordner arbeitet gerade. Bitte warten, bis er fertig ist.");
  const andere = f.devices.map((d) => d.deviceID).filter((d) => d !== myID);
  const stand = await Promise.all(andere.map((d) => getRemoteCompletion(ep, f.id, d).catch(() => null)));
  // Alle verbundenen Gegenstellen (NAS, ggf. weitere Abo-Rechner) müssen den
  // Stand von hier vollständig haben — und mindestens eine muss verbunden sein.
  const verbunden = stand.filter((c) => c?.remoteState === "valid");
  const vollstaendig = (c: (typeof stand)[number]) =>
    !!c && c.completion >= 100 && c.needItems === 0 && c.needDeletes === 0;
  if (verbunden.length === 0 || !verbunden.every(vollstaendig)) {
    throw new Error("Noch nicht alles von hier ist auf dem NAS. Abo bleibt, bis der Abgleich fertig ist.");
  }
  await deleteFolder(ep, f.id);
  return `Abo beendet. Die Dateien liegen weiter in ${f.path} — du kannst den Ordner löschen.`;
}
