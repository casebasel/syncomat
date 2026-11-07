import { invoke } from "@tauri-apps/api/core";
import {
  MAX_CONFLICTS,
  deleteFolder,
  baumAusBrowse,
  bytesDerAuswahl,
  getBrowse,
  getDbFile,
  getFolderIgnores,
  getFolderStatus,
  scanFolder,
  getRemoteCompletion,
  sumBrowseTopLevel,
  putFolder,
  setFolderIgnores,
  type BaumKnoten,
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
  auswahlAusIgnores,
  composeAboIgnores,
  schutzRegeln,
  normalisiereAuswahl,
  pruefeAuswahl,
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
  baum: BaumKnoten[]; // Ordnerbaum mit Grössen
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
  await inhaltLaeuft.get(p.folderId)?.catch(() => {});
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
    const roh = await getBrowse(ep, p.folderId, -1).catch(() => []);
    const oben = sumBrowseTopLevel(roh);
    const baum = baumAusBrowse(roh);
    const ordner = oben
      .filter((e) => e.ordner && !e.name.startsWith(".") && NAME_RE.test(e.name))
      .sort((a, b) => a.name.localeCompare(b.name, "de"));
    const dateienOben = oben.filter((e) => !e.ordner).reduce((a, e) => a + e.bytes, 0);
    return { ziel, totalBytes: disk.total_bytes, globalBytes, ordner, dateienOben, baum };
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
  pruefeAuswahl(auswahl);
  auswahl = normalisiereAuswahl(auswahl);
  const bytes = bytesDerAuswahl(v.baum, auswahl, v.globalBytes);
  const reserve = Math.max(RESERVE_MIN, v.totalBytes * RESERVE_ANTEIL);
  const frei = ((await invoke("disk_info", { path: v.ziel })) as { available_bytes: number }).available_bytes;
  if (frei < bytes + reserve) {
    throw new Error(`Zu wenig Platz auf D:. Nötig ${gb(bytes)}, frei ${gb(frei)} (Reserve ${gb(reserve)}).`);
  }
  await setFolderIgnores(ep, p.folderId, composeAboIgnores(auswahl, rolle));
  merkeAuswahl(p.folderId, auswahl);
}

/** Kennzeichen eines kurzlebigen Ordners, der nur das Inhaltsverzeichnis
 * holt (Übersicht, Statusdatei und Notizen zählen ihn nie als Abo). */
export const INHALT_LABEL = "syncomat-inhalt";
export const istInhaltOrdner = (f: Pick<Folder, "label">) => f.label === INHALT_LABEL;

/** Ordnerbaum eines Projekts, das dieser Rechner NICHT führt (z. B. um die
 * Auswahl für einen anderen Rechner zu bestimmen): kurz einen Ordner in den
 * App-Daten anlegen, der alles ignoriert, Inhaltsverzeichnis abwarten, Baum
 * lesen, Ordner wieder entfernen. Es werden keine Daten übertragen. */
const inhaltLaeuft = new Map<string, Promise<{ baum: BaumKnoten[]; globalBytes: number }>>();

export function inhaltHolen(
  ep: Endpoint,
  p: NasProjekt,
  myID: DeviceID,
): Promise<{ baum: BaumKnoten[]; globalBytes: number }> {
  // Nie zweimal gleichzeitig denselben Ordner anlegen (Feld zu und wieder auf).
  const laeuft = inhaltLaeuft.get(p.folderId);
  if (laeuft) return laeuft;
  const job = inhaltHolenEinmal(ep, p, myID).finally(() => inhaltLaeuft.delete(p.folderId));
  inhaltLaeuft.set(p.folderId, job);
  return job;
}

/** Läuft gerade eine Abfrage des Inhaltsverzeichnisses für diesen Ordner? */
export const inhaltWirdGeholt = (folderId: string) => inhaltLaeuft.has(folderId);

