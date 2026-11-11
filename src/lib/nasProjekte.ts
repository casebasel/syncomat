import { invoke } from "@tauri-apps/api/core";
import {
  MAX_CONFLICTS,
  deleteFolder,
  baumAusBrowse,
  bytesDerAuswahl,
  getBrowse,
  getConfig,
  neuVerbinden,
  folderError,
  describeFolderError,
  getDbFile,
  getFolderErrors,
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
import { protokolliere } from "./activity";
import {
  NAME_RE,
  platzPruefung,
  aboDateisystemErlaubt,
  auswahlAusIgnores,
  composeAboIgnores,
  zeitToleranzMs,
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
/** Angebote, die syncomat selbst kurz „verbraucht“ hat (Ordnerbaum holen:
 * Syncthing streicht das Angebot, sobald hier ein Ordner derselben ID
 * angelegt wird, und zeigt es erst nach einem neuen Verbindungsaufbau
 * wieder). Solange gemerkt, bleibt das Projekt abonnierbar — ohne Schleife. */
const gemerkteAngebote = new Map<string, { p: NasProjekt; bis: number }>();
const MERKEN_MS = 30 * 60_000;

export function nasProjekte(pending: PendingFolder[], folders: Folder[]): NasProjekt[] {
  const vorhanden = new Set(folders.filter((f) => !istInhaltOrdner(f)).map((f) => f.id));
  const aus = new Map<string, NasProjekt>();
  for (const p of pending) {
    if (!isAboFolderId(p.folderID) || vorhanden.has(p.folderID)) continue;
    const anbieter = Object.keys(p.offeredBy) as DeviceID[];
    const label = Object.values(p.offeredBy)[0]?.label || p.folderID;
    aus.set(p.folderID, { folderId: p.folderID, name: label, anbieter });
  }
  const jetzt = Date.now();
  for (const [id, g] of gemerkteAngebote) {
    if (g.bis < jetzt) gemerkteAngebote.delete(id);
    else if (!aus.has(id) && !vorhanden.has(id)) aus.set(id, g.p);
  }
  return [...aus.values()].sort((a, b) => a.name.localeCompare(b.name, "de"));
}

export const gb = (n: number) =>
  n >= 1e12 ? `${(n / 1e12).toFixed(1)} TB` : n >= 1e9 ? `${(n / 1e9).toFixed(n >= 1e11 ? 0 : 1)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(0, Math.round(n / 1e3))} KB`;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Versionsschutz: zu alte Version → keine Abläufe, die Daten verändern. */
let veraltetFlag = false;
export function setzeVeraltet(v: boolean) {
  veraltetFlag = v;
}
function pruefeAktuell() {
  if (veraltetFlag) {
    throw new Error("Diese syncomat-Version ist zu alt — Projekte sind angehalten. Bitte zuerst aktualisieren.");
  }
}

/** Nie zwei Abläufe gleichzeitig für denselben Ordner (Inhaltsverzeichnis,
 * Abonnieren, Auswahl ändern, Abo beenden — vom Knopf oder als Wunsch). */
const sperren = new Map<string, Promise<unknown>>();
export async function mitSperre<T>(folderId: string, f: () => Promise<T>): Promise<T> {
  while (sperren.has(folderId)) await sperren.get(folderId)!.catch(() => {});
  const job = f();
  sperren.set(folderId, job);
  try {
    return await job;
  } finally {
    if (sperren.get(folderId) === job) sperren.delete(folderId);
  }
}
export const istGesperrt = (folderId: string) => sperren.has(folderId);

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
async function aboVorbereitenEinmal(
  ep: Endpoint,
  p: NasProjekt,
  myID: DeviceID,
  rolle: GeraeteRolle,
  onSchritt: (text: string) => void,
): Promise<AboVorbereitung> {
  if (!NAME_RE.test(p.name)) throw new Error(`Projektname „${p.name}“ ist als Ordnername ungültig.`);
  const wurzel = projekteWurzel();
  if (!wurzel) throw new Error("Erst einen Ordner für Projekte wählen (auf dem Mac statt Laufwerk D:).");
  const ziel = wurzel + p.name;
  let disk: { file_system: string; total_bytes: number };
  try {
    disk = await invoke("disk_info", { path: ziel });
  } catch {
    throw new Error(`Laufwerk für Projekte (${wurzel}) nicht gefunden — angeschlossen?`);
  }
  if (!aboDateisystemErlaubt(disk.file_system)) throw new Error(`${wurzel} ist ${disk.file_system || "unbekannt"} — nötig ist NTFS, APFS oder exFAT.`);
  const st = await invoke<string>("path_state", { path: ziel });
  if (st !== "fehlt" && st !== "leer") throw new Error(`${ziel} gibt es schon und ist nicht leer. Bitte umbenennen oder löschen.`);

  onSchritt("Inhaltsverzeichnis holen …");
  if ((await getConfig(ep)).folders.some((f) => f.id === p.folderId)) {
    throw new Error("Das Projekt ist hier schon eingerichtet.");
  }
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
    await aboAbbrechen(ep, p.folderId, ziel, p.anbieter);
    throw e instanceof Error ? e : new Error(String(e));
  }
}

/** Schritt 2: Platz für die Auswahl prüfen, dann laden. Leere Auswahl = ganz. */
async function aboStartenEinmal(
  ep: Endpoint,
  p: NasProjekt,
  v: AboVorbereitung,
  auswahl: string[],
  rolle: GeraeteRolle,
): Promise<string | null> {
  pruefeAuswahl(auswahl);
  auswahl = normalisiereAuswahl(auswahl);
  const bytes = bytesDerAuswahl(v.baum, auswahl, v.globalBytes);
  const frei = ((await invoke("disk_info", { path: v.ziel })) as { available_bytes: number }).available_bytes;
  const platz = platzPruefung(frei, v.totalBytes, bytes);
  if (!platz.passt) throw new Error(platz.text ?? "Zu wenig Platz.");
  await setFolderIgnores(ep, p.folderId, composeAboIgnores(auswahl, rolle));
  merkeAuswahl(p.folderId, auswahl);
  protokolliere(p.folderId, `Abonniert: ${auswahl.length === 0 ? "ganzes Projekt" : auswahl.join(", ")} — ${gb(bytes)} kommen vom NAS.`, "added");
  return platz.text;
}

/** Kennzeichen eines kurzlebigen Ordners, der nur das Inhaltsverzeichnis
 * holt (Übersicht, Statusdatei und Notizen zählen ihn nie als Abo). */
export const INHALT_LABEL = "syncomat-inhalt";
export const istInhaltOrdner = (f: Pick<Folder, "label">) => f.label === INHALT_LABEL;

/** Ordnerbaum eines Projekts, das dieser Rechner NICHT führt (z. B. um die
 * Auswahl für einen anderen Rechner zu bestimmen): kurz einen Ordner in den
 * App-Daten anlegen, der alles ignoriert, Inhaltsverzeichnis abwarten, Baum
 * lesen, Ordner wieder entfernen. Es werden keine Daten übertragen. */
/** Geholte Ordnerbäume (10 min) — nicht bei jedem Öffnen neu holen. */
const baumPuffer = new Map<string, { b: { baum: BaumKnoten[]; globalBytes: number }; at: number }>();
const BAUM_PUFFER_MS = 10 * 60_000;

export function inhaltHolen(
  ep: Endpoint,
  p: NasProjekt,
  myID: DeviceID,
): Promise<{ baum: BaumKnoten[]; globalBytes: number }> {
  const gepuffert = baumPuffer.get(p.folderId);
  if (gepuffert && Date.now() - gepuffert.at < BAUM_PUFFER_MS) return Promise.resolve(gepuffert.b);
  // Angebot merken, bevor Syncthing es beim Anlegen des Ordners streicht.
  gemerkteAngebote.set(p.folderId, { p, bis: Date.now() + MERKEN_MS });
  return mitSperre(p.folderId, () => inhaltHolenEinmal(ep, p, myID)).then((b) => {
    if (b.globalBytes > 0 || b.baum.length > 0) baumPuffer.set(p.folderId, { b, at: Date.now() });
    return b;
  });
}

async function inhaltHolenEinmal(
  ep: Endpoint,
  p: NasProjekt,
  myID: DeviceID,
): Promise<{ baum: BaumKnoten[]; globalBytes: number }> {
  const ziel = await invoke<string>("inhalt_ordner_pfad", { folderId: p.folderId });
  // Gibt es den Ordner hier inzwischen (abonniert), nie überschreiben.
  if ((await getConfig(ep)).folders.some((f) => f.id === p.folderId)) {
    throw new Error("Das Projekt ist hier eingerichtet — Ordnerbaum bitte neu öffnen.");
  }
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
      // Auf das Inhaltsverzeichnis warten (über ZeroTier, z. B. vom Mac, dauert
      // es länger) — ein leeres nur nach 60 s annehmen (leeres Projekt).
      if (st && verbunden.some((c) => c?.remoteState === "valid") && st.state === "idle" && (st.globalFiles > 0 || i >= 29)) {
        const roh = await getBrowse(ep, p.folderId, -1).catch(() => []);
        return { baum: baumAusBrowse(roh), globalBytes: st.globalBytes };
      }
    }
    throw new Error("Der NAS hat das Inhaltsverzeichnis nicht geschickt (nicht verbunden?).");
  } finally {
    // Nur den eigenen kurzlebigen Ordner entfernen — nie ein echtes Abo.
    const jetzt = (await getConfig(ep).catch(() => null))?.folders.find((f) => f.id === p.folderId);
    if (jetzt && jetzt.label === INHALT_LABEL && jetzt.path === ziel) {
      await deleteFolder(ep, p.folderId).catch(() => {});
      // Sonst bliebe das Angebot verschwunden, bis die Verbindung neu aufgebaut wird.
      await neuVerbinden(ep, p.anbieter);
    }
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
  entfernen_pfade: string[];
  abweichend: string[];
  abweichend_anzahl: number;
  streuner: string[];
  streuner_anzahl: number;
  streuner_alle: string[];
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

/** Index des globalen Stands: Pfad → [Grösse, Änderungszeit ms]. */
function indexAusBrowse(tree: unknown): Record<string, [number, number]> {
  const out: Record<string, [number, number]> = {};
  const lauf = (node: unknown, pre: string) => {
    if (!Array.isArray(node)) return;
    for (const e of node as Record<string, unknown>[]) {
      const p = pre ? `${pre}/${String(e.name)}` : String(e.name);
      if (String(e.type).includes("DIRECTORY")) lauf(e.children, p);
      else {
        const t = Date.parse(String(e.modTime));
        if (Number.isFinite(t)) out[p.normalize("NFC")] = [Number(e.size) || 0, t];
      }
    }
  };
  lauf(tree, "");
  return out;
}

/** Geräte ohne syncomat = das NAS (der Hub). Gesetzt von der App aus „Alle
 * Geräte“ (useUpdateAll.noChannel). Massgebend für „hat das NAS alles?“ —
 * introducedBy allein reicht nicht: auf dem Mac stand render als „selbst
 * eingetragen“, weil render das Projekt ebenfalls angeboten hatte. */
let nasGeraete = new Set<DeviceID>();
export function setzeNasGeraete(ids: Iterable<DeviceID>) {
  nasGeraete = new Set(ids);
}
/** Die NAS-Geräte eines Ordners; ohne Kenntnis: die nicht vorgestellten. */
function nasImOrdner(f: Folder, myID: DeviceID): DeviceID[] {
  const andere = f.devices.filter((d) => d.deviceID !== myID);
  const bekannt = andere.filter((d) => nasGeraete.has(d.deviceID));
  return (bekannt.length > 0 ? bekannt : andere.filter((d) => !d.introducedBy)).map((d) => d.deviceID);
}

/** Hat das NAS den Stand von hier vollständig? Pflicht sind die selbst
 * eingetragenen Gegenstellen (der NAS-Hub, der das Projekt angeboten hat);
 * Rechner, die der Hub nur vorgestellt hat (introducedBy), dürfen aus sein —
 * sind sie verbunden, müssen auch sie vollständig sein (Mac, 08.11.2026:
 * ein ausgeschalteter x5950 blockierte sonst jedes Löschen).
 * null = alles gut, sonst der Grund. */
export async function alleHabenAlles(ep: Endpoint, f: Folder, myID: DeviceID): Promise<string | null> {
  const andere = f.devices.filter((d) => d.deviceID !== myID);
  if (andere.length === 0) return "Der Ordner ist mit keinem anderen Gerät geteilt.";
  const pflicht = new Set(nasImOrdner(f, myID));
  if (pflicht.size === 0) return "Kein NAS im Ordner eingetragen.";
  for (const d of andere) {
    const c = await getRemoteCompletion(ep, f.id, d.deviceID).catch(() => null);
    const verbunden = !!c && c.remoteState === "valid";
    if (!verbunden) {
      if (pflicht.has(d.deviceID)) return `Das NAS (${d.deviceID.slice(0, 7)}) ist nicht verbunden.`;
      continue;
    }
    if (c!.completion < 100 || c!.needItems > 0 || c!.needDeletes > 0) {
      return `Gerät ${d.deviceID.slice(0, 7)} hat noch nicht alles von hier.`;
    }
  }
  return null;
}

/**
 * Auswahl eines bestehenden Abos ändern — so, dass nirgends etwas verloren
 * geht (live geprüft auf i9, 07.11.2026; Prüfung durch zweiten Agenten):
 *
 * 1. Alte Auswahl aus der .stignore lesen (nicht aus dem Browser-Speicher).
 * 2. Vergrössern: lokale Dateien im neuen Bereich gleichen sich ab, die neuere
 *    Fassung gewinnt (seit 11.11.2026, vorher abgelehnt).
 * 3. Platz für den Zuwachs prüfen.
 * Fällt etwas weg:
 * 4. Scannen, warten; hier fehlt nichts, keine Fehler; ALLE Gegenstellen
 *    verbunden und vollständig.
 * 5. Globalen Index lesen; JEDE zu löschende Datei muss ihm entsprechen
 *    (Grösse, Zeit) — sonst Abbruch, bevor sich etwas ändert.
 * 6. Neue Ignore-Liste setzen, scannen, prüfen; Gegenprobe je Datei bei
 *    Syncthing (ignoriert, gleiche Version wie global, auf einem anderen
 *    Gerät vorhanden).
 * 7. Löschen (Rust prüft jede Datei nochmals gegen den Index). Bei jedem
 *    Fehler in 6–7: alte Auswahl wieder setzen.
 */
export function aboAuswahlAendern(
  ep: Endpoint,
  f: Folder,
  auswahl: string[],
  rolle: GeraeteRolle,
  myID: DeviceID,
  onSchritt: (text: string) => void = () => {},
): Promise<string> {
  try {
    pruefeAktuell();
  } catch (e) {
    return Promise.reject(e);
  }
  return mitSperre(f.id, () => auswahlAendernEinmal(ep, f, auswahl, rolle, myID, onSchritt));
}

/** Gegenprobe je Datei vor jedem Löschen: jede Datei bis zu dieser Zahl, darüber verteilt. */
const LOESCHEN_PROBE_MAX = 5000;

async function auswahlAendernEinmal(
  ep: Endpoint,
  f: Folder,
  auswahl: string[],
  rolle: GeraeteRolle,
  myID: DeviceID,
  onSchritt: (text: string) => void,
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
  const fs = ((await invoke("disk_info", { path: f.path }).catch(() => null)) as { file_system?: string } | null)?.file_system ?? "";
  const toleranzMs = zeitToleranzMs(fs);
  const pruefe = (index: Record<string, [number, number]> | null) =>
    invoke<AuswahlPruefung>("auswahl_pruefen", { root: f.path, alt, neu, ...regeln, index, toleranzMs });

  onSchritt("Ordner prüfen …");
  const p0 = await pruefe(null);
  // Lokale Dateien im neu dazukommenden Bereich („Streuner“) blockieren nicht
  // mehr (bis v0.9.38 abgelehnt): wie bei Resilio gewinnt die neuere Fassung,
  // die ältere ist für den Ernstfall in den ZFS-Snapshots des NAS (Marlon
  // 11.11.2026). Auf dem NAS Gelöschtes, das hier noch liegt, kommt zurück.
  if (p0.streuner_anzahl > 0) onSchritt(`${p0.streuner_anzahl} lokale Datei(en) im neuen Bereich — die neuere Fassung gewinnt.`);

  const { baum, globalBytes } = await baumVonOrdner(ep, f.id);
  const s0 = await getFolderStatus(ep, f.id);
  const zuwachs = Math.max(0, bytesDerAuswahl(baum, neu, globalBytes) - Math.max(0, s0.localBytes - p0.entfernen_bytes));
  let platzHinweis: string | null = null;
  if (zuwachs > 0) {
    const d = (await invoke("disk_info", { path: f.path })) as { available_bytes: number; total_bytes: number };
    const platz = platzPruefung(d.available_bytes, d.total_bytes, zuwachs);
    if (!platz.passt) throw new Error(platz.text ?? "Zu wenig Platz.");
    platzHinweis = platz.text;
  }

  const entfernen = p0.entfernen_anzahl > 0;
  let index: Record<string, [number, number]> = {};
  let pfade: string[] = [];
  if (entfernen) {
    onSchritt("Warten, bis das NAS alles von hier hat …");
    await scanFolder(ep, f.id);
    let grund: string | null = "noch nicht geprüft";
    for (let i = 0; i < 30 && grund; i++) {
      const s = await warteBisRuhig(ep, f.id);
      // Syncthing meldet „keine Fehler“ als `errors: null` (live auf i9) —
      // nur eine gescheiterte Abfrage gilt als „nicht lesbar“.
      const antwort = await getFolderErrors(ep, f.id).catch(() => undefined);
      const fehler = antwort === undefined ? null : (antwort.errors ?? []);
      grund =
        s.needFiles !== 0 || s.needDeletes !== 0 || s.needBytes > 0 || s.error
          ? "Hier fehlen noch Dateien vom NAS."
          : s.errors > 0 || fehler === null || fehler.length > 0
            ? "Der Ordner meldet Fehler (oder sie lassen sich nicht lesen)."
            : await alleHabenAlles(ep, f, myID);
      if (grund) await sleep(2000);
    }
    if (grund) throw new Error(`${grund} Auswahl bleibt, wie sie war.`);
    index = indexAusBrowse(await getBrowse(ep, f.id, -1));
    const p1 = await pruefe(index);
    if (p1.abweichend_anzahl > 0) {
      throw new Error(
        `${p1.abweichend_anzahl} Datei(en) in den abgewählten Ordnern sind nicht im Stand, den das NAS hat (neu, verschoben, geändert oder gesperrt), z. B. ${p1.abweichend[0]}. Auswahl bleibt, wie sie war.`,
      );
    }
    pfade = p1.entfernen_pfade;
  }

  onSchritt("Neue Auswahl setzen …");
  const zurueck = async (): Promise<string> => {
    try {
      await setFolderIgnores(ep, f.id, altLines);
      await scanFolder(ep, f.id);
      return "Alte Auswahl wieder gesetzt.";
    } catch (e) {
      return `ACHTUNG: Alte Auswahl liess sich nicht wieder setzen (${e instanceof Error ? e.message : String(e)}) — bitte melden.`;
    }
  };
  await setFolderIgnores(ep, f.id, neuLines);
  try {
    await scanFolder(ep, f.id);
    await warteBisRuhig(ep, f.id);
    const jetzt = (await getFolderIgnores(ep, f.id)).ignore ?? [];
    if (!gleich(jetzt, neuLines)) throw new Error("Syncthing hat die neue Auswahl nicht übernommen.");
  } catch (e) {
    throw new Error(`${e instanceof Error ? e.message : String(e)} ${await zurueck()}`);
  }

  let text = neu.length === 0 ? "Alles." : `${neu.length} Ordner gewählt.`;
  if (entfernen) {
    onSchritt("Abgewählte Ordner hier entfernen …");
    try {
      // Gegenprobe je Datei (bis LOESCHEN_PROBE_MAX, sonst gleichmässig verteilt):
      // für Syncthing ignoriert, gleiche Version wie global, auf dem NAS vorhanden.
      const nasIds = new Set(nasImOrdner(f, myID));
      const schritt = Math.max(1, Math.ceil(pfade.length / LOESCHEN_PROBE_MAX));
      for (let i = 0; i < pfade.length; i += schritt) {
        const rel = pfade[i];
        const fi = await getDbFile(ep, f.id, rel);
        const l = fi.local;
        const g = fi.global;
        const v = (x: { version?: string[] } | null | undefined) => JSON.stringify(x?.version ?? null);
        if (!l || !(l.ignored || ((l.localFlags ?? 0) & 2) !== 0)) {
          throw new Error(`Syncthing führt ${rel} noch nicht als ignoriert — nichts gelöscht.`);
        }
        if (!g || g.deleted || v(l) !== v(g) || !(fi.availability ?? []).some((a) => nasIds.has(a.id))) {
          throw new Error(`${rel} ist auf keinem anderen Gerät im selben Stand — nichts gelöscht.`);
        }
      }
      const r = await invoke<AuswahlEntfernt>("auswahl_entfernen", { root: f.path, alt, neu, ...regeln, index, toleranzMs });
      text += ` Hier entfernt: ${r.geloescht} Datei(en), ${gb(r.bytes)} — auf dem NAS bleibt alles.`;
      if (r.fehler.length > 0) {
        text += ` ${r.fehler.length} Datei(en) liessen sich nicht löschen (geöffnet?), z. B. ${r.fehler[0]}. Bitte von Hand löschen, bevor dieser Bereich wieder gewählt wird.`;
      }
    } catch (e) {
      throw new Error(`${e instanceof Error ? e.message : String(e)} ${await zurueck()}`);
    }
  }
  merkeAuswahl(f.id, neu);
  protokolliere(f.id, `Auswahl geändert: ${neu.length === 0 ? "ganzes Projekt" : neu.join(", ")}. ${text}`, entfernen ? "deleted" : "modified");
  return platzHinweis ? `${text} ${platzHinweis}` : text;
}

/** Vorbereitung verwerfen: Ordner aus dem Abgleich, leeres Ziel wieder weg. */
export async function aboAbbrechen(ep: Endpoint, folderId: string, ziel: string, anbieter: DeviceID[] = []): Promise<void> {
  await deleteFolder(ep, folderId).catch(() => {});
  await invoke("remove_unused_abo_dir", { path: ziel }).catch(() => {});
  // Angebot wieder sichtbar machen (siehe neuVerbinden).
  if (anbieter.length > 0) await neuVerbinden(ep, anbieter);
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
    await aboAbbrechen(ep, p.folderId, v.ziel, p.anbieter);
    throw e;
  }
}

