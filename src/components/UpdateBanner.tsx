import { Download, Loader2, RotateCw } from "lucide-react";
import type { UpdateState } from "../lib/updater";

export function UpdateBanner({
  state,
  onInstall,
  onDismiss,
}: {
  state: UpdateState;
  onInstall: () => void;
  onDismiss?: () => void;
}) {
  if (state.kind === "idle" || state.kind === "checking" || state.kind === "up-to-date") {
    return null;
  }

  if (state.kind === "error") {
    // Silent — Update-Server kann offline sein, das soll den User nicht stören.
    return null;
  }

  if (state.kind === "available") {
    return (
      <div className="mt-4 flex items-center gap-3 px-3 py-2.5 rounded-xl border border-blue-300 dark:border-blue-500/40 bg-blue-50 dark:bg-blue-950/30">
        <Download className="size-4 text-blue-600 dark:text-blue-400 shrink-0" />
        <div className="min-w-0 flex-1 text-xs">
          <div className="font-medium text-blue-900 dark:text-blue-200">
            Update verfügbar: v{state.update.version}
          </div>
          {state.update.body && (
            <p className="text-blue-700/80 dark:text-blue-300/80 truncate">
              {state.update.body.split("\n")[0]}
            </p>
          )}
        </div>
        {onDismiss && (
          <button
            onClick={onDismiss}
            className="text-xs text-blue-900 dark:text-blue-200 hover:bg-blue-100 dark:hover:bg-blue-900/40 px-2 py-1 rounded-md"
          >
            Später
          </button>
        )}
        <button
          onClick={onInstall}
          className="text-xs font-medium px-3 py-1.5 rounded-md bg-blue-600 text-white hover:bg-blue-700"
        >
          Installieren
        </button>
      </div>
    );
  }

  if (state.kind === "downloading") {
    const pct =
      state.total && state.total > 0
        ? Math.min(100, Math.round((state.downloaded / state.total) * 100))
        : null;
    return (
      <div className="mt-4 px-3 py-2.5 rounded-xl border border-blue-300 dark:border-blue-500/40 bg-blue-50 dark:bg-blue-950/30">
        <div className="flex items-center gap-2 text-xs text-blue-900 dark:text-blue-200">
          <Loader2 className="size-3.5 animate-spin" />
          <span>
            Lädt v{state.update.version}
            {pct !== null ? ` · ${pct}%` : ""}
          </span>
        </div>
        {pct !== null && (
          <div className="mt-2 h-1 rounded-full bg-blue-200 dark:bg-blue-900 overflow-hidden">
            <div
              className="h-full bg-blue-600 transition-all duration-200"
              style={{ width: `${pct}%` }}
            />
          </div>
        )}
      </div>
    );
  }

  if (state.kind === "ready") {
    return (
      <div className="mt-4 flex items-center gap-2 px-3 py-2.5 rounded-xl border border-emerald-300 dark:border-emerald-500/40 bg-emerald-50 dark:bg-emerald-950/30 text-xs">
        <RotateCw className="size-3.5 text-emerald-600 dark:text-emerald-400" />
        <span className="text-emerald-900 dark:text-emerald-200">
          Update bereit — App startet neu…
        </span>
      </div>
    );
  }

  return null;
}
