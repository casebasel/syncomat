import { useEffect, useState } from "react";
import { EyeOff, Loader2, Trash2 } from "lucide-react";
import { Modal } from "./Modal";
import {
  applyFolderDefaults,
  folderSettingsRead,
  folderSettingsWrite,
  DEFAULT_FOLDER_DEFAULTS,
  type FolderDefaults,
} from "../lib/folderSettings";
import type { Endpoint, Folder } from "../lib/syncthing";

export function FolderSettingsModal({
  endpoint,
  folder,
  myDeviceId,
  onClose,
}: {
  endpoint: Endpoint;
  folder: Folder;
  myDeviceId: string;
  onClose: () => void;
}) {
  const [defaults, setDefaults] = useState<FolderDefaults>(DEFAULT_FOLDER_DEFAULTS);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ updatedAt: number; updatedBy: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    folderSettingsRead(folder.path)
      .then((file) => {
        if (cancelled) return;
        if (file) {
          setDefaults(file.settings);
          setMeta({ updatedAt: file.updated_at, updatedBy: file.updated_by });
        }
        setLoaded(true);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(String(e));
          setLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [folder.path]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      // 1. Write the shared defaults file (replicated via Syncthing)
      await folderSettingsWrite(folder.path, myDeviceId, defaults);
      // 2. Apply to local Syncthing config immediately
      await applyFolderDefaults(endpoint, folder, defaults);
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!loaded) {
    return (
      <Modal title={`Einstellungen — ${folder.label}`} onClose={onClose}>
        <div className="flex items-center gap-2 text-sm text-neutral-500 dark:text-neutral-400">
          <Loader2 className="size-4 animate-spin" />
          Lade…
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title={`Einstellungen — ${folder.label}`}
      onClose={onClose}
      dismissible={!busy}
    >
      <div className="space-y-4">
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          Diese Einstellungen werden über alle Geräte synchronisiert (via versteckter
          Datei <code className="font-mono text-[10px]">.syncomat/folder-defaults.json</code> im Ordner).
        </p>

        <ToggleRow
          icon={<EyeOff className="size-4" />}
          title="Versteckte Dateien ignorieren"
          sub="Dateien die mit Punkt beginnen (.DS_Store, .git/…), Thumbs.db, desktop.ini"
          checked={defaults.ignore_hidden}
          onChange={(v) => setDefaults({ ...defaults, ignore_hidden: v })}
        />

        <ToggleRow
          icon={<Trash2 className="size-4" />}
          title="Papierkorb für gelöschte Dateien"
          sub="Gelöschte Versionen behalten — auf jedem Gerät in .stversions/"
          checked={defaults.trashcan}
          onChange={(v) => setDefaults({ ...defaults, trashcan: v })}
        />

        {defaults.trashcan && (
          <div className="pl-9">
            <label className="block text-xs text-neutral-600 dark:text-neutral-400 mb-1">
              Aufbewahrung (Tage, 0 = unbegrenzt)
            </label>
            <input
              type="number"
              min={0}
              max={3650}
              value={defaults.trashcan_cleanout_days}
              onChange={(e) =>
                setDefaults({
                  ...defaults,
                  trashcan_cleanout_days: Math.max(
                    0,
                    Math.min(3650, parseInt(e.target.value || "0", 10)),
                  ),
                })
              }
              className="w-24 px-2 py-1 text-sm rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:border-blue-500"
            />
          </div>
        )}

        {meta && (
          <p className="text-[11px] text-neutral-400 dark:text-neutral-500 pt-2 border-t border-neutral-200 dark:border-neutral-800">
            Zuletzt geändert von <span className="font-mono">{meta.updatedBy.slice(0, 7)}</span>
            {" · "}
            {fmtTime(meta.updatedAt)}
          </p>
        )}

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
            onClick={save}
            disabled={busy}
            className="text-xs font-medium px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5"
          >
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            Speichern
          </button>
        </div>
      </div>
    </Modal>
  );
}

function ToggleRow({
  icon,
  title,
  sub,
  checked,
  onChange,
}: {
  icon: React.ReactNode;
  title: string;
  sub: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3 cursor-pointer select-none">
      <div className="size-9 rounded-lg bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center text-neutral-500 dark:text-neutral-400 shrink-0">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
          {title}
        </div>
        <p className="text-[11px] text-neutral-500 dark:text-neutral-400">{sub}</p>
      </div>
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`shrink-0 mt-1 relative w-9 h-5 rounded-full transition-colors ${
          checked ? "bg-blue-600" : "bg-neutral-300 dark:bg-neutral-700"
        }`}
      >
        <span
          className={`absolute top-0.5 size-4 rounded-full bg-white transition-transform ${
            checked ? "translate-x-4" : "translate-x-0.5"
          }`}
        />
      </button>
    </label>
  );
}

function fmtTime(unix: number): string {
  return new Date(unix * 1000).toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
