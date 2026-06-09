import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ArrowLeft,
  Bell,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  Info,
  Loader2,
  RefreshCw,
} from "lucide-react";
import type { Endpoint, SystemStatus } from "../lib/syncthing";
import type { UpdateState } from "../lib/updater";

type Tab = "general" | "updates" | "notifications" | "power-user";

/**
 * Einstellungen als INLINE-Ansicht im Hauptbereich (kein Overlay-Modal mehr).
 * Ersetzt den Inspector solange offen; „Zurück" kehrt zur vorigen Ansicht.
 * Teil von Welle 1 des Native-Redesigns (weg vom Web-App-Feel).
 */
export function SettingsPanel({
  endpoint,
  status,
  version,
  updateState,
  onRecheckUpdates,
  onInstallUpdate,
  notificationsEnabled,
  onSetNotificationsEnabled,
  onBack,
}: {
  endpoint: Endpoint | null;
  status: SystemStatus | null;
  version: string | null;
  updateState: UpdateState;
  onRecheckUpdates: () => void;
  onInstallUpdate: () => void;
  notificationsEnabled: boolean;
  onSetNotificationsEnabled: (v: boolean) => void;
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
            label="Aktualisierung"
            icon={<RefreshCw className="size-[15px]" />}
            active={tab === "updates"}
            onClick={() => setTab("updates")}
            badge={updateState.kind === "available" ? "neu" : undefined}
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
            {tab === "general" && <GeneralTab status={status} version={version} />}
            {tab === "updates" && (
              <UpdatesTab
                updateState={updateState}
                version={version}
                onRecheck={onRecheckUpdates}
                onInstall={onInstallUpdate}
              />
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
}: {
  status: SystemStatus | null;
  version: string | null;
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
}: {
  updateState: UpdateState;
  version: string | null;
  onRecheck: () => void;
  onInstall: () => void;
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
