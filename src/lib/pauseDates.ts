import { useEffect, useState } from "react";
import type { Folder } from "./syncthing";

/**
 * Pause-Daten pro Folder. Wenn Marlon einen Folder pausiert, halten wir
 * lokal das Datum fest damit die Status-Pille "Pausiert seit 08.06." zeigen
 * kann. Syncthing speichert das selbst nicht.
 *
 * Storage: localStorage als JSON-Map folderId → unixMs.
 * Lokal-only (nicht synct) — pro Gerät separate Sicht.
 */
const LS_KEY = "syncomat.pauseDates";

type PauseMap = Record<string, number>;

function load(): PauseMap {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as PauseMap) : {};
  } catch {
    return {};
  }
}

function save(map: PauseMap) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(map));
  } catch {
    // ignore quota
  }
}

/**
 * Hook der Folders × paused-state mit pauseDates synct.
 * Reagiert auf folder.paused änderungen:
 *   - paused: false → true: speichert Date.now()
 *   - paused: true → false: löscht den Eintrag
 *   - paused: true und schon Eintrag da: behält den
 */
export function usePauseDates(folders: Folder[]): Record<string, number> {
  const [map, setMap] = useState<PauseMap>(load);

  useEffect(() => {
    let dirty = false;
    const next = { ...map };
    for (const f of folders) {
      if (f.paused && !next[f.id]) {
        next[f.id] = Date.now();
        dirty = true;
      } else if (!f.paused && next[f.id]) {
        delete next[f.id];
        dirty = true;
      }
    }
    // Folder die nicht mehr existieren auch räumen
    for (const id of Object.keys(next)) {
      if (!folders.some((f) => f.id === id)) {
        delete next[id];
        dirty = true;
      }
    }
    if (dirty) {
      save(next);
      setMap(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folders.map((f) => `${f.id}|${f.paused ? 1 : 0}`).join(",")]);

  return map;
}
