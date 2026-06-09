import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Folder } from "./syncthing";

// ── Lokaler Tags-Store (Sprint #4): Tags leben PRO GERÄT in app_data, nie
// gesynct (siehe src-tauri/src/tags.rs). tags_get_all liefert die ganze Map,
// tags_set schreibt/löscht einen Folder. ──
export const tagsGetAll = () => invoke<Record<string, string[]>>("tags_get_all");
export const tagsSet = (folderId: string, tags: string[]) =>
  invoke<void>("tags_set", { folderId, tags });

/**
 * Globaler Event-Bus: useFolderSettingsReplication ruft notifyTagsChanged()
 * nach jedem folder-defaults.json-Read, damit useFolderTags SOFORT refreshed
 * wenn ein Tag vom Peer gesynct wurde — statt erst beim nächsten 15s-Poll-Tick.
 *
 * Das ist der Fix für Marlon's Bug: Tag wurde auf Mac gesetzt, .syncomat/
 * folder-defaults.json war auf Windows gesynct (Activity-Feed zeigte das),
 * aber Sidebar-Gruppe blieb minutenlang auf "Ohne Tag".
 */
const tagSubscribers = new Set<() => void>();
export function notifyTagsChanged() {
  for (const fn of tagSubscribers) fn();
}

/**
 * Tags pro Folder — lokal in app_data, nie gesynct. Dieser Hook lädt die ganze
 * Map und filtert auf aktuell existierende Folders.
 *
 * Refresh-Trigger: mount · refresh() nach lokalem Save · notifyTagsChanged().
 * KEIN Poll mehr nötig — der Store ändert sich nur wenn WIR schreiben (was
 * notifyTagsChanged feuert). Ein Timer weniger.
 */
export function useFolderTags(folders: Folder[]): {
  byID: Record<string, string[]>;
  refresh: () => void;
} {
  const [byID, setByID] = useState<Record<string, string[]>>({});
  const [tick, setTick] = useState(0);
  const idKey = folders.map((f) => f.id).join(",");

  useEffect(() => {
    let cancelled = false;
    const ids = new Set(folders.map((f) => f.id));
    const fetchAll = async () => {
      try {
        const all = await tagsGetAll();
        if (cancelled) return;
        const next: Record<string, string[]> = {};
        for (const [fid, tg] of Object.entries(all)) {
          if (ids.has(fid) && tg.length > 0) next[fid] = tg;
        }
        setByID(next);
      } catch {
        // ignore
      }
    };
    void fetchAll();
    const onExternalUpdate = () => void fetchAll();
    tagSubscribers.add(onExternalUpdate);
    return () => {
      cancelled = true;
      tagSubscribers.delete(onExternalUpdate);
    };
  }, [idKey, tick]);

  return { byID, refresh: () => setTick((t) => t + 1) };
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
