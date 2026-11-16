import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef } from "react";
import { getConnections, getFolderStatus, getRemoteCompletion, folderError, type DeviceID, type Endpoint, type Folder } from "./syncthing";
import { isAboFolderId } from "./datenzentrale";
import { aboAuswahl } from "./nasProjekte";
import { ordnerName, projekteWurzel } from "./abo";

// ── Lokale Statusdatei ───────────────────────────────────────────
//
// Für die Stage (Gerätetafel: „syncomat schreibt gerade ins Projekt“) und den
// Speicher-Wächter (Arbeitskopie (Abo) erkennen). Konzept Datenzentrale,
// Kap. 9. Datei statt HTTP: kein offener Port.
//
// Ort: <app_local_data>/status.json (Windows %LOCALAPPDATA%\ch.ca-se.syncomat,
// macOS ~/Library/Application Support/ch.ca-se.syncomat). Geschrieben alle
// 5 s, sobald sich etwas ändert, sonst spätestens alle 10 s — wer liest:
// `geschrieben` älter als 30 s = syncomat läuft nicht, Stand unbekannt.

const TAKT_MS = 5_000;
const HERZSCHLAG_MS = 10_000;

export type StatusAbo = {
  folder_id: string;
  /** Bezeichnung (Syncthing-Label, kann Leerzeichen haben) — nie als Pfad nehmen. */
  name: string;
  /** Kurzname wie der Ordner auf dem NAS (aus der folder_id), z. B.
   * „INTERN_RESTAURANT_UND_AI_UNREAL“. Ab v0.9.42; null, wenn keiner ableitbar. */
  kurzname: string | null;
  path: string;
  /** idle | scanning | syncing | error | paused (Syncthing-Zustand) */
  zustand: string;
  needBytes: number;
  needItems: number;
  localBytes: number;
  fehler: string | null;
  /** Gewählte Unterordner (leer = ganzes Projekt). Ab v0.9.27. */
  auswahl: string[];
  /** Ab v0.9.47: Der NAS-Hub, mit dem dieses Abo geteilt ist, ist gerade
   * verbunden. Ohne Verbindung kann needBytes 0 veraltet sein. */
  nas_verbunden: boolean;
  /** Ab v0.9.47: Wann dieses Abo zuletzt nachweislich gleich mit dem NAS war
   * (ISO, UTC) — NAS verbunden, Ordner im Leerlauf ohne Fehler, hier nichts
   * offen (needBytes/needItems 0) und auf dem NAS nichts offen von hier.
   * null = seit der Installation nie bestätigt. Überlebt Neustarts. */
  stand_vom: string | null;
};

export type StatusDatei = {
  schema: 1;
  geschrieben: string; // ISO, UTC
  version: string | null;
  geraet_id: string | null;
  rechner: string | null;
  /** true, solange irgendein Abo gerade Dateien schreibt (lädt). */
  schreibt_gerade: boolean;
  /** Überordner der Arbeitskopien: Windows „D:\\Projekte\\“, Mac der gewählte
   * Ordner; null = keiner. Ab v0.9.34. Ältere Abos können ausserhalb liegen —
   * massgebend je Abo ist abos[].path. */
  projekte_ordner: string | null;
  /** Ab v0.9.47: irgendein NAS-Hub ist verbunden. */
  nas_verbunden: boolean;
  abos: StatusAbo[];
};

const STAND_LS = "syncomat.status.standVom";
function standLesen(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(STAND_LS) || "{}") as Record<string, string>;
  } catch {
    return {};
  }
}
function standSchreiben(m: Record<string, string>) {
  try {
    localStorage.setItem(STAND_LS, JSON.stringify(m));
  } catch {
    /* ohne Speicher: nur bis zum Neustart */
  }
}

