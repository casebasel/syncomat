import { useMemo } from "react";
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Ban,
  CheckCircle2,
  FileX,
  FolderOpen,
  Pencil,
  PauseCircle,
  RefreshCw,
} from "lucide-react";
import {
  fmtActivityBytes,
  fmtActivityTime,
  useAllActivity,
  type ActivityEvent,
} from "../lib/activity";
import {
  useFolderStatuses,
  type Endpoint,
  type Folder,
  type FolderStatus,
} from "../lib/syncthing";

const UNTAGGED = "Ohne Tag";

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1048576).toFixed(1)} MB`;
  return `${(n / 1073741824).toFixed(2)} GB`;
}

function fmtCount(n: number): string {
  if (n < 1000) return `${n}`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

type Agg = {
  bytes: number;
  files: number;
  syncing: number;
  errors: number;
  needBytes: number;
};

function aggOf(
  folders: Folder[],
  statuses: Record<string, FolderStatus | null>,
): Agg {
  let bytes = 0,
    files = 0,
    syncing = 0,
    errors = 0,
    needBytes = 0;
  for (const f of folders) {
    const s = statuses[f.id];
    if (!s) continue;
    bytes += s.localBytes || 0;
    files += s.localFiles || 0;
    needBytes += s.needBytes || 0;
    if ((s.needBytes || 0) > 0) syncing++;
    if ((s.errors || 0) + (s.pullErrors || 0) > 0) errors++;
  }
  return { bytes, files, syncing, errors, needBytes };
}

type RowState = "paused" | "error" | "syncing" | "synced";
function rowState(folder: Folder, s: FolderStatus | null): RowState {
  if (folder.paused) return "paused";
  if (((s?.errors ?? 0) + (s?.pullErrors ?? 0)) > 0) return "error";
  if ((s?.needBytes ?? 0) > 0) return "syncing";
  return "synced";
}

export function GlobalActivityView({
  folders,
  tagsByFolderID,
  endpoint,
  ready,
  onSelectFolder,
}: {
  folders: Folder[];
  tagsByFolderID: Record<string, string[]>;
  endpoint: Endpoint | null;
  ready: boolean;
  /** Klick auf Folder-Pille in einer Zeile → wechselt zum Folder-Inspector */
  onSelectFolder: (f: Folder) => void;
}) {
  const items = useAllActivity();
  const statuses = useFolderStatuses(endpoint, ready, folders);

  const folderById = useMemo(() => {
    const map = new Map<string, Folder>();
    for (const f of folders) map.set(f.id, f);
    return map;
  }, [folders]);

  // Gruppierung nach primärem Tag — gleiche Logik wie die Sidebar.
  const groups = useMemo(() => {
    const byTag = new Map<string, Folder[]>();
    for (const f of folders) {
      const primary = tagsByFolderID[f.id]?.[0] ?? UNTAGGED;
      const list = byTag.get(primary);
      if (list) list.push(f);
      else byTag.set(primary, [f]);
    }
    const order = Array.from(byTag.keys()).sort((a, b) =>
      a === UNTAGGED ? 1 : b === UNTAGGED ? -1 : a.localeCompare(b),
    );
    return order.map((tag) => ({ tag, folders: byTag.get(tag)! }));
  }, [folders, tagsByFolderID]);

  const totals = useMemo(() => aggOf(folders, statuses), [folders, statuses]);

  return (
    <section className="flex-1 flex flex-col overflow-hidden bg-white dark:bg-neutral-900">
      {/* Header — Gesamt-Zusammenfassung */}
      <header className="px-6 py-4 border-b border-neutral-200 dark:border-neutral-800 flex items-start gap-3">
        <div className="size-10 rounded-lg bg-neutral-200/70 dark:bg-neutral-800 flex items-center justify-center text-neutral-500 dark:text-neutral-400 shrink-0">
          <FolderOpen className="size-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold text-neutral-900 dark:text-neutral-100">
            Alle Ordner
          </h1>
          <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-1 tabular-nums">
            {folders.length} Ordner · {fmtSize(totals.bytes)} ·{" "}
            {fmtCount(totals.files)} Dateien
            {totals.syncing > 0 && (
              <span className="text-blue-600 dark:text-blue-400">
                {" "}
                · {totals.syncing} syncen ({fmtSize(totals.needBytes)})
              </span>
            )}
            {totals.errors > 0 && (
              <span className="text-rose-600 dark:text-rose-400">
                {" "}
                · {totals.errors} mit Fehler
              </span>
            )}
          </p>
        </div>
      </header>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
        {/* Tag-Karten (Zusammenfassungen den Tags untergeordnet) */}
        {groups.length > 0 && (
          <div className="space-y-3">
            {groups.map((g) => (
              <TagCard
                key={g.tag}
                tag={g.tag}
                folders={g.folders}
                statuses={statuses}
                onSelectFolder={onSelectFolder}
              />
            ))}
          </div>
        )}

        {/* Aktivität · alle Ordner (Feed) */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <div className="text-[10px] uppercase tracking-wider text-neutral-400 dark:text-neutral-500 font-semibold">
              Aktivität · alle Ordner
            </div>
            <div className="text-[10px] text-neutral-400 dark:text-neutral-500">
              letzte 200 Events
            </div>
          </div>

          {items.length === 0 ? (
            <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 px-3 py-4 text-center">
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                Noch keine Aktivität in dieser Session. Sync läuft im Hintergrund.
              </p>
            </div>
          ) : (
            <div
              role="log"
              aria-live="polite"
              aria-label="Aktivität alle Ordner"
              className="rounded-lg border border-neutral-200 dark:border-neutral-800 divide-y divide-neutral-200 dark:divide-neutral-800"
            >
              {items.map((e) => (
                <ActivityRow
                  key={e.id}
                  event={e}
                  folder={folderById.get(e.folderId)}
                  onSelectFolder={onSelectFolder}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function TagCard({
  tag,
  folders,
  statuses,
  onSelectFolder,
}: {
  tag: string;
  folders: Folder[];
  statuses: Record<string, FolderStatus | null>;
  onSelectFolder: (f: Folder) => void;
}) {
  const agg = aggOf(folders, statuses);
  return (
    <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 overflow-hidden">
      <div className="px-3 py-2 bg-neutral-50 dark:bg-neutral-800/40 flex items-center gap-2 flex-wrap">
        <span className="text-xs font-semibold text-neutral-700 dark:text-neutral-200">
          {tag === UNTAGGED ? tag : `#${tag}`}
        </span>
        <span className="text-[11px] text-neutral-400 dark:text-neutral-500 tabular-nums">
          {folders.length} Ordner · {fmtSize(agg.bytes)} · {fmtCount(agg.files)}{" "}
          Dateien
        </span>
        <span className="ml-auto">
          {agg.errors > 0 ? (
            <StatusPill color="rose" Icon={AlertCircle}>
              {agg.errors} mit Fehler
            </StatusPill>
          ) : agg.syncing > 0 ? (
            <StatusPill color="blue" Icon={RefreshCw} spin>
              {agg.syncing} syncen
            </StatusPill>
          ) : (
            <StatusPill color="emerald" Icon={CheckCircle2}>
              synchron
            </StatusPill>
          )}
        </span>
      </div>
      <div className="divide-y divide-neutral-100 dark:divide-neutral-800/60">
        {folders.map((f) => (
          <FolderStatRow
            key={f.id}
            folder={f}
            status={statuses[f.id] ?? null}
            onSelect={onSelectFolder}
          />
        ))}
      </div>
    </div>
  );
}