/** Freier Platz auf D: (für Kopfzeile und Spaltenkopf). null = kein D:. */
export async function freiAufD(): Promise<{ frei: number; total: number; fs: string } | null> {
  const w = projekteWurzel();
  if (!w) return null;
  try {
    const d = (await invoke("disk_info", { path: w })) as { available_bytes: number; total_bytes: number; file_system: string };
    return { frei: d.available_bytes, total: d.total_bytes, fs: d.file_system || "" };
  } catch {
    return null;
  }
}

/** Abo auf diesem Rechner beenden: nur, wenn alles von hier auf dem NAS ist.
 * Nimmt den Ordner aus dem Abgleich — die Dateien bleiben auf D: liegen
 * (Löschen wirkt danach nirgends mehr, auch nicht auf dem NAS). */
type OrdnerGeleert = { geloescht: number; bytes: number; behalten: string[]; behalten_anzahl: number; ordner_weg: boolean; fehler: string[] };

/**
 * Abo auf diesem Rechner beenden. Nur, wenn alle Gegenstellen den Stand von
 * hier vollständig haben. Mit `loeschen` (Marlon 08.11.2026): danach den
 * Ordner hier leeren — aber erst NACH dem Herausnehmen aus Syncthing (das
 * Löschen reist nirgends hin) und nur, was Datei für Datei dem Stand auf dem
 * NAS entspricht. Nie Abgeglichenes (Autosaves, hier Neues …) bleibt liegen
 * und wird gemeldet.
 */
