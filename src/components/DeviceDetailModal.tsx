import { useState } from "react";
import { Check, Copy, ExternalLink, Pencil, Trash2, X } from "lucide-react";
import { PanelShell } from "./PanelShell";
import { SyncStatusBadge } from "./SyncStatusBadge";
import {
  deleteDevice,
  patchDevice,
  type Connection,
  type Device,
  type DeviceID,
  type Endpoint,
  type Folder,
} from "../lib/syncthing";

export function DeviceDetailModal({
  device,
  endpoint,
  connection,
  folders,
  onClose,
  onRemoved,
  onSelectFolder,
}: {
  device: Device;
  endpoint: Endpoint;
  connection: Connection | undefined;
  /** Alle Folders — wir filtern nach welche mit diesem Gerät geteilt sind */
  folders: Folder[];
  onClose: () => void;
  /** Wird nach erfolgreichem Entfernen aufgerufen */
  onRemoved: () => void;
  /** Klick auf einen geteilten Folder → wechselt in den Inspector dazu */
  onSelectFolder: (f: Folder) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(device.name);
  const [copied, setCopied] = useState(false);

  const online = !!connection?.connected;
  const sharedFolders = folders.filter((f) =>
    f.devices.some((d) => d.deviceID === device.deviceID),
  );

  const copyID = async () => {
    try {
      await navigator.clipboard.writeText(device.deviceID);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      console.warn("clipboard write failed", e);
    }
  };

  const commitRename = async () => {
    if (busy) return;
    const next = name.trim();
    setEditing(false);
    if (!next || next === device.name) {
      setName(device.name);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await patchDevice(endpoint, device.deviceID, { name: next });
    } catch (e) {
      setError(String(e));
      setName(device.name);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await deleteDevice(endpoint, device.deviceID);
      // Plus: Gerät aus allen Folder.devices entfernen (sonst bleibt's
      // semantisch in den Folder-Configs drinnen + Auto-Share-Reconciliation
      // würde es beim nächsten Tick wieder hinzufügen wenn jemand das Gerät
      // re-pair-en würde).
      onRemoved();
      onClose();
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  return (
    <PanelShell
      title={device.name || device.deviceID.slice(0, 7)}
      onBack={onClose}
      dismissible={!busy && !confirmRemove}
    >
      <div className="space-y-4">
        {/* Connection-Header */}
        <div className="flex items-center gap-2.5">
          <SyncStatusBadge
            state={online ? "synced" : "waiting-peer"}
            variant="pill"
            size="sm"
          />
          {connection && online && (
            <span className="text-[11px] text-neutral-500 dark:text-neutral-400">
              {formatTransfer(connection)}
            </span>
          )}
        </div>

        {/* Name */}
        <section>
          <div className="text-[10px] uppercase tracking-wider text-neutral-400 dark:text-neutral-500 font-semibold mb-1">
            Name
          </div>
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50/40 dark:bg-neutral-900/40">
            {editing ? (
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename();
                  if (e.key === "Escape") {
                    setName(device.name);
                    setEditing(false);
                  }
                }}
                className="text-sm flex-1 bg-transparent outline-none border-b border-neutral-400 dark:border-neutral-600 focus:border-blue-500 text-neutral-900 dark:text-neutral-100"
              />
            ) : (
              <>
                <span className="text-sm flex-1 text-neutral-900 dark:text-neutral-100 truncate">
                  {device.name || device.deviceID.slice(0, 7)}
                </span>
                <button
                  onClick={() => setEditing(true)}
                  className="text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100"
                  title="Umbenennen"
                >
                  <Pencil className="size-3.5" />
                </button>
              </>
            )}
          </div>
        </section>

        {/* Device-ID */}
        <section>
          <div className="text-[10px] uppercase tracking-wider text-neutral-400 dark:text-neutral-500 font-semibold mb-1">
            Geräte-ID
          </div>
          <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50/40 dark:bg-neutral-900/40 px-3 py-2.5">
            <div className="flex items-start gap-2">
              <span className="font-mono text-[11px] text-neutral-700 dark:text-neutral-200 break-all flex-1">
                {device.deviceID}
              </span>
              <button
                onClick={copyID}
                className="shrink-0 p-1 rounded-md text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-neutral-200/60 dark:hover:bg-neutral-800"
                title="Kopieren"
              >
                {copied ? (
                  <Check className="size-3.5 text-emerald-500" />
                ) : (
                  <Copy className="size-3.5" />
                )}
              </button>
            </div>
          </div>
        </section>

        {/* Verbindung */}
        {connection && online && (
          <section>
            <div className="text-[10px] uppercase tracking-wider text-neutral-400 dark:text-neutral-500 font-semibold mb-1">
              Verbindung
            </div>
            <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50/40 dark:bg-neutral-900/40 text-[11px] divide-y divide-neutral-200 dark:divide-neutral-800">
              <Row label="Adresse" value={connection.address || "—"} mono />
              <Row
                label="Eingehend"
                value={`${fmtBytes(connection.inBytesTotal ?? 0)} insgesamt`}
              />
              <Row
                label="Ausgehend"
                value={`${fmtBytes(connection.outBytesTotal ?? 0)} insgesamt`}
              />
              {connection.clientVersion && (
                <Row
                  label="Client-Version"
                  value={connection.clientVersion}
                  mono
                />
              )}
            </div>
          </section>
        )}

        {/* Geteilte Ordner */}
        <section>
          <div className="text-[10px] uppercase tracking-wider text-neutral-400 dark:text-neutral-500 font-semibold mb-1">
            Geteilte Ordner ({sharedFolders.length})
          </div>
          {sharedFolders.length === 0 ? (
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Keine Ordner mit diesem Gerät geteilt.
            </p>
          ) : (
            <div className="space-y-1">
              {sharedFolders.map((f) => (
                <button
                  key={f.id}
                  onClick={() => {
                    onSelectFolder(f);
                    onClose();
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50/40 dark:bg-neutral-900/40 hover:bg-neutral-100 dark:hover:bg-neutral-800/60 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none text-left"
                >
                  <span className="text-xs font-medium flex-1 text-neutral-900 dark:text-neutral-100 truncate">
                    {f.label || f.id}
                  </span>
                  <ExternalLink className="size-3 text-neutral-400 dark:text-neutral-500 shrink-0" />
                </button>
              ))}
            </div>
          )}
        </section>

        {error && (
          <p className="text-xs text-rose-500 dark:text-rose-400 break-words">
            {error}
          </p>
        )}

        {/* Danger Zone */}
        {!confirmRemove ? (
          <details className="pt-2 border-t border-neutral-200 dark:border-neutral-800">
            <summary className="cursor-pointer text-xs text-rose-600 dark:text-rose-400 select-none hover:underline">
              Gerät entfernen
            </summary>
            <div className="mt-2 space-y-2">
              <p className="text-[11px] text-neutral-500 dark:text-neutral-400 leading-relaxed">
                Das Gerät wird aus Syncomat entfernt. Es kann sich nicht mehr
                verbinden bis ein neuer Einladungs-Code eingelöst wird.
                Datei-Inhalte bleiben auf beiden Geräten lokal.
              </p>
              <button
                onClick={() => setConfirmRemove(true)}
                className="text-xs font-medium px-3 py-1.5 rounded-lg border border-rose-300 dark:border-rose-500/40 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/30 flex items-center gap-1.5"
              >
                <X className="size-3.5" />
                Gerät entfernen…
              </button>
            </div>
          </details>
        ) : (
          <div className="pt-2 border-t border-rose-300 dark:border-rose-500/40 space-y-2">
            <p className="text-xs font-medium text-rose-700 dark:text-rose-300">
              „{device.name || device.deviceID.slice(0, 7)}" wirklich entfernen?
            </p>
            <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
              Sync zu diesem Gerät stoppt sofort. Datei-Inhalte bleiben auf
              beiden Geräten unverändert.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmRemove(false)}
                disabled={busy}
                className="text-xs px-3 py-1.5 rounded-lg text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              >
                Abbrechen
              </button>
              <button
                onClick={remove}
                disabled={busy}
                className="text-xs font-medium px-3 py-1.5 rounded-lg bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50 flex items-center gap-1.5"
              >
                <Trash2 className="size-3.5" />
                Entfernen
              </button>
            </div>
          </div>
        )}
      </div>
    </PanelShell>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start gap-3 px-3 py-2">
      <span className="text-neutral-500 dark:text-neutral-500 shrink-0">
        {label}
      </span>
      <span
        className={`text-right flex-1 break-all ${mono ? "font-mono text-[10px]" : ""} text-neutral-700 dark:text-neutral-200`}
      >
        {value}
      </span>
    </div>
  );
}

function formatTransfer(c: Connection): string {
  const inBps = c.inBytesTotal ?? 0;
  const outBps = c.outBytesTotal ?? 0;
  return `↑${fmtBytes(outBps)} ↓${fmtBytes(inBps)} total`;
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

// Re-export für convenience
export type { DeviceID };
