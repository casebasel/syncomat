import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import {
  MAX_CONFLICTS,
  getFolderStatus,
  getRemoteCompletion,
  putFolder,
  setFolderIgnores,
  type Config,
  type DeviceID,
  type Endpoint,
  type Folder,
} from "./syncthing";
import {
  isAboFolderId,
  type DzAuftrag,
  type DzBerichtWert,
  type DzSendeErgebnis,
} from "./datenzentrale";

// ── Abonnieren (Datenzentrale, Schritt 3, Release 2) ─────────────
//
// Die Datenzentrale legt je Rechner einen Auftrag `abonnieren` an (Seite des
// Speicher-Wächters, Marlons Klick). Syncomat prüft ihn, legt das Projekt
// nach D:\<NAME> und gleicht es mit tank/Projekte/<NAME> auf dem NAS ab —
// nur mit dem NAS geteilt, nie „an alle“. Konzept casebasel/datenzentrale,
// Kapitel 9 (Verteilung auf Abruf), E20, E28–E35.
//
// Sicherheitsregeln (Kapitel 11):
// - nur in ein leeres oder fehlendes Ziel
// - nur auf dem Laufwerk der Rolle „projekte“ (Windows D:), NTFS (exFAT mit
//   Hinweis, Marlon 07.11.2026; FAT32 nie), genug Platz
// - die Auswahl der Unterordner ist eine LOKALE Ignore-Schicht, nie mit (?d)
// - jede Ablehnung mit Grund, nichts still

const ZUSTAND_LS = "syncomat.abo.zustand";
const BERICHTE_LS = "syncomat.abo.berichte";
const ROLLE_LS = "syncomat.geraet.rolle";
const POLL_MS = 30_000;
const LAEUFT_MIN_MS = 60_000; // Fortschritt höchstens einmal je Minute und Auftrag
/** Platz (Marlon 08.11.2026, „nicht bevormunden“): gesperrt wird nur, wenn
 * das Abo selbst nicht passt (plus Arbeitsraum für Syncthing). Bliebe danach
 * weniger als die Reserve frei — 10 % des Laufwerks, höchstens 100 GB —,
 * gibt es nur einen Hinweis. (Bis v0.9.32: Reserve mindestens 100 GiB und
 * gesperrt — ein Mac mit 41 GB frei konnte nie abonnieren.) */
export const RESERVE_MAX = 100 * 1024 ** 3;
export const RESERVE_ANTEIL = 0.1;
export const ARBEITSRAUM = 2 * 1024 ** 3;

/** Ort der Projekte in Texten: „D:“ (Windows) bzw. „im Projektordner“ (Mac). */
export const projekteOrt = () => (istWindows() ? "auf D:" : "im Projektordner");

