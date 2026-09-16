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
import {
  GENERIC_STIGNORE,
  NODE_STIGNORE,
  UNREAL_STIGNORE,
  deletableIgnore,
} from "./unreal";

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
//    a) .stignore-Migration: bekannte Preset-Muster ohne `(?d)` (Ordner von
//       vor v0.9.6) bekommen das Präfix — sonst blockiert ein `.DS_Store`
//       weiter das Löschen von Verzeichnissen ("contains ignored files").
//       NUR exakt bekannte Preset-Zeilen; handgeschriebene Muster bleiben.
//    b) `ignorePerms=true` — Rechte-Bits im Mac/Windows/NAS-Mix nicht syncen
//       (Rechte-Churn, "lokal geändert" auf receive-only-Ordnern).
//    c) `weakHashThresholdPct 0 → 101` — Rolling-Hash bringt bei komplett
//       neu geschriebenen Binärassets nichts, kostet nur CPU je Scan.
//    d) (v2) `(?d).sync` anhängen — Resilio-Sync-Reste (Archiv gelöschter
//       Dateien) sind reiner Ballast. Nur bei Listen, die erkennbar von einem
//       Syncomat-Preset stammen (mind. eine bekannte Preset-Zeile).
//
// Marker-Version hochzählen, wenn ein neuer Schritt dazukommt — alle Schritte
// sind idempotent, ein erneuter Lauf schreibt nur, was wirklich fehlt.

const MARK_PREFIX = "syncomat.maintenance.v2:";
const STAGGER_MS = 1500; // Ordner nacheinander, nicht alle gleichzeitig neu starten
const RESILIO_PATTERN = "(?d).sync";

/** Alle "echten" Preset-Zeilen — ohne Kommentare, Leerzeilen, Negationen. */
const KNOWN_PRESET_LINES = new Set(
  [...UNREAL_STIGNORE, ...GENERIC_STIGNORE, ...NODE_STIGNORE].filter((l) => {
    const t = l.trim();
    return t !== "" && !t.startsWith("//") && !t.startsWith("!");
  }),
);

const stripD = (l: string) => l.replace(/^\(\?d\)/, "");

function migrateIgnores(lines: string[]): string[] {
  return lines.map((l) => (KNOWN_PRESET_LINES.has(l) ? deletableIgnore(l) : l));
}

/** Stammt die Liste erkennbar von einem Syncomat-Preset? (Handgeschriebene
 * Listen fassen wir nicht an.) */
function isPresetManaged(lines: string[]): boolean {
  return lines.some((l) => KNOWN_PRESET_LINES.has(stripD(l)));
}

function ensureResilioIgnored(lines: string[]): string[] {
  if (!isPresetManaged(lines)) return lines;
  if (lines.some((l) => stripD(l.trim()) === ".sync")) return lines;
  return [...lines, RESILIO_PATTERN];
}

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
        if (localStorage.getItem(mark)) continue;
        try {
          const cur = await getFolderIgnores(ep, f.id).catch(() => ({
            ignore: null,
            expanded: null,
          }));
          // ignore === null = API-Aussetzer → nichts schreiben (sonst Leerung).
          if (cur.ignore !== null) {
            const next = ensureResilioIgnored(migrateIgnores(cur.ignore));
            if (next.join("\n") !== cur.ignore.join("\n")) {
              await setFolderIgnores(ep, f.id, next);
              console.log(`[maintenance] ${f.id}: .stignore aktualisiert ((?d) / .sync)`);
            }
          }

          const fresh = (await getConfig(ep)).folders.find((x) => x.id === f.id);
          if (fresh) {
            const patch: Partial<Folder> = {};
            if (fresh.ignorePerms !== true) patch.ignorePerms = true;
            if (fresh.weakHashThresholdPct === 0) patch.weakHashThresholdPct = 101;
            if (Object.keys(patch).length > 0) {
              await putFolder(ep, { ...fresh, ...patch });
              console.log(`[maintenance] ${f.id}: folder`, patch);
            }
          }
          localStorage.setItem(mark, String(Date.now()));
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
