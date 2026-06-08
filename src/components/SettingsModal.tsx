import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Bell,
  Bug,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  FolderX,
  Info,
  Loader2,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import type { Folder } from "../lib/syncthing";
import { folderSettingsRead, type FolderDefaultsFile } from "../lib/folderSettings";
import { Modal } from "./Modal";
import type { Endpoint, SystemStatus } from "../lib/syncthing";
import type { UpdateState } from "../lib/updater";
import { ignoredFoldersRemove, useIgnoredFolders } from "../lib/ignored";

type Tab = "general" | "updates" | "notifications" | "ignored" | "power-user" | "diagnose";

export function SettingsModal({
  endpoint,
  status,
  version,
  updateState,
  onRecheckUpdates,
  onInstallUpdate,
  notificationsEnabled,
  onSetNotificationsEnabled,
  folders,
  onClose,
}: {
  endpoint: Endpoint | null;
  status: SystemStatus | null;
  version: string | null;
  updateState: UpdateState;
  onRecheckUpdates: () => void;
  onInstallUpdate: () => void;
  notificationsEnabled: boolean;
  onSetNotificationsEnabled: (v: boolean) => void;
  folders: Folder[];
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("general");
  const ignored = useIgnoredFolders();

  return (
    <Modal title="Einstellungen" size="wide" noPadding onClose={onClose}>
      <div className="flex h-full">
        {/* Sidebar Tabs */}
        <nav
          className="w-44 shrink-0 border-r border-neutral-200 dark:border-neutral-800 bg-neutral-50/60 dark:bg-neutral-950/40 py-3"
          aria-label="Einstellungs-Sektionen"
        >
          <TabButton
            label="Allgemein"
            icon={<Info className="size-3.5" />}
            active={tab === "general"}
            onClick={() => setTab("general")}
          />
          <TabButton
            label="Aktualisierung"
            icon={<RefreshCw className="size-3.5" />}
            active={tab === "updates"}
            onClick={() => setTab("updates")}
            badge={updateState.kind === "available" ? "neu" : undefined}
          />
          <TabButton
            label="Benachrichtigungen"
            icon={<Bell className="size-3.5" />}
            active={tab === "notifications"}
            onClick={() => setTab("notifications")}
          />
          <TabButton
            label="Ignorierte Ordner"
            icon={<FolderX className="size-3.5" />}
            active={tab === "ignored"}
            onClick={() => setTab("ignored")}
            badge={ignored.data.length > 0 ? String(ignored.data.length) : undefined}
          />
          <TabButton
            label="Power-User"
            icon={<ExternalLink className="size-3.5" />}
            active={tab === "power-user"}
            onClick={() => setTab("power-user")}
          />
          <TabButton
            label="Diagnose"
            icon={<Bug className="size-3.5" />}
            active={tab === "diagnose"}
            onClick={() => setTab("diagnose")}
          />
        </nav>

        {/* Tab Content */}
        <div className="flex-1 px-5 py-4 overflow-y-auto">
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
          {tab === "ignored" && (
            <IgnoredTab
              entries={ignored.data}
              onReactivate={async (id) => {
                await ignoredFoldersRemove(id).catch(() => {});
                ignored.refresh();
              }}
            />
          )}
          {tab === "power-user" && <PowerUserTab endpoint={endpoint} />}
          {tab === "diagnose" && <DiagnoseTab folders={folders} />}
        </div>
      </div>
    </Modal>
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
      className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 ${
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
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-600 text-white font-semibold tabular-nums">
          {badge}
        </span>
      )}
    </button>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[10px] uppercase tracking-wider text-neutral-400 dark:text-neutral-500 font-semibold mb-2">
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
            Peer verbindet sich · neuer Ordner verfügbar · Update bereit
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

function IgnoredTab({
  entries,
  onReactivate,
}: {
  entries: { folder_id: string; ignored_at: number; last_seen_label: string | null }[];
  onReactivate: (folderId: string) => void;
}) {
  if (entries.length === 0) {
    return (
      <div className="space-y-3">
        <SectionHeading>Ignorierte Ordner</SectionHeading>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          Keine ignorierten Ordner.
        </p>
        <p className="text-[11px] text-neutral-500 dark:text-neutral-500">
          Wenn du einen Ordner entfernst, erscheint er nicht mehr als
          „Verfügbar" und kann hier reaktiviert werden.
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <SectionHeading>Ignorierte Ordner ({entries.length})</SectionHeading>
      <p className="text-[11px] text-neutral-500 dark:text-neutral-500">
        Werden nicht als „Verfügbar" gezeigt, auch wenn ein Peer sie anbietet.
      </p>
      <div className="space-y-1.5">
        {entries.map((entry) => (
          <div
            key={entry.folder_id}
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50/40 dark:bg-neutral-900/40"
          >
            <FolderX className="size-3.5 text-neutral-400 dark:text-neutral-500 shrink-0" />
            <div className="min-w-0 flex-1 text-xs">
              <div className="text-neutral-900 dark:text-neutral-100 truncate">
                {entry.last_seen_label || entry.folder_id}
              </div>
              <div className="text-[10px] text-neutral-500 dark:text-neutral-500">
                Ignoriert{" "}
                {new Date(entry.ignored_at * 1000).toLocaleString("de-DE", {
                  day: "2-digit",
                  month: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </div>
            </div>
            <button
              onClick={() => onReactivate(entry.folder_id)}
              title="Reaktivieren — Ordner taucht wieder als Verfügbar auf"
              className="text-xs px-2 py-1 rounded-md border border-neutral-300 dark:border-neutral-700 text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 flex items-center gap-1"
            >
              <RotateCcw className="size-3" />
              Reaktivieren
            </button>
          </div>
        ))}
      </div>
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

function DiagnoseTab({ folders }: { folders: Folder[] }) {
  const [results, setResults] = useState<
    Record<string, { ok: boolean; file: FolderDefaultsFile | null; error?: string }>
  >({});
  const [running, setRunning] = useState(false);

  const runDiagnose = async () => {
    setRunning(true);
    const next: typeof results = {};
    for (const f of folders) {
      try {
        const file = await folderSettingsRead(f.path);
        next[f.id] = { ok: true, file };
      } catch (e) {
        next[f.id] = { ok: false, file: null, error: String(e) };
      }
    }
    setResults(next);
    setRunning(false);
  };

  return (
    <div className="space-y-3">
      <SectionHeading>Diagnose — Ordner-Defaults</SectionHeading>
      <p className="text-[11px] text-neutral-500 dark:text-neutral-500">
        Liest <code className="font-mono text-[10px]">.syncomat/folder-defaults.json</code>{" "}
        für jeden Ordner direkt von Disk und zeigt was drin steht. Hilft bei
        Sync-Problemen — Screenshot davon hilft beim Debuggen.
      </p>
      <button
        onClick={runDiagnose}
        disabled={running}
        className="text-xs font-medium px-3 py-1.5 rounded-lg border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-50 flex items-center gap-1.5"
      >
        {running ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <RefreshCw className="size-3.5" />
        )}
        Defaults von Disk lesen ({folders.length} Ordner)
      </button>

      <div className="space-y-2">
        {folders.map((f) => {
          const r = results[f.id];
          return (
            <details
              key={f.id}
              className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50/40 dark:bg-neutral-900/40 px-3 py-2"
            >
              <summary className="cursor-pointer text-xs font-medium text-neutral-900 dark:text-neutral-100 flex items-center gap-2">
                <span className="truncate flex-1">
                  {f.label || f.id}
                </span>
                {r && (
                  <span
                    className={
                      r.ok && r.file && r.file.settings.tags && r.file.settings.tags.length > 0
                        ? "text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 font-semibold"
                        : r.ok && r.file
                          ? "text-[10px] px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 font-semibold"
                          : "text-[10px] px-1.5 py-0.5 rounded bg-rose-100 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 font-semibold"
                    }
                  >
                    {r.ok && r.file && r.file.settings.tags?.length
                      ? `${r.file.settings.tags.length} Tag${r.file.settings.tags.length === 1 ? "" : "s"}`
                      : r.ok && r.file
                        ? "keine Tags"
                        : r.ok
                          ? "kein File"
                          : "Fehler"}
                  </span>
                )}
              </summary>
              <div className="text-[11px] text-neutral-600 dark:text-neutral-300 mt-2 space-y-1">
                <div className="font-mono text-[10px] text-neutral-500 dark:text-neutral-500 break-all">
                  {f.path}
                </div>
                {r ? (
                  r.ok && r.file ? (
                    <pre className="font-mono text-[10px] bg-neutral-100 dark:bg-neutral-900 px-2 py-1.5 rounded overflow-x-auto whitespace-pre-wrap">
                      {JSON.stringify(r.file, null, 2)}
                    </pre>
                  ) : r.ok ? (
                    <div className="text-neutral-500">
                      Kein <code className="font-mono">.syncomat/folder-defaults.json</code>{" "}
                      vorhanden.
                    </div>
                  ) : (
                    <div className="text-rose-600 dark:text-rose-400 break-all">
                      {r.error}
                    </div>
                  )
                ) : (
                  <div className="text-neutral-500">
                    Klick „Defaults von Disk lesen" oben.
                  </div>
                )}
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}

// Re-export für convenience
export { Loader2 };
