import { useEffect, useState } from "react";
import { AlertTriangle, FileWarning, Loader2 } from "lucide-react";
import { PanelShell } from "./PanelShell";
import {
  getFolderErrors,
  isWindowsNameError,
  type Endpoint,
  type FolderError,
} from "../lib/syncthing";

type Loadable<T> = { data: T | null; error: Error | null; loading: boolean };

export function FolderErrorsModal({
  endpoint,
  folderId,
  folderLabel,
  onClose,
}: {
  endpoint: Endpoint;
  folderId: string;
  folderLabel: string;
  onClose: () => void;
}) {
  const [state, setState] = useState<Loadable<FolderError[]>>({
    data: null,
    error: null,
    loading: true,
  });

  useEffect(() => {
    let cancelled = false;
    setState({ data: null, error: null, loading: true });
    getFolderErrors(endpoint, folderId)
      .then((r) => {
        if (cancelled) return;
        setState({ data: r.errors ?? [], error: null, loading: false });
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setState({ data: null, error: e, loading: false });
      });
    return () => {
      cancelled = true;
    };
  }, [endpoint.url, endpoint.api_key, folderId]);

  const winErrors = (state.data ?? []).filter((e) => isWindowsNameError(e.error));
  const otherErrors = (state.data ?? []).filter((e) => !isWindowsNameError(e.error));

  return (
    <PanelShell title={`Fehler in „${folderLabel}"`} onBack={onClose} width="wide">
      {state.loading ? (
        <div className="flex items-center gap-2 text-sm text-neutral-500 dark:text-neutral-400">
          <Loader2 className="size-4 animate-spin" />
          Lade Fehler…
        </div>
      ) : state.error ? (
        <p className="text-xs text-rose-500 dark:text-rose-400 break-words">
          {state.error.message}
        </p>
      ) : (state.data?.length ?? 0) === 0 ? (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Aktuell keine Fehler.
        </p>
      ) : (
        <div className="space-y-4">
          {winErrors.length > 0 && (
            <Group
              title="Auf Windows nicht erlaubt"
              hint="Dateinamen mit : ? * < > | oder reservierten Namen (CON, NUL, …) können auf Windows-Geräten nicht angelegt werden."
              errors={winErrors}
              tone="amber"
            />
          )}
          {otherErrors.length > 0 && (
            <Group
              title="Andere Fehler"
              hint="Permission, Disk-Voll, Netzwerk-Probleme oder ähnliches."
              errors={otherErrors}
              tone="rose"
            />
          )}
        </div>
      )}
    </PanelShell>
  );
}

function Group({
  title,
  hint,
  errors,
  tone,
}: {
  title: string;
  hint: string;
  errors: FolderError[];
  tone: "amber" | "rose";
}) {
  const Icon = tone === "amber" ? AlertTriangle : FileWarning;
  const iconCls =
    tone === "amber"
      ? "text-amber-500 dark:text-amber-400"
      : "text-rose-500 dark:text-rose-400";
  return (
    <section>
      <div className="flex items-start gap-2 mb-2">
        <Icon className={`size-4 shrink-0 mt-0.5 ${iconCls}`} />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            {title} <span className="text-xs text-neutral-500 dark:text-neutral-400 font-normal">({errors.length})</span>
          </h3>
          <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-0.5">
            {hint}
          </p>
        </div>
      </div>
      <ul className="space-y-1 max-h-56 overflow-y-auto pr-1">
        {errors.map((e, i) => (
          <li
            key={`${e.path}-${i}`}
            className="text-xs px-2 py-1.5 rounded border border-neutral-200 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-900/40"
          >
            <div className="font-mono text-neutral-800 dark:text-neutral-200 break-all">
              {e.path}
            </div>
            <div className="text-[10px] text-neutral-500 dark:text-neutral-500 mt-0.5 break-words">
              {e.error}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
