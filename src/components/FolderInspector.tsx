import { useState } from "react";
import {
  AlertOctagon,
  ExternalLink,
  FolderOpen,
  Pause,
  Play,
  Settings,
  X,
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
import { describeFolderError, folderError } from "../lib/syncthing";
import { isAboFolderId } from "../lib/datenzentrale";
import { useSharedFolderStatus as useFolderStatus } from "../lib/folderStatusStore";
import { useFolderConflicts } from "../lib/conflicts";
import { usePluginPresetHint } from "../lib/folderSettings";

export function FolderInspector({
  folder,
  endpoint,
  ready,
  devices,
  connections,
  myID,
  tags,
  onPauseToggle,
  onShowSettings,
  onShowConflicts,
  onShowErrors,
  onAboBeenden,
  farbe,
  onSchliessen,
}: {
  folder: Folder;
  endpoint: Endpoint | null;
  ready: boolean;
  devices: Device[];
  connections: Record<DeviceID, Connection>;
  myID: DeviceID | null;
  tags: string[];
  onPauseToggle: (f: Folder) => void;
  onShowSettings: (f: Folder) => void;
  onShowConflicts: (f: Folder) => void;
  onShowErrors: (f: Folder) => void;
  /** Nur bei Abo-Ordnern (dz-…): Abo auf diesem Rechner beenden. Gibt die
   * Meldung zurück oder wirft mit dem Grund. */
  onAboBeenden?: (f: Folder) => Promise<string>;
  /** Projektkante (nur Projekte). */
  farbe?: string | null;
  onSchliessen?: () => void;
}) {
  const { data: status } = useFolderStatus(endpoint, ready, folder.id);
  const { count: conflictCount } = useFolderConflicts(folder.path);
  const others = folder.devices.map((d) => d.deviceID).filter((id) => id !== myID);
  const peerOnline = others.some((id) => connections[id]?.connected);
  const state = deriveSyncState(folder, status, peerOnline, others.length, conflictCount);
  const [copied, setCopied] = useState(false);
  const pluginHint = usePluginPresetHint(endpoint, folder, myID);

  const errorCount = status?.errors ?? 0;
  const folderErr = folderError(status);
  const istAbo = isAboFolderId(folder.id);
  const [aboMeldung, setAboMeldung] = useState<{ ok: boolean; text: string } | null>(null);
  const [aboBusy, setAboBusy] = useState(false);
  const folderErrInfo = folderErr ? describeFolderError(folderErr) : null;
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
  });

  return (
    <section className="flex-1 min-w-0 flex flex-col overflow-hidden bg-[var(--sm-grund)] text-[var(--sm-text)]">
      {/* Kopfzeile wie AboFeld: schwarz, Projektkante, Name, Aktionen */}
      <header className="h-12 shrink-0 pl-0 pr-1.5 flex items-center gap-2.5 bg-[var(--sm-kopf)] text-[var(--sm-kopf-text)]">
        <span aria-hidden className="self-stretch w-[3px] shrink-0" style={{ background: farbe ?? "transparent" }} />
        <h2 className="flex-1 min-w-0 truncate text-[16px] font-bold" dir="auto">
          {folder.label || folder.id}
        </h2>
        {[
          {
            t: `Im ${FILE_MANAGER} öffnen`,
            on: () => invoke("reveal_in_file_manager", { path: folder.path }).catch((e) => console.warn("reveal failed", e)),
            i: <FolderOpen className="size-4" />,
          },
          { t: folder.paused ? "Fortsetzen" : "Pausieren", on: () => onPauseToggle(folder), i: folder.paused ? <Play className="size-4" /> : <Pause className="size-4" /> },
          { t: "Ordner-Einstellungen", on: () => onShowSettings(folder), i: <Settings className="size-4" /> },
        ].map((b) => (
          <button
            key={b.t}
            onClick={b.on}
            title={b.t}
            aria-label={b.t}
            className="size-8 rounded flex items-center justify-center text-[var(--sm-kopf-text2)] hover:text-[var(--sm-kopf-text)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--sm-blau)]"
          >
            {b.i}
          </button>
        ))}
        {onSchliessen && (
          <button
            onClick={onSchliessen}
            title="Schliessen"
            aria-label="Schliessen"
            className="size-8 rounded flex items-center justify-center text-[var(--sm-kopf-text2)] hover:text-[var(--sm-kopf-text)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--sm-blau)]"
          >
            <X className="size-4" />
          </button>
        )}
      </header>
      <div className="shrink-0 px-4 py-2.5 border-b border-[var(--sm-linie)] flex items-center gap-2.5 flex-wrap">
        <SyncStatusBadge state={state} label={statusLabel} variant="pill" size="sm" />
        <span className="sm-zahl text-[13px] text-[var(--sm-text2)]">{fmtMeta(folder, status, others.length, peerOnline)}</span>
        {tags.map((t) => (
          <TagChip key={t} tag={t} size="sm" />
        ))}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
        {/* Konflikt-Banner (priority) */}
        {conflictCount > 0 && (
          <button
            onClick={() => onShowConflicts(folder)}
            className="w-full text-left rounded-md border border-[var(--sm-ocker)] bg-[var(--sm-ocker-flaeche)] px-3 py-2.5 flex items-center gap-3 hover:brightness-95 focus-visible:ring-2 focus-visible:ring-[var(--sm-ocker)] focus-visible:outline-none"
          >
            <AlertOctagon className="size-4 text-[var(--sm-ocker-text)] shrink-0" />
            <div className="flex-1 text-xs">
              <div className="font-semibold text-[var(--sm-text)]">
                {conflictCount} Sync-Konflikt{conflictCount === 1 ? "" : "e"}
              </div>
              <div className="text-[var(--sm-text2)] mt-0.5">
                Auflösen →
              </div>
            </div>
            <span className="text-xs font-medium px-3 py-1.5 rounded-md bg-[var(--sm-ocker)] text-black">
              Auflösen
            </span>
          </button>
        )}

        {/* Ordner-Fehler (vor allem anderen: der Ordner synct gar nicht mehr) */}
        {folderErrInfo && (
          <div
            role="alert"
            className="rounded-md border border-[var(--sm-ocker)] bg-[var(--sm-ocker-flaeche)] px-3 py-2.5 flex items-start gap-3"
          >
            <AlertOctagon className="size-4 text-[var(--sm-ocker-text)] shrink-0 mt-0.5" />
            <div className="flex-1 text-xs min-w-0">
              <div className="font-semibold text-[var(--sm-text)]">
                {folderErrInfo.title}
              </div>
              <div className="text-[var(--sm-text2)] mt-0.5">
                {folderErrInfo.action}
              </div>
              <div className="font-mono text-[11px] text-[var(--sm-text2)] mt-1 break-words">
                {folderErr}
              </div>
            </div>
          </div>
        )}

        {/* Error-Banner */}
        {errorCount > 0 && (
          <button
            onClick={() => onShowErrors(folder)}
            className="w-full text-left rounded-md border border-[var(--sm-ocker)] bg-[var(--sm-ocker-flaeche)] px-3 py-2.5 flex items-center gap-3 hover:brightness-95 focus-visible:ring-2 focus-visible:ring-[var(--sm-ocker)] focus-visible:outline-none"
          >
            <AlertOctagon className="size-4 text-[var(--sm-ocker-text)] shrink-0" />
            <div className="flex-1 text-xs">
              <div className="font-semibold text-[var(--sm-text)]">
                {errorCount} Datei-Fehler
              </div>
              <div className="text-[var(--sm-text2)] mt-0.5">
                Details ansehen
              </div>
            </div>
            <span className="text-xs font-medium px-3 py-1.5 rounded-md bg-[var(--sm-ocker)] text-black">
              Ansehen
            </span>
          </button>
        )}

        {/* Abo vom NAS: hier beenden */}
        {istAbo && onAboBeenden && (
          <div className="rounded-lg border border-[var(--sm-linie)] px-3 py-2.5 flex items-start gap-3">
            <div className="flex-1 text-xs">
              <div className="font-semibold text-[var(--sm-text)]">Abonniert vom NAS</div>
              <div className="text-[var(--sm-text2)] mt-0.5">
                Arbeitskopie auf diesem Rechner, abgeglichen mit dem Projekt auf dem NAS.
              </div>
              {aboMeldung && (
                <div
                  className={`mt-1 ${aboMeldung.ok ? "text-[var(--sm-text)]" : "text-[var(--sm-ocker-text)]"}`}
                >
                  {aboMeldung.text}
                </div>
              )}
            </div>
            <button
              disabled={aboBusy}
              onClick={async () => {
                setAboBusy(true);
                setAboMeldung(null);
                try {
                  setAboMeldung({ ok: true, text: await onAboBeenden(folder) });
                } catch (e) {
                  setAboMeldung({ ok: false, text: e instanceof Error ? e.message : String(e) });
                } finally {
                  setAboBusy(false);
                }
              }}
              className="shrink-0 text-xs font-medium px-3 py-1.5 rounded-md border border-[var(--sm-linie)] hover:bg-[var(--sm-flaeche)] disabled:opacity-50"
            >
              Abo beenden
            </button>
          </div>
        )}

        {/* Plugin-Ordner mit Projekt-Preset: DLLs fehlen auf den anderen Geräten */}
        {pluginHint.show && (
          <div className="rounded-md border border-[var(--sm-ocker)] bg-[var(--sm-ocker-flaeche)] px-3 py-2.5 flex items-center gap-3">
            <AlertOctagon className="size-4 text-[var(--sm-ocker-text)] shrink-0" />
            <div className="flex-1 text-xs">
              <div className="font-semibold text-[var(--sm-text)]">
                {pluginHint.pluginCount} Unreal-Plugins — ihre DLLs werden nicht synct
              </div>
              <div className="text-[var(--sm-text2)] mt-0.5">
                Der Ordner nutzt das Projekt-Preset, das Binaries ausschliesst.
                Das Plugin-Preset synct die fertigen Plugins komplett, auf allen
                Geräten.
              </div>
              {pluginHint.error && (
                <div className="text-[var(--sm-ocker-text)] mt-1 break-words">
                  {pluginHint.error}
                </div>
              )}
            </div>
            <button
              onClick={() => void pluginHint.apply()}
              disabled={pluginHint.busy}
              className="text-xs font-medium px-3 py-1.5 rounded-md bg-[var(--sm-ocker)] text-black hover:brightness-95 disabled:opacity-50 shrink-0"
            >
              {pluginHint.busy ? "Stelle um…" : "Plugin-Preset"}
            </button>
          </div>
        )}

        {/* Activity-Feed */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <div className="text-[11px] uppercase tracking-wider text-[var(--sm-text2)] font-semibold">
              Aktivität
            </div>
            <div className="text-[11px] text-[var(--sm-text2)]">
              letzte 200 Events
            </div>
          </div>
          <ActivityFeed
            folderId={folder.id}
            onResolveConflict={() => onShowConflicts(folder)}
          />
        </div>

        {/* Footer Meta */}
        <div className="flex items-center justify-between text-[12px] text-[var(--sm-text2)] pt-2 border-t border-[var(--sm-linie)] gap-3">
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
            className="font-mono truncate hover:text-[var(--sm-text)] text-left"
            title="Pfad kopieren"
          >
            {copied ? "Pfad kopiert ✓" : folder.path}
          </button>
          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={() => {
                if (endpoint) openUrl(endpoint.url).catch(() => {});
              }}
              className="inline-flex items-center gap-1 hover:text-[var(--sm-text)]"
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
  if (status && (status.errors > 0 || folderError(status))) return "error";
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
