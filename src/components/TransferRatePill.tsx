import { ArrowDown, ArrowUp } from "lucide-react";

export function TransferRatePill({
  inBps,
  outBps,
  historyIn,
  historyOut,
  visible,
}: {
  inBps: number;
  outBps: number;
  historyIn: number[];
  historyOut: number[];
  visible: boolean;
}) {
  if (!visible) return null;
  // Versteckt wenn alles auf 0 und keine History → vermeidet "0 KB/s" Lärm beim First-Run.
  const everActivity =
    inBps > 0 || outBps > 0 || historyIn.some((v) => v > 0) || historyOut.some((v) => v > 0);
  if (!everActivity) return null;

  const peakBps = Math.max(1, ...historyIn, ...historyOut, inBps, outBps);

  return (
    <div className="flex items-center gap-2 text-[10px] text-neutral-500 dark:text-neutral-400">
      <div className="flex items-center gap-1">
        <ArrowDown className="size-3 text-emerald-500" />
        <span className="font-mono tabular-nums w-14 text-right">{fmtRate(inBps)}</span>
        <Sparkline data={historyIn} peak={peakBps} stroke="emerald" />
      </div>
      <div className="flex items-center gap-1">
        <ArrowUp className="size-3 text-blue-500" />
        <span className="font-mono tabular-nums w-14 text-right">{fmtRate(outBps)}</span>
        <Sparkline data={historyOut} peak={peakBps} stroke="blue" />
      </div>
    </div>
  );
}

function Sparkline({
  data,
  peak,
  stroke,
}: {
  data: number[];
  peak: number;
  stroke: "emerald" | "blue";
}) {
  const w = 36;
  const h = 10;
  const cls = stroke === "emerald" ? "stroke-emerald-500" : "stroke-blue-500";
  if (data.length < 2) {
    return <svg width={w} height={h} aria-hidden />;
  }
  const stepX = w / (data.length - 1);
  const points = data
    .map((v, i) => {
      const x = (i * stepX).toFixed(1);
      const y = (h - (Math.min(v, peak) / peak) * h).toFixed(1);
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <svg width={w} height={h} className="opacity-60" aria-label="Verlauf">
      <polyline points={points} fill="none" className={cls} strokeWidth={1} />
    </svg>
  );
}

function fmtRate(bps: number): string {
  if (bps < 1024) return `${Math.round(bps)} B/s`;
  if (bps < 1024 * 1024) return `${Math.round(bps / 1024)} kB/s`;
  return `${(bps / 1024 / 1024).toFixed(1)} MB/s`;
}
