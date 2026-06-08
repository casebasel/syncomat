import type { FolderStatus } from "../lib/syncthing";

export type AggregateState = "idle" | "syncing" | "error";

export function aggregate(statuses: FolderStatus[]): {
  state: AggregateState;
  errorCount: number;
  needBytes: number;
} {
  let errorCount = 0;
  let needBytes = 0;
  for (const s of statuses) {
    errorCount += (s.errors || 0) + (s.pullErrors || 0);
    needBytes += s.needBytes || 0;
  }
  const state: AggregateState =
    errorCount > 0 ? "error" : needBytes > 0 ? "syncing" : "idle";
  return { state, errorCount, needBytes };
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function fmtRelativeTime(d: Date | null): string {
  if (!d) return "—";
  const sec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (sec < 5) return "gerade eben";
  if (sec < 60) return `vor ${sec} s`;
  if (sec < 3600) return `vor ${Math.floor(sec / 60)} min`;
  return `vor ${Math.floor(sec / 3600)} h`;
}

export function Statusbar({
  aggregateState,
  needBytes,
  errorCount,
  lastSyncAt,
}: {
  aggregateState: AggregateState;
  needBytes: number;
  errorCount: number;
  lastSyncAt: Date | null;
}) {
  let left = "Aktuell · alles synchron";
  if (aggregateState === "syncing")
    left = `Synchronisiere · ${fmtBytes(needBytes)} offen`;
  if (aggregateState === "error")
    left = `${errorCount} Datei-Fehler · siehe Ordner-Karte`;

  const leftCls =
    aggregateState === "error"
      ? "text-rose-500 dark:text-rose-400"
      : "text-neutral-500 dark:text-neutral-400";

  return (
    <div className="mt-6 pt-4 border-t border-neutral-200 dark:border-neutral-800 flex items-center justify-between text-[11px]">
      <span className={leftCls}>{left}</span>
      <span className="text-neutral-400 dark:text-neutral-500">
        zuletzt: {fmtRelativeTime(lastSyncAt)}
      </span>
    </div>
  );
}