function StatusPill({
  color,
  Icon,
  spin,
  children,
}: {
  color: "rose" | "blue" | "emerald";
  Icon: typeof CheckCircle2;
  spin?: boolean;
  children: React.ReactNode;
}) {
  const cls =
    color === "rose"
      ? "bg-rose-100 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300"
      : color === "blue"
        ? "bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300"
        : "bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300";
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded ${cls}`}
    >
      <Icon className={`size-3 ${spin ? "animate-spin" : ""}`} />
      {children}
    </span>
  );
}

function FolderStatRow({
  folder,
  status,
  onSelect,
}: {
  folder: Folder;
  status: FolderStatus | null;
  onSelect: (f: Folder) => void;
}) {
  const state = rowState(folder, status);
  const needBytes = status?.needBytes ?? 0;
  const errors = (status?.errors ?? 0) + (status?.pullErrors ?? 0);
  const dot =
    state === "error"
      ? "bg-rose-500"
      : state === "syncing"
        ? "bg-blue-500 animate-pulse"
        : state === "paused"
          ? "bg-neutral-400"
          : "bg-emerald-500";
  return (
    <button
      onClick={() => onSelect(folder)}
      className="w-full px-3 py-2 flex items-center gap-2.5 text-left hover:bg-neutral-50 dark:hover:bg-neutral-800/40 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
    >
      <span className={`size-2 rounded-full shrink-0 ${dot}`} />
      <span className="text-[13px] font-medium text-neutral-800 dark:text-neutral-100 truncate flex-1">
        {folder.label || folder.id}
      </span>
      <span className="text-[11px] text-neutral-400 dark:text-neutral-500 tabular-nums shrink-0">
        {fmtSize(status?.localBytes ?? 0)} · {fmtCount(status?.localFiles ?? 0)}
      </span>
      <span className="text-[11px] tabular-nums shrink-0 w-28 text-right">
        {state === "syncing" ? (
          <span className="text-blue-600 dark:text-blue-400">
            lädt {fmtSize(needBytes)}
          </span>
        ) : state === "error" ? (
          <span className="text-rose-600 dark:text-rose-400">
            {errors} Fehler
          </span>
        ) : state === "paused" ? (
          <span className="inline-flex items-center gap-1 text-neutral-400 dark:text-neutral-500">
            <PauseCircle className="size-3" /> pausiert
          </span>
        ) : (
          <span className="text-emerald-600 dark:text-emerald-400">✓ synchron</span>
        )}
      </span>
    </button>
  );
}

function ActivityRow({
  event,
  folder,
  onSelectFolder,
}: {
  event: ActivityEvent;
  folder: Folder | undefined;
  onSelectFolder: (f: Folder) => void;
}) {
  const isConflict = event.direction === "conflict" || event.action === "conflict";
  const Icon = directionIcon(event);
  const iconColor = directionColor(event);
  const peerLabel =
    event.direction === "up"
      ? `→ ${event.peer || "peer"}`
      : event.peer || (event.direction === "local" ? "lokal" : "");

  return (
    <div
      className={`px-3 py-2 flex items-center gap-3 ${isConflict ? "bg-amber-50/50 dark:bg-amber-950/15" : "hover:bg-neutral-50 dark:hover:bg-neutral-800/40"}`}
    >
      <span className="text-[10px] text-neutral-400 dark:text-neutral-500 w-12 font-mono shrink-0">
        {fmtActivityTime(event.ts)}
      </span>
      <span className={`shrink-0 ${iconColor}`}>
        <Icon className="size-3.5" />
      </span>
      <span className="text-[10px] text-neutral-500 dark:text-neutral-500 font-mono w-14 truncate shrink-0">
        {peerLabel}
      </span>
      {folder ? (
        <button
          onClick={() => onSelectFolder(folder)}
          className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 font-medium shrink-0 hover:bg-blue-200 dark:hover:bg-blue-900/60 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
          title="Ordner öffnen"
        >
          {folder.label || folder.id.slice(0, 7)}
        </button>
      ) : (
        <span className="text-[10px] text-neutral-400 dark:text-neutral-600 italic shrink-0">
          unbekannt
        </span>
      )}
      <span
        className="font-mono text-[11px] truncate flex-1 text-neutral-700 dark:text-neutral-200"
        dir="auto"
        title={event.path}
      >
        {event.path}
      </span>
      <span className="text-[10px] text-neutral-400 dark:text-neutral-500 tabular-nums shrink-0">
        {fmtActivityBytes(event.size)}
      </span>
    </div>
  );
}

function directionIcon(e: ActivityEvent) {
  if (e.action === "deleted") return FileX;
  if (e.direction === "conflict" || e.action === "conflict") return Ban;
  if (e.direction === "up") return ArrowUp;
  if (e.direction === "local") return Pencil;
  return ArrowDown;
}

function directionColor(e: ActivityEvent): string {
  if (e.action === "deleted") return "text-rose-500 dark:text-rose-400";
  if (e.direction === "conflict" || e.action === "conflict")
    return "text-amber-600 dark:text-amber-400";
  if (e.direction === "up") return "text-blue-500 dark:text-blue-400";
  if (e.direction === "local") return "text-neutral-500 dark:text-neutral-400";
  return "text-emerald-500 dark:text-emerald-400";
}
