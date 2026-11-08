import { useEffect, useMemo, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

import {
  deletePendingDevice,
  ignorePendingFolder,
  patchDevice,
  putFolder,
  scanAllFolders,
  INTERN_FOLDER_ID,
  MAX_CONFLICTS,
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
import {
  useFastSubnet,
  useNetworkHints,
  useNetworkManual,
  usePrefer10GbE,
  usePrefer10GbE_apply,
} from "./lib/network";

import { invitePurgeExpired } from "./lib/invitesStore";
import { autoAcceptActive, disarmAutoAccept } from "./lib/autoAccept";
import { acceptDevice } from "./lib/pairing";
import { useFolderTags } from "./lib/tags";
import { useBlockBrowserShortcuts } from "./lib/keyboardShortcuts";
import {
  useNotificationTriggers,
  useNotificationsEnabled,
} from "./lib/notifications";
import { useAutostart } from "./lib/autostart";
import { useSyncMaintenance } from "./lib/maintenance";
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
  markIgnoresSeeded,
  useFolderSettingsReplication,
} from "./lib/folderSettings";
import { useUpdater } from "./lib/updater";
import { useUpdateAll } from "./lib/updateAll";
import { useInternFolder } from "./lib/internChannel";
import { isAboFolderId, useDatenzentrale } from "./lib/datenzentrale";
import { useAboAusfuehrung, useGeraeteRolle } from "./lib/abo";
import { useStatusDatei } from "./lib/statusDatei";
import { aboBeenden, istInhaltOrdner } from "./lib/nasProjekte";
import { useWuensche } from "./lib/wuensche";
import { useAusgeblendet } from "./lib/ausgeblendet";
import {
  setFolderIgnores,
  tuneFolderForSize,
} from "./lib/syncthing";
import { LinkFolderModal, type LinkConfirmOptions } from "./components/LinkFolderModal";
import { pickStignoreForWorkload } from "./lib/unreal";
import { Leiste, type Ansicht } from "./components/uebersicht/Leiste";
import { Uebersicht } from "./components/uebersicht/Uebersicht";
import { AuswahlFeld } from "./components/uebersicht/AuswahlFeld";
import { OrdnerAnAlle } from "./components/uebersicht/OrdnerAnAlle";
import { useUebersicht } from "./lib/uebersicht";
import { FolderInspector } from "./components/FolderInspector";
import { GlobalActivityView } from "./components/GlobalActivityView";
import { Statusbar } from "./components/Statusbar";

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

  // Der interne Kanal (syncomat-intern) ist kein Nutzer-Ordner: nirgends
  // anzeigen, nicht warten, nicht auto-sharen (er pflegt seine Geräte selbst).
  const folders = useMemo(
    () => (config.data?.folders ?? []).filter((f) => f.id !== INTERN_FOLDER_ID && !istInhaltOrdner(f)),
    [config.data?.folders],
  );
  const devices = config.data?.devices ?? [];
  const myID = status.data?.myID ?? null;
  const internFolder = useInternFolder(endpoint, ready, config.data ?? null, myID);
  // Angebote des internen Kanals (von Geräten, die ihn schon haben) nie als
  // „Verfügbar" zeigen — dieses Gerät legt ihn selbst an.
  const userPendingFolders = useMemo(
    // Abo-Ordner (dz-…) nie von Hand annehmen: sie entstehen nur über einen
    // Auftrag der Datenzentrale, mit Platz- und Laufwerksprüfung.
    () =>
      (pendingFolders.data ?? []).filter(
        (p) => p.folderID !== INTERN_FOLDER_ID && !isAboFolderId(p.folderID),
      ),
    [pendingFolders.data],
  );

  const aggregate = useAggregateStatus(endpoint, ready, folders);
  // Abo-Ordner (dz-…) verwaltet nur die Abo-Ausführung: ihre .stignore hat eine
  // LOKALE Auswahl-Schicht, die nie in die gemeinsame Ignore-Liste und nie über
  // folder-defaults/net-hints/Versionsnotizen in das Projekt geschrieben wird.
  const userFolders = useMemo(() => folders.filter((f) => !isAboFolderId(f.id)), [folders]);
  useFolderSettingsReplication(endpoint, ready, userFolders, myID);
  // Einmalige Wartung: setLowPriority aus, (?d)-Migration, ignorePerms, weakHash.
  useSyncMaintenance(endpoint, ready, userFolders);
  const tags = useFolderTags(folders);
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

  // ── Marlons Modell: "ein Gerät koppeln → alles im Umlauf bekommen" ──
  // Drei Automatiken, die genau das liefern. (In #1 entfernt um Bug-bedingte
  // Überraschungen zu stoppen — aber die Bugs (Config-Wipe, Geister-Delete,
  // Geister-Konflikte) sind seit v0.8.5–v0.9.1 gefixt. Auf dem stabilen Cluster
  // tun diese drei jetzt sauber ihren Job: Vollvernetzung + alles-überall.)

  // 1) Auto-Share-Reconciliation: jeder Ordner wird mit ALLEN bekannten Geräten
  // geteilt. So bekommt ein neu gekoppeltes Gerät automatisch alle Ordner im
  // Umlauf angeboten. putFolder ist idempotent, Syncthing dedupliziert devices[].
  useEffect(() => {
    if (!endpoint || !ready || !config.data || !myID) return;
    // Nur Ordner „an alle“: nicht der interne Kanal, nie Abo-Ordner (dz-…) —
    // ein abonniertes Projekt gehört nur den abonnierten Rechnern (E6, E28).
    const allFolders = config.data.folders.filter(
      (f) => f.id !== INTERN_FOLDER_ID && !isAboFolderId(f.id),
    );
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
    config.data?.folders.map((f) => `${f.id}|${f.devices.length}`).join(","),
    config.data?.devices.map((d) => d.deviceID).join(","),
  ]);

  // 2) Introducer-Migration: jedes Peer-Gerät als introducer markieren, damit der
  // Cluster sich bei jedem Pairing selbst vervollständigt (A stellt B und C
  // gegenseitig vor → Mesh statt Stern). Idempotent: PATCH nur wenn noch nicht
  // gesetzt; der dep-key enthält das introducer-Flag → kein Loop nach dem Flip.
  useEffect(() => {
    if (!endpoint || !ready || !config.data || !myID) return;
    for (const d of config.data.devices) {
      if (d.deviceID === myID || d.introducer) continue;
      patchDevice(endpoint, d.deviceID, { introducer: true }).catch((e) => {
        console.warn(`[introducer-migration] failed for ${d.deviceID.slice(0, 7)}`, e);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    endpoint?.url,
    endpoint?.api_key,
    ready,
    myID,
    config.data?.devices.map((d) => `${d.deviceID}|${d.introducer}`).join(","),
  ]);

  // 3) Auto-Accept nach Code: hat dieses Gerät kürzlich einen Einladungs-Code
  // erzeugt (autoAcceptActive = höchstens 15 min, bis zum ersten Gerät), wird
  // ein eingehendes Pending-Gerät automatisch akzeptiert — inkl. Ordner-Share +
  // Mesh via acceptDevice. Läuft auf App-Ebene, auch wenn das Code-Panel schon
  // zu ist. Details + Begründung: lib/autoAccept.ts.
  useEffect(() => {
    if (!endpoint || !ready) return;
    const pds = pendingDevices.data;
    if (!pds || pds.length === 0 || !autoAcceptActive()) return;
    // Nur bei genau EINEM anklopfenden Gerät automatisch annehmen — bei
    // mehreren ist unklar, welches den Code hat (Banner bleibt manuell).
    if (pds.length > 1) {
      console.warn("[auto-accept] mehrere Geräte gleichzeitig — nichts automatisch angenommen");
      return;
    }
    const pd = pds[0];
    // Fenster sofort schließen: ein Code = ein Gerät.
    disarmAutoAccept();
    acceptDevice(endpoint, pd, folders).catch((e) =>
      console.warn(`[auto-accept] ${pd.deviceID.slice(0, 7)} failed`, e),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    endpoint?.url,
    endpoint?.api_key,
    ready,
    pendingDevices.data?.map((d) => d.deviceID).join(","),
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
  const autostart = useAutostart();
  const rate = useTransferRate(endpoint, ready);
  const prefer10 = usePrefer10GbE();
  const fastSubnet = useFastSubnet();
  const netManual = useNetworkManual();
  // Beobachtet schnelle Adressen, synct sie cluster-weit (wenn aktiv) und liefert
  // die gemergte Karte (selbst gesehen ∪ manuell ∪ von Peers).
  const netHints = useNetworkHints(
    endpoint,
    ready,
    userFolders,
    myID,
    connectionsByID,
    netManual.manual,
    prefer10.enabled,
    fastSubnet.subnet,
  );
  // Pinnt die schnellen Adressen aus der gemergten Karte (wenn aktiv); Fallback bleibt.
  usePrefer10GbE_apply(endpoint, ready, devices, prefer10.enabled, netHints);
  const datenzentrale = useDatenzentrale();
  const geraeteRolle = useGeraeteRolle();
  const dzGueltig =
    !!datenzentrale.state.connection && (datenzentrale.state.check?.problems.length ?? 1) === 0;
  const abo = useAboAusfuehrung({
    ep: endpoint,
    ready,
    config: config.data ?? null,
    myID,
    rechner: dzGueltig ? datenzentrale.state.connection!.rechner : null,
    auftraege: datenzentrale.state.auftraege,
    rolle: geraeteRolle.rolle,
    sendBerichte: datenzentrale.sendBerichte,
  });
  useStatusDatei({
    ep: endpoint,
    ready,
    folders,
    myID,
    version,
    rechner: datenzentrale.state.connection?.rechner ?? null,
  });
  const updateAll = useUpdateAll({
    endpoint,
    ready,
    folders: internFolder ? [internFolder, ...userFolders] : userFolders,
    myID,
    myName: datenzentrale.state.computerName || undefined,
    version,
    updateState: updater.state,
    recheck: updater.recheck,
    installAndRestart: updater.installAndRestart,
  });
  const myName = devices.find((d) => d.deviceID === myID)?.name?.trim() || datenzentrale.state.computerName || "";
  const uebersicht = useUebersicht({
    ep: endpoint,
    ready,
    config: config.data ?? null,
    pending: pendingFolders.data ?? [],
    myID,
    myName,
    connections: connectionsByID,
    intern: internFolder,
    ohneSyncomat: updateAll.noChannel,
    rolle: geraeteRolle.rolle,
  });
  const ausgeblendet = useAusgeblendet();
  const wuensche = useWuensche({
    ep: endpoint,
    ready,
    config: config.data ?? null,
    pending: pendingFolders.data ?? [],
    intern: internFolder,
    myID,
    rolle: geraeteRolle.rolle,
    erledigtVon: uebersicht.erledigtVon,
    connections: connectionsByID,
  });
  useNotificationTriggers({
    enabled: notifications.enabled,
    connections: connectionsByID,
    devices,
    pendingDevices: pendingDevices.data ?? [],
    pendingFolders: userPendingFolders,
    updateState: updater.state,
    folderErrors: aggregate.folderErrors,
  });

  const isEmpty =
    ready &&
    config.data !== null &&
    peers.length === 0 &&
    folders.length === 0 &&
    userPendingFolders.length === 0 &&
    (pendingDevices.data?.length ?? 0) === 0;

  // "Schon mal eingerichtet?"-Marker (app_data, übersteht einen Config-Wipe).
  // Damit unterscheiden wir echten Erststart von einem Config-VERLUST und zeigen
  // im Verlust-Fall einen ehrlichen Recovery-Hinweis statt dem fröhlichen Welcome
  // (der so täte, als wäre alles normal — UX-Trust-Breaker #2).
  const [everSeen, setEverSeen] = useState(false);
  useEffect(() => {
    invoke<boolean>("config_ever_seen").then(setEverSeen).catch(() => {});
  }, []);
  useEffect(() => {
    if (folders.length > 0 || peers.length > 0) {
      setEverSeen(true);
      invoke("config_mark_seen").catch(() => {});
    }
  }, [folders.length, peers.length]);

  const isFirstRun = isEmpty && !everSeen;
  const isConfigLost = isEmpty && everSeen;

  // Selected folder als reine Ableitung (kein State-setzender Effekt mehr — das
  // war ein Render→setState→Render-Anti-Pattern). selectedFolderId hält nur die
  // EXPLIZITE Wahl (oder null/GLOBAL); der effektive Inspector-Folder fällt auf
  // den ersten Ordner zurück, wenn nichts Gültiges gewählt ist. effectiveSelectedId
  // geht an die Sidebar fürs Highlight, damit der Default-Ordner markiert bleibt.
  // Hauptbereiche (Leiste links) und die gewählte Zeile der Übersicht.
  const [ansicht, setAnsicht] = useState<Ansicht>("uebersicht");
  const [gewaehlt, setGewaehltRoh] = useState<string | null>(null);
  /** Gewählter Schnittpunkt Projekt × Rechner (Auswahlfeld rechts). */
  const [gewaehltRechner, setGewaehltRechner] = useState<string | null>(null);
  const setGewaehlt = (v: string | null | ((g: string | null) => string | null)) => {
    setGewaehltRoh(v);
    setGewaehltRechner(null);
  };
  const setSelectedFolderId = (id: string | null) => {
    setGewaehlt(id);
    setAnsicht("uebersicht");
  };
  const gewaehltSpalte = gewaehltRechner ? (uebersicht.spalten.find((s) => s.id === gewaehltRechner) ?? null) : null;
  const gewaehlteZeile = gewaehlt
    ? ([...uebersicht.projekte, ...uebersicht.plugins].find((z) => z.folderId === gewaehlt) ?? null)
    : null;
  // Native-Redesign: Inline-Panel das die Inspector/Activity-Ansicht überlagert
  // (Settings, Ordner anlegen, Code anzeigen/einlösen, Folder-Settings).
  const [panel, setPanel] = useState<Panel>(null);
  const visiblePending = userPendingFolders;

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
      // Konfliktverlierer als .sync-conflict-Kopie behalten (MAX_CONFLICTS).
      maxConflicts: MAX_CONFLICTS,
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
    // Die geteilte Ignore-Liste kommt per Sync von den anderen Geräten — keine
    // eigene schreiben, die würde sie als "neuere" überschreiben.
    markIgnoresSeeded(folder.id);
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
    await acceptDevice(endpoint, pd, folders);
  };

  const onIgnoreDevice = async (pd: PendingDevice) => {
    if (!endpoint) return;
    await deletePendingDevice(endpoint, pd.deviceID);
  };

  return (
    <main className="h-screen bg-[var(--sm-grund)] text-[var(--sm-text)] antialiased flex flex-col overflow-hidden">
      {!updateDismissed && (
        <UpdateBanner
          state={updater.state}
          onInstall={updater.installAndRestart}
          onDismiss={() => setUpdateDismissed(true)}
        />
      )}


      {(pendingDevices.data?.length ?? 0) > 0 &&
        panel?.kind !== "code-show" &&
        !autoAcceptActive() && (
        <div className="border-b border-[var(--sm-linie)] bg-[var(--sm-blau-flaeche)] shrink-0">
          {pendingDevices.data!.map((pd) => (
            <div key={pd.deviceID} className="flex items-center gap-2 px-4 py-2.5">
              <div className="min-w-0 flex-1 text-xs">
                <div className="font-semibold text-[var(--sm-text)] truncate">
                  {pd.name || pd.deviceID.slice(0, 7)} möchte sich verbinden
                </div>
                <p className="font-mono text-[var(--sm-text2)] truncate">{pd.address}</p>
              </div>
              <button
                onClick={() => onIgnoreDevice(pd)}
                className="text-xs px-2.5 py-1 rounded-md border border-[var(--sm-linie)] hover:bg-[var(--sm-flaeche)]"
              >
                Ablehnen
              </button>
              <button
                onClick={() => onAcceptDevice(pd)}
                className="text-xs font-semibold px-2.5 py-1 rounded-md bg-[var(--sm-blau)] text-white hover:brightness-110"
              >
                Akzeptieren
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        {isFirstRun && !panel && ansicht !== "einstellungen" ? (
          <FirstRunWelcome
            onCreateFolder={() => setPanel({ kind: "create-folder" })}
            onShowCode={() => setPanel({ kind: "code-show" })}
            onRedeemCode={() => setPanel({ kind: "code-redeem" })}
            onOpenSettings={() => setAnsicht("einstellungen")}
          />
        ) : isConfigLost && !panel && ansicht !== "einstellungen" ? (
          <RecoveryScreen
            onRedeemCode={() => setPanel({ kind: "code-redeem" })}
            onShowCode={() => setPanel({ kind: "code-show" })}
            onCreateFolder={() => setPanel({ kind: "create-folder" })}
          />
        ) : (
          <>
            <Leiste
              ansicht={ansicht}
              onAnsicht={(a) => {
                setPanel(null);
                setAnsicht(a);
              }}
              stoerungen={uebersicht.lage.stoerungen}
              angebote={visiblePending.length}
              update={updater.state.kind === "available"}
            />

            {ansicht === "einstellungen" && !(panel && panel.kind !== "settings") ? (
              <SettingsPanel
                endpoint={endpoint}
                status={status.data}
                version={version}
                updateState={updater.state}
                onRecheckUpdates={updater.recheck}
                onInstallUpdate={updater.installAndRestart}
                datenzentrale={datenzentrale}
                abo={abo}
                geraeteRolle={geraeteRolle}
                updateNotes={updateAll.notes}
                updateNoChannel={updateAll.noChannel}
                updateRequest={updateAll.request}
                onRequestUpdateAll={updateAll.requestAll}
                myID={myID}
                notificationsEnabled={notifications.enabled}
                onSetNotificationsEnabled={notifications.setEnabled}
                autostartEnabled={autostart.enabled}
                onSetAutostartEnabled={autostart.setEnabled}
                prefer10gbe={prefer10.enabled}
                onSetPrefer10gbe={prefer10.setEnabled}
                fastSubnet={fastSubnet.subnet}
                onSetFastSubnet={fastSubnet.setSubnet}
                peers={peers}
                connections={connectionsByID}
                hints={netHints}
                manual={netManual.manual}
                onSetManual={netManual.setManual}
                onBack={() => setAnsicht("uebersicht")}
                onGeraet={(id) => setPanel({ kind: "device-detail", deviceID: id })}
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
                onDecline={
                  endpoint
                    ? async () => {
                        const first = Object.values(panel.pending.offeredBy)[0];
                        await ignorePendingFolder(
                          endpoint,
                          panel.pending.folderID,
                          first?.label || panel.pending.folderID,
                          Object.keys(panel.pending.offeredBy),
                        );
                      }
                    : undefined
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
            ) : ansicht === "ordner" && !panel ? (
              <OrdnerAnAlle
                onAnlegen={() => setPanel({ kind: "create-folder" })}
                ordner={uebersicht.plugins.map((z) => ({
                  id: z.folderId,
                  name: z.name,
                  bytes: z.bytes,
                  stoerung: z.stoerung,
                  onOeffnen: () => setSelectedFolderId(z.folderId),
                }))}
                angebote={visiblePending.map((pf) => ({
                  id: pf.folderID,
                  name: Object.values(pf.offeredBy)[0]?.label || pf.folderID,
                  von: Object.keys(pf.offeredBy).map((id) => devices.find((d) => d.deviceID === id)?.name?.trim() || id.slice(0, 7)),
                  onAnnehmen: () => onLink(pf),
                  onAblehnen: async () => {
                    if (!endpoint) return;
                    await ignorePendingFolder(
                      endpoint,
                      pf.folderID,
                      Object.values(pf.offeredBy)[0]?.label || pf.folderID,
                      Object.keys(pf.offeredBy),
                    );
                  },
                }))}
              />
            ) : ansicht === "aktivitaet" && !panel ? (
              <GlobalActivityView
                folders={folders}
                tagsByFolderID={tagsByFolderID}
                endpoint={endpoint}
                ready={ready}
                onSelectFolder={(f) => setSelectedFolderId(f.id)}
              />
            ) : (
              <>
                <Uebersicht
                  spalten={uebersicht.spalten}
                  projekte={uebersicht.projekte}
                  plugins={uebersicht.plugins}
                  lage={uebersicht.lage}
                  gewaehlt={gewaehlt}
                  onZeile={(z) => {
                    // Projekt, das hier nicht abonniert ist: gleich die Auswahl für diesen Rechner zeigen.
                    if (z.art === "projekt" && !z.hier && myID) {
                      setGewaehltRoh(z.folderId);
                      setGewaehltRechner(myID);
                      return;
                    }
                    setGewaehlt((g) => (g === z.folderId ? null : z.folderId));
                  }}
                  onAbonnieren={(z) => {
                    setGewaehltRoh(z.folderId);
                    setGewaehltRechner(myID);
                  }}
                  gewaehltRechner={gewaehltRechner}
                  onZelle={(z, s) => {
                    const gleich = gewaehlt === z.folderId && gewaehltRechner === s.id;
                    setGewaehltRoh(gleich ? null : z.folderId);
                    setGewaehltRechner(gleich ? null : s.id);
                  }}
                  offeneWuensche={wuensche.eigene}
                  ausgeblendet={ausgeblendet.ids}
                  onRechner={(id) => (id === myID ? setAnsicht("einstellungen") : setPanel({ kind: "device-detail", deviceID: id }))}
                  onRechnerKoppeln={() => setPanel({ kind: "code-show" })}
                  onCodeEinloesen={() => setPanel({ kind: "code-redeem" })}
                  onNeuPruefen={() => void onScan()}
                  pruefe={scanning}
                />
                {gewaehlteZeile && gewaehltSpalte && gewaehlteZeile.art === "projekt" ? (
                  <AuswahlFeld
                    key={`${gewaehlteZeile.folderId}|${gewaehltSpalte.id}`}
                    ep={endpoint}
                    myID={myID}
                    rolle={geraeteRolle.rolle}
                    zeile={gewaehlteZeile}
                    spalte={gewaehltSpalte}
                    offenerWunsch={
                      wuensche.eigene.find((w) => w.ziel === gewaehltSpalte.id && w.folder_id === gewaehlteZeile.folderId) ?? null
                    }
                    ergebnisVomZiel={(() => {
                      const w = wuensche.neueste.get(`${gewaehltSpalte.id}|${gewaehlteZeile.folderId}`);
                      return (w && uebersicht.erledigtVon[gewaehltSpalte.id]?.find((e) => e.id === w.id)) ?? null;
                    })()}
                    laeuftHier={
                      !!wuensche.laeuft &&
                      [...wuensche.neueste.values()].some((w) => w.id === wuensche.laeuft && w.folder_id === gewaehlteZeile.folderId)
                    }
                    onSenden={(art, auswahl, vorher, loeschen) =>
                      wuensche.senden({ ziel: gewaehltSpalte.id, folder_id: gewaehlteZeile.folderId, name: gewaehlteZeile.name, art, auswahl, vorher, ...(art === "beenden" ? { loeschen: !!loeschen } : {}) })
                    }
                    onZuruecknehmen={wuensche.zuruecknehmen}
                    onSchliessen={() => setGewaehlt(null)}
                    aktionen={
                      gewaehlteZeile.hier
                        ? (() => {
                            const f = gewaehlteZeile.hier!;
                            const z = gewaehlteZeile.zellen[gewaehltSpalte.id];
                            return {
                              explorer: () => void invoke("reveal_in_file_manager", { path: f.path }).catch(() => {}),
                              details: () => setGewaehltRechner(null),
                              fortsetzen: f.paused ? () => void onPauseToggle(f) : null,
                              konflikte: z?.konflikte ? () => setPanel({ kind: "folder-conflicts", folder: f }) : null,
                              fehler: z?.dateifehler ? () => setPanel({ kind: "folder-errors", folder: f }) : null,
                            };
                          })()
                        : undefined
                    }
                    ausblenden={{
                      aus: ausgeblendet.ids.has(gewaehlteZeile.folderId),
                      setzen: (aus) => ausgeblendet.setzen(gewaehlteZeile.folderId, aus),
                    }}
                    onUeberallBeenden={async (loeschen) => {
                      const z = gewaehlteZeile;
                      const teile: string[] = [];
                      for (const sp of uebersicht.spalten) {
                        if (sp.ich) continue;
                        const c = z.zellen[sp.id];
                        if (!c || c.zustand === "nicht" || c.zustand === "unbekannt") continue;
                        if (!sp.kannWuensche || c.auswahl === undefined) {
                          teile.push(`${sp.name}: ältere Version — dort selbst beenden`);
                          continue;
                        }
                        wuensche.senden({ ziel: sp.id, folder_id: z.folderId, name: z.name, art: "beenden", auswahl: [], vorher: c.auswahl, loeschen });
                        teile.push(`${sp.name}: gesendet`);
                      }
                      if (z.hier && endpoint && myID) {
                        try {
                          teile.unshift(`Hier: ${await aboBeenden(endpoint, z.hier, myID, loeschen)}`);
                        } catch (e) {
                          teile.unshift(`Hier: ${e instanceof Error ? e.message : String(e)}`);
                        }
                      }
                      return teile.length ? teile.join(" · ") : "Auf keinem Rechner abonniert.";
                    }}
                  />
                ) : gewaehlteZeile?.hier ? (
                  <aside className="w-[380px] shrink-0 border-l border-[var(--sm-linie)] flex overflow-hidden">
                    <FolderInspector
                      folder={gewaehlteZeile.hier}
                      farbe={gewaehlteZeile.farbe}
                      onSchliessen={() => setGewaehlt(null)}
                      endpoint={endpoint}
                      ready={ready}
                      devices={devices}
                      connections={connectionsByID}
                      myID={myID}
                      tags={tagsByFolderID[gewaehlteZeile.hier.id] ?? []}
                      onPauseToggle={onPauseToggle}
                      onShowSettings={(f) => setPanel({ kind: "folder-settings", folder: f })}
                      onShowConflicts={(f) => setPanel({ kind: "folder-conflicts", folder: f })}
                      onShowErrors={(f) => setPanel({ kind: "folder-errors", folder: f })}
                      onAboBeenden={
                        endpoint && myID
                          ? async (f, loeschen) => {
                              const m = await aboBeenden(endpoint, f, myID, loeschen);
                              setGewaehlt(null);
                              return m;
                            }
                          : undefined
                      }
                    />
                  </aside>
                ) : null}
              </>
            )}
          </>
        )}
      </div>

      <div className="border-t border-[var(--sm-linie)] bg-[var(--sm-flaeche)] shrink-0 flex items-stretch">
        <div className="flex-1 px-4">
          <Statusbar
            ready={ready}
            aggregateState={aggregate.state}
            needBytes={aggregate.needBytes}
            errorCount={aggregate.errorCount}
            folderErrorLabels={aggregate.folderErrors.map((e) => e.label)}
            lastSyncAt={aggregate.lastUpdate}
            localFiles={aggregate.localFiles}
            localBytes={aggregate.localBytes}
            version={version}
            inBps={rate.inBps}
            outBps={rate.outBps}
          />
        </div>
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

        <div className="mt-6 pt-4 border-t border-neutral-200 dark:border-neutral-800 flex items-center justify-between text-[12px] text-neutral-500 dark:text-neutral-500">
          <span>Fenster schließen lässt den Sync im Tray weiterlaufen.</span>
          <button onClick={onOpenSettings} className="hover:text-neutral-900 dark:hover:text-neutral-100">
            Einstellungen →
          </button>
        </div>
      </div>
    </div>
  );
}

function RecoveryScreen({
  onRedeemCode,
  onShowCode,
  onCreateFolder,
}: {
  onRedeemCode: () => void;
  onShowCode: () => void;
  onCreateFolder: () => void;
}) {
  return (
    <div className="flex-1 flex items-center justify-center bg-white dark:bg-neutral-900 px-8 py-12">
      <div className="max-w-md w-full">
        <div className="size-10 rounded-md bg-amber-500 flex items-center justify-center text-white mb-4">
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
            <path d="M12 9v4" />
            <path d="M12 17h.01" />
          </svg>
        </div>
        <h1
          className="text-2xl font-bold text-neutral-900 dark:text-neutral-100 mb-2"
          style={{ textWrap: "balance" } as React.CSSProperties}
        >
          Deine Konfiguration ist leer — das ist unerwartet.
        </h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-6 leading-relaxed">
          Syncomat hatte schon Ordner oder Geräte, jetzt ist die Liste leer (z.B.
          nach einem fehlgeschlagenen Update).{" "}
          <span className="font-medium text-neutral-800 dark:text-neutral-200">
            Deine Dateien auf der Platte sind sicher
          </span>{" "}
          — nur die Sync-Verknüpfungen fehlen. So baust du sie wieder auf:
        </p>

        <div className="space-y-2">
          <button
            onClick={onRedeemCode}
            className="w-full text-left px-4 py-3 rounded-xl border border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-950/30 hover:bg-amber-100 dark:hover:bg-amber-950/50 focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:outline-none"
          >
            <div className="text-sm font-semibold text-amber-900 dark:text-amber-100">
              Mit einem anderen Gerät verbinden
            </div>
            <div className="text-xs text-amber-700/80 dark:text-amber-300/80 mt-0.5">
              Code einlösen — Ordner & Geräte kommen vom Cluster zurück.
            </div>
          </button>
          <button
            onClick={onShowCode}
            className="w-full text-left px-4 py-3 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50/40 dark:bg-neutral-900/40 hover:bg-neutral-100 dark:hover:bg-neutral-800/60 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
          >
            <div className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              Code erzeugen
            </div>
            <div className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
              Auf einem anderen Gerät einlösen, um neu zu koppeln.
            </div>
          </button>
          <button
            onClick={onCreateFolder}
            className="w-full text-left px-4 py-3 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50/40 dark:bg-neutral-900/40 hover:bg-neutral-100 dark:hover:bg-neutral-800/60 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
          >
            <div className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              Ordner neu verknüpfen
            </div>
            <div className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
              Lokalen Pfad wieder einbinden.
            </div>
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
