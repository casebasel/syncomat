import { useState } from "react";
import { Check, Folder as FolderIcon, Pause, Pencil, Play } from "lucide-react";
import {
  useFolderStatus,
  type Connection,
  type Device,
  type DeviceID,
  type Endpoint,
  type Folder,
  type FolderStatus,
  type PendingFolder,
} from "../lib/syncthing";

function shortDevice(id: DeviceID, devices: Device[]): string {
  const d = devices.find((x) => x.deviceID === id);
  if (d?.name) return d.name;
  return id.slice(0, 7);
}

function syncStateLabel(s: FolderStatus | null): string {
  if (!s) return "lädt";
  if (s.errors > 0 || s.pullErrors > 0) return "Fehler";
  if (s.state === "syncing") return "synct";
  if (s.state === "scanning") return "scannt";
  if (s.state === "idle") return s.needBytes > 0 ? "wartet" : "synct";
  return s.state;
}

function syncStateTone(s: FolderStatus | null): "ok" | "wait" | "off" {
  if (!s) return "wait";
  if (s.errors > 0 || s.pullErrors > 0) return "off";
  if (s.needBytes > 0) return "wait";
  return "ok";
}

export function LinkedFolderCard({
  folder,
  endpoint,
  ready,
  devices,
  connections,
  myID,
  onPauseToggle,
  onRename,
}: {
  folder: Folder;
  endpoint: Endpoint | null;
  ready: boolean;
  devices: Device[];
  connections: Record<DeviceID, Connection>;
  myID: DeviceID | null;
  onPauseToggle: (f: Folder) => void;
  onRename: (f: Folder, newLabel: string) => void;
}) {
  const { data: status } = useFolderStatus(endpoint, ready, folder.id);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(folder.label || folder.id);
  const tone = folder.paused ? "off" : syncStateTone(status);

  const others = folder.devices
    .map((d) => d.deviceID)
    .filter((id) => id !== myID);
  const sourceName =
    others.length === 0
      ? "nur lokal"
      : shortDevice(others[0]!, devices) +
        (others.length > 1 ? ` +${others.length - 1}` : "");

  const meta = folder.paused
    ? `${sourceName} · pausiert`
    : `${sourceName} · ${syncStateLabel(status)}`;

  const commitRename = () => {
    setEditing(false);
    const next = draft.trim();
    if (next && next !== (folder.label || folder.id)) {
      onRename(folder, next);
    } else {
      setDraft(folder.label || folder.id);
    }
  };

  const peerOnline = others.some((id) => connections[id]?.connected);

  return (
    <div className="flex items-center gap-3 px-3 py-3 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50/60 dark:bg-neutral-900">
      <div className="size-9 rounded-lg bg-neutral-200/70 dark:bg-neutral-800 flex items-center justify-center text-neutral-500 dark:text-neutral-400 shrink-0">
        <FolderIcon className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {editing ? (
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
                if (e.key === "Escape") {
                  setDraft(folder.label || folder.id);
                  setEditing(false);
                }
              }}
              className="text-sm font-semibold bg-transparent border-b border-neutral-400 dark:border-neutral-600 outline-none focus:border-blue-500 px-0 py-0 min-w-0 flex-1 text-neutral-900 dark:text-neutral-100"
            />
          ) : (
            <>
              <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 truncate">
                {folder.label || folder.id}
              </span>
              <button
                onClick={() => setEditing(true)}
                title="Umbenennen"
                className="text-neutral-400 dark:text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-200 shrink-0"
              >
                <Pencil className="size-3" />
              </button>
            </>
          )}
        </div>
        <p
          className={`text-xs ${
            tone === "off"
              ? "text-rose-500 dark:text-rose-400"
              : "text-neutral-500 dark:text-neutral-400"
          }`}
        >
          {meta}
        </p>
      </div>
      <button
        onClick={() => onPauseToggle(folder)}
        title={folder.paused ? "Fortsetzen" : "Pausieren"}
        className="p-1.5 rounded-md text-neutral-400 dark:text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-neutral-200/60 dark:hover:bg-neutral-800 shrink-0"
      >
        {folder.paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
      </button>
      {!folder.paused && tone === "ok" && peerOnline && (
        <Check className="size-4 text-emerald-500 shrink-0" />
      )}
    </div>
  );
}

export function PendingFolderCard({
  pending,
  devices,
  onLink,
}: {
  pending: PendingFolder;
  devices: Device[];
  onLink: (pf: PendingFolder) => void;
}) {
  const offerers = Object.keys(pending.offeredBy);
  const first = offerers[0]!;
  const offer = pending.offeredBy[first];
  const sourceName = shortDevice(first, devices);
  const label = offer?.label || pending.folderID;

  return (
    <div className="flex items-center gap-3 px-3 py-3 rounded-xl border border-dashed border-neutral-300 dark:border-neutral-700">
      <div className="size-9 rounded-lg bg-neutral-200/70 dark:bg-neutral-800 flex items-center justify-center text-neutral-500 dark:text-neutral-400 shrink-0">
        <FolderIcon className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 truncate">
          {label}
        </div>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          {sourceName} · verfügbar
        </p>
      </div>
      <button
        onClick={() => onLink(pending)}
        className="text-xs font-medium px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 shrink-0"
      >
        Verknüpfen
      </button>
    </div>
  );
}
