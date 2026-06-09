import { useEffect, useMemo, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import "./App.css";

import {
  deletePendingDevice,
  putDevice,
  putFolder,
  scanAllFolders,
  useAggregateStatus,
  useConfig,
  useConnections,
  useEndpoint,
  usePendingDevices,
  usePendingFolders,
  useStatus,
  useSyncthingReady,
  type Folder,
  type PendingDevice,
  type PendingFolder,
} from "./lib/syncthing";

import { invitePurgeExpired } from "./lib/invitesStore";
import { useFolderTags } from "./lib/tags";
import { usePauseDates } from "./lib/pauseDates";
import { useBlockBrowserShortcuts } from "./lib/keyboardShortcuts";
import {
  useNotificationTriggers,
  useNotificationsEnabled,
} from "./lib/notifications";
import { CodeRedeemModal } from "./components/CodeRedeemModal";
import { CodeShowModal } from "./components/CodeShowModal";
import { CreateFolderModal } from "./components/CreateFolderModal";
import { ConflictResolverModal } from "./components/ConflictResolverModal";
import { DeviceDetailModal } from "./components/DeviceDetailModal";
import { FolderErrorsModal } from "./components/FolderErrorsModal";
import { FolderSettingsModal } from "./components/FolderSettingsModal";
import { SettingsPanel } from "./components/SettingsModal";
import { UpdateBanner } from "./components/UpdateBanner";
import {
  useFolderSettingsReplication,
} from "./lib/folderSettings";
import { useUpdater } from "./lib/updater";
import {
  setFolderIgnores,
  tuneFolderForSize,
} from "./lib/syncthing";
import { LinkFolderModal, type LinkConfirmOptions } from "./components/LinkFolderModal";
import { pickStignoreForWorkload } from "./lib/unreal";
import { Sidebar, GLOBAL_ACTIVITY_KEY } from "./components/Sidebar";
import { FolderInspector } from "./components/FolderInspector";
import { GlobalActivityView } from "./components/GlobalActivityView";
import { Statusbar } from "./components/Statusbar";
import { Settings as SettingsIcon } from "lucide-react";

// Inline-Panels die den Hauptbereich (Inspector/Activity) überlagern statt als
// Modal aufzupoppen — Native-Redesign. Ab Welle 3 gibt es KEINE Overlay-Modals
// mehr; alles ist Panel oder Banner.
type Panel =
  | null
  | { kind: "settings" }
  | { kind: "create-folder" }
  | { kind: "code-show" }
  | { kind: "code-redeem" }
  | { kind: "folder-settings"; folder: Folder }
  | { kind: "folder-conflicts"; folder: Folder }
  | { kind: "folder-errors"; folder: Folder }
  | { kind: "device-detail"; deviceID: string }
  | { kind: "link"; pending: PendingFolder };

function App() {
  // WebView2-Default-Shortcuts (Find/Print/Reload) blockieren — sonst
  // oeffnet sich auf Windows die Find-Bar wenn der User Ctrl+F drueckt
  // und der Tag-Eingabe-Workflow ist unterbrochen.
  useBlockBrowserShortcuts();

  const endpoint = useEndpoint();
  const ready = useSyncthingReady(endpoint);
  const status = useStatus(endpoint, ready);
  const connections = useConnections(endpoint, ready);
  const config = useConfig(endpoint, ready);
  const pendingFolders = usePendingFolders(endpoint, ready);
  const pendingDevices = usePendingDevices(endpoint, ready);

  const folders = config.data?.folders ?? [];
  const devices = config.data?.devices ?? [];
  const myID = status.data?.myID ?? null;

  const aggregate = useAggregateStatus(endpoint, ready, folders);
  useFolderSettingsReplication(endpoint, ready, folders, myID);
  const tags = useFolderTags(folders);
  const pauseDates = usePauseDates(folders);
  const tagsByFolderID = tags.byID;
  // Alle existierenden Tags für Autocomplete im TagEditor
  const allTagSuggestions = useMemo(() => {
    const set = new Set<string>();
    for (const ts of Object.values(tagsByFolderID)) {
      for (const t of ts) set.add(t);
    }
    return Array.from(set).sort();
  }, [tagsByFolderID]);

  const updater = useUpdater(true);
  const [updateDismissed, setUpdateDismissed] = useState(false);

  const [scanning, setScanning] = useState(false);
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    getVersion().then(setVersion).catch(() => {});
  }, []);

  // VEREINFACHUNG (Sprint #1): KEINE stillen Hintergrund-Automatiken mehr.
  // Entfernt: Auto-Share-Reconciliation (verteilte Ordner ungefragt an jeden
  // Peer), Introducer-Migration (transitives Mesh -> "Geräte tauchen von selbst
  // auf" + Entfernen wirkungslos), Auto-Accept-Loop (stilles Annehmen). Pairing
  // und Folder-Sharing sind ab jetzt ausschliesslich explizite, sichtbare
  // Aktionen. Syncthings vorhersehbare Defaults bleiben unangetastet.

  const connList = useMemo(
    () =>
      connections.data ? Object.entries(connections.data.connections) : [],
    [connections.data],
  );
  const connectionsByID = useMemo(() => {
    const r: Record<string, (typeof connList)[number][1]> = {};
    for (const [id, c] of connList) r[id] = c;
    return r;
  }, [connList]);

  // Memoized: peers + peersConnected werden bei jeder Event-Tick (ItemFinished
  // im Background-Aggregate) neu berechnet wenn man's nicht memoiziert. Audit-
  // Finding: high-frequency re-render. Devices.length ist stabil über Session.
  const peers = useMemo(
    () => devices.filter((d) => d.deviceID !== myID),
    // devices ist eine config-derivierte array, aber neue Referenz pro Fetch.
    // Wir keyen auf die device-IDs-string statt der Array-Reference.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [devices.map((d) => d.deviceID).join(","), myID],
  );
  const notifications = useNotificationsEnabled();
  useNotificationTriggers({
    enabled: notifications.enabled,
    connections: connectionsByID,
    devices,
    pendingDevices: pendingDevices.data ?? [],
    pendingFolders: pendingFolders.data ?? [],
    updateState: updater.state,
  });

  const isFirstRun =
    ready &&
    config.data !== null &&
    peers.length === 0 &&
    folders.length === 0 &&
    (pendingFolders.data?.length ?? 0) === 0 &&
    (pendingDevices.data?.length ?? 0) === 0;

  // Selected folder für Inspector. Default: erster Folder wenn nichts gewählt.
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  useEffect(() => {
    if (folders.length === 0) {
      if (selectedFolderId !== null) setSelectedFolderId(null);
      return;
    }
    // "Alle Ordner"-Pseudo-Selection darf bestehen bleiben
    if (selectedFolderId === GLOBAL_ACTIVITY_KEY) return;
    if (!selectedFolderId || !folders.some((f) => f.id === selectedFolderId)) {
      setSelectedFolderId(folders[0]!.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folders.map((f) => f.id).join(",")]);

  const selectedFolder = folders.find((f) => f.id === selectedFolderId) ?? null;
  const showGlobalActivity = selectedFolderId === GLOBAL_ACTIVITY_KEY;
  // Native-Redesign: Inline-Panel das die Inspector/Activity-Ansicht überlagert
  // (Settings, Ordner anlegen, Code anzeigen/einlösen, Folder-Settings).
  const [panel, setPanel] = useState<Panel>(null);
  const visiblePending = pendingFolders.data ?? [];

  // Beim App-Start expired Codes purgen (sonst wächst die invites.json unbounded).
  useEffect(() => {
    invitePurgeExpired().catch((e) => console.warn("[invites] purge failed", e));
  }, []);

  const onScan = async () => {
    if (!endpoint || folders.length === 0) return;
    setScanning(true);
    try {
      await scanAllFolders(endpoint, folders);
    } catch (e) {
      console.error("[syncomat] scan failed", e);
    } finally {
      setScanning(false);
    }
  };

  const onPauseToggle = async (f: Folder) => {
    if (!endpoint) return;
    await putFolder(endpoint, { ...f, paused: !f.paused });
  };

  const onLink = (pf: PendingFolder) => setPanel({ kind: "link", pending: pf });

  const onLinkConfirm = async (
    pending: PendingFolder,
    label: string,
    localPath: string,
    options: LinkConfirmOptions,
  ) => {
    if (!endpoint || !myID) throw new Error("Endpoint nicht bereit");
    const offerers = Object.keys(pending.offeredBy);
    let folder: Folder = {
      id: pending.folderID,
      label,
      path: localPath,
      type: "sendreceive",
      paused: false,
      devices: [
        { deviceID: myID },
        ...offerers.map((deviceID) => ({ deviceID })),
      ],
      // caseSensitiveFS bewusst NICHT setzen — Syncthing auto-detected pro
      // folder.path. Hardcoded:true bricht silent den Sync mit Windows-Peers
      // (NTFS = case-insensitive), siehe Audit-Finding.
    };
    // Wenn der Empfänger ein Preset gewählt hat: tune Folder + setze .stignore
    // VOR dem putFolder, damit Syncthing nicht erst die ganzen Ignore-Files
    // anfasst und dann re-ignored. Bei Unreal verhindert das den Download von
    // DerivedDataCache (10-50 GB) gleich beim ersten Sync.
    if (options.applyPreset && options.estimate) {
      folder = tuneFolderForSize(
        folder,
        options.estimate.bytes,
        options.estimate.files,
        options.preset,
      );
    }
    await putFolder(endpoint, folder);
    if (options.applyPreset) {
      const patterns = pickStignoreForWorkload(options.preset);
      if (patterns.length > 0) {
        try {
          await setFolderIgnores(endpoint, folder.id, patterns);
        } catch (e) {
          console.warn("link: setFolderIgnores failed", e);
        }
      }
    }
  };

  const onAcceptDevice = async (pd: PendingDevice) => {
    if (!endpoint) return;
    await putDevice(endpoint, {
      deviceID: pd.deviceID,
      name: pd.name || pd.deviceID.slice(0, 7),
      addresses: ["dynamic"],
      // introducer: false (Sprint #1) — kein transitives Mesh. Geräte werden
      // einzeln explizit gepairt; nichts kommt von selbst dazu.
      introducer: false,
      autoAcceptFolders: false,
      paused: false,
    });
  };

  const onIgnoreDevice = async (pd: PendingDevice) => {
    if (!endpoint) return;
    await deletePendingDevice(endpoint, pd.deviceID);
  };

  return (
    <main className="h-screen bg-neutral-100 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 antialiased flex flex-col overflow-hidden">
      {!updateDismissed && (
        <UpdateBanner
          state={updater.state}
          onInstall={updater.installAndRestart}
          onDismiss={() => setUpdateDismissed(true)}
        />
      )}


      {(pendingDevices.data?.length ?? 0) > 0 &&
        panel?.kind !== "code-show" && (
        <div className="border-b border-blue-300 dark:border-blue-500/40 bg-blue-50 dark:bg-blue-950/30 shrink-0">
          {pendingDevices.data!.map((pd) => (
            <div key={pd.deviceID} className="flex items-center gap-2 px-4 py-2.5">
              <div className="min-w-0 flex-1 text-xs">
                <div className="font-medium text-blue-900 dark:text-blue-200 truncate">
                  {pd.name || pd.deviceID.slice(0, 7)} möchte sich verbinden
                </div>
                <p className="text-blue-700/80 dark:text-blue-300/80 truncate">{pd.address}</p>
              </div>
              <button
                onClick={() => onIgnoreDevice(pd)}
                className="text-xs px-2.5 py-1 rounded-md text-blue-900 dark:text-blue-200 hover:bg-blue-100 dark:hover:bg-blue-900/40"
              >
                Ablehnen
              </button>
              <button
                onClick={() => onAcceptDevice(pd)}
                className="text-xs font-medium px-2.5 py-1 rounded-md bg-blue-600 text-white hover:bg-blue-700"
              >
                Akzeptieren
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        {isFirstRun && !panel ? (
          <FirstRunWelcome
            onCreateFolder={() => setPanel({ kind: "create-folder" })}
            onShowCode={() => setPanel({ kind: "code-show" })}
            onRedeemCode={() => setPanel({ kind: "code-redeem" })}
            onOpenSettings={() => setPanel({ kind: "settings" })}
          />
        ) : (
          <>
            <Sidebar
              folders={folders}
              pending={visiblePending}
              tagsByFolderID={tagsByFolderID}
              devices={devices}
              connections={connectionsByID}
              myID={myID}
              endpoint={endpoint}
              ready={ready}
              selectedFolderId={selectedFolderId}
              onSelectFolder={(f) => {
                setSelectedFolderId(f.id);
                setPanel(null);
              }}
              onSelectPending={onLink}
              onScan={onScan}
              scanning={scanning}
              onAddFolder={() => setPanel({ kind: "create-folder" })}
              onShowCode={() => setPanel({ kind: "code-show" })}
              onRedeemCode={() => setPanel({ kind: "code-redeem" })}
              onSelectDevice={(d) =>
                setPanel({ kind: "device-detail", deviceID: d.deviceID })
              }
              pauseDates={pauseDates}
            />

            {panel?.kind === "settings" ? (
              <SettingsPanel
                endpoint={endpoint}
                status={status.data}
                version={version}
                updateState={updater.state}
                onRecheckUpdates={updater.recheck}
                onInstallUpdate={updater.installAndRestart}
                notificationsEnabled={notifications.enabled}
                onSetNotificationsEnabled={notifications.setEnabled}
                onBack={() => setPanel(null)}
              />
            ) : panel?.kind === "create-folder" ? (
              <CreateFolderModal
                endpoint={endpoint}
                myDeviceId={myID}
                ready={ready}
                peers={peers.map((p) => ({
                  deviceID: p.deviceID,
                  name: p.name || p.deviceID.slice(0, 7),
                }))}
                onClose={() => setPanel(null)}
              />
            ) : panel?.kind === "code-show" ? (
              <CodeShowModal
                endpoint={endpoint}
                ready={ready}
                status={status.data}
                folders={folders}
                onClose={() => setPanel(null)}
              />
            ) : panel?.kind === "code-redeem" ? (
              <CodeRedeemModal
                endpoint={endpoint}
                ready={ready}
                status={status.data}
                onClose={() => setPanel(null)}
              />
            ) : panel?.kind === "folder-settings" && endpoint && myID ? (
              <FolderSettingsModal
                endpoint={endpoint}
                folder={panel.folder}
                myDeviceId={myID}
                tagSuggestions={allTagSuggestions}
                onClose={() => setPanel(null)}
                onRemoved={() => setPanel(null)}
                onSaved={() => tags.refresh()}
              />
            ) : panel?.kind === "folder-conflicts" ? (
              <ConflictResolverModal
                folderPath={panel.folder.path}
                folderLabel={panel.folder.label || panel.folder.id}
                onClose={() => setPanel(null)}
              />
            ) : panel?.kind === "folder-errors" && endpoint ? (
              <FolderErrorsModal
                endpoint={endpoint}
                folderId={panel.folder.id}
                folderLabel={panel.folder.label || panel.folder.id}
                onClose={() => setPanel(null)}
              />
            ) : panel?.kind === "link" ? (
              <LinkFolderModal
                pending={panel.pending}
                onConfirm={(label, path, options) =>
                  onLinkConfirm(panel.pending, label, path, options)
                }
                onClose={() => setPanel(null)}
              />
            ) : panel?.kind === "device-detail" && endpoint ? (
              (() => {
                const device = devices.find((d) => d.deviceID === panel.deviceID);
                if (!device) return <NoSelectionView onCreateFolder={() => setPanel({ kind: "create-folder" })} onShowCode={() => setPanel({ kind: "code-show" })} />;
                return (
                  <DeviceDetailModal
                    device={device}
                    endpoint={endpoint}
                    connection={connectionsByID[device.deviceID]}
                    folders={folders}
                    onClose={() => setPanel(null)}
                    onRemoved={() => {
                      // Reconciliation entfernt das Gerät beim nächsten config-Tick.
                    }}
                    onSelectFolder={(f) => {
                      setSelectedFolderId(f.id);
                      setPanel(null);
                    }}
                  />
                );
              })()
            ) : showGlobalActivity ? (
              <GlobalActivityView
                folders={folders}
                onSelectFolder={(f) => setSelectedFolderId(f.id)}
              />
            ) : selectedFolder ? (
              <FolderInspector
                folder={selectedFolder}
                endpoint={endpoint}
                ready={ready}
                devices={devices}
                connections={connectionsByID}
                myID={myID}
                tags={tagsByFolderID[selectedFolder.id] ?? []}
                pausedSince={pauseDates[selectedFolder.id]}
                onPauseToggle={onPauseToggle}
                onShowSettings={(f) => setPanel({ kind: "folder-settings", folder: f })}
                onShowConflicts={(f) => setPanel({ kind: "folder-conflicts", folder: f })}
                onShowErrors={(f) => setPanel({ kind: "folder-errors", folder: f })}
              />
            ) : (
              <NoSelectionView
                onCreateFolder={() => setPanel({ kind: "create-folder" })}
                onShowCode={() => setPanel({ kind: "code-show" })}
              />
            )}
          </>
        )}
      </div>

      <div className="border-t border-neutral-200 dark:border-neutral-800 bg-neutral-50/60 dark:bg-neutral-950/40 shrink-0 flex items-stretch">
        <div className="flex-1 px-4">
          <Statusbar
            aggregateState={aggregate.state}
            needBytes={aggregate.needBytes}
            errorCount={aggregate.errorCount}
            lastSyncAt={aggregate.lastUpdate}
            localFiles={aggregate.localFiles}
            localBytes={aggregate.localBytes}
            version={version}
          />
        </div>
        <button
          onClick={() =>
            setPanel((p) => (p?.kind === "settings" ? null : { kind: "settings" }))
          }
          title="Einstellungen"
          aria-pressed={panel?.kind === "settings"}
          className={`px-3 flex items-center border-l border-neutral-200 dark:border-neutral-800 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none ${
            panel?.kind === "settings"
              ? "text-blue-600 dark:text-blue-400 bg-blue-500/10"
              : "text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
          }`}
        >
          <SettingsIcon className="size-3.5" />
        </button>
      </div>

    </main>
  );
}

export default App;

// ─────────────────────────────────────────────────────────────────────
// Welcome- und Empty-States (inline weil klein + nur hier verwendet)
// ─────────────────────────────────────────────────────────────────────

function FirstRunWelcome({
  onCreateFolder,
  onShowCode,
  onRedeemCode,
  onOpenSettings,
}: {
  onCreateFolder: () => void;
  onShowCode: () => void;
  onRedeemCode: () => void;
  onOpenSettings: () => void;
}) {
  return (
    <div className="flex-1 flex items-center justify-center bg-white dark:bg-neutral-900 px-8 py-12">
      <div className="max-w-md w-full">
        <div className="size-10 rounded-md bg-blue-600 flex items-center justify-center text-white mb-4">
          <svg
            viewBox="0 0 24 24"
            className="size-5"
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
        <h1
          className="text-2xl font-bold text-neutral-900 dark:text-neutral-100 mb-2"
          style={{ textWrap: "balance" } as React.CSSProperties}
        >
          Sync-Dienst läuft.
        </h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-6 leading-relaxed">
          Drei Wege zu starten:
        </p>

        <div className="space-y-2">
          <button
            onClick={onCreateFolder}
            className="w-full text-left px-4 py-3 rounded-xl border border-blue-300 dark:border-blue-500/40 bg-blue-50 dark:bg-blue-950/30 hover:bg-blue-100 dark:hover:bg-blue-950/50 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
          >
            <div className="text-sm font-semibold text-blue-900 dark:text-blue-100">
              Ersten Ordner anlegen
            </div>
            <div className="text-xs text-blue-700/80 dark:text-blue-300/80 mt-0.5">
              Lokalen Pfad wählen, Geräte kommen später dazu.
            </div>
          </button>
          <button
            onClick={onShowCode}
            className="w-full text-left px-4 py-3 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50/40 dark:bg-neutral-900/40 hover:bg-neutral-100 dark:hover:bg-neutral-800/60 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
          >
            <div className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              Gerät einladen
            </div>
            <div className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
              Erzeugt einen Code für deinen zweiten Rechner.
            </div>
          </button>
          <button
            onClick={onRedeemCode}
            className="w-full text-left px-4 py-3 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50/40 dark:bg-neutral-900/40 hover:bg-neutral-100 dark:hover:bg-neutral-800/60 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
          >
            <div className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              Code einlösen
            </div>
            <div className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
              Einladungs-Code von jemand anderem
            </div>
          </button>
        </div>

        <div className="mt-6 pt-4 border-t border-neutral-200 dark:border-neutral-800 flex items-center justify-between text-[11px] text-neutral-500 dark:text-neutral-500">
          <span>Fenster schließen lässt den Sync im Tray weiterlaufen.</span>
          <button onClick={onOpenSettings} className="hover:text-neutral-900 dark:hover:text-neutral-100">
            Einstellungen →
          </button>
        </div>
      </div>
    </div>
  );
}

function NoSelectionView({
  onCreateFolder,
  onShowCode,
}: {
  onCreateFolder: () => void;
  onShowCode: () => void;
}) {
  return (
    <div className="flex-1 flex items-center justify-center bg-white dark:bg-neutral-900 px-8">
      <div className="max-w-sm text-center">
        <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-4">
          Kein Ordner ausgewählt. Wähle links einen aus oder lege einen neuen
          an.
        </p>
        <div className="flex justify-center gap-2">
          <button
            onClick={onCreateFolder}
            className="text-xs font-medium px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
          >
            + Ordner
          </button>
          <button
            onClick={onShowCode}
            className="text-xs font-medium px-3 py-1.5 rounded-lg border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
          >
            Gerät einladen
          </button>
        </div>
      </div>
    </div>
  );
}
