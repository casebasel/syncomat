import { AlertOctagon, AlertTriangle, Check, Pause, RefreshCw, WifiOff } from "lucide-react";

export type SyncState =
  | "synced" // alles aktuell + peer online
  | "syncing" // synct gerade — bytes fließen
  | "scanning" // local rescan läuft
  | "waiting-peer" // wir sind ok, aber peer offline → wartet
  | "waiting-data" // peer online, aber needBytes > 0 (queued)
  | "error" // FolderErrors / pullErrors
  | "conflicts" // sync-conflict-Files vorhanden
  | "paused" // user-paused
  | "local-only"; // nur 1 device (self) im folder

const STYLE: Record<
  SyncState,
  { dot: string; label: string; bg: string; text: string; icon?: typeof Check }
> = {
  synced: {
    dot: "bg-emerald-500",
    bg: "bg-emerald-100 dark:bg-emerald-950/40",
    text: "text-emerald-700 dark:text-emerald-300",
    label: "Synchron",
    icon: Check,
  },
  syncing: {
    dot: "bg-blue-500 animate-pulse",
    bg: "bg-blue-100 dark:bg-blue-950/40",
    text: "text-blue-700 dark:text-blue-300",
    label: "Synct",
    icon: RefreshCw,
  },
  scanning: {
    dot: "bg-blue-400 animate-pulse",
    bg: "bg-blue-100 dark:bg-blue-950/40",
    text: "text-blue-700 dark:text-blue-300",
    label: "Scant",
    icon: RefreshCw,
  },
  "waiting-peer": {
    dot: "bg-amber-500",
    bg: "bg-amber-100 dark:bg-amber-950/40",
    text: "text-amber-700 dark:text-amber-300",
    label: "Wartet auf Peer",
    icon: WifiOff,
  },
  "waiting-data": {
    dot: "bg-amber-500 animate-pulse",
    bg: "bg-amber-100 dark:bg-amber-950/40",
    text: "text-amber-700 dark:text-amber-300",
    label: "Wartet",
  },
  error: {
    dot: "bg-rose-500",
    bg: "bg-rose-100 dark:bg-rose-950/40",
    text: "text-rose-700 dark:text-rose-300",
    label: "Fehler",
    icon: AlertTriangle,
  },
  conflicts: {
    dot: "bg-amber-600",
    bg: "bg-amber-100 dark:bg-amber-950/40",
    text: "text-amber-700 dark:text-amber-300",
    label: "Konflikte",
    icon: AlertOctagon,
  },
  paused: {
    dot: "bg-neutral-400 dark:bg-neutral-600",
    bg: "bg-neutral-200 dark:bg-neutral-800",
    text: "text-neutral-600 dark:text-neutral-400",
    label: "Pausiert",
    icon: Pause,
  },
  "local-only": {
    dot: "bg-neutral-300 dark:bg-neutral-700",
    bg: "bg-neutral-100 dark:bg-neutral-900",
    text: "text-neutral-500 dark:text-neutral-500",
    label: "Nur lokal",
  },
};

export function SyncStatusBadge({
  state,
  variant = "dot",
  size = "md",
}: {
  state: SyncState;
  variant?: "dot" | "pill";
  size?: "sm" | "md";
}) {
  const s = STYLE[state];
  if (variant === "dot") {
    const sz = size === "sm" ? "size-2" : "size-2.5";
    return (
      <span
        title={s.label}
        className={`${sz} rounded-full ${s.dot} shrink-0`}
      />
    );
  }
  const Icon = s.icon;
  const padding = size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-1 text-[11px]";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md ${padding} ${s.bg} ${s.text} font-medium shrink-0`}
    >
      {Icon && <Icon className="size-3" />}
      {s.label}
    </span>
  );
}
