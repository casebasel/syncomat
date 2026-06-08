import { RefreshCw, Settings } from "lucide-react";
import { StatusDot, statusLabel, type StatusTone } from "./StatusLight";

function SyncMark() {
  return (
    <div className="size-10 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-sm shadow-blue-900/30">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="size-5"
      >
        <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
        <path d="M3 3v5h5" />
        <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
        <path d="M16 16h5v5" />
      </svg>
    </div>
  );
}

export function Header({
  tone,
  connected,
  total,
  onScan,
  scanning,
  canScan,
  onOpenSettings,
}: {
  tone: StatusTone;
  connected: number;
  total: number;
  onScan: () => void;
  scanning: boolean;
  canScan: boolean;
  onOpenSettings: () => void;
}) {
  return (
    <header className="flex items-start justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <SyncMark />
        <div className="min-w-0">
          <h1 className="text-base font-semibold tracking-tight leading-none text-neutral-900 dark:text-neutral-100">
            Sync
          </h1>
          <p className="mt-1.5 text-xs text-neutral-500 dark:text-neutral-400 flex items-center gap-1.5">
            <StatusDot tone={tone} />
            {statusLabel(tone, connected, total)}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          onClick={onScan}
          disabled={!canScan || scanning}
          title={canScan ? "Scan auf allen Ordnern auslösen" : "Keine Ordner"}
          className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-neutral-300 dark:border-neutral-700 text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <RefreshCw className={`size-3.5 ${scanning ? "animate-spin" : ""}`} />
          Jetzt syncen
        </button>
        <button
          onClick={onOpenSettings}
          title="Einstellungen"
          className="p-1.5 rounded-lg border border-neutral-300 dark:border-neutral-700 text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          <Settings className="size-3.5" />
        </button>
      </div>
    </header>
  );
}
