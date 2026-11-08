import { useEffect, useRef } from "react";
import { putFolder, type Endpoint, type Folder } from "./syncthing";
import { isAboFolderId } from "./datenzentrale";
import { istInhaltOrdner } from "./nasProjekte";

// ── Versionsschutz ───────────────────────────────────────────────
//
// Ist dieser Rechner zu alt (seine Schutzstufe niedriger als die neueste im
// Studio, siehe updateAll.ts SCHUTZSTUFE), hält er seine Projekt-Abos an, bis
// er aktualisiert ist — eine alte Version soll nichts anrichten können
// (Marlon 08.11.2026). Plugins laufen weiter, gelöscht wird nichts. Nach dem
// Update laufen genau die so angehaltenen Abos von selbst weiter (nie die,
// die jemand von Hand angehalten hat).

const LS = "syncomat.versionsschutz.angehalten";

function lesen(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(LS) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}
function schreiben(ids: string[]) {
  try {
    localStorage.setItem(LS, JSON.stringify(ids));
  } catch {
    /* ohne Speicher: nach dem Update von Hand fortsetzen */
  }
}

export function useVersionsSchutz({
  ep,
  ready,
  folders,
  veraltet,
}: {
  ep: Endpoint | null;
  ready: boolean;
  folders: Folder[];
  veraltet: boolean;
}) {
  const busyRef = useRef(false);
  const key = folders.map((f) => `${f.id}:${f.paused ? 1 : 0}`).join(",");
  useEffect(() => {
    if (!ep || !ready || busyRef.current) return;
    busyRef.current = true;
    (async () => {
      try {
        const abos = folders.filter((f) => isAboFolderId(f.id) && !istInhaltOrdner(f));
        let gemerkt = lesen();
        if (veraltet) {
          for (const f of abos.filter((x) => !x.paused)) {
            await putFolder(ep, { ...f, paused: true });
            gemerkt = [...new Set([...gemerkt, f.id])];
            schreiben(gemerkt);
          }
        } else if (gemerkt.length > 0) {
          for (const f of abos.filter((x) => x.paused && gemerkt.includes(x.id))) {
            await putFolder(ep, { ...f, paused: false });
          }
          schreiben([]);
        }
      } catch (e) {
        console.warn("[versionsschutz]", e);
      } finally {
        busyRef.current = false;
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ep?.url, ready, veraltet, key]);
}
