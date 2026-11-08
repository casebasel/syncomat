import { ArrowDown, ArrowUp, Loader2, RefreshCw } from "lucide-react";
import type { Spalte, Zeile, Zelle } from "../../lib/uebersicht";
import type { UpdateState } from "../../lib/updater";
import { compareVersions } from "../../lib/updateAll";

// ── Start: der Stand auf einen Blick ─────────────────────────────
//
// Marlon 08.11.2026: „Ist alles synchronisiert? Gibt es Probleme? Speicher?
// Mit wie viel MB wird kopiert? Sind wir aktuell? Wie heisst der Computer?“
// Oben ein Satz, darunter nur, was zählt — keine Kachelwand.

const groesse = (n: number | null | undefined) =>
  n == null
    ? "—"
    : n >= 1e12
      ? `${(n / 1e12).toFixed(1)} TB`
      : n >= 1e10
        ? `${Math.round(n / 1e9)} GB`
        : n >= 1e9
          ? `${(n / 1e9).toFixed(1)} GB`
          : n >= 1e6
            ? `${Math.round(n / 1e6)} MB`
            : n > 0
              ? `${Math.max(1, Math.round(n / 1e3))} KB`
              : "0 KB";
const tempo = (bps: number) => (bps >= 1e6 ? `${(bps / 1e6).toFixed(bps >= 1e8 ? 0 : 1)} MB/s` : bps >= 1e3 ? `${Math.round(bps / 1e3)} KB/s` : "0 KB/s");
const dauer = (s: number) => (s < 90 ? "unter 2 min" : s < 3600 ? `ca. ${Math.round(s / 60)} min` : `ca. ${(s / 3600).toFixed(1)} Std`);
const seit = (t: number) => {
  const m = Math.max(0, Math.round((Date.now() - t) / 60_000));
  if (m < 1) return "gerade eben";
  if (m < 60) return `vor ${m} min`;
  const h = Math.round(m / 60);
  return h < 48 ? `vor ${h} Std` : `vor ${Math.round(h / 24)} Tagen`;
};

/** Kurztext, warum eine Zelle Aufmerksamkeit braucht (null = alles gut). */
function problem(z: Zelle): string | null {
  if (z.zustand === "angehalten") return z.grund && z.grund !== "Pausiert" ? `angehalten — ${z.grund}` : "angehalten";
  if (z.konflikte) return `${z.konflikte} Konflikt${z.konflikte === 1 ? "" : "e"}`;
  if (z.dateifehler) return `${z.dateifehler} Datei${z.dateifehler === 1 ? "" : "en"} mit Fehler`;
  if (z.ungesichert) return `${z.ungesichert.anzahl} Datei${z.ungesichert.anzahl === 1 ? "" : "en"} nicht gesichert`;
  return null;
}

/** Wenig Platz: unter 10 % oder unter 50 GB. */
const knapp = (frei: number | null, total: number | null) =>
  frei != null && (frei < 50e9 || (total != null && total > 0 && frei / total < 0.1));

function Abschnitt({ titel, zahl, children }: { titel: string; zahl?: number; children: React.ReactNode }) {
  return (
    <section className="min-w-0">
      <h2 className="text-[13px] font-bold text-[var(--sm-text)] mb-1.5">
        {titel}
        {zahl != null && <span className="sm-zahl ml-1.5 font-semibold text-[var(--sm-text2)]">{zahl}</span>}
      </h2>
      <div className="border-t border-[var(--sm-linie)]">{children}</div>
    </section>
  );
}

const Zeichen = ({ art }: { art: "warn" | "ok" | "aus" }) => (
  <span
    aria-hidden
    className={`size-2 shrink-0 rounded-full ${
      art === "warn" ? "bg-[var(--sm-ocker)]" : art === "ok" ? "bg-[var(--sm-text)]" : "border border-[var(--sm-text2)]"
    }`}
  />
);

