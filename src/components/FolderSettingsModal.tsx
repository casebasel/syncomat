import { useEffect, useState } from "react";
import { AlertTriangle, EyeOff, Loader2, Trash2, XCircle } from "lucide-react";
import { Modal } from "./Modal";
import {
  applyFolderDefaults,
  folderSettingsRead,
  folderSettingsWrite,
  DEFAULT_FOLDER_DEFAULTS,
  type FolderDefaults,
} from "../lib/folderSettings";
import { deleteFolder, type Endpoint, type Folder } from "../lib/syncthing";
import { ignoredFoldersAdd } from "../lib/ignored";

export function FolderSettingsModal({
  endpoint,
  folder,
  myDeviceId,
  onClose,
  onRemoved,
}: {
  endpoint: Endpoint;
  folder: Folder;
  myDeviceId: string;
  onClose: () => void;
  onRemoved?: () => void;
}) {
  const [defaults, setDefaults] = useState<FolderDefaults>(DEFAULT_FOLDER_DEFAULTS);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ updatedAt: number; updatedBy: string } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [clusterWide, setClusterWide] = useState(false);

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

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      // Optional: cluster-wide delete signal — schreibt deletion_requested in
      // die .syncomat/folder-defaults.json. Andere Geräte sehen das beim
      // nächsten Replication-Check und bekommen einen Confirm-Banner.
      // WICHTIG: vor dem lokalen Delete-Folder, weil danach der Pfad nicht
      // mehr in der Syncthing-Config ist (file wird trotzdem auf Disk sein).
      if (clusterWide) {
        try {
          await folderSettingsWrite(folder.path, myDeviceId, {
            ...defaults,
            deletion_requested: true,
            deletion_requested_by: myDeviceId,
          });
          // Kurz warten damit Syncthing den geänderten File registriert
          // und an Peers propagiert. 1s ist genug für File-System-Watcher.
          await new Promise((r) => setTimeout(r, 1000));
        } catch (e) {
          console.warn("[folder-settings] cluster-delete-signal failed", e);
          // Trotzdem mit lokalem Delete fortfahren — User-Intent ist klar.
        }
      }
      // Lokal aus Syncthing entfernen — Files bleiben auf Disk.
      await deleteFolder(endpoint, folder.id);
      // Folder-ID merken damit er nicht direkt als Pending wieder erscheint.
      await ignoredFoldersAdd(folder.id, folder.label || folder.id);
      onRemoved?.();
      onClose();
    } catch (e) {
      setError(String(e));
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

        {/* Danger Zone */}
        {!confirmRemove ? (
          <details className="mt-3 pt-3 border-t border-neutral-200 dark:border-neutral-800">
            <summary className="cursor-pointer text-xs text-rose-600 dark:text-rose-400 select-none hover:underline">
              Ordner-Verknüpfung entfernen
            </summary>
            <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-2 leading-relaxed">
              Stoppt das Syncen auf diesem Gerät. Die Datei-Inhalte unter{" "}
              <code className="font-mono text-[10px]">{folder.path}</code> bleiben
              auf der Platte — nichts wird gelöscht.
            </p>
            <button
              onClick={() => setConfirmRemove(true)}
              className="mt-3 text-xs font-medium px-3 py-1.5 rounded-lg border border-rose-300 dark:border-rose-500/40 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/30 flex items-center gap-1.5"
            >
              <XCircle className="size-3.5" />
              Verknüpfung entfernen…
            </button>
          </details>
        ) : (
          <div className="mt-3 pt-3 border-t border-rose-300 dark:border-rose-500/40 space-y-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="size-4 text-rose-500 dark:text-rose-400 shrink-0 mt-0.5" />
              <div className="text-xs text-neutral-700 dark:text-neutral-300 leading-relaxed">
                <p className="font-medium text-rose-700 dark:text-rose-300 mb-1">
                  Ordner-Verknüpfung wirklich entfernen?
                </p>
                <ul className="space-y-1 text-[11px] text-neutral-600 dark:text-neutral-400">
                  <li>
                    ✓ Datei-Inhalte unter{" "}
                    <code className="font-mono text-[10px]">{folder.path}</code>{" "}
                    bleiben auf der Platte.
                  </li>
                  <li>
                    ✓ Andere Geräte machen weiter wie bisher.
                  </li>
                  <li>
                    ✓ Dieser Ordner taucht nicht mehr als „Verfügbar" auf —
                    Re-Enable über Einstellungen → Ignorierte Ordner.
                  </li>
                </ul>
              </div>
            </div>
            <label className="flex items-start gap-2 cursor-pointer select-none px-3 py-2 rounded-lg bg-rose-50/60 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-500/30">
              <input
                type="checkbox"
                checked={clusterWide}
                onChange={(e) => setClusterWide(e.target.checked)}
                className="mt-0.5 accent-rose-600"
              />
              <div className="text-[11px] text-neutral-700 dark:text-neutral-300">
                <span className="font-medium text-rose-700 dark:text-rose-400">
                  Auch auf allen anderen Geräten vorschlagen
                </span>
                <p className="text-neutral-500 dark:text-neutral-400 mt-0.5">
                  Markiert den Ordner Cluster-weit. Andere Syncomat-Instanzen
                  sehen einen Banner „auch hier entfernen?" — die User entscheiden
                  pro Gerät selbst.
                </p>
              </div>
            </label>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setConfirmRemove(false);
                  setClusterWide(false);
                }}
                disabled={busy}
                className="text-xs font-medium px-3 py-1.5 rounded-lg text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              >
                Doch nicht
              </button>
              <button
                onClick={remove}
                disabled={busy}
                className="text-xs font-medium px-3 py-1.5 rounded-lg bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50 flex items-center gap-1.5"
              >
                {busy ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Trash2 className="size-3.5" />
                )}
                {clusterWide ? "Überall entfernen" : "Hier entfernen"}
              </button>
            </div>
          </div>
        )}
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
