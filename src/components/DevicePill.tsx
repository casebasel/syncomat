import { StatusDot } from "./StatusLight";

export function DevicePill({
  name,
  connected,
}: {
  name: string;
  connected: boolean;
}) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 text-sm text-neutral-900 dark:text-neutral-100 min-w-0">
      <StatusDot tone={connected ? "ok" : "off"} />
      <span className="truncate" title={name}>
        {name}
      </span>
    </div>
  );
}
