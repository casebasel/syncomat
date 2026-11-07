import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ArrowLeft,
  Bell,
  CheckCircle2,
  Copy,
  Database,
  Download,
  ExternalLink,
  Info,
  Loader2,
  Network,
  Power,
  RefreshCw,
} from "lucide-react";
import type {
  Connection,
  Device,
  DeviceID,
  Endpoint,
  SystemStatus,
} from "../lib/syncthing";
import type { UpdateState } from "../lib/updater";
import { compareVersions, type UpdateNote } from "../lib/updateAll";
import type { DzAuftrag, useDatenzentrale } from "../lib/datenzentrale";
import type { AboEintrag, Bericht, useAboAusfuehrung, useGeraeteRolle } from "../lib/abo";
import { classifyPath, type NetPath } from "../lib/network";

type Tab = "general" | "network" | "updates" | "datenzentrale" | "notifications" | "power-user";

/**
 * Einstellungen als INLINE-Ansicht im Hauptbereich (kein Overlay-Modal mehr).
 * Ersetzt den Inspector solange offen; „Zurück" kehrt zur vorigen Ansicht.
 * Teil von Welle 1 des Native-Redesigns (weg vom Web-App-Feel).
 */
export function SettingsPanel({
  onGeraet,
  endpoint,
  status,
  version,
  updateState,
  onRecheckUpdates,
  onInstallUpdate,
  datenzentrale,
  abo,
  geraeteRolle,
  updateNotes,
  updateNoChannel,
  updateRequest,
  onRequestUpdateAll,
  myID,
  notificationsEnabled,
  onSetNotificationsEnabled,
  autostartEnabled,
  onSetAutostartEnabled,
  prefer10gbe,
  onSetPrefer10gbe,
  fastSubnet,
  onSetFastSubnet,
  peers,
  connections,
  hints,
  manual,
  onSetManual,
  onBack,
}: {
  onGeraet?: (deviceID: string) => void;
  endpoint: Endpoint | null;
  status: SystemStatus | null;
  version: string | null;
  updateState: UpdateState;
  onRecheckUpdates: () => void;
  onInstallUpdate: () => void;
  datenzentrale: ReturnType<typeof useDatenzentrale>;
  abo: ReturnType<typeof useAboAusfuehrung>;
  geraeteRolle: ReturnType<typeof useGeraeteRolle>;
  updateNotes: Record<DeviceID, UpdateNote>;
  updateNoChannel: Set<DeviceID>;
  updateRequest: { version: string; by: DeviceID } | null;
  onRequestUpdateAll: () => void;
  myID: DeviceID | null;
  notificationsEnabled: boolean;
  onSetNotificationsEnabled: (v: boolean) => void;
  autostartEnabled: boolean;
  onSetAutostartEnabled: (v: boolean) => void;
  prefer10gbe: boolean;
  onSetPrefer10gbe: (v: boolean) => void;
  fastSubnet: string;
  onSetFastSubnet: (v: string) => void;
  peers: Device[];
  connections: Record<DeviceID, Connection>;
  hints: Record<string, string>;
  manual: Record<string, string>;
  onSetManual: (deviceID: string, addr: string) => void;
  onBack: () => void;
}) {
  const [tab, setTab] = useState<Tab>("general");

  return (
    <section className="flex-1 flex flex-col overflow-hidden bg-white dark:bg-neutral-900">
      {/* Header mit Zurück */}
      <header className="px-6 py-4 border-b border-neutral-200/70 dark:border-neutral-800/70 flex items-center gap-3 shrink-0">
        <button
          onClick={onBack}
          className="size-8 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 flex items-center justify-center text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
          title="Zurück"
        >
          <ArrowLeft className="size-[18px]" />
        </button>
        <h1 className="text-lg font-bold tracking-tight">Einstellungen</h1>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Tab-Spalte */}
        <nav
          className="w-48 shrink-0 border-r border-neutral-200/70 dark:border-neutral-800/70 bg-neutral-50/60 dark:bg-neutral-950/40 py-3 overflow-y-auto"
          aria-label="Einstellungs-Sektionen"
        >
          <TabButton
            label="Allgemein"
            icon={<Info className="size-[15px]" />}
            active={tab === "general"}
            onClick={() => setTab("general")}
          />
          <TabButton
            label="Netzwerk"
            icon={<Network className="size-[15px]" />}
            active={tab === "network"}
            onClick={() => setTab("network")}
          />
          <TabButton
            label="Aktualisierung"
            icon={<RefreshCw className="size-[15px]" />}
            active={tab === "updates"}
            onClick={() => setTab("updates")}
            badge={updateState.kind === "available" ? "neu" : undefined}
          />
          <TabButton
            label="Datenzentrale"
            icon={<Database className="size-[15px]" />}
            active={tab === "datenzentrale"}
            onClick={() => setTab("datenzentrale")}
            badge={
              datenzentrale.state.check &&
              (datenzentrale.state.check.problems.length > 0 ||
                datenzentrale.state.check.warnings.length > 0)
                ? "!"
                : undefined
            }
          />
          <TabButton
            label="Benachrichtigungen"
            icon={<Bell className="size-[15px]" />}
            active={tab === "notifications"}
            onClick={() => setTab("notifications")}
          />
          <TabButton
            label="Power-User"
            icon={<ExternalLink className="size-[15px]" />}
            active={tab === "power-user"}
            onClick={() => setTab("power-user")}
          />
        </nav>

        {/* Tab-Inhalt — luftig, max-Breite damit Zeilen nicht zu breit werden */}
        <div className="flex-1 px-8 py-7 overflow-y-auto">
          <div className="max-w-xl">
            {tab === "general" && (
              <GeneralTab
                status={status}
                version={version}
                autostartEnabled={autostartEnabled}
                onSetAutostartEnabled={onSetAutostartEnabled}
              />
            )}
            {tab === "network" && (
              <NetworkTab
                prefer10gbe={prefer10gbe}
                onSetPrefer10gbe={onSetPrefer10gbe}
                fastSubnet={fastSubnet}
                onSetFastSubnet={onSetFastSubnet}
                peers={peers}
                connections={connections}
                hints={hints}
                manual={manual}
                onSetManual={onSetManual}
                onGeraet={onGeraet}
              />
            )}
            {tab === "updates" && (
              <UpdatesTab
                updateState={updateState}
                version={version}
                onRecheck={onRecheckUpdates}
                onInstall={onInstallUpdate}
                notes={updateNotes}
                noChannel={updateNoChannel}
                request={updateRequest}
                onRequestAll={onRequestUpdateAll}
                peers={peers}
                connections={connections}
                myID={myID}
              />
            )}
            {tab === "datenzentrale" && (
              <DatenzentraleTab dz={datenzentrale} abo={abo} geraeteRolle={geraeteRolle} />
            )}
            {tab === "notifications" && (
              <NotificationsTab
                enabled={notificationsEnabled}
                onSet={onSetNotificationsEnabled}
              />
            )}
            {tab === "power-user" && <PowerUserTab endpoint={endpoint} />}
          </div>
        </div>
      </div>
    </section>
  );
}

