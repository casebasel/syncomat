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
// - nur auf dem Laufwerk der Rolle „projekte“ (Windows D:), NTFS, genug Platz
// - die Auswahl der Unterordner ist eine LOKALE Ignore-Schicht, nie mit (?d)
// - jede Ablehnung mit Grund, nichts still

const ZUSTAND_LS = "syncomat.abo.zustand";
const BERICHTE_LS = "syncomat.abo.berichte";
const ROLLE_LS = "syncomat.geraet.rolle";
const POLL_MS = 30_000;
const LAEUFT_MIN_MS = 60_000; // Fortschritt höchstens einmal je Minute und Auftrag
/** Reserve auf dem Ziel-Laufwerk nach dem Abo: max(100 GB, 10 % der Grösse). */
const RESERVE_MIN = 100 * 1024 ** 3;
const RESERVE_ANTEIL = 0.1;

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

const NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** Vollständige .stignore eines Abo-Ordners: Basis → Rolle → Auswahl.
 * Syncthing nimmt das ERSTE passende Muster, darum stehen die Ausschlüsse der
 * Basis vor den Negationen der Auswahl (Intermediate bleibt auch in einem
 * gewählten Unterordner ignoriert). Auswahl nie mit (?d). */
export function composeAboIgnores(auswahl: string[], rolle: GeraeteRolle): string[] {
  const out = [...ABO_BASIS, `// Rolle: ${rolle}`, ...ROLLEN_SCHICHT[rolle]];
  if (auswahl.length > 0) {
    out.push("// Auswahl dieses Rechners (lokal, reist nicht mit)", "!/.syncomat");
    for (const a of auswahl) out.push(`!/${a}`);
    out.push("/*");
  }
  return out;
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
  if (!Array.isArray(auswahlRaw) || !auswahlRaw.every((x) => typeof x === "string" && NAME_RE.test(x))) {
    return "Ungültige Auswahl (nur Namen von Unterordnern im Projekt, ohne / oder ..).";
  }
  const auswahl = [...new Set(auswahlRaw as string[])];
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
export function projekteWurzel(): string | null {
  const win = typeof navigator !== "undefined" && /Win/i.test(navigator.userAgent);
  return win ? "D:\\" : null;
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
    if (!wurzel) return ablehnen(a, "Rolle „projekte“ ist auf diesem Rechner nicht eingerichtet (nur Windows: D:).");
    const ziel = wurzel + g.name;

    let disk: { file_system: string; total_bytes: number; available_bytes: number };
    try {
      disk = await invoke("disk_info", { path: ziel });
    } catch (e) {
      return ablehnen(a, `Laufwerk D: nicht gefunden (${String(e)}).`);
    }
    if (!/^(ntfs|apfs)$/i.test(disk.file_system)) {
      return ablehnen(a, `D: ist ${disk.file_system || "unbekannt"}, erwartet NTFS.`);
    }
    const reserve = Math.max(RESERVE_MIN, disk.total_bytes * RESERVE_ANTEIL);
    if (disk.available_bytes < g.bytes_erwartet + reserve) {
      const gb = (n: number) => `${(n / 1024 ** 3).toFixed(1)} GB`;
      return ablehnen(
        a,
        `Zu wenig Platz auf D: — frei ${gb(disk.available_bytes)}, nötig ${gb(g.bytes_erwartet)} + Reserve ${gb(reserve)}.`,
      );
    }
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
