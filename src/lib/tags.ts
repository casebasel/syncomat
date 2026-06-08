import { useEffect, useState } from "react";
import { folderSettingsRead } from "./folderSettings";
import type { Folder } from "./syncthing";

/**
 * Tags pro Folder werden in .syncomat/folder-defaults.json gespeichert.
 * Dieser Hook lädt sie für eine Liste von Folders und gibt eine Map
 * folderID → tags[] zurück. Re-polled alle 60s damit Tags vom Peer
 * eingebracht werden ohne UI-Refresh.
 */
export function useFolderTags(folders: Folder[]): Record<string, string[]> {
  const [byID, setByID] = useState<Record<string, string[]>>({});
  // Path-set als dep damit Folder-Add/Remove triggert
  const pathKey = folders.map((f) => `${f.id}|${f.path}`).join(",");

  useEffect(() => {
    let cancelled = false;
    const fetchAll = async () => {
      const next: Record<string, string[]> = {};
      for (const f of folders) {
        try {
          const file = await folderSettingsRead(f.path);
          if (file?.settings.tags && file.settings.tags.length > 0) {
            next[f.id] = file.settings.tags;
          }
        } catch {
          // ignore missing settings.json
        }
      }
      if (!cancelled) setByID(next);
    };
    void fetchAll();
    const id = setInterval(fetchAll, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [pathKey]);

  return byID;
}

/**
 * Deterministische Farbe pro Tag-String. Generiert konsistent über alle
 * Geräte hinweg dieselbe Farbe weil hash-basiert.
 *
 * Palette: 8 Pastell-ish Farben die im light + dark mode lesbar sind.
 * Index aus FNV-1a-Hash über den Tag-String mod palette.length.
 */
const TAG_PALETTE = [
  { bg: "bg-blue-100 dark:bg-blue-950/40", text: "text-blue-700 dark:text-blue-300", ring: "ring-blue-300 dark:ring-blue-500/40" },
  { bg: "bg-emerald-100 dark:bg-emerald-950/40", text: "text-emerald-700 dark:text-emerald-300", ring: "ring-emerald-300 dark:ring-emerald-500/40" },
  { bg: "bg-amber-100 dark:bg-amber-950/40", text: "text-amber-700 dark:text-amber-300", ring: "ring-amber-300 dark:ring-amber-500/40" },
  { bg: "bg-rose-100 dark:bg-rose-950/40", text: "text-rose-700 dark:text-rose-300", ring: "ring-rose-300 dark:ring-rose-500/40" },
  { bg: "bg-purple-100 dark:bg-purple-950/40", text: "text-purple-700 dark:text-purple-300", ring: "ring-purple-300 dark:ring-purple-500/40" },
  { bg: "bg-cyan-100 dark:bg-cyan-950/40", text: "text-cyan-700 dark:text-cyan-300", ring: "ring-cyan-300 dark:ring-cyan-500/40" },
  { bg: "bg-lime-100 dark:bg-lime-950/40", text: "text-lime-700 dark:text-lime-300", ring: "ring-lime-300 dark:ring-lime-500/40" },
  { bg: "bg-pink-100 dark:bg-pink-950/40", text: "text-pink-700 dark:text-pink-300", ring: "ring-pink-300 dark:ring-pink-500/40" },
];

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h;
}

export function tagColor(tag: string) {
  const idx = fnv1a(tag.toLowerCase()) % TAG_PALETTE.length;
  return TAG_PALETTE[idx]!;
}

/** Normalisiert einen Tag-String (trim, lowercase, kein leading-#). */
export function normalizeTag(raw: string): string {
  return raw.trim().replace(/^#+/, "").slice(0, 32);
}
