import { memo, useMemo, useState } from "react";
import {
  Activity,
  ChevronDown,
  ChevronRight,
  KeyRound,
  Plus,
  RefreshCw,
} from "lucide-react";
import { SyncStatusBadge, computeStatusLabel, type SyncState } from "./SyncStatusBadge";
import type {
  Connection,
  Device,
  DeviceID,
  Endpoint,
  Folder,
  FolderStatus,
  PendingFolder,
} from "../lib/syncthing";
import { useSharedFolderStatus as useFolderStatus } from "../lib/folderStatusStore";
import { useFolderConflicts } from "../lib/conflicts";

const UNTAGGED_KEY = "__untagged__";
const PENDING_KEY = "__pending__";
const LS_COLLAPSED_KEY = "syncomat.sidebar.collapsedGroups";
export const GLOBAL_ACTIVITY_KEY = "__all__";

function loadCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(LS_COLLAPSED_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}
function saveCollapsed(s: Set<string>) {
  try {
    localStorage.setItem(LS_COLLAPSED_KEY, JSON.stringify(Array.from(s)));
  } catch {
    // ignore
  }
}

export function Sidebar({
  folders,
  pending,
  tagsByFolderID,
  devices,
  connections,
  myID,
  endpoint,
  ready,
  selectedFolderId,
  onSelectFolder,
  onSelectPending,
  onScan,
  scanning,
  onAddFolder,
  onShowCode,
  onRedeemCode,
  onSelectDevice,
  pauseDates,
}: {
  folders: Folder[];
  pending: PendingFolder[];
  tagsByFolderID: Record<string, string[]>;
  devices: Device[];
  connections: Record<DeviceID, Connection>;
  myID: DeviceID | null;
  endpoint: Endpoint | null;
  ready: boolean;
  selectedFolderId: string | null;
  onSelectFolder: (folder: Folder) => void;
  onSelectPending: (pf: PendingFolder) => void;
  onScan: () => void;
  scanning: boolean;
  onAddFolder: () => void;
  onShowCode: () => void;
  onRedeemCode: () => void;
  /** Klick auf Geraet-Item öffnet Device-Detail-Modal. self device wird nicht durchgereicht. */
  onSelectDevice: (d: Device) => void;
  /** Lokale Pause-Dates pro folderId → unixMs für "Pausiert seit X" labels */
  pauseDates: Record<string, number>;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(loadCollapsed);

  const toggle = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      saveCollapsed(next);
      return next;
    });
  };

  // Folder pro Tag-Gruppe sortieren
  const groups = useMemo(() => {
    const byTag = new Map<string, Folder[]>();
    const untagged: Folder[] = [];
    for (const f of folders) {
      const tags = tagsByFolderID[f.id] ?? [];
      if (tags.length === 0) {
        untagged.push(f);
        continue;
      }
      // Brief-Entscheidung: Folder erscheint nur unter erstem Tag in der Sidebar.
      const primary = tags[0]!;
      const list = byTag.get(primary);
      if (list) list.push(f);
      else byTag.set(primary, [f]);
    }
    const tagOrder = Array.from(byTag.keys()).sort();
    return { byTag, untagged, tagOrder };
  }, [folders, tagsByFolderID]);

  const peers = devices.filter((d) => d.deviceID !== myID);

  return (
    <aside
      className="w-56 shrink-0 border-r border-neutral-200 dark:border-neutral-800 bg-neutral-100/60 dark:bg-neutral-950/40 overflow-y-auto flex flex-col"
      aria-label="Navigation"
    >
      {/* Brand + Sync */}
      <div className="px-3 py-3 border-b border-neutral-200 dark:border-neutral-800">
        <div className="flex items-center gap-2 mb-2">
          <div className="size-7 rounded-md bg-blue-600 flex items-center justify-center text-white shrink-0">
            <svg
              viewBox="0 0 24 24"
              className="size-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
              <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
              <path d="M16 16h5v5" />
            </svg>
          </div>
          <div className="text-sm font-bold text-neutral-900 dark:text-neutral-100">
            Syncomat
          </div>
        </div>
        <button
          onClick={onScan}
          disabled={!ready || scanning || folders.length === 0}
          className="w-full text-xs font-medium px-2.5 py-1.5 rounded-md border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 text-neutral-700 dark:text-neutral-200"
          title={ready ? "Alle Ordner scannen" : "Sync-Dienst startet noch…"}
        >
          <RefreshCw className={`size-3.5 ${scanning ? "animate-spin" : ""}`} />
          Jetzt syncen
        </button>
      </div>

      {/* Globale Aktivität — Quick-Access oben, vor allen Tag-Gruppen.
          Nutzt einen Pseudo-Folder mit GLOBAL_ACTIVITY_KEY als ID damit
          die existierende selectedFolderId-Logik im Parent ohne extra
          state-Sache hochreicht. */}
      <button
        onClick={() => onSelectFolder({ id: GLOBAL_ACTIVITY_KEY } as Folder)}
        aria-current={selectedFolderId === GLOBAL_ACTIVITY_KEY ? "true" : undefined}
        className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 text-[13px] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 focus-visible:outline-none ${
          selectedFolderId === GLOBAL_ACTIVITY_KEY
            ? "bg-blue-100/70 dark:bg-blue-950/60 text-blue-900 dark:text-blue-100 font-semibold border-l-2 border-blue-600"
            : "text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200/40 dark:hover:bg-neutral-800/40 border-l-2 border-transparent"
        }`}
      >
        <Activity
          className={`size-3.5 ${selectedFolderId === GLOBAL_ACTIVITY_KEY ? "text-blue-600 dark:text-blue-300" : "text-neutral-400"}`}
        />
        <span className="flex-1 text-left">Alle Ordner</span>
        <span className="text-[10px] text-neutral-400 tabular-nums">
          {folders.length}
        </span>
      </button>

      {/* Pending folders */}
      {pending.length > 0 && (
        <Group
          label="Verfügbar"
          count={pending.length}
          collapsed={collapsed.has(PENDING_KEY)}
          onToggle={() => toggle(PENDING_KEY)}
          accent="amber"
        >
          {pending.map((pf) => (
            <PendingItem key={pf.folderID} pending={pf} devices={devices} onSelect={onSelectPending} />
          ))}
        </Group>
      )}

      {/* Tag groups */}
      {groups.tagOrder.map((tag) => (
        <Group
          key={tag}
          label={`#${tag}`}
          count={groups.byTag.get(tag)!.length}
          collapsed={collapsed.has(tag)}
          onToggle={() => toggle(tag)}
        >
          {groups.byTag.get(tag)!.map((f) => (
            <FolderItem
              key={f.id}
              folder={f}
              endpoint={endpoint}
              ready={ready}
              devices={devices}
              connections={connections}
              myID={myID}
              selected={selectedFolderId === f.id}
              onSelect={onSelectFolder}
              pausedSince={pauseDates[f.id]}
            />
          ))}
        </Group>
      ))}

      {/* Untagged */}
      {groups.untagged.length > 0 && (
        <Group
          label="Ohne Tag"
          count={groups.untagged.length}
          collapsed={collapsed.has(UNTAGGED_KEY)}
          onToggle={() => toggle(UNTAGGED_KEY)}
        >
          {groups.untagged.map((f) => (
            <FolderItem
              key={f.id}
              folder={f}
              endpoint={endpoint}
              ready={ready}
              devices={devices}
              connections={connections}
              myID={myID}
              selected={selectedFolderId === f.id}
              onSelect={onSelectFolder}
              pausedSince={pauseDates[f.id]}
            />
          ))}
        </Group>
      )}

      {/* + Ordner */}
      <div className="px-1.5 py-2 border-t border-neutral-200 dark:border-neutral-800">
        <button
          onClick={onAddFolder}
          className="w-full text-left px-2 py-1.5 rounded-md hover:bg-neutral-200/60 dark:hover:bg-neutral-800/60 text-blue-600 dark:text-blue-400 flex items-center gap-1.5 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
        >
          <Plus className="size-3.5" />
          <span className="text-[13px] font-medium">Ordner</span>
        </button>
      </div>

      {/* Devices — Header mit Icon-Actions (Gerät einladen + Code einlösen) */}
      <div className="px-3 pt-3 pb-1 border-t border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-neutral-400 dark:text-neutral-500 font-semibold">
          Geräte
        </span>
        <div className="flex items-center gap-0.5 -mr-1">
          <button
            onClick={onShowCode}
            title="Gerät einladen — Code erzeugen"
            aria-label="Gerät einladen"
            className="size-6 rounded-md flex items-center justify-center text-neutral-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-neutral-200/60 dark:hover:bg-neutral-800/60 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
          >
            <Plus className="size-4" />
          </button>
          <button
            onClick={onRedeemCode}
            title="Code einlösen"
            aria-label="Code einlösen"
            className="size-6 rounded-md flex items-center justify-center text-neutral-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-neutral-200/60 dark:hover:bg-neutral-800/60 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
          >
            <KeyRound className="size-3.5" />
          </button>
        </div>
      </div>
      <div className="px-1.5 pb-2 space-y-0.5">
        {myID && (
          <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-md">
            <SyncStatusBadge state="synced" size="md" />
            <span className="text-[13px] font-medium flex-1 text-neutral-900 dark:text-neutral-100 truncate">
              {devices.find((d) => d.deviceID === myID)?.name || myID.slice(0, 7)}
            </span>
            <span className="text-[10px] text-neutral-500 dark:text-neutral-500">
              lokal
            </span>
          </div>
        )}
        {peers.map((p) => {
          const conn = connections[p.deviceID];
          const online = !!conn?.connected;
          return (
            <button
              key={p.deviceID}
              onClick={() => onSelectDevice(p)}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-neutral-200/60 dark:hover:bg-neutral-800/60 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none text-left"
              title={`${p.name || p.deviceID.slice(0, 7)} — Details ansehen`}
            >
              <SyncStatusBadge state={online ? "synced" : "waiting-peer"} size="md" />
              <span
                className={`text-[13px] flex-1 truncate ${online ? "font-medium text-neutral-900 dark:text-neutral-100" : "text-neutral-500"}`}
              >
                {p.name || p.deviceID.slice(0, 7)}
              </span>
              <span className="text-[10px] text-neutral-500 dark:text-neutral-500">
                {online ? "online" : "offline"}
              </span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

function Group({
  label,
  count,
  collapsed,
  onToggle,
  accent,
  children,
}: {
  label: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  accent?: "amber";
  children: React.ReactNode;
}) {
  const accentCls =
    accent === "amber"
      ? "text-amber-700 dark:text-amber-300"
      : "text-neutral-500 dark:text-neutral-400";
  return (
    <div className="border-t border-neutral-200 dark:border-neutral-800 first:border-t-0">
      <button
        onClick={onToggle}
        className="w-full px-3 py-1.5 flex items-center gap-1.5 hover:bg-neutral-200/40 dark:hover:bg-neutral-800/40 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none focus-visible:ring-inset"
      >
        {collapsed ? (
          <ChevronRight className="size-3 text-neutral-400 dark:text-neutral-500" />
        ) : (
          <ChevronDown className="size-3 text-neutral-400 dark:text-neutral-500" />
        )}
        <span className={`text-[10px] font-bold tracking-wide truncate ${accentCls}`}>
          {label}
        </span>
        <span className="text-[10px] text-neutral-400 dark:text-neutral-500 ml-auto tabular-nums">
          {count}
        </span>
      </button>
      {!collapsed && <div className="px-1.5 pb-2 space-y-0.5">{children}</div>}
    </div>
  );
}

// React.memo: Sidebar rendert sich bei jedem Aggregate-Tick (ItemFinished-Burst
// während Big-Syncs) neu. Ohne memo würden alle FolderItem-Renders durchlaufen
// — auch wenn nur das eine geänderte Folder einen neuen Status hat. Mit memo
// rendert nur das Item das wirklich neue Daten sieht (über useFolderStatus-
// Subscriber). Bei 5+ Folders messbarer Frame-Time-Gewinn.
const FolderItem = memo(function FolderItem({
  folder,
  endpoint,
  ready,
  devices,
  connections,
  myID,
  selected,
  onSelect,
  pausedSince,
}: {
  folder: Folder;
  endpoint: Endpoint | null;
  ready: boolean;
  devices: Device[];
  connections: Record<DeviceID, Connection>;
  myID: DeviceID | null;
  selected: boolean;
  onSelect: (f: Folder) => void;
  pausedSince?: number;
}) {
  const { data: status } = useFolderStatus(endpoint, ready, folder.id);
  const { count: conflictCount } = useFolderConflicts(folder.path);
  const others = folder.devices.map((d) => d.deviceID).filter((id) => id !== myID);
  const peerOnline = others.some((id) => connections[id]?.connected);
  const state = deriveSyncState(folder, status, peerOnline, others.length, conflictCount);
  // Erstes offline-peer für "Wartet auf X" Label
  const offlinePeerName = (() => {
    const first = others.find((id) => !connections[id]?.connected);
    if (!first) return undefined;
    const d = devices.find((x) => x.deviceID === first);
    return d?.name || first.slice(0, 7);
  })();
  const tooltip = computeStatusLabel(state, {
    peerName: offlinePeerName,
    needBytes: status?.needBytes,
    globalBytes: status?.globalBytes,
    conflictCount,
    errorCount: (status?.errors ?? 0) + (status?.pullErrors ?? 0),
    pausedSince,
  });

  return (
    <button
      onClick={() => onSelect(folder)}
      aria-current={selected ? "true" : undefined}
      title={tooltip}
      className={`w-full text-left px-2.5 py-2 rounded-md flex items-center gap-2 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none ${
        selected
          ? "bg-blue-100/70 dark:bg-blue-950/60 ring-1 ring-inset ring-blue-200 dark:ring-blue-500/30"
          : "hover:bg-neutral-200/60 dark:hover:bg-neutral-800/60"
      }`}
    >
      <SyncStatusBadge state={state} label={tooltip} size="md" />
      <span
        className={`text-[13px] truncate flex-1 ${selected ? "font-semibold text-blue-900 dark:text-blue-100" : folder.paused ? "text-neutral-500" : "font-medium text-neutral-900 dark:text-neutral-100"}`}
      >
        {folder.label || folder.id}
      </span>
      {conflictCount > 0 && (
        <span className="text-[10px] px-1 rounded bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 font-semibold tabular-nums shrink-0">
          {conflictCount}
        </span>
      )}
    </button>
  );
});

function PendingItem({
  pending,
  devices,
  onSelect,
}: {
  pending: PendingFolder;
  devices: Device[];
  onSelect: (pf: PendingFolder) => void;
}) {
  const offer = Object.values(pending.offeredBy)[0];
  const label = offer?.label || pending.folderID;
  const offererId = Object.keys(pending.offeredBy)[0]!;
  const offerer = devices.find((d) => d.deviceID === offererId);
  return (
    <button
      onClick={() => onSelect(pending)}
      className="w-full text-left px-2 py-1.5 rounded-md hover:bg-amber-100/40 dark:hover:bg-amber-900/20 flex items-center gap-1.5 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
    >
      <SyncStatusBadge state="waiting-data" size="md" />
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium text-amber-900 dark:text-amber-200 truncate">
          {label}
        </div>
        <div className="text-[10px] text-amber-700/80 dark:text-amber-400/80 truncate">
          von {offerer?.name || offererId.slice(0, 7)}
        </div>
      </div>
    </button>
  );
}

function deriveSyncState(
  folder: Folder,
  status: FolderStatus | null,
  peerOnline: boolean,
  peersConfigured: number,
  conflictCount: number,
): SyncState {
  if (folder.paused) return "paused";
  if (status && (status.errors > 0 || status.pullErrors > 0)) return "error";
  if (conflictCount > 0) return "conflicts";
  if (peersConfigured === 0) return "local-only";
  if (status?.state === "syncing") return "syncing";
  if (status?.state === "scanning") return "scanning";
  if (status && status.needBytes > 0) {
    return peerOnline ? "waiting-data" : "waiting-peer";
  }
  if (!peerOnline) return "waiting-peer";
  return "synced";
}