export function Start({
  bereit,
  rechnerName,
  rolle,
  version,
  updateState,
  spalten,
  projekte,
  plugins,
  offenBytes,
  inBps,
  outBps,
  zuletzt,
  versionen,
  nasVerbunden,
  angebote,
  onZelle,
  onOrdner,
  onEinstellungen,
  onAbgleichen,
  pruefe,
}: {
  bereit: boolean;
  rechnerName: string;
  rolle: string | null;
  version: string | null;
  updateState: UpdateState;
  spalten: Spalte[];
  projekte: Zeile[];
  plugins: Zeile[];
  offenBytes: number;
  inBps: number;
  outBps: number;
  zuletzt: Date | null;
  /** syncomat-Version je Gerät (Versionsnotizen) */
  versionen: Record<string, string | undefined>;
  /** NAS-Hub verbunden? null = kein NAS bekannt */
  nasVerbunden: boolean | null;
  angebote: number;
  onZelle: (z: Zeile, s: Spalte) => void;
  onOrdner: () => void;
  onEinstellungen: () => void;
  /** Alle Ordner hier neu prüfen (Abgleich anstossen) */
  onAbgleichen: () => void;
  pruefe: boolean;
}) {
  const ich = spalten.find((s) => s.ich) ?? null;
  const alle = [...projekte, ...plugins];

  // Was braucht Aufmerksamkeit — über alle Rechner.
  const probleme: { z: Zeile; s: Spalte; text: string }[] = [];
  for (const z of alle) {
    for (const s of spalten) {
      const c = z.zellen[s.id];
      const t = c && problem(c);
      if (t) probleme.push({ z, s, text: t });
    }
  }
  if (nasVerbunden === false) {
    /* eigener Eintrag unten im Statussatz */
  }

  // Was lädt gerade — hier und bei den anderen (aus deren Notizen).
  const laeuft: { z: Zeile; s: Spalte; prozent: number; offen: number | null }[] = [];
  for (const z of alle) {
    for (const s of spalten) {
      const c = z.zellen[s.id];
      if (c?.zustand === "laedt") laeuft.push({ z, s, prozent: c.prozent ?? 0, offen: s.ich ? z.offenBytes : null });
    }
  }

  const laedt = offenBytes > 0 || laeuft.some((l) => l.s.ich);
  const eta = laedt && inBps > 50_000 ? offenBytes / inBps : null;
  const updateDa = updateState.kind === "available" || updateState.kind === "ready";
  const abosHier = projekte.filter((z) => z.hier).length;

  // Statussatz: das Wichtigste zuerst.
  let satz: string;
  let satzArt: "warn" | "ok" | "laedt";
  if (!bereit) {
    satz = "Syncthing startet …";
    satzArt = "laedt";
  } else if (probleme.length > 0 || nasVerbunden === false) {
    const n = probleme.length + (nasVerbunden === false ? 1 : 0);
    satz = n === 1 ? "Eine Sache braucht Aufmerksamkeit." : `${n} Sachen brauchen Aufmerksamkeit.`;
    satzArt = "warn";
  } else if (laedt) {
    satz = `Lädt — noch ${groesse(offenBytes)}${eta != null ? `, ${dauer(eta)}` : ""}.`;
    satzArt = "laedt";
  } else {
    satz = "Alles abgeglichen.";
    satzArt = "ok";
  }

  return (
    <section className="flex-1 min-w-0 flex flex-col overflow-hidden bg-[var(--sm-grund)] text-[var(--sm-text)]">
      <header className="h-12 shrink-0 px-5 flex items-center justify-between bg-[var(--sm-kopf)] text-[var(--sm-kopf-text)]">
        <h1 className="text-[16px] font-bold">Start</h1>
        <p className="sm-zahl text-[14px] text-[var(--sm-kopf-text2)]">
          <span className="font-semibold text-[var(--sm-kopf-text)]">{rechnerName || "Dieser Rechner"}</span>
          {rolle && <> · {rolle}</>}
        </p>
      </header>

      <div className="flex-1 overflow-y-auto px-5 py-5">
        {/* Der Satz */}
        <div className="max-w-[1100px] mb-6">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <p className="flex items-center gap-2.5 text-[22px] font-bold leading-tight" role="status" aria-live="polite">
            {satzArt === "laedt" ? (
              <Loader2 className="size-5 shrink-0 animate-spin text-[var(--sm-blau)]" />
            ) : (
              <span
                aria-hidden
                className={`size-3 shrink-0 rounded-full ${satzArt === "warn" ? "bg-[var(--sm-ocker)]" : "bg-[var(--sm-text)]"}`}
              />
            )}
            {satz}
          </p>
          <button
            onClick={onAbgleichen}
            disabled={pruefe || !bereit}
            title="Alle Ordner auf diesem Rechner neu prüfen — Änderungen gehen sofort los"
            className="h-8 px-3 rounded-md border border-[var(--sm-linie)] text-[13px] font-semibold inline-flex items-center gap-1.5 hover:bg-[var(--sm-flaeche)] disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-[var(--sm-blau)]"
          >
            <RefreshCw className={`size-3.5 ${pruefe ? "animate-spin" : ""}`} aria-hidden />
            {pruefe ? "Prüft …" : "Jetzt abgleichen"}
          </button>
          </div>
          <p className="sm-zahl mt-1.5 text-[13px] text-[var(--sm-text2)] flex flex-wrap gap-x-4 gap-y-1">
            <span className="inline-flex items-center gap-1">
              <ArrowDown className="size-3.5" aria-hidden />
              {tempo(inBps)}
              <ArrowUp className="size-3.5 ml-1.5" aria-hidden />
              {tempo(outBps)}
            </span>
            {offenBytes > 0 && satzArt !== "laedt" && <span>noch {groesse(offenBytes)} offen</span>}
            <span>
              {abosHier} {abosHier === 1 ? "Abo" : "Abos"} hier
            </span>
            {nasVerbunden != null && (
              <span className="inline-flex items-center gap-1.5">
                <Zeichen art={nasVerbunden ? "ok" : "warn"} />
                {nasVerbunden ? "NAS verbunden" : "NAS nicht verbunden"}
              </span>
            )}
            {zuletzt && <span>zuletzt geprüft {seit(zuletzt.getTime())}</span>}
            <button onClick={onEinstellungen} className="inline-flex items-center gap-1.5 hover:text-[var(--sm-text)] underline-offset-2 hover:underline">
              {updateDa && <Zeichen art="warn" />}
              syncomat {version ? `v${version}` : ""} · {updateDa ? "Update verfügbar" : updateState.kind === "up-to-date" ? "aktuell" : "Version prüfen"}
            </button>
            {angebote > 0 && (
              <button onClick={onOrdner} className="inline-flex items-center gap-1.5 hover:text-[var(--sm-text)] underline-offset-2 hover:underline">
                <span aria-hidden className="size-2 rounded-full bg-[var(--sm-blau)]" />
                {angebote} {angebote === 1 ? "Ordner wartet" : "Ordner warten"} aufs Annehmen
              </button>
            )}
          </p>
        </div>

        <div className="max-w-[1100px] grid gap-x-10 gap-y-7 lg:grid-cols-2">
          <div className="space-y-7 min-w-0">
            <Abschnitt titel="Braucht Aufmerksamkeit" zahl={probleme.length}>
              {probleme.length === 0 ? (
                <p className="py-2.5 text-[13px] text-[var(--sm-text2)]">Nichts offen.</p>
              ) : (
                <ul>
                  {probleme.slice(0, 12).map(({ z, s, text }) => (
                    <li key={`${z.folderId}|${s.id}`}>
                      <button
                        onClick={() => onZelle(z, s)}
                        className="w-full h-10 flex items-center gap-2.5 text-left border-b border-[var(--sm-linie-fein)] hover:bg-[var(--sm-flaeche)] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--sm-blau)]"
                      >
                        <span aria-hidden className="self-stretch w-[3px] shrink-0" style={{ background: z.farbe ?? "transparent" }} />
                        <Zeichen art="warn" />
                        <span className="min-w-0 truncate text-[13px] font-semibold" dir="auto">{z.name}</span>
                        <span className="shrink-0 text-[12px] text-[var(--sm-text2)]">{s.ich ? "hier" : s.name}</span>
                        <span className="ml-auto min-w-0 truncate pr-2 text-[12px]">{text}</span>
                      </button>
                    </li>
                  ))}
                  {probleme.length > 12 && (
                    <li className="py-2 text-[12px] text-[var(--sm-text2)]">… und {probleme.length - 12} weitere in der Übersicht</li>
                  )}
                </ul>
              )}
            </Abschnitt>

            <Abschnitt titel="Lädt gerade" zahl={laeuft.length}>
              {laeuft.length === 0 ? (
                <p className="py-2.5 text-[13px] text-[var(--sm-text2)]">Nichts in Arbeit.</p>
              ) : (
                <ul>
                  {laeuft.slice(0, 10).map(({ z, s, prozent, offen }) => (
                    <li key={`${z.folderId}|${s.id}`}>
                      <button
                        onClick={() => onZelle(z, s)}
                        className="w-full h-10 flex items-center gap-2.5 text-left border-b border-[var(--sm-linie-fein)] hover:bg-[var(--sm-flaeche)] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--sm-blau)]"
                      >
                        <span aria-hidden className="self-stretch w-[3px] shrink-0" style={{ background: z.farbe ?? "transparent" }} />
                        <span className="w-40 min-w-0 truncate text-[13px] font-semibold" dir="auto">{z.name}</span>
                        <span className="w-20 shrink-0 truncate text-[12px] text-[var(--sm-text2)]">{s.ich ? "hier" : s.name}</span>
                        <span className="flex-1 h-1.5 rounded-full bg-[var(--sm-flaeche)] overflow-hidden" aria-hidden>
                          <span className="block h-full bg-[var(--sm-blau)]" style={{ width: `${Math.min(100, Math.max(2, prozent))}%` }} />
                        </span>
                        <span className="sm-zahl w-28 shrink-0 pr-2 text-right text-[12px]">
                          {prozent} %{offen != null && offen > 0 ? ` · ${groesse(offen)}` : ""}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Abschnitt>
          </div>

          <div className="space-y-7 min-w-0">
            <Abschnitt titel="Rechner" zahl={spalten.length}>
              <ul>
                {spalten.map((s) => {
                  const v = s.ich ? version : versionen[s.id];
                  const alt = !!(v && version && compareVersions(v, version) < 0);
                  const eng = knapp(s.freiD, s.totalD);
                  const belegt = s.totalD && s.freiD != null ? 1 - s.freiD / s.totalD : null;
                  return (
                    <li key={s.id} className="h-11 flex items-center gap-2.5 border-b border-[var(--sm-linie-fein)]">
                      <Zeichen art={s.online ? "ok" : "aus"} />
                      <span className="w-40 min-w-0">
                        <span className="block truncate text-[13px] font-semibold">{s.ich ? `${s.name} (hier)` : s.name}</span>
                        <span className="block truncate text-[11px] text-[var(--sm-text2)]">
                          {s.ich ? "läuft" : s.online ? (s.ueberNas ? "über das NAS" : "verbunden") : s.zuletzt ? `aus · ${seit(s.zuletzt)}` : "aus"}
                          {s.rolle ? ` · ${s.rolle === "render" ? "Render" : "Arbeitsplatz"}` : ""}
                        </span>
                      </span>
                      <span className="flex-1 h-1.5 rounded-full bg-[var(--sm-flaeche)] overflow-hidden" aria-hidden>
                        {belegt != null && (
                          <span
                            className={`block h-full ${eng ? "bg-[var(--sm-ocker)]" : "bg-[var(--sm-text2)]"}`}
                            style={{ width: `${Math.round(belegt * 100)}%` }}
                          />
                        )}
                      </span>
                      <span className="sm-zahl w-32 shrink-0 text-right text-[12px] inline-flex items-center justify-end gap-1.5">
                        {eng && <Zeichen art="warn" />}
                        {s.freiD == null ? (
                          <span className="text-[var(--sm-text2)]">{s.ich ? "kein Projektlaufwerk" : "—"}</span>
                        ) : (
                          <>
                            {groesse(s.freiD)} frei
                          </>
                        )}
                      </span>
                      <span
                        className="sm-zahl w-16 shrink-0 pr-2 text-right text-[12px] inline-flex items-center justify-end gap-1.5"
                        title={alt ? "Ältere syncomat-Version — „Alle Geräte aktualisieren“ in den Einstellungen" : undefined}
                      >
                        {alt && <Zeichen art="warn" />}
                        {v ? `v${v}` : <span className="text-[var(--sm-text2)]">—</span>}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </Abschnitt>
          </div>
        </div>
        {ich == null && <p className="mt-6 text-[13px] text-[var(--sm-text2)]">Warte auf Syncthing …</p>}
      </div>
    </section>
  );
}
