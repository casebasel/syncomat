import type { Zelle } from "../../lib/uebersicht";

// ── Zeichen einer Zelle (Marlon 08.11.2026) ──────────────────────
//
// Füllung = Fortschritt, Farbe = Gewissheit, Ring = Teil-Abo:
//   ● grün      aktuell und bestätigt (Rechner verbunden)
//   ◔ blau      lädt — der Kuchen füllt sich mit dem Fortschritt
//   ○           abonniert, noch nichts da (0 %)
//   ● grau      Rechner aus — letzter bekannter Stand, nicht bestätigt
//   ⦿           nur Unterordner: Ring = Projekt, innen dieselben Zeichen
//   ▬ gold      angehalten · gestrichelt: unbekannt · leer: nicht abonniert

/** Kuchen von 12 Uhr im Uhrzeigersinn (Anteil 0…1). */
function kuchen(c: number, r: number, p: number): string {
  if (p >= 0.999) return `M ${c} ${c - r} A ${r} ${r} 0 1 1 ${c - 0.01} ${c - r} Z`;
  const a = 2 * Math.PI * p;
  const x = c + r * Math.sin(a);
  const y = c - r * Math.cos(a);
  return `M ${c} ${c} L ${c} ${c - r} A ${r} ${r} 0 ${p > 0.5 ? 1 : 0} 1 ${x} ${y} Z`;
}

/** Inhalt (voll/Kuchen/leer) in Farbe nach Zustand. */
function Inhalt({ z, c, r }: { z: Zelle; c: number; r: number }) {
  if (z.zustand === "laedt") {
    const p = Math.max(0, Math.min(100, z.prozent ?? 0)) / 100;
    const farbe = z.offline ? "var(--sm-text2)" : "var(--sm-blau)";
    return (
      <>
        <circle cx={c} cy={c} r={r} fill="none" stroke={farbe} strokeWidth={1.25} opacity={0.55} />
        {p > 0 && <path d={kuchen(c, r, p)} fill={farbe} style={{ transition: "d 400ms cubic-bezier(0.16,1,0.3,1)" }} />}
      </>
    );
  }
  return <circle cx={c} cy={c} r={r} fill={z.offline ? "var(--sm-text2)" : "var(--sm-gruen)"} />;
}

export function ZellSymbol({ z, size = 14, leer = false }: { z: Zelle; size?: number; leer?: boolean }) {
  const c = size / 2;
  const r = size / 2 - 1.5;
  if (z.zustand === "nicht") {
    // Projekt nicht abonniert: feiner leerer Kreis = hier kann man klicken
    // (Marlon 12.11.2026). Durchgezogen und blass — anders als „unbekannt“
    // (gestrichelt) und „abonniert, 0 %“ (blauer Ring). Ohne `leer`: nichts.
    if (!leer) return <span aria-hidden className="inline-block" style={{ width: size, height: size }} />;
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="sm-leer">
        <circle cx={c} cy={c} r={r} fill="none" stroke="var(--sm-text2)" strokeWidth={1} />
      </svg>
    );
  }
  if (z.zustand === "angehalten") {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
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
  if (z.teil) {
    // Ring = ganzes Projekt, innen der Stand der gewählten Unterordner.
    const ring = z.offline ? "var(--sm-text2)" : z.zustand === "laedt" ? "var(--sm-blau)" : "var(--sm-gruen)";
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={c} cy={c} r={r} fill="none" stroke={ring} strokeWidth={1.5} />
        <Inhalt z={z} c={c} r={r - 2.75} />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
      <Inhalt z={z} c={c} r={r} />
    </svg>
  );
}

/** Wort zum Zustand (immer daneben bzw. als Tooltip). */
export function zellText(z: Zelle): string {
  const basis =
    z.zustand === "aktuell"
      ? z.offline
        ? "aus — zuletzt aktuell, nicht bestätigt"
        : z.teil
          ? "aktuell (bestätigt) · nur Unterordner"
          : "aktuell (bestätigt)"
      : z.zustand === "laedt"
        ? `lädt ${z.prozent ?? 0} %${z.teil ? " · nur Unterordner" : ""}`
        : z.zustand === "angehalten"
          ? `angehalten${z.grund ? ` — ${z.grund}` : ""}`
          : z.zustand === "nicht"
            ? "nicht abonniert"
            : "Stand unbekannt";
  const u =
    (z.konflikte ? ` · ${z.konflikte} Konflikt(e)` : "") +
    (z.dateifehler ? ` · ${z.dateifehler} Datei(en) mit Fehler` : "") +
    (z.ungesichert ? ` · ${z.ungesichert.anzahl} Datei(en) ausserhalb der Auswahl, nicht gesichert` : "");
  return (z.offline && z.zustand === "laedt" ? `${basis} (aus, letzter Stand)` : basis) + u;
}
