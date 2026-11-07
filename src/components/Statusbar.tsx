import type { FolderStatus } from "../lib/syncthing";
import { estimateIndexRamMB } from "../lib/unreal";
import { fmtSpeed } from "../lib/network";

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
    errorCount += s.errors || 0;
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
  folderErrorLabels = [],
  lastSyncAt,
  version,
  localFiles,
  localBytes,
  inBps,
  outBps,
}: {
  ready: boolean;
  aggregateState: AggregateState;
  needBytes: number;
  errorCount: number;
  /** Labels der Ordner, die als Ganzes im Fehler stehen (Sync angehalten). */
  folderErrorLabels?: string[];
  lastSyncAt: Date | null;
  version: string | null;
  localFiles?: number;
  localBytes?: number;
  inBps?: number;
  outBps?: number;
}) {
  // Live-Übertragungsrate nur zeigen wenn wirklich was fließt (> 1 KB/s) —
  // sonst flackert "0 B/s" im Idle.
  const dn = inBps ?? 0;
  const up = outBps ?? 0;
  const transferActive = dn + up > 1024;
  // Beim Boot NICHT grün „Alle Ordner synchron" lügen — erst wenn der Sync-Dienst
  // wirklich verbunden ist (sonst wirkt ein leerer/ladender Zustand wie „alles ok").
  let left = ready ? "Alle Ordner synchron" : "Sync-Dienst startet…";
  if (ready && aggregateState === "syncing")
    left = `Synct · ${fmtBytes(needBytes)} offen`;
  if (ready && aggregateState === "error")
    left =
      folderErrorLabels.length > 0
        ? `Sync angehalten: ${folderErrorLabels.join(", ")} · Details im Inspector`
        : `${errorCount} Datei-Fehler · Details im Inspector`;

  const leftCls =
    aggregateState === "error"
      ? "text-[var(--sm-ocker-text)] font-semibold"
      : "text-[var(--sm-text2)]";

  // Index-RAM-Forecast: zeigt User die echten Kosten seiner Folder.
  // Ab 500 MB: gelb. Ab 1.5 GB: rot (Syncthing wird träge / OOM-Risiko).
  const ramMB =
    localFiles && localBytes ? estimateIndexRamMB(localFiles, localBytes) : 0;
  let ramTone = "text-[var(--sm-text2)]";
  if (ramMB >= 500) ramTone = "text-[var(--sm-ocker-text)]";

  return (
    <div className="h-7 flex items-center justify-between text-[12px] text-[var(--sm-text2)]">
      <span className={leftCls}>{left}</span>
      <span className="text-[var(--sm-text2)] flex items-center gap-1.5">
        {transferActive && (
          <>
            <span
              className="text-[var(--sm-blau)] tabular-nums font-medium"
              title="Live-Übertragungsrate (gesamt über alle Geräte)"
            >
              ↓ {fmtSpeed(dn)} ↑ {fmtSpeed(up)}
            </span>
            <span className="text-[var(--sm-linie)]">·</span>
          </>
        )}
        {ramMB > 0 && (
          <>
            <span className={ramTone} title="Geschätzter Sync-Engine RAM-Verbrauch für den Index">
              Index ~{ramMB} MB
            </span>
            <span className="text-[var(--sm-linie)]">·</span>
          </>
        )}
        {version && (
          <>
            <span className="font-mono">v{version}</span>
            <span className="text-[var(--sm-linie)]">·</span>
          </>
        )}
        zuletzt: {fmtRelativeTime(lastSyncAt)}
      </span>
    </div>
  );
}
