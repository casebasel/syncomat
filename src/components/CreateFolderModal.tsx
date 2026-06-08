import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, Loader2 } from "lucide-react";
import { Modal } from "./Modal";
import { putFolder, type Endpoint, type Folder } from "../lib/syncthing";

export function CreateFolderModal({
  endpoint,
  myDeviceId,
  onClose,
  onCreated,
}: {
  endpoint: Endpoint;
  myDeviceId: string;
  onClose: () => void;
  onCreated?: (folder: Folder) => void;
}) {
  const [label, setLabel] = useState("");
  const [path, setPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pickPath = async () => {
    setError(null);
    try {
      const chosen = await open({
        directory: true,
        title: `Ordner für „${label || "Neuer Ordner"}"`,
      });
      if (typeof chosen === "string") {
        setPath(chosen);
        // Wenn Label leer: vorschlagen aus letzter Pfad-Komponente.
        // Pfad kann '/' (POSIX) oder '\' (Windows) als Separator haben.
        if (!label.trim()) {
          const guess = chosen.split(/[/\\]/).filter(Boolean).pop();
          if (guess) setLabel(guess);
        }
      }
    } catch (e) {
      setError(String(e));
    }
  };

  const submit = async () => {
    if (!label.trim() || !path) return;
    setBusy(true);
    setError(null);
    try {
      const folder: Folder = {
        // Syncthing erwartet eine String-ID; UUID ist kollisionsfrei.
        id: crypto.randomUUID(),
        label: label.trim(),
        path,
        type: "sendreceive",
        paused: false,
        devices: [{ deviceID: myDeviceId }],
        caseSensitiveFS: true,
      };
      await putFolder(endpoint, folder);
      onCreated?.(folder);
      onClose();
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  return (
    <Modal title="Neuen Ordner anlegen" onClose={onClose} dismissible={!busy}>
      <div className="space-y-4">
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          Lege einen Ordner an, den du später per Einladungs-Code mit anderen
          Geräten teilen kannst.
        </p>

        <div>
          <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1.5">
            Anzeigename
          </label>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="z.B. Footage RAW"
            className="w-full px-3 py-2 text-sm rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:border-blue-500"
          />
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
          {path && (
            <p className="text-[11px] text-neutral-500 dark:text-neutral-500 mt-1">
              Existierende Dateien werden mitgesynct sobald ein Peer dazukommt.
            </p>
          )}
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
            className="text-xs font-medium px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
          >
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            Anlegen
          </button>
        </div>
      </div>
    </Modal>
  );
}