export function platzPruefung(
  frei: number,
  total: number,
  bytes: number,
): { passt: boolean; text: string | null } {
  const fmt = (n: number) => (n >= 1e12 ? `${(n / 1e12).toFixed(1)} TB` : n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.max(0, n / 1e6).toFixed(1)} MB`);
  if (frei < bytes + ARBEITSRAUM) {
    return { passt: false, text: `Zu wenig Platz ${projekteOrt()}: nötig ${fmt(bytes)} (+ ${fmt(ARBEITSRAUM)} Arbeitsraum), frei ${fmt(frei)}.` };
  }
  const reserve = Math.min(RESERVE_MAX, total * RESERVE_ANTEIL);
  if (frei - bytes < reserve) {
    return { passt: true, text: `Hinweis: danach bleiben nur ${fmt(frei - bytes)} frei ${projekteOrt()}.` };
  }
  return { passt: true, text: null };
}

export type GeraeteRolle = "arbeitsplatz" | "render";
export type AboZustand = "angenommen" | "laeuft" | "fertig" | "abgelehnt" | "abgebrochen";

export type AboEintrag = {
  zustand: AboZustand;
  grund: string;
  zeit: string;
  folderId?: string;
  /** Zeitpunkt des letzten „laeuft“-Berichts (ms), für die 1-min-Grenze. */
  laeuftGemeldet?: number;
};

export type Bericht = {
  id: string;
  auftrag_id: string;
  rechner: string;
  zustand: AboZustand;
  grund: string;
  stand: Record<string, unknown>;
  zeit: string;
  /** true = gespeichert (uebernommen/wiederholt) oder endgültig abgelehnt. */
  gesendet: boolean;
  /** Grund, wenn der Server den Bericht endgültig abgelehnt hat. */
  abgelehnt?: string;
  /** Grund des letzten Fehlversuchs (Netz, 401 …) — wird später erneut gesendet. */
  letzterFehler?: string;
};

// ── Ignore-Schichten ─────────────────────────────────────────────

/** Gemeinsame Basis eines Abo-Ordners (gleich wie die .stignore des NAS, ohne
 * die NAS-eigene Reihenfolge-Ausnahme). (?d) nur auf OS-Resten und Caches. */
export const ABO_BASIS: string[] = [
  "// syncomat-Abo — von syncomat erzeugt, nicht von Hand ändern",
  ".waechter",
  "(?d)(?i).DS_Store",
  "(?d)(?i)Thumbs.db",
  "(?d)(?i)desktop.ini",
  "(?d)._*",
  "(?d)*.tmp",
  "(?d)*.temp",
  "(?d)*.swp",
  "(?d)*~",
  "(?d)DerivedDataCache",
  "(?d)Intermediate",
  "(?d)*.pdb",
  "(?d).vs",
  // E35: Autosaves nicht abgleichen (ohne (?d): nie von fern löschen)
  "**/Saved/Autosaves",
  "**/Saved/Logs",
  "**/Saved/Crashes",
];

/** Ausnahmen je Rolle (Bauliste Schritt 3, Punkt 3; E33). */
export const ROLLEN_SCHICHT: Record<GeraeteRolle, string[]> = {
  arbeitsplatz: ["**/Saved/Config", "**/Saved/Concert"],
  // Render-Rechner: ganz Saved/ (MovieRenders entstehen am Arbeitsplatz)
  render: ["Saved"],
};

/** Dateisysteme für Abos: NTFS/APFS; exFAT erlaubt (Marlon 07.11.2026, mit
 * einmaligem Hinweis — kein Journal). FAT32 nie (4-GB-Grenze, 2-s-Zeiten). */
export function aboDateisystemErlaubt(fs: string | null | undefined): boolean {
  return /^(ntfs|apfs|exfat|hfs\+?)$/i.test(fs ?? "");
}
export const istExfat = (fs: string | null | undefined) => /^exfat$/i.test(fs ?? "");
/** Hinweis für exFAT (einmal zeigen, nie sperren). */
export const EXFAT_HINWEIS =
  "D: ist exFAT, ohne Journal — bei Stromausfall oder Absturz während des Schreibens können Dateien beschädigt werden. Das NAS behält Snapshots.";
/** Toleranz beim Vergleich der Änderungszeit mit dem Index (ms): NTFS speichert
 * 100 ns genau, exFAT nur 10 ms. */
export const zeitToleranzMs = (fs: string | null | undefined) => (istExfat(fs) ? 20 : 1);

export const NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** Vollständige .stignore eines Abo-Ordners: Basis → Rolle → Auswahl.
 * Syncthing nimmt das ERSTE passende Muster, darum stehen die Ausschlüsse der
 * Basis vor den Negationen der Auswahl (Intermediate bleibt auch in einem
 * gewählten Unterordner ignoriert). Auswahl nie mit (?d). */
export function composeAboIgnores(auswahl: string[], rolle: GeraeteRolle): string[] {
  return [...ABO_BASIS, `// Rolle: ${rolle}`, ...ROLLEN_SCHICHT[rolle], ...auswahlSchicht(auswahl)];
}

/** Ein Auswahl-Pfad: relativ zum Projekt, Teile mit „/“ getrennt, jeder Teil
 * ein gültiger Name (kein „..“, kein „\“, nichts Verstecktes). */
