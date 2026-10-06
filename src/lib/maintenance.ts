import { useEffect, useRef } from "react";
import {
  getConfig,
  getFolderIgnores,
  getOptions,
  patchOptions,
  putFolder,
  setFolderIgnores,
  type Endpoint,
  type Folder,
} from "./syncthing";
import { SYNCOMAT_DIR_EXCEPTION } from "./folderSettings";

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
//    c) (v3) `maxConflicts=0` — Konflikte still lösen wie Resilio: die Datei
//       mit dem neueren Änderungsdatum gewinnt, die ältere wird verworfen
//       (keine `.sync-conflict-`-Kopien mehr).
//    d) (v4) `!/.syncomat` vor das Hidden-Muster `.*` setzen — sonst ignoriert
//       "versteckte Dateien ignorieren" auch `.syncomat/`, und Tags, Papierkorb,
//       geteilte Ignore-Liste und Netzwerk-Hinweise syncen nicht mehr.
//
// Die .stignore-Bereinigung ((?d), .sync, veraltete Preset-Zeilen) läuft seit
// v3 nicht mehr hier, sondern beim Abgleich der geteilten Ignore-Liste
// (folderSettings.ts → useFolderSettingsReplication / mergeLocalInto).
//
// Marker-Version hochzählen, wenn ein neuer Schritt dazukommt — alle Schritte
// sind idempotent, ein erneuter Lauf schreibt nur, was wirklich fehlt.
const MARK_PREFIX = "syncomat.maintenance.v4:";
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
          if (
            cur.ignore !== null &&
            (cur.ignore.includes("(?d).*") || cur.ignore.includes(".*")) &&
            !cur.ignore.includes(SYNCOMAT_DIR_EXCEPTION)
          ) {
            await setFolderIgnores(ep, f.id, [SYNCOMAT_DIR_EXCEPTION, ...cur.ignore]);
            console.log(`[maintenance] ${f.id}: .syncomat vom Hidden-Muster ausgenommen`);
          }

          const fresh = (await getConfig(ep)).folders.find((x) => x.id === f.id);
          if (fresh) {
            const patch: Partial<Folder> = {};
            if (fresh.ignorePerms !== true) patch.ignorePerms = true;
            if (fresh.weakHashThresholdPct === 0) patch.weakHashThresholdPct = 101;
            if (fresh.maxConflicts !== 0) patch.maxConflicts = 0;
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
