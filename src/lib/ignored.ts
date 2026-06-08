import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

export type IgnoredFolderEntry = {
  folder_id: string;
  ignored_at: number;
  last_seen_label: string | null;
};

export const ignoredFoldersList = () =>
  invoke<IgnoredFolderEntry[]>("ignored_folders_list");

export const ignoredFoldersAdd = (folderId: string, label?: string | null) =>
  invoke<void>("ignored_folders_add", { folderId, label: label ?? null });

export const ignoredFoldersRemove = (folderId: string) =>
  invoke<void>("ignored_folders_remove", { folderId });

export function useIgnoredFolders(pollMs = 10_000) {
  const [data, setData] = useState<IgnoredFolderEntry[] | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const fetchOnce = () =>
      ignoredFoldersList()
        .then((d) => !cancelled && setData(d))
        .catch(() => !cancelled && setData([]));
    fetchOnce();
    const id = setInterval(fetchOnce, pollMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [pollMs, tick]);

  const ids = new Set((data ?? []).map((e) => e.folder_id));
  return {
    data: data ?? [],
    isIgnored: (folderId: string) => ids.has(folderId),
    refresh: () => setTick((t) => t + 1),
  };
}
