import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef } from "react";
import { getFolderStatus, folderError, type DeviceID, type Endpoint, type Folder } from "./syncthing";
import { isAboFolderId } from "./datenzentrale";

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
  name: string;
  path: string;
  /** idle | scanning | syncing | error | paused (Syncthing-Zustand) */
  zustand: string;
  needBytes: number;
  needItems: number;
  localBytes: number;
  fehler: string | null;
};

export type StatusDatei = {
  schema: 1;
  geschrieben: string; // ISO, UTC
  version: string | null;
  geraet_id: string | null;
  rechner: string | null;
  /** true, solange irgendein Abo gerade Dateien schreibt (lädt). */
  schreibt_gerade: boolean;
  abos: StatusAbo[];
};

export function useStatusDatei({
  ep,
  ready,
  folders,
  myID,
  version,
  rechner,
}: {
  ep: Endpoint | null;
  ready: boolean;
  folders: Folder[];
  myID: DeviceID | null;
  version: string | null;
  rechner: string | null;
}) {
  const lastRef = useRef({ key: "", at: 0 });
  const abos = folders.filter((f) => isAboFolderId(f.id));
  const key = abos.map((f) => `${f.id}:${f.path}:${f.paused ? 1 : 0}`).join(",");

  useEffect(() => {
    if (!ep || !ready) return;
    let cancelled = false;
    const run = async () => {
      const liste: StatusAbo[] = [];
      for (const f of abos) {
        const s = await getFolderStatus(ep, f.id).catch(() => null);
        liste.push({
          folder_id: f.id,
          name: f.label || f.id,
          path: f.path,
          zustand: f.paused ? "paused" : folderError(s) ? "error" : s?.state ?? "unknown",
          needBytes: s?.needBytes ?? 0,
          needItems: (s as unknown as { needFiles?: number } | null)?.needFiles ?? 0,
          localBytes: s?.localBytes ?? 0,
          fehler: folderError(s),
        });
      }
      if (cancelled) return;
      const inhalt = { version, geraet_id: myID, rechner, abos: liste };
      const k = JSON.stringify(inhalt);
      const now = Date.now();
      if (k === lastRef.current.key && now - lastRef.current.at < HERZSCHLAG_MS) return;
      const datei: StatusDatei = {
        schema: 1,
        geschrieben: new Date(now).toISOString(),
        ...inhalt,
        schreibt_gerade: liste.some((a) => a.zustand === "syncing"),
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