function TabButton({
  label,
  icon,
  active,
  onClick,
  badge,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
  badge?: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 ${
        active
          ? "bg-blue-100/70 dark:bg-blue-950/60 text-blue-900 dark:text-blue-100 font-semibold border-l-2 border-blue-600"
          : "text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200/60 dark:hover:bg-neutral-800/60 border-l-2 border-transparent"
      }`}
    >
      <span className={active ? "text-blue-600 dark:text-blue-300" : "text-neutral-400"}>
        {icon}
      </span>
      <span className="flex-1 truncate">{label}</span>
      {badge && (
        <span className="text-[11px] px-1.5 py-0.5 rounded bg-blue-600 text-white font-semibold tabular-nums">
          {badge}
        </span>
      )}
    </button>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[11px] uppercase tracking-wider text-neutral-400 dark:text-neutral-500 font-semibold mb-2.5">
      {children}
    </h3>
  );
}

function GeneralTab({
  status,
  version,
  autostartEnabled,
  onSetAutostartEnabled,
}: {
  status: SystemStatus | null;
  version: string | null;
  autostartEnabled: boolean;
  onSetAutostartEnabled: (v: boolean) => void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async (val: string) => {
    try {
      await navigator.clipboard.writeText(val);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.warn("clipboard write failed", e);
    }
  };

  return (
    <div className="space-y-4">
      <section>
        <SectionHeading>Verhalten</SectionHeading>
        <label className="flex items-start gap-3 cursor-pointer select-none px-3 py-2.5 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50/40 dark:bg-neutral-900/40">
          <div className="size-9 rounded-lg bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center text-neutral-500 dark:text-neutral-400 shrink-0">
            <Power className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
              Bei Anmeldung starten
            </div>
            <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
              Syncomat startet ab dem Login minimiert in der Taskleiste und
              synchronisiert weiter, ohne dass du die App manuell öffnen musst.
            </p>
          </div>
          <input
            type="checkbox"
            checked={autostartEnabled}
            onChange={(e) => onSetAutostartEnabled(e.target.checked)}
            className="mt-0.5 size-4 accent-blue-600"
          />
        </label>
        <p className="text-[11px] text-neutral-500 dark:text-neutral-500 mt-2">
          Gleicher Schalter wie der Haken „Bei Anmeldung starten" im Tray-Menü.
        </p>
      </section>

      <section>
        <SectionHeading>Dieses Gerät</SectionHeading>
        {status ? (
          <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50/40 dark:bg-neutral-900/40 px-3 py-2.5">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-[10px] text-neutral-500 dark:text-neutral-500">
                  Geräte-ID
                </div>
                <div className="font-mono text-[11px] text-neutral-700 dark:text-neutral-200 break-all">
                  {status.myID}
                </div>
              </div>
              <button
                onClick={() => copy(status.myID)}
                className="shrink-0 mt-0.5 p-1.5 rounded-md text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-neutral-200/60 dark:hover:bg-neutral-800"
                title="Kopieren"
              >
                {copied ? (
                  <CheckCircle2 className="size-3.5 text-emerald-500" />
                ) : (
                  <Copy className="size-3.5" />
                )}
              </button>
            </div>
          </div>
        ) : (
          <p className="text-xs text-neutral-500">Lade…</p>
        )}
      </section>

      <section>
        <SectionHeading>Version</SectionHeading>
        <div className="text-xs text-neutral-700 dark:text-neutral-300">
          Syncomat <span className="font-mono">v{version ?? "?"}</span>
        </div>
      </section>
    </div>
  );
}

function UpdatesTab({
  updateState,
  version,
  onRecheck,
  onInstall,
  notes,
  noChannel,
  request,
  onRequestAll,
  peers,
  connections,
  myID,
}: {
  updateState: UpdateState;
  version: string | null;
  onRecheck: () => void;
  onInstall: () => void;
  notes: Record<DeviceID, UpdateNote>;
  noChannel: Set<DeviceID>;
  request: { version: string; by: DeviceID } | null;
  onRequestAll: () => void;
  peers: Device[];
  connections: Record<DeviceID, Connection>;
  myID: DeviceID | null;
}) {
  const checking = updateState.kind === "checking";
  const available = updateState.kind === "available";
  const downloading = updateState.kind === "downloading";
  const ready = updateState.kind === "ready";
  const statusText = (() => {
    switch (updateState.kind) {
      case "checking":
        return "Suche…";
      case "available":
        return `v${updateState.update.version} verfügbar`;
      case "up-to-date":
        return "Aktuell";
      case "error":
        return updateState.message;
      case "downloading":
        return updateState.total
          ? `Lade… ${Math.round((updateState.downloaded / updateState.total) * 100)} %`
          : "Lade…";
      case "ready":
        return "Update bereit — App startet neu…";
      default:
        return "Bereit zum Prüfen";
    }
  })();
  const tone =
    updateState.kind === "error"
      ? "text-rose-500 dark:text-rose-400"
      : available
        ? "text-blue-600 dark:text-blue-400 font-medium"
        : "text-neutral-500 dark:text-neutral-400";

  return (
    <div className="space-y-3">
      <SectionHeading>Aktualisierung</SectionHeading>
      <div className="px-3 py-2.5 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50/40 dark:bg-neutral-900/40">
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs min-w-0">
            <div className="text-neutral-900 dark:text-neutral-100">
              Installiert: <span className="font-mono">v{version ?? "?"}</span>
            </div>
            <div className={`mt-0.5 truncate ${tone}`}>{statusText}</div>
          </div>
          {!available && !downloading && !ready && (
            <button
              onClick={onRecheck}
              disabled={checking}
              className="text-xs font-medium px-3 py-1.5 rounded-lg border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-50 flex items-center gap-1.5 shrink-0"
            >
              <RefreshCw className={`size-3.5 ${checking ? "animate-spin" : ""}`} />
              Prüfen
            </button>
          )}
        </div>

        {/* Download-Progress-Bar wenn downloading */}
        {downloading && updateState.total && (
          <div className="mt-2 h-1.5 rounded-full bg-neutral-200 dark:bg-neutral-800 overflow-hidden">
            <div
              className="h-full bg-blue-600 transition-all duration-150 ease-out"
              style={{
                width: `${Math.min(100, Math.round((updateState.downloaded / updateState.total) * 100))}%`,
              }}
            />
          </div>
        )}

        {/* Install-Action wenn Update verfügbar */}
        {available && (
          <div className="flex gap-2 mt-2.5">
            <button
              onClick={onInstall}
              className="flex-1 text-xs font-semibold px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 flex items-center justify-center gap-1.5 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
            >
              <Download className="size-3.5" />
              v{updateState.update.version} installieren
            </button>
            <button
              onClick={onRecheck}
              className="text-xs px-3 py-1.5 rounded-lg border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-300"
              title="Erneut prüfen"
            >
              <RefreshCw className="size-3.5" />
            </button>
          </div>
        )}

        {downloading && (
          <div className="mt-2 flex items-center justify-center gap-1.5 text-[11px] text-neutral-500 dark:text-neutral-400">
            <Loader2 className="size-3 animate-spin" /> App startet nach Download
            automatisch neu
          </div>
        )}
      </div>
      <p className="text-[11px] text-neutral-500 dark:text-neutral-500">
        Automatischer Check alle 6 Stunden. Updates werden mit
        Minisign-Signatur verifiziert bevor sie installiert werden.
      </p>

      <AllDevicesUpdate
        version={version}
        upToDate={updateState.kind === "up-to-date"}
        notes={notes}
        noChannel={noChannel}
        request={request}
        onRequestAll={onRequestAll}
        peers={peers}
        connections={connections}
        myID={myID}
      />
    </div>
  );
}

function NotificationsTab({
  enabled,
  onSet,
}: {
  enabled: boolean;
  onSet: (v: boolean) => void;
}) {
  return (
    <div className="space-y-3">
      <SectionHeading>Benachrichtigungen</SectionHeading>
      <label className="flex items-start gap-3 cursor-pointer select-none px-3 py-2.5 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50/40 dark:bg-neutral-900/40">
        <div className="size-9 rounded-lg bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center text-neutral-500 dark:text-neutral-400 shrink-0">
          <Bell className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
            System-Benachrichtigungen
          </div>
          <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
            Gerät verbindet sich · neuer Ordner verfügbar · Update bereit
          </p>
        </div>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onSet(e.target.checked)}
          className="mt-0.5 size-4 accent-blue-600"
        />
      </label>
      <p className="text-[11px] text-neutral-500 dark:text-neutral-500">
        Beim ersten Mal fragt das System nach Erlaubnis. Lehnst du ab, kann
        die App keine Benachrichtigungen schicken — Toggle bleibt aus.
      </p>
    </div>
  );
}

function netBadge(path: NetPath): { label: string; cls: string } | null {
  if (path === "fast")
    return { label: "10GbE", cls: "bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300" };
  if (path === "local")
    return { label: "lokal", cls: "bg-sky-100 dark:bg-sky-950/50 text-sky-700 dark:text-sky-300" };
  if (path === "slow")
    return { label: "langsam", cls: "bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300" };
  return null;
}

function NetworkTab({
  prefer10gbe,
  onSetPrefer10gbe,
  fastSubnet,
  onSetFastSubnet,
  peers,
  connections,
  hints,
  manual,
  onSetManual,
  onGeraet,
}: {
  prefer10gbe: boolean;
  onSetPrefer10gbe: (v: boolean) => void;
  fastSubnet: string;
  onSetFastSubnet: (v: string) => void;
  peers: Device[];
  connections: Record<DeviceID, Connection>;
  hints: Record<string, string>;
  manual: Record<string, string>;
  onSetManual: (deviceID: string, addr: string) => void;
  /** Gerät öffnen (Details, umbenennen, entfernen) — auch das NAS, das keine Spalte hat */
  onGeraet?: (deviceID: string) => void;
}) {
  return (
    <div className="space-y-5">
      <section>
        <SectionHeading>10GbE bevorzugen</SectionHeading>
        <label className="flex items-start gap-3 cursor-pointer select-none px-3 py-2.5 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50/40 dark:bg-neutral-900/40">
          <div className="size-9 rounded-lg bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center text-neutral-500 dark:text-neutral-400 shrink-0">
            <Network className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
              Schnelles Subnetz bevorzugen
            </div>
            <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
              Merkt die schnelle Adresse jedes Geräts, teilt sie clusterweit und
              hinterlegt sie fest — wird beim Verbinden bevorzugt. ZeroTier
              bleibt als Fallback.
            </p>
          </div>
          <input
            type="checkbox"
            checked={prefer10gbe}
            onChange={(e) => onSetPrefer10gbe(e.target.checked)}
            className="mt-0.5 size-4 accent-blue-600"
          />
        </label>
        <p className="text-[11px] text-neutral-500 dark:text-neutral-500 mt-2">
          „Weich": Syncthing behält die Verbindung, die zuerst steht. Die feste
          Adresse gewinnt im schnellen LAN meist das Connect-Rennen, aber nicht
          garantiert. Aus = zurück zu reinem Auto (dynamic).
        </p>
      </section>

      <section>
        <SectionHeading>Schnelles Subnetz (Präfix)</SectionHeading>
        <input
          type="text"
          value={fastSubnet}
          onChange={(e) => onSetFastSubnet(e.target.value)}
          spellCheck={false}
          className="w-full font-mono text-sm px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50/40 dark:bg-neutral-900/40 text-neutral-900 dark:text-neutral-100 focus:border-blue-500 focus-visible:outline-none"
          placeholder="192.168.100."
        />
        <p className="text-[11px] text-neutral-500 dark:text-neutral-500 mt-2">
          Adressen mit diesem Präfix gelten als „schnell" (10GbE). ZeroTier
          (<span className="font-mono">192.168.191.</span>) = langsam,
          IPv6-Link-Local (<span className="font-mono">fe80::</span>) = lokal.
        </p>
      </section>

      <section>
        <SectionHeading>Geräte-Pfade</SectionHeading>
        {peers.length === 0 ? (
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            Keine Geräte.
          </p>
        ) : (
          <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 divide-y divide-neutral-200 dark:divide-neutral-800">
            {peers.map((d) => {
              const c = connections[d.deviceID];
              const online = !!c?.connected;
              const badge = online ? netBadge(classifyPath(c?.address, fastSubnet)) : null;
              const knownFast = hints[d.deviceID]?.replace(/^tcp:\/\//, "");
              return (
                <div key={d.deviceID} className="px-3 py-2.5 text-[11px] space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="flex-1 truncate font-medium text-neutral-800 dark:text-neutral-200">
                      {d.name || d.deviceID.slice(0, 7)}
                    </span>
                    {onGeraet && (
                      <button
                        onClick={() => onGeraet(d.deviceID)}
                        className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        Details
                      </button>
                    )}
                    {!online ? (
                      <span className="text-neutral-400 dark:text-neutral-500">
                        offline
                      </span>
                    ) : (
                      <>
                        <span className="font-mono text-neutral-400 dark:text-neutral-500 truncate max-w-[140px]">
                          {c?.address}
                        </span>
                        {badge && (
                          <span className={`font-semibold px-1.5 py-0.5 rounded text-[10px] ${badge.cls}`}>
                            {badge.label}
                          </span>
                        )}
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-neutral-400 dark:text-neutral-500 shrink-0">
                      10GbE:
                    </span>
                    <input
                      type="text"
                      value={manual[d.deviceID] ?? ""}
                      onChange={(e) => onSetManual(d.deviceID, e.target.value)}
                      spellCheck={false}
                      placeholder={knownFast || "z.B. 192.168.100.50:22000"}
                      className="flex-1 font-mono text-[10px] px-2 py-1 rounded border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950/40 text-neutral-700 dark:text-neutral-200 placeholder:text-neutral-400 dark:placeholder:text-neutral-600 focus:border-blue-500 focus-visible:outline-none"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <p className="text-[11px] text-neutral-500 dark:text-neutral-500 mt-2">
          Adressen werden auto-gelernt + clusterweit geteilt. Für Geräte, die
          kein Node je auf 10GbE gesehen hat (z.B. NAS), die Adresse hier manuell
          eintragen. Platzhalter (grau) = bereits bekannter Wert.
        </p>
      </section>
    </div>
  );
}

function PowerUserTab({ endpoint }: { endpoint: Endpoint | null }) {
  return (
    <div className="space-y-3">
      <SectionHeading>Power-User</SectionHeading>
      <div className="space-y-2">
        <LinkRow
          title="Syncthing Web-UI öffnen"
          sub="Komplette Syncthing-Verwaltung im Browser"
          onClick={() => {
            if (endpoint) openUrl(endpoint.url).catch(() => {});
          }}
          disabled={!endpoint}
        />
        <LinkRow
          title="GitHub-Repository"
          sub="Source-Code + Releases + Issues"
          onClick={() =>
            openUrl("https://github.com/casebasel/syncomat").catch(() => {})
          }
        />
      </div>
      <p className="text-[11px] text-neutral-500 dark:text-neutral-500">
        Die Web-UI zeigt alle Syncthing-Internals (Block-Hash-Algorithmen,
        IPv6-Listener, ratelimits etc.). Nur reingehen wenn du weißt was du tust.
      </p>
    </div>
  );
}

function LinkRow({
  title,
  sub,
  onClick,
  disabled,
}: {
  title: string;
  sub: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50/40 dark:bg-neutral-900/40 hover:bg-neutral-100 dark:hover:bg-neutral-800/60 text-left disabled:opacity-50 disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
    >
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
          {title}
        </div>
        <p className="text-[11px] text-neutral-500 dark:text-neutral-400 truncate">
          {sub}
        </p>
      </div>
      <ExternalLink className="size-3.5 text-neutral-400 dark:text-neutral-500 shrink-0" />
    </button>
  );
}

// Re-export für convenience
export { Loader2 };

/** Versionen aller Geräte + Knopf „Alle Geräte auf vX aktualisieren". */
function AllDevicesUpdate({
  version,
  upToDate,
  notes,
  noChannel,
  request,
  onRequestAll,
  peers,
  connections,
  myID,
}: {
  version: string | null;
  upToDate: boolean;
  notes: Record<DeviceID, UpdateNote>;
  noChannel: Set<DeviceID>;
  request: { version: string; by: DeviceID } | null;
  onRequestAll: () => void;
  peers: Device[];
  connections: Record<DeviceID, Connection>;
  myID: DeviceID | null;
}) {
  const rows = [
    ...(myID ? [{ id: myID, name: "Dieses Gerät", online: true }] : []),
    ...peers.map((p) => ({
      id: p.deviceID,
      // Eigener Name des Geräts aus seiner Notiz, wenn es hier ohne Namen eingetragen ist.
      name: p.name?.trim() || notes[p.deviceID]?.name?.trim() || p.deviceID.slice(0, 7),
      online: !!connections[p.deviceID]?.connected,
    })),
  ];
  const nameOf = (id: DeviceID) => rows.find((r) => r.id === id)?.name ?? id.slice(0, 7);
  const requested = !!(request && version && compareVersions(request.version, version) >= 0);
  // Noch nicht auf der verlangten Version (Geräte mit syncomat).
  const pending =
    requested && request
      ? rows.filter((r) => {
          if (noChannel.has(r.id)) return false;
          const v = notes[r.id]?.version;
          return !v || compareVersions(v, request.version) < 0;
        })
      : [];
  // Fortschritt nur über eingeschaltete Geräte. Ausgeschaltete lesen die
  // Aufforderung beim nächsten Start aus dem internen Kanal und holen das
  // Update dann selbst — auf sie wird hier nicht gewartet.
  const waitingFor = pending.filter((r) => r.online);
  const later = pending.filter((r) => !r.online);
  const behindCount = version
    ? rows.filter((r) => {
        const v = notes[r.id]?.version;
        if (!v) return !noChannel.has(r.id);
        return compareVersions(v, version) < 0;
      }).length
    : 0;

  return (
    <section>
      <SectionHeading>Alle Geräte</SectionHeading>
      <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 divide-y divide-neutral-200 dark:divide-neutral-800">
        {rows.map((r) => {
          const v = notes[r.id]?.version;
          const old = !v || (version ? compareVersions(v, version) < 0 : false);
          const updating = waitingFor.some((w) => w.id === r.id);
          const folgt = later.some((w) => w.id === r.id);
          const justDone =
            requested && !!request && !!v && compareVersions(v, request.version) >= 0;
          return (
            <div key={r.id} className="px-3 py-2 flex items-center justify-between gap-3 text-xs">
              <span className="truncate text-neutral-800 dark:text-neutral-200">{r.name}</span>
              {updating ? (
                <span className="shrink-0 flex items-center gap-1.5 text-blue-600 dark:text-blue-400">
                  <Loader2 className="size-3 animate-spin" />
                  wird aktualisiert…
                </span>
              ) : folgt ? (
                <span className="shrink-0 text-neutral-500 dark:text-neutral-400">
                  ausgeschaltet · holt es beim Start
                </span>
              ) : (
                <span
                  className={`font-mono shrink-0 flex items-center gap-1 ${
                    justDone
                      ? "text-emerald-600 dark:text-emerald-400"
                      : old
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-neutral-500 dark:text-neutral-400"
                  }`}
                >
                  {justDone && <CheckCircle2 className="size-3" />}
                  {v ? `v${v}` : noChannel.has(r.id) ? "kein syncomat oder alt" : "unbekannt"}
                </span>
              )}
            </div>
          );
        })}
      </div>
      {(() => {
        const target = rows.filter((r) => !noChannel.has(r.id) && !later.some((w) => w.id === r.id)).length;
        const inProgress = requested && waitingFor.length > 0;
        const allDone = requested && waitingFor.length === 0;
        if (inProgress) {
          return (
            <div
              role="status"
              className="mt-2.5 w-full text-xs font-semibold px-3 py-1.5 rounded-lg bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-500/30 flex items-center justify-center gap-1.5"
            >
              <Loader2 className="size-3.5 animate-spin" />
              Updates werden installiert … {target - waitingFor.length} von {target}
            </div>
          );
        }
        if (allDone && later.length > 0) {
          return (
            <div
              role="status"
              className="mt-2.5 w-full text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/30 flex items-center justify-center gap-1.5"
            >
              <CheckCircle2 className="size-3.5" />
              Alle eingeschalteten Geräte auf v{request?.version}
            </div>
          );
        }
        if (allDone && behindCount === 0) {
          return (
            <div
              role="status"
              className="mt-2.5 w-full text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/30 flex items-center justify-center gap-1.5"
            >
              <CheckCircle2 className="size-3.5" />
              Alle Geräte auf v{request?.version}
            </div>
          );
        }
        return (
          <button
            onClick={onRequestAll}
            disabled={!upToDate || !version || behindCount === 0}
            className="mt-2.5 w-full text-xs font-semibold px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:hover:bg-blue-600 flex items-center justify-center gap-1.5 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
          >
            <Download className="size-3.5" />
            Alle Geräte auf v{version ?? "?"} aktualisieren
          </button>
        );
      })()}
      <p className="text-[11px] text-neutral-500 dark:text-neutral-500 mt-2">
        {requested && request
          ? waitingFor.length > 0
            ? `Angefordert: v${request.version} (von ${nameOf(request.by)}). Warte auf: ${waitingFor.map((r) => r.name).join(", ")} — jedes Gerät lädt, installiert und startet neu, das dauert 1–2 Minuten.${later.length > 0 ? ` Ausgeschaltet: ${later.map((r) => r.name).join(", ")} — holen das Update beim nächsten Start.` : ""}`
            : later.length > 0
              ? `Ausgeschaltet: ${later.map((r) => r.name).join(", ")} — holen v${request.version} beim nächsten Start selbst.`
              : `Alle Geräte melden v${request.version}.`
          : !upToDate
            ? "Erst dieses Gerät aktualisieren — der Knopf verteilt die Version, die hier läuft."
            : "Geräte mit älterer Version laden das signierte Release, installieren es und starten neu. „unbekannt“ = Gerät läuft noch eine Version ohne diese Funktion (einmal von Hand aktualisieren). „kein syncomat oder alt“ = reines Syncthing (z. B. der NAS-Hub) oder syncomat älter als v0.9.17."}
      </p>
    </section>
  );
}

/** Verbindung zur Datenzentrale + Aufträge dieses Rechners (Release 1: nur lesen). */
function DatenzentraleTab({
  dz,
  abo,
  geraeteRolle,
}: {
  dz: ReturnType<typeof useDatenzentrale>;
  abo: ReturnType<typeof useAboAusfuehrung>;
  geraeteRolle: ReturnType<typeof useGeraeteRolle>;
}) {
  const { state } = dz;
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<
    | { kind: "ok"; rechner: string; exp: Date | null; problems: string[]; warnings: string[] }
    | { kind: "error"; message: string }
    | null
  >(null);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const onText = async (t: string) => {
    setText(t);
    setSaveError(null);
    if (!t.trim()) return setPreview(null);
    const p = await dz.preview(t);
    setPreview(
      "error" in p
        ? { kind: "error", message: p.error }
        : { kind: "ok", rechner: p.creds.rechner, ...p.check },
    );
  };

  const fmtDate = (d: Date | null) => (d ? d.toLocaleDateString("de-CH") : "—");

  if (!state.connection) {
    const blocked = !preview || preview.kind === "error" || preview.problems.length > 0;
    return (
      <div className="space-y-4">
        <section>
          <SectionHeading>Datenzentrale verbinden</SectionHeading>
          <p className="text-xs text-neutral-600 dark:text-neutral-400 mb-2.5">
            Die vier Zeilen aus <span className="font-mono">datenagent-token-erzeugen.sh</span>{" "}
            einfügen. Das Token gilt nur für diesen Rechner
            {state.computerName ? ` (${state.computerName})` : ""} und wird im Schlüsselbund des
            Systems abgelegt.
          </p>
          <textarea
            value={text}
            onChange={(e) => void onText(e.target.value)}
            rows={5}
            spellCheck={false}
            placeholder={"STUDIO_DB_URL=…\nSTUDIO_DB_ANON_KEY=…\nSTUDIO_DB_TOKEN=…\nSTUDIO_DB_RECHNER=…"}
            className="w-full font-mono text-[11px] px-3 py-2 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-950 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
          />
          {preview?.kind === "error" && (
            <p className="text-[11px] text-rose-600 dark:text-rose-400 mt-1.5">{preview.message}</p>
          )}
          {preview?.kind === "ok" && (
            <div className="text-[11px] mt-1.5 space-y-0.5">
              <div className="text-neutral-600 dark:text-neutral-400">
                Rechner <span className="font-mono">{preview.rechner}</span> · gültig bis{" "}
                {fmtDate(preview.exp)}
              </div>
              {preview.problems.map((p) => (
                <div key={p} className="text-rose-600 dark:text-rose-400">{p}</div>
              ))}
              {preview.warnings.map((w) => (
                <div key={w} className="text-amber-600 dark:text-amber-400">{w}</div>
              ))}
            </div>
          )}
          {saveError && (
            <p className="text-[11px] text-rose-600 dark:text-rose-400 mt-1.5">{saveError}</p>
          )}
          <button
            disabled={blocked || busy}
            onClick={async () => {
              setBusy(true);
              const err = await dz.connect(text);
              setBusy(false);
              if (err) setSaveError(err);
              else {
                setText("");
                setPreview(null);
              }
            }}
            className="mt-2.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:hover:bg-blue-600 flex items-center gap-1.5 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Database className="size-3.5" />}
            Verbinden
          </button>
        </section>
      </div>
    );
  }

  const host = (() => {
    try {
      return new URL(state.connection.url).host;
    } catch {
      return state.connection.url;
    }
  })();

  return (
    <div className="space-y-4">
      <section>
        <SectionHeading>Datenzentrale</SectionHeading>
        <div className="px-3 py-2.5 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50/40 dark:bg-neutral-900/40 text-xs space-y-1">
          <div className="flex items-center justify-between gap-3">
            <span className="text-neutral-900 dark:text-neutral-100">
              Verbunden als <span className="font-mono">{state.connection.rechner}</span>
            </span>
            <button
              onClick={() => void dz.disconnect()}
              className="text-[11px] px-2.5 py-1 rounded-md border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              Trennen
            </button>
          </div>
          <div className="text-neutral-500 dark:text-neutral-400">
            {host} · Token gültig bis {fmtDate(state.check?.exp ?? null)}
            {state.lastFetch ? ` · zuletzt gelesen ${state.lastFetch.toLocaleTimeString("de-CH")}` : ""}
          </div>
          {state.check?.problems.map((p) => (
            <div key={p} className="text-rose-600 dark:text-rose-400">{p}</div>
          ))}
          {state.check?.warnings.map((w) => (
            <div key={w} className="text-amber-600 dark:text-amber-400">{w}</div>
          ))}
          {state.error && <div className="text-rose-600 dark:text-rose-400">{state.error}</div>}
        </div>
      </section>

      <section>
        <SectionHeading>Rolle dieses Rechners</SectionHeading>
        <div className="flex gap-2">
          {(["arbeitsplatz", "render"] as const).map((r) => (
            <button
              key={r}
              onClick={() => geraeteRolle.setRolle(r)}
              className={`text-xs px-3 py-1.5 rounded-lg border ${
                geraeteRolle.rolle === r
                  ? "border-blue-500 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 font-semibold"
                  : "border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              }`}
            >
              {r === "arbeitsplatz" ? "Arbeitsplatz" : "Render-Rechner"}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-neutral-500 dark:text-neutral-500 mt-2">
          Bestimmt, was ein Abo auf diesem Rechner auslässt: Arbeitsplatz ohne Saved/Config und
          Saved/Concert, Render-Rechner ohne ganz Saved/. Gilt für neue Abos.
        </p>
      </section>

      <section>
        <SectionHeading>Aufträge für diesen Rechner</SectionHeading>
        {state.auftraege.length === 0 ? (
          <p className="text-xs text-neutral-500 dark:text-neutral-400">Keine Aufträge.</p>
        ) : (
          <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 divide-y divide-neutral-200 dark:divide-neutral-800">
            {state.auftraege.map((a) => (
              <AuftragRow
                key={a.id}
                a={a}
                lokal={abo.zustand[a.id]}
                berichte={abo.berichte.filter((b) => b.auftrag_id === a.id)}
              />
            ))}
          </div>
        )}
        <p className="text-[11px] text-neutral-500 dark:text-neutral-500 mt-2">
          Aufträge legt die Datenzentrale an (Seite des Speicher-Wächters). Syncomat führt
          „Abonnieren“ selbst aus: Projekt nach D:\&lt;NAME&gt;, nur mit dem NAS abgeglichen, nur in
          ein leeres Ziel, mit Platzprüfung. Abo beenden und Pausieren folgen.
        </p>
      </section>
    </div>
  );
}

function AuftragRow({ a, lokal, berichte }: { a: DzAuftrag; lokal?: AboEintrag; berichte: Bericht[] }) {
  const offen = berichte.filter((b) => !b.gesendet);
  const abgelehnt = berichte.filter((b) => b.abgelehnt);
  const berichtText =
    abgelehnt.length > 0
      ? `Bericht abgelehnt: ${abgelehnt[abgelehnt.length - 1]!.abgelehnt}`
      : offen.length > 0
        ? `${offen.length} Bericht${offen.length === 1 ? "" : "e"} wartet${offen[offen.length - 1]!.letzterFehler ? ` (${offen[offen.length - 1]!.letzterFehler})` : ""}`
        : berichte.length > 0
          ? "an die Datenzentrale gemeldet"
          : "";
  const g = (a.angaben ?? {}) as Record<string, unknown>;
  const name = typeof g.name === "string" ? g.name : typeof g.projekt_id === "string" ? g.projekt_id : "";
  const auswahl = Array.isArray(g.auswahl) && g.auswahl.length > 0 ? (g.auswahl as string[]).join(", ") : "ganz";
  const label = a.art === "abonnieren" ? "Abonnieren" : a.art === "abo_beenden" ? "Abo beenden" : a.art === "pausieren" ? "Pausieren" : a.art;
  return (
    <div className="px-3 py-2 text-xs flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="text-neutral-900 dark:text-neutral-100 truncate">
          {label}
          {name ? ` · ${name}` : ""}
          {a.art === "abonnieren" ? ` · ${auswahl}` : ""}
        </div>
        <div className="font-mono text-[10px] text-neutral-500 dark:text-neutral-500 truncate">{a.id}</div>
        {lokal?.grund && (
          <div
            className={`text-[11px] mt-0.5 ${
              lokal.zustand === "abgelehnt" || lokal.zustand === "abgebrochen"
                ? "text-rose-600 dark:text-rose-400"
                : "text-neutral-500 dark:text-neutral-400"
            }`}
          >
            {lokal.grund}
          </div>
        )}
        {berichtText && (
          <div
            className={`text-[10px] mt-0.5 ${abgelehnt.length > 0 ? "text-rose-600 dark:text-rose-400" : "text-neutral-400 dark:text-neutral-500"}`}
          >
            {berichtText}
          </div>
        )}
      </div>
      <span
        className={`shrink-0 ${
          lokal?.zustand === "fertig"
            ? "text-emerald-600 dark:text-emerald-400"
            : lokal?.zustand === "abgelehnt" || lokal?.zustand === "abgebrochen"
              ? "text-rose-600 dark:text-rose-400"
              : "text-neutral-500 dark:text-neutral-400"
        }`}
      >
        {lokal ? ZUSTAND_TEXT[lokal.zustand] : a.zustand}
      </span>
    </div>
  );
}

const ZUSTAND_TEXT: Record<AboEintrag["zustand"], string> = {
  angenommen: "angenommen",
  laeuft: "läuft",
  fertig: "fertig",
  abgelehnt: "abgelehnt",
  abgebrochen: "abgebrochen",
};
