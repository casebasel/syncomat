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
  useTransferRate,
  type Folder,
  type PendingDevice,
  type PendingFolder,
} from "./lib/syncthing";

import { invitePurgeExpired } from "./lib/invitesStore";
import { useIgnoredFolders } from "./lib/ignored";
import {
  useNotificationTriggers,
  useNotificationsEnabled,
} from "./lib/notifications";
import { ActiveInvitesPanel } from "./components/ActiveInvitesPanel";
import { CodeRedeemModal } from "./components/CodeRedeemModal";
import { CodeShowModal } from "./components/CodeShowModal";
import { CreateFolderModal } from "./components/CreateFolderModal";
import { ConflictResolverModal } from "./components/ConflictResolverModal";
import { FolderErrorsModal } from "./components/FolderErrorsModal";
import { FolderSettingsModal } from "./components/FolderSettingsModal";
import { SettingsModal } from "./components/SettingsModal";
import { TransferRatePill } from "./components/TransferRatePill";
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
import { DeviceRow } from "./components/DeviceRow";
import { EmptyState } from "./components/EmptyState";
import { FolderList } from "./components/FolderList";
import { Header } from "./components/Header";
import { LinkFolderModal, type LinkConfirmOptions } from "./components/LinkFolderModal";
import { pickStignoreForWorkload } from "./lib/unreal";
import { Statusbar } from "./components/Statusbar";

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
  const rate = useTransferRate(endpoint, ready);
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
  const peersConnected = useMemo(
    () =>
      peers.filter((d) => connectionsByID[d.deviceID]?.connected).length,
    [peers, connectionsByID],
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

  const headerTone = !ready
    ? "wait"
    : peers.length === 0
      ? "off"
      : peersConnected > 0
        ? "ok"
        : "wait";

  const isFirstRun =
    ready &&
    config.data !== null &&
    peers.length === 0 &&
    folders.length === 0 &&
    (pendingFolders.data?.length ?? 0) === 0 &&
    (pendingDevices.data?.length ?? 0) === 0;

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

  const onRename = async (f: Folder, newLabel: string) => {
    if (!endpoint) return;
    await putFolder(endpoint, { ...f, label: newLabel });
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
    <main className="min-h-screen bg-neutral-100 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 antialiased flex items-start justify-center pt-8 px-5 pb-8">
      <div className="w-full max-w-md rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/80 shadow-xl shadow-black/5 dark:shadow-black/40 p-5">
        <Header
          tone={headerTone}
          connected={peersConnected}
          total={peers.length}
          onScan={onScan}
          scanning={scanning}
          canScan={folders.length > 0}
          onOpenSettings={() => setModal({ kind: "settings" })}
        />

        {ready && peersConnected > 0 && (
          <div className="mt-3 flex justify-end">
            <TransferRatePill
              inBps={rate.inBps}
              outBps={rate.outBps}
              historyIn={rate.historyIn}
              historyOut={rate.historyOut}
              visible={true}
            />
          </div>
        )}

        {!updateDismissed && (
          <UpdateBanner
            state={updater.state}
            onInstall={updater.installAndRestart}
            onDismiss={() => setUpdateDismissed(true)}
          />
        )}

        {deletionSuggestion && (
          <div className="mt-4 flex items-start gap-3 px-3 py-2.5 rounded-xl border border-rose-300 dark:border-rose-500/40 bg-rose-50 dark:bg-rose-950/30">
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

        {isFirstRun ? (
          <EmptyState
            onCreateFolder={() => setModal({ kind: "create-folder" })}
            onRedeemCode={() => setModal({ kind: "code-redeem" })}
            onShowCode={() => setModal({ kind: "code-show" })}
          />
        ) : (
          <>
            {(pendingDevices.data?.length ?? 0) > 0 && modal?.kind !== "code-show" && (
              <section className="mt-5 space-y-2">
                {pendingDevices.data!.map((pd) => (
                  <div
                    key={pd.deviceID}
                    className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-blue-400/40 dark:border-blue-500/30 bg-blue-50 dark:bg-blue-950/30"
                  >
                    <div className="min-w-0 flex-1 text-xs">
                      <div className="font-medium text-blue-900 dark:text-blue-200 truncate">
                        {pd.name || pd.deviceID.slice(0, 7)} möchte sich verbinden
                      </div>
                      <p className="text-blue-700/80 dark:text-blue-300/80 truncate">
                        {pd.address}
                      </p>
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
              </section>
            )}

            <section className="mt-6">
              <p className="text-[11px] uppercase tracking-wider text-neutral-400 dark:text-neutral-500 mb-2">
                Geräte
              </p>
              <DeviceRow
                devices={devices}
                connections={connectionsByID}
                myID={myID}
              />
            </section>

            <section className="mt-5">
              <p className="text-[11px] uppercase tracking-wider text-neutral-400 dark:text-neutral-500 mb-2">
                Ordner
              </p>
              <FolderList
                linked={folders}
                pending={(pendingFolders.data ?? []).filter(
                  (pf) => !ignored.isIgnored(pf.folderID),
                )}
                endpoint={endpoint}
                ready={ready}
                devices={devices}
                connections={connectionsByID}
                myID={myID}
                onLink={onLink}
                onPauseToggle={onPauseToggle}
                onRename={onRename}
                onShowErrors={(f) => setModal({ kind: "folder-errors", folder: f })}
                onShowSettings={(f) => setModal({ kind: "folder-settings", folder: f })}
                onShowConflicts={(f) => setModal({ kind: "folder-conflicts", folder: f })}
              />
            </section>

            <section className="mt-5 flex gap-2">
              <button
                onClick={() => setModal({ kind: "create-folder" })}
                className="flex-1 text-xs font-medium px-3 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700"
              >
                + Ordner
              </button>
              <button
                onClick={() => setModal({ kind: "code-redeem" })}
                className="flex-1 text-xs font-medium px-3 py-2 rounded-lg border border-neutral-300 dark:border-neutral-700 text-neutral-700 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-neutral-800"
              >
                Code einlösen
              </button>
              <button
                onClick={() => setModal({ kind: "code-show" })}
                className="flex-1 text-xs font-medium px-3 py-2 rounded-lg border border-neutral-300 dark:border-neutral-700 text-neutral-700 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-neutral-800"
              >
                Code anzeigen
              </button>
            </section>

            <ActiveInvitesPanel />
          </>
        )}

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
      {modal?.kind === "create-folder" && endpoint && myID && (
        <CreateFolderModal
          endpoint={endpoint}
          myDeviceId={myID}
          onClose={() => setModal(null)}
        />
      )}
    </main>
  );
}

export default App;
