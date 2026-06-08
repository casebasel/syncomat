import { ArrowDown, ArrowUp, Ban, FileX, Pencil } from "lucide-react";
import {
  fmtActivityBytes,
  fmtActivityTime,
  useFolderActivity,
  type ActivityEvent,
} from "../lib/activity";

export function ActivityFeed({
  folderId,
  onResolveConflict,
}: {
  folderId: string;
  onResolveConflict?: () => void;
}) {
  const items = useFolderActivity(folderId);

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 px-3 py-4 text-center">
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          Noch keine Aktivität in dieser Session. Sync läuft im Hintergrund.
        </p>
      </div>
    );
  }

  return (
    <div
      role="log"
      aria-live="polite"
      aria-label="Sync-Aktivität"
      className="rounded-lg border border-neutral-200 dark:border-neutral-800 divide-y divide-neutral-200 dark:divide-neutral-800 text-xs"
    >
      {items.map((e) => (
        <ActivityRow key={e.id} event={e} onResolveConflict={onResolveConflict} />
      ))}
    </div>
  );
}

function ActivityRow({
  event,
  onResolveConflict,
}: {
  event: ActivityEvent;
  onResolveConflict?: () => void;
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
      <span className={`shrink-0 ${iconColor}`} title={directionLabel(event)}>
        <Icon className="size-3.5" />
      </span>
      <span className="text-[10px] text-neutral-500 dark:text-neutral-500 font-mono w-16 truncate shrink-0">
        {peerLabel}
      </span>
      <span
        className="font-mono text-[11px] truncate flex-1 text-neutral-700 dark:text-neutral-200"
        dir="auto"
        title={event.path}
      >
        {event.path}
      </span>
      {isConflict ? (
        <button
          onClick={onResolveConflict}
          className="text-[10px] text-amber-700 dark:text-amber-300 font-semibold hover:underline shrink-0"
        >
          Auflösen →
        </button>
      ) : (
        <span className="text-[10px] text-neutral-400 dark:text-neutral-500 tabular-nums shrink-0">
          {fmtActivityBytes(event.size)}
        </span>
      )}
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

function directionLabel(e: ActivityEvent): string {
  if (e.action === "deleted") return "Gelöscht";
  if (e.direction === "conflict") return "Konflikt";
  if (e.direction === "up") return "Hochgeladen";
  if (e.direction === "local") return "Lokal geändert";
  return "Empfangen";
}
