import type { FolderStatus } from "../lib/syncthing";
import { estimateIndexRamMB } from "../lib/unreal";

export type AggregateState = "idle" | "syncing" | "error";

export function aggregate(statuses: FolderStatus[]): {
  state: AggregateState;
  errorCount: number;
  needBytes: number;
  localFiles: number;
  localBytes: number;
} {
  let errorCount = 0;
  let needBytes = 0;
  let localFiles = 0;
  let localBytes = 0;
  for (const s of statuses) {
    errorCount += (s.errors || 0) + (s.pullErrors || 0);
    needBytes += s.needBytes || 0;
    localFiles += s.localFiles || 0;
    localBytes += s.localBytes || 0;
  }
  const state: AggregateState =
    errorCount > 0 ? "error" : needBytes > 0 ? "syncing" : "idle";
  return { state, errorCount, needBytes, localFiles, localBytes };
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
  ready,
  aggregateState,
  needBytes,
  errorCount,
  lastSyncAt,
  version,
  localFiles,
  localBytes,
}: {
  ready: boolean;
  aggregateState: AggregateState;
  needBytes: number;
  errorCount: number;
  lastSyncAt: Date | null;
  version: string | null;
  localFiles?: number;
  localBytes?: number;
}) {
  // Beim Boot NICHT grün „Alle Ordner synchron" lügen — erst wenn der Sync-Dienst
  // wirklich verbunden ist (sonst wirkt ein leerer/ladender Zustand wie „alles ok").
  let left = ready ? "Alle Ordner synchron" : "Sync-Dienst startet…";
  if (ready && aggregateState === "syncing")
    left = `Synct · ${fmtBytes(needBytes)} offen`;
  if (ready && aggregateState === "error")
    left = `${errorCount} Datei-Fehler · Details im Inspector`;

  const leftCls =
    aggregateState === "error"
      ? "text-rose-500 dark:text-rose-400"
      : "text-neutral-500 dark:text-neutral-400";

  // Index-RAM-Forecast: zeigt User die echten Kosten seiner Folder.
  // Ab 500 MB: gelb. Ab 1.5 GB: rot (Syncthing wird träge / OOM-Risiko).
  const ramMB =
    localFiles && localBytes ? estimateIndexRamMB(localFiles, localBytes) : 0;
  let ramTone = "text-neutral-400 dark:text-neutral-500";
  if (ramMB >= 1500) ramTone = "text-rose-500 dark:text-rose-400";
  else if (ramMB >= 500) ramTone = "text-amber-500 dark:text-amber-400";

  return (
    <div className="mt-6 pt-4 border-t border-neutral-200 dark:border-neutral-800 flex items-center justify-between text-[11px]">
      <span className={leftCls}>{left}</span>
      <span className="text-neutral-400 dark:text-neutral-500 flex items-center gap-1.5">
        {ramMB > 0 && (
          <>
            <span className={ramTone} title="Geschätzter Sync-Engine RAM-Verbrauch für den Index">
              Index ~{ramMB} MB
            </span>
            <span className="text-neutral-300 dark:text-neutral-700">·</span>
          </>
        )}
        {version && (
          <>
            <span className="font-mono">v{version}</span>
            <span className="text-neutral-300 dark:text-neutral-700">·</span>
          </>
        )}
        zuletzt: {fmtRelativeTime(lastSyncAt)}
      </span>
    </div>
  );
}
