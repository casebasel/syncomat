import { useState } from "react";
import { AlertOctagon, Check, Copy, Loader2, Trash2 } from "lucide-react";
import { Modal } from "./Modal";
import {
  conflictsKeepBoth,
  conflictsKeepLocal,
  conflictsTakeRemote,
  fmtConflictBytes,
  fmtConflictWhen,
  useFolderConflicts,
  type ConflictItem,
} from "../lib/conflicts";

export function ConflictResolverModal({
  folderPath,
  folderLabel,
  onClose,
}: {
  folderPath: string;
  folderLabel: string;
  onClose: () => void;
}) {
  const { items, refresh } = useFolderConflicts(folderPath, { active: true });
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const act = async (action: () => Promise<unknown>, key: string) => {
    setError(null);
    setBusyKey(key);
    try {
      await action();
      refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <Modal
      title={`Konflikte in „${folderLabel}"`}
      onClose={onClose}
      dismissible={busyKey === null}
    >
      {items === null ? (
        <div className="flex items-center gap-2 text-sm text-neutral-500 dark:text-neutral-400">
          <Loader2 className="size-4 animate-spin" /> Lade…
        </div>
      ) : items.length === 0 ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400">
            <Check className="size-4" /> Keine Konflikte im Ordner.
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            Wenn dieselbe Datei auf zwei Geräten gleichzeitig geändert wurde,
            behält Syncthing eine Version als <code>.sync-conflict-…</code>{" "}
            Variante. Wähle pro Konflikt was passieren soll.
          </p>

          <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
            {items.map((c) => (
              <ConflictRow
                key={c.conflict_rel}
                item={c}
                busy={busyKey === c.conflict_rel}
                onKeepLocal={() =>
                  act(
                    () => conflictsKeepLocal(folderPath, c.conflict_rel),
                    c.conflict_rel,
                  )
                }
                onTakeRemote={() =>
                  act(
                    () =>
                      conflictsTakeRemote(
                        folderPath,
                        c.conflict_rel,
                        c.original_rel,
                      ),
                    c.conflict_rel,
                  )
                }
                onKeepBoth={() =>
                  act(
                    () =>
                      conflictsKeepBoth(
                        folderPath,
                        c.conflict_rel,
                        c.peer_fragment,
                      ),
                    c.conflict_rel,
                  )
                }
              />
            ))}
          </div>

          {error && (
            <p className="text-xs text-rose-500 dark:text-rose-400 break-words">
              {error}
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}

function ConflictRow({
  item,
  busy,
  onKeepLocal,
  onTakeRemote,
  onKeepBoth,
}: {
  item: ConflictItem;
  busy: boolean;
  onKeepLocal: () => void;
  onTakeRemote: () => void;
  onKeepBoth: () => void;
}) {
  return (
    <div className="rounded-xl border border-amber-300 dark:border-amber-500/30 bg-amber-50/50 dark:bg-amber-950/20 px-3 py-2.5">
      <div className="flex items-start gap-2 mb-2">
        <AlertOctagon className="size-3.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-neutral-900 dark:text-neutral-100 truncate">
            {item.original_rel}
          </div>
          <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
            Konflikt von {item.peer_fragment} · {fmtConflictWhen(item.when)}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-[11px] mb-2">
        <div className="rounded-md bg-white/60 dark:bg-neutral-900/40 px-2 py-1.5">
          <div className="text-neutral-500 dark:text-neutral-500">Lokal</div>
          <div className="font-mono text-neutral-700 dark:text-neutral-200">
            {item.original_exists ? fmtConflictBytes(item.original_size) : "fehlt"}
          </div>
          {item.original_exists && (
            <div className="text-neutral-400 dark:text-neutral-500 text-[10px]">
              {new Date(item.original_mtime * 1000).toLocaleString("de-DE", {
                day: "2-digit",
                month: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </div>
          )}
        </div>
        <div className="rounded-md bg-white/60 dark:bg-neutral-900/40 px-2 py-1.5">
          <div className="text-neutral-500 dark:text-neutral-500">Remote</div>
          <div className="font-mono text-neutral-700 dark:text-neutral-200">
            {fmtConflictBytes(item.conflict_size)}
          </div>
          <div className="text-neutral-400 dark:text-neutral-500 text-[10px]">
            {new Date(item.conflict_mtime * 1000).toLocaleString("de-DE", {
              day: "2-digit",
              month: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </div>
        </div>
      </div>

      <div className="flex gap-1.5">
        <button
          onClick={onKeepLocal}
          disabled={busy}
          title="Konflikt-Datei löschen, lokale Version bleibt"
          className="flex-1 text-[11px] font-medium px-2 py-1.5 rounded-md border border-neutral-300 dark:border-neutral-700 text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-50 flex items-center justify-center gap-1"
        >
          <Trash2 className="size-3" /> Lokal behalten
        </button>
        <button
          onClick={onTakeRemote}
          disabled={busy || !item.original_exists}
          title={
            item.original_exists
              ? "Lokal überschreiben mit Konflikt-Version"
              : "Original existiert nicht — nutze 'Beide behalten'"
          }
          className="flex-1 text-[11px] font-medium px-2 py-1.5 rounded-md border border-neutral-300 dark:border-neutral-700 text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-50 flex items-center justify-center gap-1"
        >
          <Check className="size-3" /> Remote übernehmen
        </button>
        <button
          onClick={onKeepBoth}
          disabled={busy}
          title="Konflikt-Datei umbenennen in .von-PEER, beide behalten"
          className="flex-1 text-[11px] font-medium px-2 py-1.5 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-1"
        >
          {busy ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <Copy className="size-3" />
          )}
          Beide behalten
        </button>
      </div>
    </div>
  );
}
