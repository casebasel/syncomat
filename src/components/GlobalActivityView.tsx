import { useMemo } from "react";
import { ArrowDown, ArrowUp, Ban, FileX, FolderOpen, Pencil } from "lucide-react";
import {
  fmtActivityBytes,
  fmtActivityTime,
  useAllActivity,
  type ActivityEvent,
} from "../lib/activity";
import type { Folder } from "../lib/syncthing";

export function GlobalActivityView({
  folders,
  onSelectFolder,
}: {
  folders: Folder[];
  /** Klick auf Folder-Pille in einer Zeile → wechselt zum Folder-Inspector */
  onSelectFolder: (f: Folder) => void;
}) {
  const items = useAllActivity();
  const folderById = useMemo(() => {
    const map = new Map<string, Folder>();
    for (const f of folders) map.set(f.id, f);
    return map;
  }, [folders]);

  return (
    <section className="flex-1 flex flex-col overflow-hidden bg-white dark:bg-neutral-900">
      {/* Header */}
      <header className="px-6 py-4 border-b border-neutral-200 dark:border-neutral-800 flex items-start gap-3">
        <div className="size-10 rounded-lg bg-neutral-200/70 dark:bg-neutral-800 flex items-center justify-center text-neutral-500 dark:text-neutral-400 shrink-0">
          <FolderOpen className="size-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold text-neutral-900 dark:text-neutral-100">
            Alle Ordner
          </h1>
          <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-1">
            {folders.length} Ordner · {items.length} Events aktuell · jüngste oben
          </p>
        </div>
      </header>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <div className="text-[10px] uppercase tracking-wider text-neutral-400 dark:text-neutral-500 font-semibold">
              Aktivität · alle Ordner
            </div>
            <div className="text-[10px] text-neutral-400 dark:text-neutral-500">
              letzte 200 Events
            </div>
          </div>

          {items.length === 0 ? (
            <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 px-3 py-4 text-center">
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                Noch keine Aktivität in dieser Session. Sync läuft im Hintergrund.
              </p>
            </div>
          ) : (
            <div
              role="log"
              aria-live="polite"
              aria-label="Aktivität alle Ordner"
              className="rounded-lg border border-neutral-200 dark:border-neutral-800 divide-y divide-neutral-200 dark:divide-neutral-800"
            >
              {items.map((e) => (
                <ActivityRow
                  key={e.id}
                  event={e}
                  folder={folderById.get(e.folderId)}
                  onSelectFolder={onSelectFolder}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function ActivityRow({
  event,
  folder,
  onSelectFolder,
}: {
  event: ActivityEvent;
  folder: Folder | undefined;
  onSelectFolder: (f: Folder) => void;
}) {
  const isConflict = event.direction === "conflict" || event.action === "conflict";
  const Icon = directionIcon(event);
  const iconColor = directionColor(event);
  const peerLabel =
    event.direction === "up"
      ? `→ ${event.peer || "peer"}`
      : event.peer || (event.direction === "local" ? "lokal" : "");

  return (
    <div
      className={`px-3 py-2 flex items-center gap-3 ${isConflict ? "bg-amber-50/50 dark:bg-amber-950/15" : "hover:bg-neutral-50 dark:hover:bg-neutral-800/40"}`}
    >
      <span className="text-[10px] text-neutral-400 dark:text-neutral-500 w-12 font-mono shrink-0">
        {fmtActivityTime(event.ts)}
      </span>
      <span className={`shrink-0 ${iconColor}`}>
        <Icon className="size-3.5" />
      </span>
      <span className="text-[10px] text-neutral-500 dark:text-neutral-500 font-mono w-14 truncate shrink-0">
        {peerLabel}
      </span>
      {folder ? (
        <button
          onClick={() => onSelectFolder(folder)}
          className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 font-medium shrink-0 hover:bg-blue-200 dark:hover:bg-blue-900/60 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
          title="Ordner öffnen"
        >
          {folder.label || folder.id.slice(0, 7)}
        </button>
      ) : (
        <span className="text-[10px] text-neutral-400 dark:text-neutral-600 italic shrink-0">
          unbekannt
        </span>
      )}
      <span
        className="font-mono text-[11px] truncate flex-1 text-neutral-700 dark:text-neutral-200"
        dir="auto"
        title={event.path}
      >
        {event.path}
      </span>
      <span className="text-[10px] text-neutral-400 dark:text-neutral-500 tabular-nums shrink-0">
        {fmtActivityBytes(event.size)}
      </span>
    </div>
  );
}

function directionIcon(e: ActivityEvent) {
  if (e.action === "deleted") return FileX;
  if (e.direction === "conflict" || e.action === "conflict") return Ban;
  if (e.direction === "up") return ArrowUp;
  if (e.direction === "local") return Pencil;
  return ArrowDown;
}

function directionColor(e: ActivityEvent): string {
  if (e.action === "deleted") return "text-rose-500 dark:text-rose-400";
  if (e.direction === "conflict" || e.action === "conflict")
    return "text-amber-600 dark:text-amber-400";
  if (e.direction === "up") return "text-blue-500 dark:text-blue-400";
  if (e.direction === "local") return "text-neutral-500 dark:text-neutral-400";
  return "text-emerald-500 dark:text-emerald-400";
}