export const AUSWAHL_PFAD_RE = /^[\p{L}\p{N}_\- .()+&,']{1,128}(\/[\p{L}\p{N}_\- .()+&,']{1,128}){0,15}$/u;
export function istAuswahlPfad(roh: string): boolean {
  const p = roh.normalize("NFC");
  return AUSWAHL_PFAD_RE.test(p) && !p.split("/").some((t) => t === "." || t === ".." || t.startsWith(".") || t.trim() !== t);
}

/** Schrägstriche aussen weg, Unicode zusammengesetzt (NFC) — so führt
 * Syncthing alle Namen in seinem Index, auch wenn sie auf dem NAS zerlegt
 * (NFD, z. B. vom Mac über SMB) liegen. Live geprüft auf i9, 07.11.2026. */
const sauberPfad = (p: string) => p.normalize("NFC").replace(/^\/+|\/+$/g, "");

/** Wirft, wenn ein Pfad der Auswahl ungültig ist — nie still weglassen:
 * eine dadurch LEERE Auswahl hiesse „ganzes Projekt“. */
export function pruefeAuswahl(auswahl: string[]): void {
  const schlecht = auswahl.map(sauberPfad).filter((p) => !istAuswahlPfad(p));
  if (schlecht.length > 0) {
    throw new Error(`Ordnername nicht wählbar: „${schlecht[0]}“ (Sonderzeichen wie * ? [ ] ! # oder führender Punkt).`);
  }
}

/** Auswahl bereinigen: doppelte und in einem gewählten Ordner liegende Pfade weg. */
export function normalisiereAuswahl(auswahl: string[]): string[] {
  const sauber = [...new Set(auswahl.map(sauberPfad))].filter(istAuswahlPfad).sort();
  return sauber.filter((p) => !sauber.some((q) => q !== p && p.startsWith(q + "/")));
}

/** Lokale Auswahl-Schicht für Syncthing (erstes passendes Muster gewinnt; jedes
 * Muster gilt auch für den Inhalt). Für „a/b/c“ entsteht:
 *   !/a/b/c    gewählt (mit Inhalt)
 *   /a/b/*     Geschwister in a/b aus
 *   !/a/b      a/b selbst durchlassen
 *   /a/*  !/a  /*
 * Ebenen von tief nach flach. Nie mit (?d): nicht Gewähltes wird nur nicht
 * abgeglichen, nie gelöscht. Leere Auswahl = ganzes Projekt. */
export const AUSWAHL_KOPF = "// Auswahl dieses Rechners (lokal, reist nicht mit)";

export function auswahlSchicht(auswahl: string[]): string[] {
  const sel = normalisiereAuswahl(auswahl);
  if (sel.length === 0) return [];
  const out = [AUSWAHL_KOPF, "!/.syncomat"];
  for (const p of sel) out.push(`!/${p}`);
  const ahnen = new Set<string>();
  for (const p of sel) {
    const t = p.split("/");
    for (let i = 1; i < t.length; i++) ahnen.add(t.slice(0, i).join("/"));
  }
  const nachTiefe = [...ahnen].sort((a, b) => b.split("/").length - a.split("/").length || a.localeCompare(b));
  for (const a of nachTiefe) out.push(`/${a}/*`, `!/${a}`);
  out.push("/*");
  return out;
}

/** Die Auswahl, die in einer .stignore WIRKLICH gilt — Quelle der Wahrheit
 * beim Ändern (nicht der gemerkte Wert im Browser-Speicher).
 * [] = ganzes Projekt; null = nicht von syncomat erzeugt, noch in Vorbereitung
 * („*“) oder von Hand geändert → dann wird nichts geändert. */
export function auswahlAusIgnores(lines: string[] | null | undefined): string[] | null {
  if (!lines || lines[0] !== ABO_BASIS[0] || lines.includes("*")) return null;
  const i = lines.indexOf(AUSWAHL_KOPF);
  const auswahlMuster = (l: string) => !l.startsWith("//") && (l.startsWith("!") || l.startsWith("/"));
  if (i < 0) return lines.some(auswahlMuster) ? null : [];
  const schicht = lines.slice(i);
  const gewaehlt = schicht
    .filter((l) => l.startsWith("!/") && l !== "!/.syncomat")
    .map((l) => l.slice(2))
    .filter((p) => !schicht.includes(`/${p}/*`));
  const sel = normalisiereAuswahl(gewaehlt);
  if (sel.length !== gewaehlt.length) return null;
  const nachgebaut = auswahlSchicht(sel);
  if (nachgebaut.length !== schicht.length || nachgebaut.some((l, k) => l !== schicht[k])) return null;
  if (lines.slice(0, i).some(auswahlMuster)) return null;
  return sel;
}