async function aboBeendenEinmal(ep: Endpoint, f: Folder, myID: DeviceID, loeschen: boolean): Promise<string> {
  const s = await getFolderStatus(ep, f.id);
  // Kaputtes Abo (Ordner fehlt, Markierung fehlt …): Syncthing steht auf
  // „error“. Beenden ohne Löschen nimmt nur den Eintrag heraus und fasst keine
  // Dateien an — das muss gehen (Mac 08.11.2026: liess sich nie beenden).
  const ordnerFehler = folderError(s);
  if (ordnerFehler) {
    if (loeschen) {
      throw new Error(`Der Ordner hat einen Fehler (${describeFolderError(ordnerFehler).title}) — ohne „Ordner löschen“ beenden.`);
    }
    await deleteFolder(ep, f.id);
    const andereIds = f.devices.map((d) => d.deviceID).filter((d) => d !== myID);
    gemerkteAngebote.set(f.id, { p: { folderId: f.id, name: f.label || f.id, anbieter: andereIds }, bis: Date.now() + MERKEN_MS });
    await neuVerbinden(ep, andereIds);
    return `Abo beendet (der Ordner hatte einen Fehler: ${describeFolderError(ordnerFehler).title}). An ${f.path} wurde nichts verändert.`;
  }
  if (s.state !== "idle") throw new Error("Der Ordner arbeitet gerade. Bitte warten, bis er fertig ist.");
  const andere = f.devices.map((d) => d.deviceID).filter((d) => d !== myID);
  // Das NAS muss alles von hier haben (vorgestellte, ausgeschaltete Rechner
  // blockieren nicht); beim Löschen zusätzlich je Datei die Gegenprobe.
  const grund = await alleHabenAlles(ep, f, myID);
  if (grund) throw new Error(`${grund} Abo bleibt, bis der Abgleich fertig ist.`);

  const nasIds = new Set(nasImOrdner(f, myID));
  let index: Record<string, [number, number]> = {};
  let wegwerf: string[] = [];
  let toleranzMs = 1;
  if (loeschen) {
    index = indexAusBrowse(await getBrowse(ep, f.id, -1));
    wegwerf = schutzRegeln((await getFolderIgnores(ep, f.id)).ignore ?? []).wegwerf;
    const fs = ((await invoke("disk_info", { path: f.path }).catch(() => null)) as { file_system?: string } | null)?.file_system ?? "";
    toleranzMs = zeitToleranzMs(fs);
    // Gegenprobe je Datei: hier gleiche Version wie global und auf einem
    // anderen Gerät vorhanden — jede Datei bis LOESCHEN_PROBE_MAX, darüber
    // gleichmässig verteilt (Rust prüft zusätzlich jede Datei gegen den Index).
    const pfade = Object.keys(index).sort();
    const schritt = Math.max(1, Math.ceil(pfade.length / LOESCHEN_PROBE_MAX));
    for (let i = 0; i < pfade.length; i += schritt) {
      const fi = await getDbFile(ep, f.id, pfade[i]).catch(() => null);
      const l = fi?.local;
      if (!fi || !l || l.ignored || ((l.localFlags ?? 0) & 2) !== 0) continue; // hier nicht abgeglichen → wird ohnehin nicht gelöscht
      const v = (x: { version?: string[] } | null | undefined) => JSON.stringify(x?.version ?? null);
      if (!fi.global || v(l) !== v(fi.global) || !(fi.availability ?? []).some((a) => nasIds.has(a.id))) {
        throw new Error(`${pfade[i]} ist auf dem NAS nicht im selben Stand — Abo bleibt, nichts gelöscht.`);
      }
    }
  }

  // Vor dem Herausnehmen prüfen und vormerken — Syncthing entfernt dabei .stfolder.
  if (loeschen) await invoke("abo_ordner_vormerken", { root: f.path });
  await deleteFolder(ep, f.id);
  // Das Angebot des NAS erscheint sonst erst nach dem nächsten Verbindungsaufbau
  // wieder — bis dahin gemerkt, damit das Projekt gleich wieder abonnierbar ist.
  gemerkteAngebote.set(f.id, { p: { folderId: f.id, name: f.label || f.id, anbieter: andere }, bis: Date.now() + MERKEN_MS });
  await neuVerbinden(ep, andere);
  if (!loeschen) return `Abo beendet. Die Dateien liegen weiter in ${f.path}.`;

  const r = await invoke<OrdnerGeleert>("abo_ordner_leeren", { root: f.path, wegwerf, index, toleranzMs }).catch(
    (e: unknown) => {
      throw new Error(`Abo beendet, aber der Ordner liess sich nicht leeren: ${e instanceof Error ? e.message : String(e)}`);
    },
  );
  if (r.ordner_weg) return `Abo beendet und ${f.path} gelöscht (${gb(r.bytes)}) — alles liegt auf dem NAS.`;
  return (
    `Abo beendet. Gelöscht: ${r.geloescht} Datei(en), ${gb(r.bytes)}. ` +
    `${r.behalten_anzahl} Datei(en) waren nie auf dem NAS und liegen weiter in ${f.path}, z. B. ${r.behalten[0] ?? r.fehler[0] ?? "?"}.`
  );
}

export function aboVorbereiten(ep: Endpoint, p: NasProjekt, myID: DeviceID, rolle: GeraeteRolle, onSchritt: (text: string) => void): Promise<AboVorbereitung> {
  try {
    pruefeAktuell();
  } catch (e) {
    return Promise.reject(e);
  }
  return mitSperre(p.folderId, () => aboVorbereitenEinmal(ep, p, myID, rolle, onSchritt));
}

export function aboStarten(ep: Endpoint, p: NasProjekt, v: AboVorbereitung, auswahl: string[], rolle: GeraeteRolle): Promise<string | null> {
  return mitSperre(p.folderId, () => aboStartenEinmal(ep, p, v, auswahl, rolle));
}

export function aboBeenden(ep: Endpoint, f: Folder, myID: DeviceID, loeschen = false): Promise<string> {
  // Beenden ohne Löschen nimmt nur den Eintrag heraus — das geht auch veraltet.
  if (loeschen) {
    try {
      pruefeAktuell();
    } catch (e) {
      return Promise.reject(e);
    }
  }
  return mitSperre(f.id, () => aboBeendenEinmal(ep, f, myID, loeschen)).then((t) => {
    protokolliere(f.id, t, loeschen ? "deleted" : "modified");
    return t;
  });
}
