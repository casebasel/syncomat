import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getConfig, INTERN_FOLDER_ID, putFolder, type Endpoint, type Folder, type FolderVersioning } from "./syncthing";

// ── Lokaler Papierkorb (30 Tage) ─────────────────────────────────
//
// Marlon/stage-system 11.11.2026: Die neuere Fassung gewinnt ohne Kopie im
// Projekt. Was dieser Rechner verliert (von fern überschrieben oder gelöscht,
// die unterlegene Fassung eines Konflikts), bleibt 30 Tage in einem
// versteckten Papierkorb neben den Projekten — nie im Projekt, nie abgeglichen
// (Ort siehe src-tauri/src/papierkorb.rs). Technik: Syncthings Papierkorb
// („trashcan“) mit Ablage ausserhalb des Ordners; neue Konfliktkopien schiebt
// lib/conflicts.ts in denselben Ordner.

export const PAPIERKORB_TAGE = 30;

const orte = new Map<string, string>();
/** Papierkorb-Pfad eines Ordners auf diesem Rechner (null = noch nicht eingerichtet). */
export const papierkorbVon = (folderId: string) => orte.get(folderId) ?? null;

function soll(ort: string): FolderVersioning {
  return {
    type: "trashcan",
    params: { cleanoutDays: String(PAPIERKORB_TAGE) },
    fsPath: ort,
    fsType: "basic",
    cleanupIntervalS: 3600,
  };
}

const gleich = (v: FolderVersioning | undefined, s: FolderVersioning) =>
  v?.type === s.type && v?.params?.cleanoutDays === s.params?.cleanoutDays && (v?.fsPath ?? "") === s.fsPath;

export function usePapierkorb(ep: Endpoint | null, ready: boolean, folders: Folder[]) {
  const aufgeraeumt = useRef(false);
  const key = folders.map((f) => `${f.id}:${f.path}:${f.versioning?.fsPath ?? ""}:${f.versioning?.type ?? ""}`).join(",");
  useEffect(() => {
    if (!ep || !ready) return;
    let cancelled = false;
    (async () => {
      for (const f of folders) {
        if (cancelled || f.id === INTERN_FOLDER_ID) continue;
        try {
          const ort = await invoke<string>("papierkorb_ordner", { folderPath: f.path, folderId: f.id });
          orte.set(f.id, ort);
          const s = soll(ort);
          if (gleich(f.versioning, s)) continue;
          const fresh = (await getConfig(ep)).folders.find((x) => x.id === f.id);
          if (fresh && !gleich(fresh.versioning, s)) await putFolder(ep, { ...fresh, versioning: s });
        } catch (e) {
          // z. B. Pfad gerade nicht da (Laufwerk ab) — beim nächsten Mal wieder.
          console.warn(`[papierkorb] ${f.id}`, e);
        }
      }
      if (!cancelled && !aufgeraeumt.current && orte.size > 0) {
        aufgeraeumt.current = true;
        await invoke("papierkorb_aufraeumen", { aktive: [...orte.values()], tage: PAPIERKORB_TAGE }).catch((e) =>
          console.warn("[papierkorb] aufräumen", e),
        );
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ep?.url, ready, key]);
}