/** Muster vor der Auswahl-Schicht: mit (?d) = Wegwerf (Caches, OS-Reste),
 * ohne = geschützt (nur lokal, nie anfassen: Autosaves, .waechter, Rolle). */
export function schutzRegeln(...listen: string[][]): { schutz: string[]; wegwerf: string[] } {
  const schutz = new Set<string>();
  const wegwerf = new Set<string>();
  for (const lines of listen) {
    const ende = lines.indexOf(AUSWAHL_KOPF);
    for (const l of ende < 0 ? lines : lines.slice(0, ende)) {
      const t = l.trim();
      if (!t || t.startsWith("//") || t.startsWith("!") || t.startsWith("/") || t === "*") continue;
      (t.includes("(?d)") ? wegwerf : schutz).add(t);
    }
  }
  // Was irgendwo geschützt ist, ist nie Wegwerf.
  return { schutz: [...schutz], wegwerf: [...wegwerf].filter((w) => !schutz.has(w.replace(/\(\?d\)/g, ""))) };
}

// ── Prüfung des Auftrags ─────────────────────────────────────────

export type AboAngaben = {
  projekt_id: string;
  name: string;
  folder_id: string;
  auswahl: string[];
  rolle: string;
  bytes_erwartet: number;
  nas_geraet: DeviceID;
};

/** Angaben eines Auftrags lesen und prüfen; Fehler = Grund der Ablehnung. */
export function parseAngaben(a: DzAuftrag): AboAngaben | string {
  const g = (a.angaben ?? {}) as Record<string, unknown>;
  const name = typeof g.name === "string" ? g.name : "";
  if (!NAME_RE.test(name)) return `Ungültiger Projektname „${name}“.`;
  const folderId = typeof g.folder_id === "string" ? g.folder_id : "";
  if (!isAboFolderId(folderId) || !/^[a-z0-9][a-z0-9_-]{1,63}$/.test(folderId)) {
    return `Ungültige folder_id „${folderId}“ (erwartet dz-…).`;
  }
  const auswahlRaw = g.auswahl ?? [];
  if (!Array.isArray(auswahlRaw) || !auswahlRaw.every((x) => typeof x === "string" && istAuswahlPfad(x))) {
    return "Ungültige Auswahl (nur Namen von Unterordnern im Projekt, ohne / oder ..).";
  }
  const auswahl = normalisiereAuswahl(auswahlRaw as string[]);
  const rolle = typeof g.rolle === "string" ? g.rolle : "projekte";
  if (rolle !== "projekte") return `Unbekannte Laufwerksrolle „${rolle}“.`;
  const bytes = typeof g.bytes_erwartet === "number" && g.bytes_erwartet >= 0 ? g.bytes_erwartet : -1;
  if (bytes < 0) return "bytes_erwartet fehlt.";
  const nas = typeof g.nas_geraet === "string" ? g.nas_geraet : "";
  if (!/^[A-Z0-9]{7}(-[A-Z0-9]{7}){7}$/.test(nas)) return "nas_geraet fehlt oder ist keine Syncthing-Geräte-ID.";
  const projektId = typeof g.projekt_id === "string" ? g.projekt_id : "";
  return { projekt_id: projektId, name, folder_id: folderId, auswahl, rolle, bytes_erwartet: bytes, nas_geraet: nas };
}

/** Wurzel der Rolle „projekte“ auf diesem Rechner (E3: D:). */
const WURZEL_LS = "syncomat.projekte.wurzel";
export const istWindows = () => typeof navigator !== "undefined" && /Win/i.test(navigator.userAgent);

