import { useEffect, useMemo, useState } from "react";
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
import { ActiveInvitesPanel } from "./components/ActiveInvitesPanel";
import { CodeRedeemModal } from "./components/CodeRedeemModal";
import { CodeShowModal } from "./components/CodeShowModal";
import { DeviceRow } from "./components/DeviceRow";
import { EmptyState } from "./components/EmptyState";
import { FolderList } from "./components/FolderList";
import { Header } from "./components/Header";
import { LinkFolderModal } from "./components/LinkFolderModal";
import { Statusbar } from "./components/Statusbar";

type Modal =
  | null
  | { kind: "code-show" }
  | { kind: "code-redeem" }
  | { kind: "link"; pending: PendingFolder };

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

  const [modal, setModal] = useState<Modal>(null);
  const [scanning, setScanning] = useState(false);
  const [forceMain, setForceMain] = useState(false);

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

  const peers = devices.filter((d) => d.deviceID !== myID);
  const peersConnected = peers.filter(
    (d) => connectionsByID[d.deviceID]?.connected,
  ).length;

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
  ) => {
    if (!endpoint || !myID) throw new Error("Endpoint nicht bereit");
    const offerers = Object.keys(pending.offeredBy);
    const folder: Folder = {
      id: pending.folderID,
      label,
      path: localPath,
      type: "sendreceive",
      paused: false,
      devices: [
        { deviceID: myID },
        ...offerers.map((deviceID) => ({ deviceID })),
      ],
    };
    await putFolder(endpoint, folder);
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
        />

        {isFirstRun && !forceMain ? (
          <EmptyState
            onRedeemCode={() => setModal({ kind: "code-redeem" })}
            onShowCode={() => setModal({ kind: "code-show" })}
            onContinueAlone={() => setForceMain(true)}
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
                pending={pendingFolders.data ?? []}
                endpoint={endpoint}
                ready={ready}
                devices={devices}
                connections={connectionsByID}
                myID={myID}
                onLink={onLink}
                onPauseToggle={onPauseToggle}
                onRename={onRename}
              />
            </section>

            <section className="mt-5 flex gap-2">
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
        />
      </div>

      {modal?.kind === "link" && (
        <LinkFolderModal
          pending={modal.pending}
          onConfirm={(label, path) => onLinkConfirm(modal.pending, label, path)}
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
    </main>
  );
}

export default App;
