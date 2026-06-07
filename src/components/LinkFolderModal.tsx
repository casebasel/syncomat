import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen } from "lucide-react";
import type { PendingFolder } from "../lib/syncthing";
import { Modal } from "./Modal";

export function LinkFolderModal({
  pending,
  onConfirm,
  onClose,
}: {
  pending: PendingFolder;
  onConfirm: (label: string, localPath: string) => Promise<void>;
  onClose: () => void;
}) {
  const firstOfferer = Object.values(pending.offeredBy)[0];
  const defaultLabel = firstOfferer?.label || pending.folderID;

  const [label, setLabel] = useState(defaultLabel);
  const [path, setPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pickPath = async () => {
    setError(null);
    try {
      const chosen = await open({
        directory: true,
        title: `Ziel-Ordner für „${label}"`,
      });
      if (typeof chosen === "string") setPath(chosen);
    } catch (e) {
      setError(String(e));
    }
  };

  const submit = async () => {
    if (!label.trim() || !path) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(label.trim(), path);
      onClose();
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  return (
    <Modal title="Ordner verknüpfen" onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1.5">
            Anzeigename
          </label>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="w-full px-3 py-2 text-sm rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:border-blue-500"
            placeholder="z.B. Footage RAW"
          />
          <p className="text-[11px] text-neutral-500 dark:text-neutral-500 mt-1">
            Nur lokal. Andere Geräte sehen ihren eigenen Namen.
          </p>
        </div>

        <div>
          <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1.5">
            Lokaler Pfad
          </label>
          <button
            type="button"
            onClick={pickPath}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-950 text-left hover:bg-neutral-50 dark:hover:bg-neutral-900"
          >
            <FolderOpen className="size-4 text-neutral-400 dark:text-neutral-500 shrink-0" />
            <span
              className={
                path
                  ? "text-neutral-900 dark:text-neutral-100 truncate"
                  : "text-neutral-500 dark:text-neutral-500"
              }
            >
              {path || "Ordner wählen…"}
            </span>
          </button>
        </div>

        {error && (
          <p className="text-xs text-rose-500 dark:text-rose-400 break-words">{error}</p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="text-xs font-medium px-3 py-1.5 rounded-lg text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            Abbrechen
          </button>
          <button
            onClick={submit}
            disabled={!label.trim() || !path || busy}
            className="text-xs font-medium px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? "Verknüpfe…" : "Verknüpfen"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