/** Wo die Arbeitskopien der Projekte liegen (Rolle „projekte“): unter Windows
 * immer `D:\`; auf dem Mac ein einmal gewählter Ordner (z. B. ~/Projekte oder
 * eine externe SSD), der dort die Rolle von D: übernimmt (Marlon 08.11.2026).
 * null = auf diesem Rechner (noch) keiner. Endet immer mit dem Trenner. */
export function projekteWurzel(): string | null {
  if (istWindows()) return "D:\\";
  try {
    const w = localStorage.getItem(WURZEL_LS);
    if (!w) return null;
    return w.endsWith("/") ? w : w + "/";
  } catch {
    return null;
  }
}

/** Projektordner auf dem Mac festlegen (null = zurücksetzen). Wirkt nur für
 * neue Abos — bestehende bleiben, wo sie sind. */
export function setzeProjekteWurzel(pfad: string | null): void {
  if (istWindows()) return;
  try {
    if (pfad) localStorage.setItem(WURZEL_LS, pfad.replace(/\/+$/, ""));
    else localStorage.removeItem(WURZEL_LS);
  } catch {
    /* ohne Speicher kein Projektordner — Abonnieren meldet das */
  }
  window.dispatchEvent(new Event("syncomat-wurzel"));
}

// ── Speicher ─────────────────────────────────────────────────────

function lsRead<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function lsWrite(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* ohne Speicher: nächster Lauf prüft den Auftrag erneut (idempotent) */
  }
}

export function useGeraeteRolle() {
  const [rolle, setRolleState] = useState<GeraeteRolle>(() => lsRead<GeraeteRolle>(ROLLE_LS, "arbeitsplatz"));
  const setRolle = (r: GeraeteRolle) => {
    setRolleState(r);
    lsWrite(ROLLE_LS, r);
  };
  return { rolle, setRolle };
}

const berichtId = () => "be-" + crypto.randomUUID().replace(/-/g, "");
const jetzt = () => {
  // ISO mit Zone (z. B. 2026-11-07T15:04:05+01:00)
  const d = new Date();
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const p = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, "0");
  const local = new Date(d.getTime() + off * 60_000).toISOString().slice(0, 19);
  return `${local}${sign}${p(off / 60)}:${p(off % 60)}`;
};

// ── Ausführen ────────────────────────────────────────────────────