async function inhaltHolenEinmal(
  ep: Endpoint,
  p: NasProjekt,
  myID: DeviceID,
): Promise<{ baum: BaumKnoten[]; globalBytes: number }> {
  const ziel = await invoke<string>("inhalt_ordner_pfad", { folderId: p.folderId });
  await invoke("remove_unused_abo_dir", { path: ziel }).catch(() => {});
  await invoke("create_abo_dir", { path: ziel });
  const folder: Folder = {
    id: p.folderId,
    label: INHALT_LABEL,
    path: ziel,
    type: "receiveonly",
    paused: true,
    devices: [{ deviceID: myID }, ...p.anbieter.map((deviceID) => ({ deviceID }))],
    ignorePerms: true,
    fsWatcherEnabled: false,
    rescanIntervalS: 3600,
  };
  try {
    await putFolder(ep, folder);
    await setFolderIgnores(ep, p.folderId, ["// nur Inhaltsverzeichnis", "*"]);
    await putFolder(ep, { ...folder, paused: false });
    for (let i = 0; i < 60; i++) {
      await sleep(2000);
      const verbunden = await Promise.all(p.anbieter.map((d) => getRemoteCompletion(ep, p.folderId, d).catch(() => null)));
      const st = await getFolderStatus(ep, p.folderId).catch(() => null);
      if (st && verbunden.some((c) => c?.remoteState === "valid") && st.state === "idle" && (st.globalFiles > 0 || i >= 5)) {
        const roh = await getBrowse(ep, p.folderId, -1).catch(() => []);
        return { baum: baumAusBrowse(roh), globalBytes: st.globalBytes };
      }
    }
    throw new Error("Der NAS hat das Inhaltsverzeichnis nicht geschickt (nicht verbunden?).");
  } finally {
    await deleteFolder(ep, p.folderId).catch(() => {});
    await invoke("remove_unused_abo_dir", { path: ziel }).catch(() => {});
  }
}

/** Baum eines Ordners, den dieser Rechner schon führt. */
export async function baumVonOrdner(ep: Endpoint, folderId: string): Promise<{ baum: BaumKnoten[]; globalBytes: number }> {
  const [roh, s] = await Promise.all([getBrowse(ep, folderId, -1), getFolderStatus(ep, folderId)]);
  return { baum: baumAusBrowse(roh), globalBytes: s.globalBytes };
}

/** Ergebnis der Prüfung in Rust (src-tauri/src/auswahl.rs). */
type AuswahlPruefung = {
  entfernen_anzahl: number;
  entfernen_bytes: number;
  entfernen_beispiele: string[];
  neuere: string[];
  streuner: string[];
  streuner_anzahl: number;
};
type AuswahlEntfernt = { geloescht: number; bytes: number; fehler: string[] };

const gleich = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

async function warteBisRuhig(ep: Endpoint, id: string, maxS = 600) {
  for (let i = 0; i < maxS / 2; i++) {
    const s = await getFolderStatus(ep, id);
    if (s.state === "idle") return s;
    await sleep(2000);
  }
  throw new Error("Der Ordner wird nicht ruhig (Abgleich läuft noch). Später nochmals versuchen.");
}

/** Haben alle verbundenen Gegenstellen (NAS) den Stand von hier vollständig? */
async function nasHatAlles(ep: Endpoint, f: Folder, myID: DeviceID): Promise<boolean> {
  const andere = f.devices.map((d) => d.deviceID).filter((d) => d !== myID);
  const stand = await Promise.all(andere.map((d) => getRemoteCompletion(ep, f.id, d).catch(() => null)));
  const verbunden = stand.filter((c) => c?.remoteState === "valid");
  return (
    verbunden.length > 0 &&
    verbunden.every((c) => !!c && c.completion >= 100 && c.needItems === 0 && c.needDeletes === 0)
  );
}

/**
 * Auswahl eines bestehenden Abos ändern — so, dass nirgends etwas verloren
 * geht (live geprüft auf i9, 07.11.2026):
 *
 * 1. Alte Auswahl aus der .stignore lesen (nicht aus dem Browser-Speicher).
 * 2. Vergrössern nur, wo lokal nichts liegt. Liegen im neu dazukommenden
 *    Bereich schon Dateien, die nie abgeglichen wurden, könnten sie neuere
 *    Stände auf dem NAS überschreiben → ablehnen.
 * 3. Platz für den Zuwachs prüfen.
 * 4. Fällt etwas weg: scannen, warten, bis das NAS ALLES von hier hat.
 * 5. Neue Ignore-Liste setzen, scannen — die weggefallenen Pfade sind jetzt
 *    ignoriert; Gegenprobe bei Syncthing.
 * 6. Die weggefallenen Dateien HIER löschen (Rust; bricht ohne Löschen ab,
 *    wenn eine davon neuer ist als Schritt 4). Das Löschen reist nicht mit.
 *    Bei jedem Fehler in 5–6: alte Auswahl wieder setzen.
 *
 * Leere Auswahl = ganzes Projekt. Gibt einen Satz für die Anzeige zurück.
 */
