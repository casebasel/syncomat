import { useState } from "react";
import {
  AlertOctagon,
  ExternalLink,
  FolderOpen,
  Pause,
  Play,
  Settings,
} from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { invoke } from "@tauri-apps/api/core";

// Plattform-abhängiger Name des Dateimanagers für Tooltips.
const FILE_MANAGER =
  typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent)
    ? "Finder"
    : typeof navigator !== "undefined" && /Win/i.test(navigator.userAgent)
      ? "Explorer"
      : "Dateimanager";
import { SyncStatusBadge, computeStatusLabel, type SyncState } from "./SyncStatusBadge";
import { TagChip } from "./TagChip";
import { ActivityFeed } from "./ActivityFeed";
import type {
  Connection,
  Device,
  DeviceID,
  Endpoint,
  Folder,
  FolderStatus,
} from "../lib/syncthing";
import { useSharedFolderStatus as useFolderStatus } from "../lib/folderStatusStore";
import { useFolderConflicts } from "../lib/conflicts";

export function FolderInspector({
  folder,
  endpoint,
  ready,
  devices,
  connections,
  myID,
  tags,
  pausedSince,
  onPauseToggle,
  onShowSettings,
  onShowConflicts,
  onShowErrors,
}: {
  folder: Folder;
  endpoint: Endpoint | null;
  ready: boolean;
  devices: Device[];
  connections: Record<DeviceID, Connection>;
  myID: DeviceID | null;
  tags: string[];
  pausedSince?: number;
  onPauseToggle: (f: Folder) => void;
  onShowSettings: (f: Folder) => void;
  onShowConflicts: (f: Folder) => void;
  onShowErrors: (f: Folder) => void;
}) {
  const { data: status } = useFolderStatus(endpoint, ready, folder.id);
  const { count: conflictCount } = useFolderConflicts(folder.path);
  const others = folder.devices.map((d) => d.deviceID).filter((id) => id !== myID);
  const peerOnline = others.some((id) => connections[id]?.connected);
  const state = deriveSyncState(folder, status, peerOnline, others.length, conflictCount);
  const [copied, setCopied] = useState(false);

  const errorCount = (status?.errors ?? 0) + (status?.pullErrors ?? 0);
  // Erstes offline-peer für "Wartet auf X" Label
  const offlinePeerName = (() => {
    const first = others.find((id) => !connections[id]?.connected);
    if (!first) return undefined;
    const d = devices.find((x) => x.deviceID === first);
    return d?.name || first.slice(0, 7);
  })();
  const statusLabel = computeStatusLabel(state, {
    peerName: offlinePeerName,
    needBytes: status?.needBytes,
    globalBytes: status?.globalBytes,
    conflictCount,
    errorCount,
    pausedSince,
  });

  return (
    <section className="flex-1 flex flex-col overflow-hidden bg-white dark:bg-neutral-900">
      {/* Header — luftiger (Native-Redesign Welle 1) */}
      <header className="px-7 py-5 border-b border-neutral-200/70 dark:border-neutral-800/70 flex items-start gap-4">
        <div className="size-11 rounded-xl bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center text-neutral-400 dark:text-neutral-400 shrink-0">
          <FolderOpen className="size-[22px]" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1
              className="text-[21px] font-bold tracking-tight text-neutral-900 dark:text-neutral-100 truncate"
              style={{ textWrap: "balance" } as React.CSSProperties}
            >
              {folder.label || folder.id}
            </h1>
            {tags.map((t) => (
              <TagChip key={t} tag={t} size="sm" />
            ))}
          </div>
          <div className="flex items-center gap-2.5 mt-2 flex-wrap">
            <SyncStatusBadge state={state} label={statusLabel} variant="pill" size="sm" />
            <span className="text-[13px] text-neutral-500 dark:text-neutral-400">
              {fmtMeta(folder, status, others.length, peerOnline)}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() =>
              invoke("reveal_in_file_manager", { path: folder.path }).catch(
                (e) => console.warn("reveal failed", e),
              )
            }
            title={`Im ${FILE_MANAGER} öffnen`}
            className="p-1.5 rounded-md hover:bg-neutral-200 dark:hover:bg-neutral-800 text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
          >
            <FolderOpen className="size-4" />
          </button>
          <button
            onClick={() => onPauseToggle(folder)}
            title={folder.paused ? "Fortsetzen" : "Pausieren"}
            className="p-1.5 rounded-md hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
          >
            {folder.paused ? <Play className="size-4" /> : <Pause className="size-4" />}
          </button>
          <button
            onClick={() => onShowSettings(folder)}
            title="Einstellungen"
            className="p-1.5 rounded-md hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
          >
            <Settings className="size-4" />
          </button>
        </div>
      </header>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-7 py-6 space-y-7">
        {/* Konflikt-Banner (priority) */}
        {conflictCount > 0 && (
          <button
            onClick={() => onShowConflicts(folder)}
            className="w-full text-left rounded-lg border border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-950/30 px-3 py-2.5 flex items-center gap-3 hover:bg-amber-100/60 dark:hover:bg-amber-950/40 focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:outline-none"
          >
            <AlertOctagon className="size-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <div className="flex-1 text-xs">
              <div className="font-semibold text-amber-900 dark:text-amber-200">
                {conflictCount} Sync-Konflikt{conflictCount === 1 ? "" : "e"}
              </div>
              <div className="text-amber-700/80 dark:text-amber-300/80 mt-0.5">
                Auflösen →
              </div>
            </div>
            <span className="text-xs font-medium px-3 py-1.5 rounded-md bg-amber-600 text-white">
              Auflösen
            </span>
          </button>
        )}

        {/* Error-Banner */}
        {errorCount > 0 && (
          <button
            onClick={() => onShowErrors(folder)}
            className="w-full text-left rounded-lg border border-rose-300 dark:border-rose-500/40 bg-rose-50 dark:bg-rose-950/30 px-3 py-2.5 flex items-center gap-3 hover:bg-rose-100/60 dark:hover:bg-rose-950/40 focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:outline-none"
          >
            <AlertOctagon className="size-4 text-rose-600 dark:text-rose-400 shrink-0" />
            <div className="flex-1 text-xs">
              <div className="font-semibold text-rose-900 dark:text-rose-200">
                {errorCount} Datei-Fehler
              </div>
              <div className="text-rose-700/80 dark:text-rose-300/80 mt-0.5">
                Details ansehen
              </div>
            </div>
            <span className="text-xs font-medium px-3 py-1.5 rounded-md bg-rose-600 text-white">
              Ansehen
            </span>
          </button>
        )}

        {/* Activity-Feed */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <div className="text-[10px] uppercase tracking-wider text-neutral-400 dark:text-neutral-500 font-semibold">
              Aktivität
            </div>
            <div className="text-[10px] text-neutral-400 dark:text-neutral-500">
              letzte 200 Events
            </div>
          </div>
          <ActivityFeed
            folderId={folder.id}
            onResolveConflict={() => onShowConflicts(folder)}
          />
        </div>

        {/* Footer Meta */}
        <div className="flex items-center justify-between text-[11px] text-neutral-500 dark:text-neutral-500 pt-2 border-t border-neutral-200 dark:border-neutral-800 gap-3">
          <button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(folder.path);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              } catch (e) {
                console.warn("clipboard write failed", e);
              }
            }}
            className="font-mono truncate hover:text-neutral-900 dark:hover:text-neutral-100 text-left"
            title="Pfad kopieren"
          >
            {copied ? "Pfad kopiert ✓" : folder.path}
          </button>
          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={() => {
                if (endpoint) openUrl(endpoint.url).catch(() => {});
              }}
              className="inline-flex items-center gap-1 hover:text-neutral-900 dark:hover:text-neutral-100"
              title="Syncthing Web-UI"
            >
              Syncthing
              <ExternalLink className="size-3" />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function fmtMeta(
  folder: Folder,
  status: FolderStatus | null,
  peerCount: number,
  peerOnline: boolean,
): string {
  if (folder.paused) return "Pausiert · Files bleiben lokal";
  const parts: string[] = [];
  if (status) {
    if (status.localBytes > 0) {
      parts.push(fmtBytes(status.localBytes));
    }
    if (status.localFiles > 0) {
      parts.push(`${status.localFiles.toLocaleString("de-DE")} Dateien`);
    }
  }
  if (peerCount === 0) {
    parts.push("nur lokal");
  } else if (peerOnline) {
    parts.push(`${peerCount} Gerät${peerCount === 1 ? "" : "e"}`);
  } else {
    parts.push("Gerät offline");
  }
  return parts.join(" · ");
}

function fmtBytes(n: number): string {
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
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