export function useStatusDatei({
  ep,
  ready,
  folders,
  myID,
  version,
  rechner,
  hubIds,
}: {
  ep: Endpoint | null;
  ready: boolean;
  folders: Folder[];
  myID: DeviceID | null;
  version: string | null;
  rechner: string | null;
  /** Geräte ohne syncomat (der NAS-Hub). */
  hubIds: Set<DeviceID>;
}) {
  const hubRef = useRef(hubIds);
  hubRef.current = hubIds;
  const standRef = useRef<Record<string, string> | null>(null);
  const lastRef = useRef({ key: "", at: 0 });
  const abos = folders.filter((f) => isAboFolderId(f.id));
  const key = abos.map((f) => `${f.id}:${f.path}:${f.paused ? 1 : 0}:${f.devices.length}`).join(",");

  useEffect(() => {
    if (!ep || !ready) return;
    let cancelled = false;
    const run = async () => {
      const liste: StatusAbo[] = [];
      const conns = await getConnections(ep).catch(() => null);
      const verbunden = (id: DeviceID) => !!conns?.connections[id]?.connected;
      const hubs = [...hubRef.current];
      const stand = (standRef.current ??= standLesen());
      let standNeu = false;
      for (const f of abos) {
        const s = await getFolderStatus(ep, f.id).catch(() => null);
        const fHubs = hubs.filter((h) => f.devices.some((d) => d.deviceID === h));
        const nasVerbunden = fHubs.some(verbunden);
        if (nasVerbunden && !f.paused && s && s.state === "idle" && !folderError(s) && (s.needBytes ?? 0) === 0 && ((s as unknown as { needFiles?: number }).needFiles ?? 0) === 0) {
          // Auch auf dem NAS nichts offen von hier (alles hochgeladen).
          const c = await Promise.all(fHubs.filter(verbunden).map((h) => getRemoteCompletion(ep, f.id, h).catch(() => null)));
          if (c.length > 0 && c.every((x) => x && x.needItems === 0 && x.needDeletes === 0 && (x.remoteState ?? "valid") === "valid")) {
            stand[f.id] = new Date().toISOString();
            standNeu = true;
          }
        }
        liste.push({
          folder_id: f.id,
          name: f.label || f.id,
          kurzname: ordnerName(f.id, f.label || ""),
          path: f.path,
          zustand: f.paused ? "paused" : folderError(s) ? "error" : s?.state ?? "unknown",
          needBytes: s?.needBytes ?? 0,
          needItems: (s as unknown as { needFiles?: number } | null)?.needFiles ?? 0,
          localBytes: s?.localBytes ?? 0,
          fehler: folderError(s),
          auswahl: aboAuswahl(f.id),
          nas_verbunden: nasVerbunden,
          stand_vom: stand[f.id] ?? null,
        });
      }
      if (cancelled) return;
      if (standNeu) standSchreiben(stand);
      const nasVerbunden = hubs.some(verbunden);
      const inhalt = { version, geraet_id: myID, rechner, nas_verbunden: nasVerbunden, abos: liste };
      // stand_vom läuft im Takt mit — nur mit dem Herzschlag neu schreiben.
      const k = JSON.stringify({ ...inhalt, abos: liste.map((a) => ({ ...a, stand_vom: a.stand_vom ? 1 : 0 })) });
      const now = Date.now();
      if (k === lastRef.current.key && now - lastRef.current.at < HERZSCHLAG_MS) return;
      const datei: StatusDatei = {
        schema: 1,
        geschrieben: new Date(now).toISOString(),
        ...inhalt,
        schreibt_gerade: liste.some((a) => a.zustand === "syncing"),
        projekte_ordner: projekteWurzel(),
      };
      try {
        await invoke("status_datei_write", { content: JSON.stringify(datei, null, 2) });
        lastRef.current = { key: k, at: now };
      } catch (e) {
        console.warn("[status.json] schreiben fehlgeschlagen", e);
      }
    };
    void run();
    const id = setInterval(() => void run(), TAKT_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ep?.url, ep?.api_key, ready, key, myID, version, rechner]);
}
