import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { CheckCircle2, Copy, ExternalLink, Loader2, RefreshCw, RotateCcw, FolderX } from "lucide-react";
import { Modal } from "./Modal";
import type { Endpoint, SystemStatus } from "../lib/syncthing";
import type { UpdateState } from "../lib/updater";
import {
  ignoredFoldersRemove,
  useIgnoredFolders,
} from "../lib/ignored";

export function SettingsModal({
  endpoint,
  status,
  version,
  updateState,
  onRecheckUpdates,
  onClose,
}: {
  endpoint: Endpoint | null;
  status: SystemStatus | null;
  version: string | null;
  updateState: UpdateState;
  onRecheckUpdates: () => void;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const ignored = useIgnoredFolders();

  const reactivate = async (folderId: string) => {
    try {
      await ignoredFoldersRemove(folderId);
      ignored.refresh();
    } catch (e) {
      console.warn("ignored-remove failed", e);
    }
  };

  const copy = async (val: string, key: string) => {
    try {
      await navigator.clipboard.writeText(val);
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    } catch (e) {
      console.warn("clipboard write failed", e);
    }
  };

  const updateLabel = (() => {
    switch (updateState.kind) {
      case "checking":
        return "Suche…";
      case "available":
        return `v${updateState.update.version} verfügbar`;
      case "up-to-date":
        return "Aktuell";
      case "error":
        return "Fehler";
      default:
        return "Jetzt suchen";
    }
  })();

  return (
    <Modal title="Einstellungen" onClose={onClose}>
      <div className="space-y-5">
        {/* Eigene Device-ID */}
        <section>
          <h3 className="text-[11px] uppercase tracking-wider text-neutral-400 dark:text-neutral-500 mb-2">
            Dieses Gerät
          </h3>
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
                  onClick={() => copy(status.myID, "device-id")}
                  className="shrink-0 mt-0.5 p-1.5 rounded-md text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-neutral-200/60 dark:hover:bg-neutral-800"
                  title="Kopieren"
                >
                  {copied === "device-id" ? (
                    <CheckCircle2 className="size-3.5 text-emerald-500" />
                  ) : (
                    <Copy className="size-3.5" />
                  )}
                </button>
              </div>
            </div>
          ) : (
            <p className="text-xs text-neutral-500">Lädt…</p>
          )}
        </section>

        {/* Updates */}
        <section>
          <h3 className="text-[11px] uppercase tracking-wider text-neutral-400 dark:text-neutral-500 mb-2">
            Aktualisierung
          </h3>
          <div className="flex items-center justify-between px-3 py-2.5 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50/40 dark:bg-neutral-900/40">
            <div className="text-xs">
              <div className="text-neutral-900 dark:text-neutral-100">
                Installiert: <span className="font-mono">v{version ?? "?"}</span>
              </div>
              <div className="text-neutral-500 dark:text-neutral-500 mt-0.5">
                {updateLabel}
              </div>
            </div>
            <button
              onClick={onRecheckUpdates}
              disabled={updateState.kind === "checking"}
              className="text-xs font-medium px-3 py-1.5 rounded-lg border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-50 flex items-center gap-1.5"
            >
              <RefreshCw
                className={`size-3.5 ${updateState.kind === "checking" ? "animate-spin" : ""}`}
              />
              Prüfen
            </button>
          </div>
        </section>

        {/* Power-User */}
        <section>
          <h3 className="text-[11px] uppercase tracking-wider text-neutral-400 dark:text-neutral-500 mb-2">
            Power-User
          </h3>
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
        </section>

        {/* Ignorierte Ordner */}
        {ignored.data.length > 0 && (
          <section>
            <h3 className="text-[11px] uppercase tracking-wider text-neutral-400 dark:text-neutral-500 mb-2">
              Ignorierte Ordner
            </h3>
            <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mb-2">
              Diese Ordner werden nicht als „Verfügbar" gezeigt, auch wenn ein
              Peer sie anbietet. Reaktiviere einen wenn du ihn doch wieder syncen
              willst.
            </p>
            <div className="space-y-1.5">
              {ignored.data.map((entry) => (
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
                    onClick={() => reactivate(entry.folder_id)}
                    title="Reaktivieren — Ordner taucht wieder als Verfügbar auf"
                    className="text-xs px-2 py-1 rounded-md border border-neutral-300 dark:border-neutral-700 text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 flex items-center gap-1"
                  >
                    <RotateCcw className="size-3" />
                    Reaktivieren
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        <div className="flex justify-end pt-2">
          <button
            onClick={onClose}
            className="text-xs font-medium px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700"
          >
            Fertig
          </button>
        </div>
      </div>
    </Modal>
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
      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50/40 dark:bg-neutral-900/40 hover:bg-neutral-100 dark:hover:bg-neutral-800/60 text-left disabled:opacity-50 disabled:cursor-not-allowed"
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
