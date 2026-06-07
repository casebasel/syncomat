export type StatusTone = "ok" | "wait" | "off";

export function StatusDot({ tone, size = "sm" }: { tone: StatusTone; size?: "sm" | "md" }) {
  const sz = size === "md" ? "size-2" : "size-1.5";
  const cls =
    tone === "ok"
      ? "bg-emerald-500"
      : tone === "wait"
        ? "bg-amber-500 animate-pulse"
        : "bg-neutral-400 dark:bg-neutral-600";
  return <span className={`${sz} rounded-full ${cls} shrink-0`} />;
}

export function statusLabel(tone: StatusTone, connected: number, total: number): string {
  if (tone === "ok") return `Verbunden · ${connected} Gerät${connected === 1 ? "" : "e"}`;
  if (tone === "wait" && total > 0)
    return `Suche · ${total} Gerät${total === 1 ? "" : "e"} konfiguriert`;
  if (tone === "wait") return "Starte Syncthing…";
  return "Keine Geräte";
}