export function useAboAusfuehrung({
  ep,
  ready,
  config,
  myID,
  rechner,
  auftraege,
  rolle,
  sendBerichte,
}: {
  ep: Endpoint | null;
  ready: boolean;
  config: Config | null;
  myID: DeviceID | null;
  rechner: string | null;
  auftraege: DzAuftrag[];
  rolle: GeraeteRolle;
  sendBerichte: (b: DzBerichtWert[]) => Promise<DzSendeErgebnis[] | null>;
}) {
  const [zustand, setZustand] = useState<Record<string, AboEintrag>>(() => lsRead(ZUSTAND_LS, {}));
  const [berichte, setBerichte] = useState<Bericht[]>(() => lsRead(BERICHTE_LS, []));
  const busyRef = useRef(false);
  const zustandRef = useRef(zustand);
  zustandRef.current = zustand;
  const configRef = useRef(config);
  configRef.current = config;

  const setEintrag = (auftrag: DzAuftrag, e: AboEintrag, stand: Record<string, unknown> = {}) => {
    const next = { ...zustandRef.current, [auftrag.id]: e };
    zustandRef.current = next;
    setZustand(next);
    lsWrite(ZUSTAND_LS, next);
    if (!rechner) return;
    const b: Bericht = {
      id: berichtId(),
      auftrag_id: auftrag.id,
      rechner,
      zustand: e.zustand,
      grund: e.grund.slice(0, 500),
      stand,
      zeit: e.zeit,
      gesendet: false,
    };
    setBerichte((prev) => {
      // Ungesendete nie wegwerfen; von den gesendeten nur die letzten behalten.
      const merged = [...prev, b];
      const gesendet = merged.filter((x) => x.gesendet);
      const drop = new Set(gesendet.slice(0, Math.max(0, gesendet.length - 100)).map((x) => x.id));
      const all = merged.filter((x) => !drop.has(x.id));
      lsWrite(BERICHTE_LS, all);
      return all;
    });
  };

  const ablehnen = (a: DzAuftrag, grund: string) =>
    setEintrag(a, { zustand: "abgelehnt", grund, zeit: jetzt() });

  /** Einen neuen Abo-Auftrag prüfen und ausführen. */
  const abonnieren = async (a: DzAuftrag) => {
    if (!ep || !myID || !rechner) return;
    const cfg = configRef.current;
    if (!cfg) return;
    if (a.rechner !== rechner) return ablehnen(a, `Auftrag für „${a.rechner}“, dieser Rechner ist „${rechner}“.`);
    const g = parseAngaben(a);
    if (typeof g === "string") return ablehnen(a, g);

    // Schon vorhanden (z. B. nach Neustart): nicht neu anlegen, nur weiterführen.
    const existing = cfg.folders.find((f) => f.id === g.folder_id);
    if (existing) {
      return setEintrag(a, { zustand: "laeuft", grund: "Ordner schon eingerichtet.", zeit: jetzt(), folderId: g.folder_id });
    }
    if (!cfg.devices.some((d) => d.deviceID === g.nas_geraet)) {
      return ablehnen(a, "Der NAS-Hub ist mit diesem Rechner nicht gekoppelt.");
    }
    const wurzel = projekteWurzel();
    if (!wurzel) return ablehnen(a, "Kein Ordner für Projekte auf diesem Rechner (Mac: in syncomat einmal wählen).");
    const ziel = wurzel + g.name;

    let disk: { file_system: string; total_bytes: number; available_bytes: number };
    try {
      disk = await invoke("disk_info", { path: ziel });
    } catch (e) {
      return ablehnen(a, `Laufwerk für Projekte nicht gefunden (${String(e)}).`);
    }
    if (!aboDateisystemErlaubt(disk.file_system)) {
      return ablehnen(a, `${wurzel} ist ${disk.file_system || "unbekannt"}, erwartet NTFS, APFS oder exFAT.`);
    }
    const platz = platzPruefung(disk.available_bytes, disk.total_bytes, g.bytes_erwartet);
    if (!platz.passt) return ablehnen(a, platz.text ?? "Zu wenig Platz.");
    const st = await invoke<string>("path_state", { path: ziel }).catch((e) => `fehler: ${String(e)}`);
    if (st !== "fehlt" && st !== "leer") {
      return ablehnen(a, `Ziel ${ziel} ist ${st} — abonniert wird nur in ein leeres Ziel.`);
    }

    setEintrag(a, { zustand: "angenommen", grund: "", zeit: jetzt(), folderId: g.folder_id });
    try {
      await invoke("create_abo_dir", { path: ziel });
      // Pausiert anlegen, erst die Ignore-Schichten setzen, dann starten —
      // so lädt Syncthing nie etwas, das die Auswahl ausschliesst.
      const folder: Folder = {
        id: g.folder_id,
        label: g.name,
        path: ziel,
        type: "sendreceive",
        paused: true,
        devices: [{ deviceID: myID }, { deviceID: g.nas_geraet }],
        maxConflicts: MAX_CONFLICTS,
        ignorePerms: true,
        fsWatcherEnabled: true,
        fsWatcherDelayS: 2,
        rescanIntervalS: 3600,
      };
      await putFolder(ep, folder);
      await setFolderIgnores(ep, g.folder_id, composeAboIgnores(g.auswahl, rolle));
      await putFolder(ep, { ...folder, paused: false });
      setEintrag(a, {
        zustand: "laeuft",
        grund: g.auswahl.length ? `Auswahl: ${g.auswahl.join(", ")}` : "ganzes Projekt",
        zeit: jetzt(),
        folderId: g.folder_id,
        laeuftGemeldet: Date.now(),
      });
    } catch (e) {
      setEintrag(a, { zustand: "abgebrochen", grund: `Einrichten fehlgeschlagen: ${String(e)}`, zeit: jetzt(), folderId: g.folder_id });
    }
  };

  /** Laufende Abos: Fortschritt melden (≤ 1/min), fertig bei vollständigem Stand. */
  const fortschritt = async (a: DzAuftrag, e: AboEintrag) => {
    if (!ep || !e.folderId) return;
    const g = parseAngaben(a);
    try {
      const s = await getFolderStatus(ep, e.folderId);
      const c = typeof g === "string" ? null : await getRemoteCompletion(ep, e.folderId, g.nas_geraet).catch(() => null);
      const stand = {
        needBytes: s.needBytes,
        needItems: (s as unknown as { needFiles?: number }).needFiles ?? null,
        bytes_lokal: s.localBytes,
        nas_completion: c?.completion ?? null,
        fehler: s.error || null,
      };
      const verbunden = c?.remoteState === "valid";
      if (verbunden && s.state === "idle" && s.needBytes === 0 && !s.error) {
        setEintrag(a, { zustand: "fertig", grund: "Arbeitskopie vollständig.", zeit: jetzt(), folderId: e.folderId }, stand);
      } else if (Date.now() - (e.laeuftGemeldet ?? 0) >= LAEUFT_MIN_MS) {
        setEintrag(
          a,
          { ...e, grund: s.error ? `Ordner-Fehler: ${s.error}` : e.grund, zeit: jetzt(), laeuftGemeldet: Date.now() },
          stand,
        );
      }
    } catch {
      /* Syncthing kurz nicht erreichbar — nächster Lauf */
    }
  };

  const key = auftraege.map((a) => `${a.id}:${a.zustand}`).join(",");
  useEffect(() => {
    if (!ep || !ready || !myID || !rechner) return;
    const run = async () => {
      if (busyRef.current) return;
      busyRef.current = true;
      try {
        for (const a of auftraege) {
          if (a.art !== "abonnieren") continue;
          const e = zustandRef.current[a.id];
          if (!e) {
            if (a.zustand === "freigegeben") await abonnieren(a);
          } else if (e.zustand === "laeuft") {
            await fortschritt(a, e);
          }
        }
      } finally {
        busyRef.current = false;
      }
    };
    void run();
    const id = setInterval(() => void run(), POLL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ep?.url, ep?.api_key, ready, myID, rechner, key, rolle]);

  // ── Berichte an dz_bericht senden (Vertrag: plate-assistant ABGLEICH.md) ──
  // Gespeichert → nie wieder; abgelehnt → endgültig, sichtbar; keine Antwort,
  // 5xx, 401/403 → später dieselbe Änderung erneut (gleiche id = „wiederholt“).
  const sendBusyRef = useRef(false);
  const berichteRef = useRef(berichte);
  berichteRef.current = berichte;
  const offenKey = berichte.filter((b) => !b.gesendet).map((b) => b.id).join(",");
  useEffect(() => {
    if (!rechner) return;
    const send = async () => {
      if (sendBusyRef.current) return;
      const offen = berichteRef.current.filter((b) => !b.gesendet).slice(0, 50);
      if (offen.length === 0) return;
      sendBusyRef.current = true;
      try {
        const res = await sendBerichte(
          offen.map(({ id, auftrag_id, rechner: r, zustand: z, grund, stand, zeit }) => ({
            id,
            auftrag_id,
            rechner: r,
            zustand: z,
            grund,
            stand,
            zeit,
          })),
        );
        if (!res) return;
        const byId = new Map(res.map((r) => [r.id, r]));
        setBerichte((prev) => {
          const all = prev.map((b) => {
            const r = byId.get(b.id);
            if (!r) return b;
            if (r.kind === "gespeichert") return { ...b, gesendet: true, letzterFehler: undefined };
            if (r.kind === "abgelehnt") return { ...b, gesendet: true, abgelehnt: r.grund };
            return { ...b, letzterFehler: r.grund };
          });
          lsWrite(BERICHTE_LS, all);
          return all;
        });
      } finally {
        sendBusyRef.current = false;
      }
    };
    void send();
    const id = setInterval(() => void send(), POLL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rechner, offenKey, sendBerichte]);

  return { zustand, berichte };
}
