import { useMemo, useState } from "react";
import type {
  Connection,
  Device,
  DeviceID,
  Endpoint,
  Folder,
  PendingFolder,
} from "../lib/syncthing";
import { LinkedFolderCard, PendingFolderCard } from "./FolderCard";
import { TagChip } from "./TagChip";

export function FolderList({
  linked,
  pending,
  endpoint,
  ready,
  devices,
  connections,
  myID,
  onLink,
  onPauseToggle,
  onRename,
  onShowErrors,
  onShowSettings,
  onShowConflicts,
  tagsByFolderID,
}: {
  linked: Folder[];
  pending: PendingFolder[];
  endpoint: Endpoint | null;
  ready: boolean;
  devices: Device[];
  connections: Record<DeviceID, Connection>;
  myID: DeviceID | null;
  onLink: (pf: PendingFolder) => void;
  onPauseToggle: (f: Folder) => void;
  onRename: (f: Folder, newLabel: string) => void;
  onShowErrors: (f: Folder) => void;
  onShowSettings: (f: Folder) => void;
  onShowConflicts: (f: Folder) => void;
  tagsByFolderID: Record<string, string[]>;
}) {
  const all = linked.length + pending.length;
  // Aktiver Filter — wenn null, alle Folder zeigen. Sonst nur Folder mit
  // diesem Tag (Klick auf Tag-Chip in der Card toggelt).
  const [activeTag, setActiveTag] = useState<string | null>(null);

  // Alle vorkommenden Tags fürs Filter-Banner oben
  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const f of linked) {
      for (const t of tagsByFolderID[f.id] ?? []) set.add(t);
    }
    return Array.from(set).sort();
  }, [linked, tagsByFolderID]);

  const filteredLinked = useMemo(() => {
    if (!activeTag) return linked;
    return linked.filter((f) => (tagsByFolderID[f.id] ?? []).includes(activeTag));
  }, [linked, tagsByFolderID, activeTag]);

  // Group-by-tag: bei Multi-Tag erscheint ein Folder unter mehreren Gruppen.
  // Wenn ein activeTag-Filter gesetzt ist, zeigen wir flach (keine Gruppen
  // mehr nötig).
  type Group = { label: string | null; folders: Folder[] };
  const groups: Group[] = useMemo(() => {
    if (activeTag) return [{ label: null, folders: filteredLinked }];
    if (allTags.length === 0) return [{ label: null, folders: linked }];
    // Gruppen pro Tag, plus eine "Ohne Tag"-Gruppe wenn relevant
    const tagged = new Map<string, Folder[]>();
    const untagged: Folder[] = [];
    for (const f of linked) {
      const tags = tagsByFolderID[f.id] ?? [];
      if (tags.length === 0) {
        untagged.push(f);
        continue;
      }
      for (const t of tags) {
        const list = tagged.get(t);
        if (list) list.push(f);
        else tagged.set(t, [f]);
      }
    }
    const result: Group[] = [];
    for (const t of allTags) {
      result.push({ label: t, folders: tagged.get(t) ?? [] });
    }
    if (untagged.length > 0) {
      result.push({ label: null, folders: untagged });
    }
    return result;
  }, [linked, allTags, tagsByFolderID, activeTag, filteredLinked]);

  if (all === 0) {
    return (
      <p className="text-xs text-neutral-500 dark:text-neutral-500">
        Noch keine Ordner. Verknüpfe einen, sobald ein Gerät welche anbietet.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {allTags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => setActiveTag(null)}
            className={`text-[11px] px-2 py-0.5 rounded-md font-medium ${
              activeTag === null
                ? "bg-neutral-800 text-white dark:bg-neutral-100 dark:text-neutral-900"
                : "text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100"
            }`}
          >
            Alle
          </button>
          {allTags.map((t) => (
            <TagChip
              key={t}
              tag={t}
              size="sm"
              active={activeTag === t}
              onClick={() => setActiveTag(activeTag === t ? null : t)}
            />
          ))}
        </div>
      )}

      {groups.map((g, idx) => (
        <div key={g.label ?? `__no-tag-${idx}`} className="space-y-2">
          {!activeTag && g.label !== null && allTags.length > 0 && (
            <div className="flex items-center gap-2 pt-1">
              <TagChip tag={g.label} size="sm" />
              <span className="text-[10px] text-neutral-400 dark:text-neutral-500">
                {g.folders.length}
              </span>
            </div>
          )}
          {!activeTag &&
            g.label === null &&
            allTags.length > 0 &&
            g.folders.length > 0 && (
              <div className="text-[10px] uppercase tracking-wider text-neutral-400 dark:text-neutral-500 pt-1">
                Ohne Tag
              </div>
            )}
          {g.folders.map((f) => (
            <LinkedFolderCard
              key={f.id}
              folder={f}
              endpoint={endpoint}
              ready={ready}
              devices={devices}
              connections={connections}
              myID={myID}
              onPauseToggle={onPauseToggle}
              onRename={onRename}
              onShowErrors={onShowErrors}
              onShowSettings={onShowSettings}
              onShowConflicts={onShowConflicts}
              tags={tagsByFolderID[f.id] ?? []}
              onTagClick={(t) => setActiveTag(activeTag === t ? null : t)}
            />
          ))}
        </div>
      ))}
      {pending.map((pf) => (
        <PendingFolderCard
          key={pf.folderID}
          pending={pf}
          devices={devices}
          onLink={onLink}
        />
      ))}
    </div>
  );
}
