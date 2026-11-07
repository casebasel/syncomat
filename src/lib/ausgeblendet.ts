import { useCallback, useState } from "react";

// Fertige Projekte in der Übersicht ausblenden — nur eine Ansicht-Einstellung
// dieses Rechners (Browser-Speicher), ändert an Abos und Daten nichts.
// Projekte mit Störung bleiben immer sichtbar.

const LS = "syncomat.uebersicht.ausgeblendet";

function lesen(): Set<string> {
  try {
    const v = JSON.parse(localStorage.getItem(LS) ?? "[]");
    return new Set(Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

export function useAusgeblendet() {
  const [ids, setIds] = useState<Set<string>>(lesen);
  const setzen = useCallback((folderId: string, aus: boolean) => {
    setIds((alt) => {
      const n = new Set(alt);
      if (aus) n.add(folderId);
      else n.delete(folderId);
      try {
        localStorage.setItem(LS, JSON.stringify([...n]));
      } catch {
        /* nur Bequemlichkeit */
      }
      return n;
    });
  }, []);
  return { ids, setzen };
}
