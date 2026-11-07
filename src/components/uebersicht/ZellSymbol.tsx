import type { Zelle } from "../../lib/uebersicht";

/** Zustand einer Zelle als Form (nicht nur Farbe):
 *  aktuell ● · lädt Ring mit Anteil · nur Unterordner ◐ · angehalten Ocker-Strich
 *  · nicht abonniert leer · unbekannt gestrichelter Kreis. Offline = blass. */
export function ZellSymbol({ z, size = 14 }: { z: Zelle; size?: number }) {
  const r = size / 2 - 1.5;
  const c = size / 2;
  const blass = z.offline ? 0.62 : 1;
  if (z.zustand === "nicht") return <span aria-hidden className="inline-block" style={{ width: size, height: size }} />;
  if (z.zustand === "angehalten") {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden style={{ opacity: blass }}>
        <rect x={1} y={c - 2} width={size - 2} height={4} rx={1} fill="var(--sm-ocker)" />
      </svg>
    );
  }
  if (z.zustand === "unbekannt") {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden style={{ opacity: 0.55 }}>
        <circle cx={c} cy={c} r={r} fill="none" stroke="var(--sm-text2)" strokeWidth={1.25} strokeDasharray="2 2" />
      </svg>
    );
  }
  if (z.zustand === "laedt") {
    const p = Math.max(0, Math.min(100, z.prozent ?? 0)) / 100;
    const len = 2 * Math.PI * r;
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden style={{ opacity: blass }}>
        <circle cx={c} cy={c} r={r} fill="none" stroke="var(--sm-linie)" strokeWidth={2} />
        <circle
          cx={c}
          cy={c}
          r={r}
          fill="none"
          stroke="var(--sm-blau)"
          strokeWidth={2}
          strokeDasharray={`${len * p} ${len}`}
          transform={`rotate(-90 ${c} ${c})`}
          style={{ transition: "stroke-dasharray 400ms cubic-bezier(0.16,1,0.3,1)" }}
        />
      </svg>
    );
  }
  // aktuell (ganz oder nur Unterordner)
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden style={{ opacity: blass }}>
      {z.teil ? (
        <>
          <circle cx={c} cy={c} r={r} fill="none" stroke="var(--sm-text)" strokeWidth={1.5} />
          <path d={`M ${c} ${c - r} A ${r} ${r} 0 0 0 ${c} ${c + r} Z`} fill="var(--sm-text)" />
        </>
      ) : (
        <circle cx={c} cy={c} r={r} fill="var(--sm-text)" />
      )}
    </svg>
  );
}

/** Wort zum Zustand (immer daneben bzw. als Tooltip). */
export function zellText(z: Zelle): string {
  const basis =
    z.zustand === "aktuell"
      ? z.teil
        ? "aktuell · nur Unterordner"
        : "aktuell"
      : z.zustand === "laedt"
        ? `lädt ${z.prozent ?? 0} %`
        : z.zustand === "angehalten"
          ? `angehalten${z.grund ? ` — ${z.grund}` : ""}`
          : z.zustand === "nicht"
            ? "nicht abonniert"
            : "Stand unbekannt";
  return z.offline && z.zustand !== "unbekannt" ? `${basis} (offline, letzter Stand)` : basis;
}
