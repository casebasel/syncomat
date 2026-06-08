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
import { useIgnoredFolders } from "./lib/ignored";
import { useFolderTags } from "./lib/tags";
import {
  useNotificationTriggers,
  useNotificationsEnabled,
} from "./lib/notifications";
import { CodeRedeemModal } from "./components/CodeRedeemModal";
import { CodeShowModal } from "./components/CodeShowModal";
import { CreateFolderModal } from "./components/CreateFolderModal";
import { ConflictResolverModal } from "./components/ConflictResolverModal";
import { FolderErrorsModal } from "./components/FolderErrorsModal";
import { FolderSettingsModal } from "./components/FolderSettingsModal";
import { SettingsModal } from "./components/SettingsModal";
import { UpdateBanner } from "./components/UpdateBanner";
import {
  useFolderSettingsReplication,
  type DeletionSuggestion,
} from "./lib/folderSettings";
import { useUpdater } from "./lib/updater";
import {
  deleteFolder,
  setFolderIgnores,
  tuneFolderForSize,
} from "./lib/syncthing";
import { ignoredFoldersAdd } from "./lib/ignored";
import { LinkFolderModal, type LinkConfirmOptions } from "./components/LinkFolderModal";
import { pickStignoreForWorkload } from "./lib/unreal";
import { Sidebar } from "./components/Sidebar";
import { FolderInspector } from "./components/FolderInspector";
import { Statusbar } from "./components/Statusbar";
import { Settings as SettingsIcon } from "lucide-react";

type Modal =
  | null
  | { kind: "code-show" }
  | { kind: "code-redeem" }
  | { kind: "create-folder" }
  | { kind: "link"; pending: PendingFolder }
  | { kind: "folder-errors"; folder: Folder }
  | { kind: "folder-settings"; folder: Folder }
  | { kind: "folder-conflicts"; folder: Folder }
  | { kind: "settings" };