export async function aboAuswahlAendern(
  ep: Endpoint,
  f: Folder,
  auswahl: string[],
  rolle: GeraeteRolle,
  myID: DeviceID,
  onSchritt: (text: string) => void = () => {},
): Promise<string> {
  pruefeAuswahl(auswahl);
  const neu = normalisiereAuswahl(auswahl);
  const altLines = (await getFolderIgnores(ep, f.id)).ignore ?? [];
  const alt = auswahlAusIgnores(altLines);
  if (alt === null) {
    throw new Error("Die Ignore-Liste dieses Ordners ist nicht von syncomat (oder noch in Vorbereitung). Auswahl hier nicht änderbar.");
  }
  const neuLines = composeAboIgnores(neu, rolle);
  if (gleich(altLines, neuLines)) return "Keine Änderung.";
  const regeln = schutzRegeln(altLines, neuLines);
  const pruefe = (seitMs: number | null) =>
    invoke<AuswahlPruefung>("auswahl_pruefen", { root: f.path, alt, neu, ...regeln, seitMs });

  onSchritt("Ordner prüfen …");
  const p0 = await pruefe(null);
  if (p0.streuner_anzahl > 0) {
    throw new Error(
      `Im neu gewählten Bereich liegen hier schon ${p0.streuner_anzahl} Datei(en), die nie abgeglichen wurden, z. B. ${p0.streuner[0]}. ` +
        "Erst verschieben oder löschen — sonst könnten sie neuere Stände auf dem NAS überschreiben.",
    );
  }

  const { baum, globalBytes } = await baumVonOrdner(ep, f.id);
  const s0 = await getFolderStatus(ep, f.id);
  const zuwachs = Math.max(0, bytesDerAuswahl(baum, neu, globalBytes) - Math.max(0, s0.localBytes - p0.entfernen_bytes));
  if (zuwachs > 0) {
    const d = (await invoke("disk_info", { path: f.path })) as { available_bytes: number; total_bytes: number };
    const reserve = Math.max(RESERVE_MIN, d.total_bytes * RESERVE_ANTEIL);
    if (d.available_bytes < zuwachs + reserve) {
      throw new Error(`Zu wenig Platz auf D:. Dazu kämen ${gb(zuwachs)}, frei ${gb(d.available_bytes)} (Reserve ${gb(reserve)}).`);
    }
  }

  const entfernen = p0.entfernen_anzahl > 0;
  // Zeitgrenze VOR dem Scan, mit 2 s Spielraum: alles, was danach entsteht
  // oder geändert wird, verhindert das Löschen.
  const seit = Date.now() - 2000;
  if (entfernen) {
    onSchritt("Warten, bis das NAS alles von hier hat …");
    await scanFolder(ep, f.id);
    await warteBisRuhig(ep, f.id);
    let ok = false;
    for (let i = 0; i < 30 && !ok; i++) {
      ok = await nasHatAlles(ep, f, myID);
      if (!ok) await sleep(2000);
    }
    if (!ok) throw new Error("Das NAS hat noch nicht alles von hier (oder ist nicht verbunden). Auswahl bleibt, wie sie war.");
  }

  onSchritt("Neue Auswahl setzen …");
  const zurueck = async () => {
    await setFolderIgnores(ep, f.id, altLines).catch(() => {});
    await scanFolder(ep, f.id).catch(() => {});
  };
  await setFolderIgnores(ep, f.id, neuLines);
  try {
    await scanFolder(ep, f.id);
    await warteBisRuhig(ep, f.id);
    const jetzt = (await getFolderIgnores(ep, f.id)).ignore ?? [];
    if (!gleich(jetzt, neuLines)) throw new Error("Syncthing hat die neue Auswahl nicht übernommen.");
  } catch (e) {
    await zurueck();
    throw e;
  }

  let text = neu.length === 0 ? "Ganzes Projekt." : `${neu.length} Ordner gewählt.`;
  if (entfernen) {
    onSchritt("Abgewählte Ordner hier entfernen …");
    try {
      // Gegenprobe: die zu löschenden Dateien sind für Syncthing jetzt ignoriert.
      for (const rel of p0.entfernen_beispiele.slice(0, 3)) {
        const fi = await getDbFile(ep, f.id, rel);
        const l = fi.local;
        if (!l || !(l.ignored || ((l.localFlags ?? 0) & 2) !== 0)) {
          throw new Error(`Syncthing führt ${rel} noch nicht als ignoriert — nichts gelöscht.`);
        }
      }
      const r = await invoke<AuswahlEntfernt>("auswahl_entfernen", { root: f.path, alt, neu, ...regeln, seitMs: seit });
      text += ` Hier entfernt: ${r.geloescht} Datei(en), ${gb(r.bytes)} — auf dem NAS bleibt alles.`;
      if (r.fehler.length > 0) {
        text += ` ${r.fehler.length} Datei(en) liessen sich nicht löschen (geöffnet?), z. B. ${r.fehler[0]}. Bitte von Hand löschen, bevor dieser Bereich wieder gewählt wird.`;
      }
    } catch (e) {
      await zurueck();
      throw new Error(`${e instanceof Error ? e.message : String(e)} Alte Auswahl wieder gesetzt.`);
    }
  }
  merkeAuswahl(f.id, neu);
  return text;
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
