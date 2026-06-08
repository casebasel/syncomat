import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";

export type ConflictItem = {
  conflict_rel: string;
  original_rel: string;
  original_exists: boolean;
  conflict_size: number;
  original_size: number;
  conflict_mtime: number;
  original_mtime: number;
  peer_fragment: string;
  when: string;
};

export const conflictsList = (folderPath: string) =>
  invoke<ConflictItem[]>("conflicts_list", { folderPath });

export const conflictsKeepLocal = (folderPath: string, conflictRel: string) =>
  invoke<void>("conflicts_keep_local", { folderPath, conflictRel });

export const conflictsTakeRemote = (
  folderPath: string,
  conflictRel: string,
  originalRel: string,
) =>
  invoke<void>("conflicts_take_remote", {
    folderPath,
    conflictRel,
    originalRel,
  });

export const conflictsKeepBoth = (
  folderPath: string,
  conflictRel: string,
  peerFragment: string,
) =>
  invoke<string>("conflicts_keep_both", { folderPath, conflictRel, peerFragment });

// ── Hook: pro Folder die Liste der Konflikte mit Polling alle 60s ──

export function useFolderConflicts(folderPath: string | null) {
  const [items, setItems] = useState<ConflictItem[] | null>(null);
  const [tick, setTick] = useState(0);
  const lastFetchRef = useRef(0);

  useEffect(() => {
    if (!folderPath) {
      setItems(null);
      return;
    }
    let cancelled = false;
    const fetchOnce = () => {
      lastFetchRef.current = Date.now();
      conflictsList(folderPath)
        .then((data) => !cancelled && setItems(data))
        .catch(() => !cancelled && setItems([]));
    };
    fetchOnce();
    const id = setInterval(fetchOnce, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [folderPath, tick]);

  return {
    items,
    count: items?.length ?? 0,
    refresh: () => setTick((t) => t + 1),
  };
}

// ── Helpers für die UI ──

export function fmtConflictBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function fmtConflictWhen(when: string): string {
  // when = "YYYYMMDD-HHMMSS"
  if (when.length !== 15) return when;
  const y = when.slice(0, 4);
  const m = when.slice(4, 6);
  const d = when.slice(6, 8);
  const hh = when.slice(9, 11);
  const mm = when.slice(11, 13);
  return `${d}.${m}.${y} ${hh}:${mm}`;
}