function App() {
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
  const [deletionSuggestion, setDeletionSuggestion] =
    useState<DeletionSuggestion | null>(null);
  useFolderSettingsReplication(
    endpoint,
    ready,
    folders,
    myID,
    30_000,
    (s) => setDeletionSuggestion(s),
  );
  const ignored = useIgnoredFolders();
  const tagsByFolderID = useFolderTags(folders);
  // Alle existierenden Tags für Autocomplete im TagEditor
  const allTagSuggestions = useMemo(() => {
    const set = new Set<string>();
    for (const tags of Object.values(tagsByFolderID)) {
      for (const t of tags) set.add(t);
    }
    return Array.from(set).sort();
  }, [tagsByFolderID]);

  const acceptClusterDelete = async () => {
    if (!deletionSuggestion || !endpoint) return;
    const f = deletionSuggestion.folder;
    try {
      await deleteFolder(endpoint, f.id);
      await ignoredFoldersAdd(f.id, f.label || f.id);
      ignored.refresh();
    } catch (e) {
      console.warn("cluster-delete-accept failed", e);
    }
    setDeletionSuggestion(null);
  };
  const updater = useUpdater(true);
  const [updateDismissed, setUpdateDismissed] = useState(false);

  const [modal, setModal] = useState<Modal>(null);
  const [scanning, setScanning] = useState(false);
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    getVersion().then(setVersion).catch(() => {});
  }, []);

  // Auto-Share-Reconciliation: stellt sicher dass JEDER Folder mit ALLEN
  // bekannten Peers geshared ist. Default-Verhalten nach Marlons Concept-Defaults
  // (Resilio-Style: alles wird mit allen meinen Geräten geteilt, kein manuelles
  // pro-Folder-Auswählen). Greift wenn:
  //  - Folders die vor v0.1.17 ohne peers angelegt wurden (orderA bug)
  //  - Folders die angelegt wurden während ein peer paused war
  //  - Edge-cases wo acceptIncoming einzelne Folders verpasst hat
  // Läuft bei jedem config.data + devices change. putFolder ist idempotent
  // und Syncthing dedupliziert devices[].
  useEffect(() => {
    if (!endpoint || !ready || !config.data || !myID) return;
    const allFolders = config.data.folders;
    const peerIDs = config.data.devices
      .filter((d) => d.deviceID !== myID)
      .map((d) => d.deviceID);
    if (peerIDs.length === 0 || allFolders.length === 0) return;
    for (const f of allFolders) {
      const missing = peerIDs.filter(
        (id) => !f.devices.some((d) => d.deviceID === id),
      );
      if (missing.length === 0) continue;
      const updated = {
        ...f,
        devices: [...f.devices, ...missing.map((id) => ({ deviceID: id }))],
      };
      putFolder(endpoint, updated).catch((e) => {
        console.warn(`[auto-share] reconciliation failed for ${f.id}`, e);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    endpoint?.url,
    endpoint?.api_key,
    ready,
    myID,
    // Re-run wenn neuer peer oder neuer folder dazukommt
    config.data?.folders.map((f) => `${f.id}|${f.devices.length}`).join(","),
    config.data?.devices.map((d) => d.deviceID).join(","),
  ]);

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
    if (!selectedFolderId || !folders.some((f) => f.id === selectedFolderId)) {
      setSelectedFolderId(folders[0]!.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folders.map((f) => f.id).join(",")]);

  const selectedFolder = folders.find((f) => f.id === selectedFolderId) ?? null;
  const visiblePending = (pendingFolders.data ?? []).filter(
    (pf) => !ignored.isIgnored(pf.folderID),
  );

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

  const onLink = (pf: PendingFolder) => setModal({ kind: "link", pending: pf });

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

      {deletionSuggestion && (
        <div className="flex items-start gap-3 px-4 py-2.5 border-b border-rose-300 dark:border-rose-500/40 bg-rose-50 dark:bg-rose-950/30 shrink-0">
          <div className="size-7 rounded-md bg-rose-600 text-white flex items-center justify-center shrink-0 mt-0.5">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4">
              <path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>
            </svg>
          </div>
          <div className="min-w-0 flex-1 text-xs">
            <div className="font-medium text-rose-900 dark:text-rose-200">
              Ordner „{deletionSuggestion.folder.label || deletionSuggestion.folder.id}" — auch hier entfernen?
            </div>
            <p className="text-rose-700/80 dark:text-rose-300/80 mt-0.5">
              {deletionSuggestion.by.slice(0, 7)} hat diesen Ordner Cluster-weit zum Entfernen markiert.
              Datei-Inhalte bleiben auf der Platte.
            </p>
          </div>
          <button
            onClick={() => setDeletionSuggestion(null)}
            className="text-xs px-2 py-1 rounded-md text-rose-900 dark:text-rose-200 hover:bg-rose-100 dark:hover:bg-rose-900/40 shrink-0"
          >
            Behalten
          </button>
          <button
            onClick={acceptClusterDelete}
            className="text-xs font-medium px-2.5 py-1 rounded-md bg-rose-600 text-white hover:bg-rose-700 shrink-0"
          >
            Hier auch entfernen
          </button>
        </div>
      )}

      {(pendingDevices.data?.length ?? 0) > 0 && modal?.kind !== "code-show" && (
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
        {isFirstRun ? (
          <FirstRunWelcome
            onCreateFolder={() => setModal({ kind: "create-folder" })}
            onShowCode={() => setModal({ kind: "code-show" })}
            onRedeemCode={() => setModal({ kind: "code-redeem" })}
            onOpenSettings={() => setModal({ kind: "settings" })}
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
              onSelectFolder={(f) => setSelectedFolderId(f.id)}
              onSelectPending={onLink}
              onScan={onScan}
              scanning={scanning}
              onAddFolder={() => setModal({ kind: "create-folder" })}
              onShowCode={() => setModal({ kind: "code-show" })}
              onRedeemCode={() => setModal({ kind: "code-redeem" })}
            />

            {selectedFolder ? (
              <FolderInspector
                folder={selectedFolder}
                endpoint={endpoint}
                ready={ready}
                connections={connectionsByID}
                myID={myID}
                tags={tagsByFolderID[selectedFolder.id] ?? []}
                onPauseToggle={onPauseToggle}
                onShowSettings={(f) => setModal({ kind: "folder-settings", folder: f })}
                onShowConflicts={(f) => setModal({ kind: "folder-conflicts", folder: f })}
                onShowErrors={(f) => setModal({ kind: "folder-errors", folder: f })}
              />
            ) : (
              <NoSelectionView
                onCreateFolder={() => setModal({ kind: "create-folder" })}
                onShowCode={() => setModal({ kind: "code-show" })}
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
          onClick={() => setModal({ kind: "settings" })}
          title="Einstellungen"
          className="px-3 flex items-center text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 border-l border-neutral-200 dark:border-neutral-800 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
        >
          <SettingsIcon className="size-3.5" />
        </button>
      </div>

      {modal?.kind === "link" && (
        <LinkFolderModal
          pending={modal.pending}
          onConfirm={(label, path, options) =>
            onLinkConfirm(modal.pending, label, path, options)
          }
          onClose={() => setModal(null)}
        />
      )}
      {modal?.kind === "code-show" && (
        <CodeShowModal
          endpoint={endpoint}
          ready={ready}
          status={status.data}
          folders={folders}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.kind === "code-redeem" && (
        <CodeRedeemModal
          endpoint={endpoint}
          ready={ready}
          status={status.data}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.kind === "folder-errors" && endpoint && (
        <FolderErrorsModal
          endpoint={endpoint}
          folderId={modal.folder.id}
          folderLabel={modal.folder.label || modal.folder.id}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.kind === "folder-settings" && endpoint && myID && (
        <FolderSettingsModal
          endpoint={endpoint}
          folder={modal.folder}
          myDeviceId={myID}
          tagSuggestions={allTagSuggestions}
          onClose={() => setModal(null)}
          onRemoved={() => ignored.refresh()}
        />
      )}
      {modal?.kind === "folder-conflicts" && (
        <ConflictResolverModal
          folderPath={modal.folder.path}
          folderLabel={modal.folder.label || modal.folder.id}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.kind === "settings" && (
        <SettingsModal
          endpoint={endpoint}
          status={status.data}
          version={version}
          updateState={updater.state}
          onRecheckUpdates={updater.recheck}
          notificationsEnabled={notifications.enabled}
          onSetNotificationsEnabled={notifications.setEnabled}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.kind === "create-folder" && (
        <CreateFolderModal
          endpoint={endpoint}
          myDeviceId={myID}
          ready={ready}
          peers={peers.map((p) => ({
            deviceID: p.deviceID,
            name: p.name || p.deviceID.slice(0, 7),
          }))}
          onClose={() => setModal(null)}
        />
      )}
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
          Syncomat ist bereit.
        </h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-6 leading-relaxed">
          Drei Wege zu starten — wähle den, der passt.
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
              Hat dir jemand einen Einladungs-Code geschickt?
            </div>
          </button>
        </div>

        <div className="mt-6 pt-4 border-t border-neutral-200 dark:border-neutral-800 flex items-center justify-between text-[11px] text-neutral-500 dark:text-neutral-500">
          <span>Tipp: Tray-Icon bleibt aktiv wenn du das Fenster schliesst.</span>
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
