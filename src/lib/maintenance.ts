import { useEffect, useRef } from "react";
import {
  getConfig,
  getFolderIgnores,
  getOptions,
  MAX_CONFLICTS,
  patchOptions,
  putFolder,
  setFolderIgnores,
  type Endpoint,
  type Folder,
} from "./syncthing";
import { normalizeLocalIgnores } from "./folderSettings";
import { ABO_MIN_DISK_FREE } from "./abo";
import { isAboFolderId } from "./datenzentrale";

// ── Einmalige Sync-Wartung beim Start ─────────────────────────────
//
// Bringt bestehende Ordner/Optionen auf den Stand, den neue Ordner seit den
// Fixes automatisch bekommen. Alles idempotent und nur-bei-Diff, damit kein
// unnötiger Rescan entsteht; pro Ordner mit Marker in localStorage, damit es
// genau einmal läuft (bei Fehlschlag beim nächsten Start erneut).
//
// 1) Globale Optionen: `setLowPriority=false` — Syncthing drosselt sich sonst
//    selbst (nice / IDLE_PRIORITY) und hasht/zieht auf den Workstations
//    spürbar langsamer.
// 2) Pro Ordner:
//    a) `ignorePerms=true` — Rechte-Bits im Mac/Windows/NAS-Mix nicht syncen
//       (Rechte-Churn, "lokal geändert" auf receive-only-Ordnern).
//    b) `weakHashThresholdPct 0 → 101` — Rolling-Hash bringt bei komplett
//       neu geschriebenen Binärassets nichts, kostet nur CPU je Scan.
//    c) `maxConflicts` = MAX_CONFLICTS. v5 setzte 1 (Kopie behalten), v7 wieder
//       0: die neuere Fassung gewinnt ohne Kopie, wie Resilio (Marlon 11.11.2026).
//    d) (v4/v5) .stignore nachziehen (normalizeLocalIgnores): `!/.syncomat` vor
//       dem Hidden-Muster (sonst syncen Tags, Papierkorb, geteilte Ignore-Liste
//       und Netzwerk-Hinweise nicht), `.*` ohne `(?d)`, und `(?d)` auf
//       Preset-Zeilen nur noch für OS-Reste und echte Caches (v5); `.waechter`
//       (Eingang des Speicher-Wächters) ignorieren, ohne `(?d)` (v6).
//
// Die geteilte Ignore-Liste zieht der Abgleich nach (folderSettings.ts →
// useFolderSettingsReplication / mergeLocalInto, beide über normalizeIgnores).
//
// Marker-Version hochzählen, wenn ein neuer Schritt dazukommt — alle Schritte
// sind idempotent, ein erneuter Lauf schreibt nur, was wirklich fehlt.
const MARK_PREFIX = "syncomat.maintenance.v7:";
const STAGGER_MS = 1500; // Ordner nacheinander, nicht alle gleichzeitig neu starten

// localStorage kann werfen (gesperrt/voll) — dann läuft die Wartung beim
// nächsten Start erneut, statt hier abzubrechen.
const lsGet = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const lsSet = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* nächster Start versucht es erneut */
  }
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function useSyncMaintenance(
  ep: Endpoint | null,
  ready: boolean,
  folders: Folder[],
): void {
  const ranRef = useRef(false);
  const folderKey = folders
    .map((f) => f.id)
    .sort()
    .join(",");

  useEffect(() => {
    if (!ep || !ready || ranRef.current || folders.length === 0) return;
    ranRef.current = true;
    let cancelled = false;

    (async () => {
      try {
        const opts = await getOptions(ep);
        if (opts.setLowPriority !== false) {
          await patchOptions(ep, { setLowPriority: false });
          console.log("[maintenance] setLowPriority -> false");
        }
      } catch (e) {
        console.warn("[maintenance] options failed", e);
      }

      for (const f of folders) {
        if (cancelled) return;
        const mark = MARK_PREFIX + f.id;
        if (lsGet(mark)) continue;
        try {
          const cur = await getFolderIgnores(ep, f.id).catch(() => ({ ignore: null }));
          // ignore === null = API-Aussetzer → nichts schreiben (sonst Leerung).
          if (cur.ignore !== null) {
            const next = normalizeLocalIgnores(cur.ignore);
            if (next.join("\n") !== cur.ignore.join("\n")) {
              await setFolderIgnores(ep, f.id, next);
              console.log(`[maintenance] ${f.id}: .stignore nachgezogen ((?d), Hidden-Block)`);
            }
          }

          const fresh = (await getConfig(ep)).folders.find((x) => x.id === f.id);
          if (fresh) {
            const patch: Partial<Folder> = {};
            if (fresh.ignorePerms !== true) patch.ignorePerms = true;
            if (fresh.weakHashThresholdPct === 0) patch.weakHashThresholdPct = 101;
            if (fresh.maxConflicts !== MAX_CONFLICTS) patch.maxConflicts = MAX_CONFLICTS;
            if (Object.keys(patch).length > 0) {
              await putFolder(ep, { ...fresh, ...patch });
              console.log(`[maintenance] ${f.id}: folder`, patch);
            }
          }
          lsSet(mark, String(Date.now()));
        } catch (e) {
          console.warn(`[maintenance] ${f.id} failed`, e);
        }
        await sleep(STAGGER_MS);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ep?.url, ep?.api_key, ready, folderKey]);
}

/** `maxConflicts` auf ALLEN Ordnern (auch Abos, die useSyncMaintenance
 * auslässt) auf MAX_CONFLICTS halten — nur bei Abweichung, also kein Rescan
 * im Normalfall. Abos von vor dem 11.11.2026 hatten noch 1. */
export function useKonfliktEinstellung(ep: Endpoint | null, ready: boolean, folders: Folder[]): void {
  // Abo-Ordner zusätzlich: minDiskFree = feste Reserve (50 GB, Marlon 12.11.2026).
  const platzFalsch = (f: Folder) =>
    isAboFolderId(f.id) &&
    (f.minDiskFree?.value !== ABO_MIN_DISK_FREE.value || f.minDiskFree?.unit !== ABO_MIN_DISK_FREE.unit);
  const key = folders.map((f) => `${f.id}:${f.maxConflicts}:${f.minDiskFree?.value}${f.minDiskFree?.unit}`).join(",");
  useEffect(() => {
    if (!ep || !ready) return;
    const falsch = folders.filter(
      (f) => (f.maxConflicts !== undefined && f.maxConflicts !== MAX_CONFLICTS) || platzFalsch(f),
    );
    if (falsch.length === 0) return;
    (async () => {
      for (const f of falsch) {
        try {
          const fresh = (await getConfig(ep)).folders.find((x) => x.id === f.id);
          if (fresh && (fresh.maxConflicts !== MAX_CONFLICTS || platzFalsch(fresh))) {
            await putFolder(ep, {
              ...fresh,
              maxConflicts: MAX_CONFLICTS,
              ...(isAboFolderId(fresh.id) ? { minDiskFree: ABO_MIN_DISK_FREE } : {}),
            });
          }
        } catch (e) {
          console.warn(`[maintenance] ${f.id} maxConflicts`, e);
        }
        await sleep(STAGGER_MS);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ep?.url, ready, key]);
}
