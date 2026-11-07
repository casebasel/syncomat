import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, KeyRound, Plus, RefreshCw, Search } from "lucide-react";
import type { Spalte, Zeile } from "../../lib/uebersicht";
import type { Wunsch } from "../../lib/wuensche";
import { ZellSymbol, zellText } from "./ZellSymbol";

type Filter = "alle" | "hier" | "stoerung";

const gb = (n: number | null) => (n == null ? "—" : n >= 1e12 ? `${(n / 1e12).toFixed(1)} TB` : `${Math.round(n / 1e9)} GB`);
const rolleKurz = (r: Spalte["rolle"]) => (r === "render" ? "Render" : r ? "Arbeitsplatz" : null);

/** Hauptansicht: Projekte × Rechner. Zeilen = Projekte auf dem NAS (und die
 * Plugins), Spalten = Rechner, „Dieser Rechner“ zuerst. */
export function Uebersicht({
  spalten,
  projekte,
  plugins,
  lage,
  gewaehlt,
  gewaehltRechner,
  onZeile,
  onZelle,
  offeneWuensche,
  onAbonnieren,
  onRechner,
  onRechnerKoppeln,
  onCodeEinloesen,
  onNeuPruefen,
  pruefe,
  angeboteneOrdner,
}: {
  spalten: Spalte[];
  projekte: Zeile[];
  plugins: Zeile[];
  lage: { freiD: number | null; abosHier: number; stoerungen: number; ungesichert?: number };
  gewaehlt: string | null;
  /** gewählter Rechner im gewählten Projekt (Schnittpunkt) */
  gewaehltRechner: string | null;
  onZeile: (z: Zeile) => void;
  /** Klick auf einen Schnittpunkt Projekt × Rechner → Auswahlfeld */
  onZelle: (z: Zeile, s: Spalte) => void;
  /** Von hier gesendete, noch offene Wünsche (Markierung in der Zelle) */
  offeneWuensche: Wunsch[];
  onAbonnieren: (z: Zeile) => void;
  onRechner: (id: string) => void;
  onRechnerKoppeln: () => void;
  onCodeEinloesen: () => void;
  onNeuPruefen: () => void;
  pruefe: boolean;
  /** Ordner, die ein anderer Rechner anbietet (keine Projekte) — von Hand verknüpfen. */
  angeboteneOrdner: { id: string; name: string; onVerknuepfen: () => void }[];
}) {
  const [filter, setFilter] = useState<Filter>("alle");
  const [suche, setSuche] = useState("");
  const [pluginsOffen, setPluginsOffen] = useState(false);
  const sucheRef = useRef<HTMLInputElement>(null);
  const tabelleRef = useRef<HTMLTableElement>(null);
  const ich = spalten.find((s) => s.ich);

  // „/“ fokussiert die Suche
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key === "/" && t?.tagName !== "INPUT" && t?.tagName !== "TEXTAREA") {
        e.preventDefault();
        sucheRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const passt = (z: Zeile) => {
    if (suche && !z.name.toLowerCase().includes(suche.toLowerCase())) return false;
    if (filter === "hier") return !!z.hier;
    if (filter === "stoerung") return z.stoerung;
    return true;
  };
  const sichtbar = useMemo(() => projekte.filter(passt), [projekte, filter, suche]); // eslint-disable-line react-hooks/exhaustive-deps
  const pluginsSichtbar = useMemo(() => plugins.filter(passt), [plugins, filter, suche]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pfeiltasten zwischen den Zellen (data-r / data-c)
  const onTabelleKey = (e: React.KeyboardEvent) => {
    const el = e.target as HTMLElement;
    const r = Number(el.dataset.r);
    const c = Number(el.dataset.c);
    if (Number.isNaN(r) || Number.isNaN(c)) return;
    const d = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
    if (!d) return;
    e.preventDefault();
    const next = tabelleRef.current?.querySelector<HTMLElement>(`[data-r="${r + d[0]}"][data-c="${c + d[1]}"]`);
    next?.focus();
  };

  // Signatur: Zellen, deren Zustand seit dem letzten Bild wechselte, heben
  // sich kurz ab (nicht beim ersten Laden).
  const prevRef = useRef<Map<string, string>>(new Map());
  const naechste = new Map<string, string>();
  useEffect(() => {
    prevRef.current = naechste;
  });

  let rowIndex = 0;
  const zeileRender = (z: Zeile) => {
    const r = rowIndex++;
    const istGewaehlt = gewaehlt === z.folderId;
    return (
      <tr
        key={z.folderId}
        className={`group border-b border-[var(--sm-linie-fein)] ${istGewaehlt ? "bg-[var(--sm-blau-flaeche)]" : "hover:bg-[var(--sm-flaeche)]"}`}
      >
        <th scope="row" className="sticky left-0 z-10 p-0 text-left font-normal bg-inherit">
          <button
            data-r={r}
            data-c={0}
            tabIndex={r === 0 ? 0 : -1}
            onClick={() => onZeile(z)}
            className={`w-full h-9 flex items-center gap-2.5 pl-0 pr-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--sm-blau)] ${istGewaehlt ? "bg-[var(--sm-blau-flaeche)]" : "bg-[var(--sm-grund)] group-hover:bg-[var(--sm-flaeche)]"}`}
          >
            <span
              aria-hidden
              className="self-stretch w-[3px] shrink-0"
              style={{ background: z.farbe ?? "transparent" }}
            />
            <span className="min-w-0 truncate text-[13px] font-semibold text-[var(--sm-text)]" dir="auto">
              {z.name}
            </span>
            {z.stoerung && (
              <span className="shrink-0 text-[11px] font-semibold text-[var(--sm-ocker-text)]">angehalten</span>
            )}
            {z.bytes != null && (
              <span className="ml-auto shrink-0 sm-zahl font-mono text-[11px] text-[var(--sm-text2)]">{gb(z.bytes)}</span>
            )}
          </button>
        </th>
        {spalten.map((s, i) => {
          const zelle = z.zellen[s.id] ?? { zustand: "unbekannt" as const };
          const abonnierbar = s.ich && z.art === "projekt" && !z.hier && !!z.angebot;
          const text = zellText(zelle);
          const k = `${z.folderId}|${s.id}`;
          const sig = `${zelle.zustand}:${zelle.teil ? 1 : 0}:${zelle.offline ? 1 : 0}`;
          const vorher = prevRef.current.get(k);
          naechste.set(k, sig);
          const gewechselt = vorher !== undefined && vorher !== sig;
          const istZelle = istGewaehlt && gewaehltRechner === s.id;
          const wunsch = z.art === "projekt" ? offeneWuensche.find((w) => w.ziel === s.id && w.folder_id === z.folderId) : undefined;
          return (
            <td key={`${s.id}:${sig}`} className={`p-0 text-center ${s.ich ? "bg-[var(--sm-ich)]/60" : ""} ${gewechselt ? "sm-wechsel" : ""}`}>
              <button
                data-r={r}
                data-c={i + 1}
                tabIndex={-1}
                title={
                  abonnierbar
                    ? `${z.name} auf diesem Rechner abonnieren`
                    : `${z.name} · ${s.name}: ${text}${wunsch ? " · Änderung gesendet, wartet" : ""}${z.art === "projekt" ? " — Klick: Auswahl festlegen" : ""}`
                }
                aria-label={`${z.name}, ${s.ich ? "dieser Rechner" : s.name}: ${abonnierbar ? "nicht abonniert, abonnieren" : text}${wunsch ? ", Änderung gesendet" : ""}`}
                aria-pressed={z.art === "projekt" ? istZelle : undefined}
                onClick={() => (abonnierbar ? onAbonnieren(z) : z.art === "projekt" ? onZelle(z, s) : onZeile(z))}
                className={`relative w-full h-9 inline-flex items-center justify-center gap-1 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--sm-blau)] ${istZelle ? "ring-2 ring-inset ring-[var(--sm-blau)]" : ""}`}
              >
                {wunsch && (
                  <span aria-hidden className="absolute top-1.5 right-2 size-1.5 rounded-full bg-[var(--sm-blau)]" />
                )}
                {zelle.ungesichert && (
                  <span aria-hidden className="absolute top-1 left-2 text-[10px] font-bold leading-none text-[var(--sm-ocker-text)]">!</span>
                )}
                {abonnierbar ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--sm-text2)] group-hover:text-[var(--sm-blau)] [button:focus-visible_&]:text-[var(--sm-blau)]">
                    <Plus className="size-3.5" strokeWidth={2.25} />
                    <span className="hidden group-hover:inline [button:focus-visible_&]:inline">Abonnieren</span>
                  </span>
                ) : (
                  <>
                    <ZellSymbol z={zelle} />
                    {zelle.zustand === "laedt" && (
                      <span className="sm-zahl font-mono text-[10px] text-[var(--sm-blau)]">{zelle.prozent ?? 0}%</span>
                    )}
                  </>
                )}
              </button>
            </td>
          );
        })}
        <td aria-hidden />
      </tr>
    );
  };

  return (
    <section className="flex-1 min-w-0 flex flex-col overflow-hidden bg-[var(--sm-grund)] text-[var(--sm-text)]">
      {/* Kopfzeile: Titel + zwei Zahlen */}
      <header className="h-12 shrink-0 px-5 flex items-center justify-between bg-[var(--sm-kopf)] text-[var(--sm-kopf-text)]">
        <h1 className="text-[15px] font-bold tracking-tight">Übersicht</h1>
        <p className="sm-zahl text-[13px]">
          <span className="font-semibold">{gb(lage.freiD)}</span>
          <span className="text-[var(--sm-kopf-text2)]"> frei auf D: · </span>
          <span className="font-semibold">{lage.abosHier}</span>
          <span className="text-[var(--sm-kopf-text2)]"> {lage.abosHier === 1 ? "Abo" : "Abos"} hier</span>
          {lage.stoerungen > 0 && (
            <span className="ml-3 font-semibold text-[var(--sm-ocker)]">{lage.stoerungen} angehalten</span>
          )}
          {(lage.ungesichert ?? 0) > 0 && (
            <span className="ml-3 font-semibold text-[var(--sm-ocker)]" title="Dateien in Projekten mit Teil-Auswahl, die ausserhalb der Auswahl liegen — sie werden nicht abgeglichen und nicht gesichert.">
              {lage.ungesichert} nicht gesichert
            </span>
          )}
        </p>
      </header>

      {/* Suche, Filter, Legende */}
      <div className="h-11 shrink-0 px-5 flex items-center gap-3 border-b border-[var(--sm-linie)] whitespace-nowrap overflow-hidden">
        <label className="relative flex items-center">
          <Search className="absolute left-2 size-3.5 text-[var(--sm-text2)]" aria-hidden />
          <input
            ref={sucheRef}
            value={suche}
            onChange={(e) => setSuche(e.target.value)}
            placeholder="Projekt suchen   /"
            aria-label="Projekt suchen"
            className="w-56 h-7 pl-7 pr-2 text-[13px] rounded-md bg-[var(--sm-flaeche)] border border-[var(--sm-linie)] placeholder:text-[var(--sm-text2)] outline-none focus:border-[var(--sm-blau)] focus:ring-2 focus:ring-[var(--sm-blau)]/25"
          />
        </label>
        <div role="radiogroup" aria-label="Filter" className="flex h-7 rounded-md border border-[var(--sm-linie)] overflow-hidden text-[12px]">
          {(
            [
              ["alle", "Alle"],
              ["hier", "Auf diesem Rechner"],
              ["stoerung", "Mit Störung"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              role="radio"
              aria-checked={filter === k}
              onClick={() => setFilter(k)}
              className={`px-2.5 border-r last:border-r-0 border-[var(--sm-linie)] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--sm-blau)] ${
                filter === k ? "bg-[var(--sm-text)] text-[var(--sm-grund)] font-semibold" : "hover:bg-[var(--sm-flaeche)]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          onClick={onNeuPruefen}
          disabled={pruefe}
          title="Alle Ordner auf diesem Rechner neu prüfen"
          className="h-7 px-2.5 rounded-md border border-[var(--sm-linie)] text-[12px] inline-flex items-center gap-1.5 hover:bg-[var(--sm-flaeche)] disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-[var(--sm-blau)]"
        >
          <RefreshCw className={`size-3.5 ${pruefe ? "animate-spin" : ""}`} />
          Neu prüfen
        </button>
      </div>

      {angeboteneOrdner.length > 0 && (
        <div className="shrink-0 px-5 py-2 border-b border-[var(--sm-linie)] bg-[var(--sm-flaeche)] flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
          <span className="font-semibold">Angeboten von einem anderen Rechner:</span>
          {angeboteneOrdner.map((o) => (
            <span key={o.id} className="inline-flex items-center gap-2">
              <span className="font-mono" dir="auto">{o.name}</span>
              <button
                onClick={o.onVerknuepfen}
                className="text-[var(--sm-blau)] font-semibold hover:underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-[var(--sm-blau)] rounded"
              >
                Verknüpfen
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Tafel */}
      <div className="flex-1 overflow-auto">
        <table ref={tabelleRef} onKeyDown={onTabelleKey} className="border-collapse text-[13px] min-w-full">
          <thead className="sticky top-0 z-20 bg-[var(--sm-grund)]">
            <tr className="border-b border-[var(--sm-linie)]">
              <th scope="col" className="sticky left-0 z-30 bg-[var(--sm-grund)] h-[60px] pl-3 pr-3 text-left align-bottom pb-2 min-w-[280px] w-[280px]">
                <span className="text-[11px] font-bold uppercase tracking-wide text-[var(--sm-text2)]">Projekt</span>
              </th>
              {spalten.map((s) => (
                <th key={s.id} scope="col" className={`h-[60px] px-0.5 align-bottom pb-1 min-w-[90px] max-w-[132px] ${s.ich ? "bg-[var(--sm-ich)]" : ""}`}>
                  <button
                    onClick={() => onRechner(s.id)}
                    title={s.ich ? "Dieser Rechner" : `${s.name} — ${s.online ? "online" : "offline"}`}
                    className="w-full flex flex-col items-center gap-0.5 rounded px-1 py-0.5 outline-none hover:bg-[var(--sm-flaeche)] focus-visible:ring-2 focus-visible:ring-[var(--sm-blau)]"
                  >
                    <span className="flex items-center gap-1 max-w-full">
                      <span
                        aria-hidden
                        className={`size-1.5 rounded-full shrink-0 ${s.online ? "bg-[var(--sm-text)]" : "border border-[var(--sm-text2)]"}`}
                      />
                      <span className={`truncate text-[12px] ${s.ich ? "font-bold" : "font-semibold"}`}>{s.name}</span>
                    </span>
                    <span className="text-[10px] text-[var(--sm-text2)] truncate max-w-full">
                      {s.ich ? <span className="font-semibold text-[var(--sm-blau)]">hier</span> : (rolleKurz(s.rolle) ?? (s.online ? "—" : "offline"))}
                    </span>
                    <span className="sm-zahl font-mono text-[10px] text-[var(--sm-text2)] truncate max-w-full">
                      {s.freiD != null ? `${gb(s.freiD)} frei` : s.ich ? "kein D:" : "\u00a0"}
                    </span>
                  </button>
                </th>
              ))}
              <th scope="col" className="w-full align-bottom pb-2 pl-2 text-left">
                <button
                  onClick={onRechnerKoppeln}
                  className="inline-flex items-center gap-1 h-6 px-2 rounded text-[11px] font-semibold text-[var(--sm-blau)] outline-none hover:bg-[var(--sm-flaeche)] focus-visible:ring-2 focus-visible:ring-[var(--sm-blau)]"
                >
                  <Plus className="size-3" strokeWidth={2.5} />
                  Rechner koppeln
                </button>
                <button
                  onClick={onCodeEinloesen}
                  className="ml-1 inline-flex items-center gap-1 h-6 px-2 rounded text-[11px] font-semibold text-[var(--sm-text2)] outline-none hover:bg-[var(--sm-flaeche)] hover:text-[var(--sm-text)] focus-visible:ring-2 focus-visible:ring-[var(--sm-blau)]"
                >
                  <KeyRound className="size-3" />
                  Code einlösen
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {sichtbar.length > 0 && (
              <tr>
                <th colSpan={spalten.length + 2} className="sticky left-0 text-left pl-3 pt-3 pb-1 text-[11px] font-bold uppercase tracking-wide text-[var(--sm-text2)] bg-[var(--sm-grund)]">
                  Projekte auf dem NAS <span className="sm-zahl font-semibold normal-case tracking-normal">{sichtbar.length}</span>
                </th>
              </tr>
            )}
            {sichtbar.map(zeileRender)}
            {sichtbar.length === 0 && (
              <tr>
                <td colSpan={spalten.length + 2} className="px-3 py-6 text-[13px] text-[var(--sm-text2)]">
                  {projekte.length === 0
                    ? "Der NAS bietet diesem Rechner noch keine Projekte an. Sobald er eins anbietet, erscheint es hier."
                    : filter === "stoerung"
                      ? "Kein Projekt ist angehalten."
                      : filter === "hier"
                        ? "Auf diesem Rechner ist noch kein Projekt abonniert. Bei einem Projekt auf „Abonnieren“ klicken."
                        : `Kein Projekt passt zu „${suche}“.`}
                </td>
              </tr>
            )}
            {pluginsSichtbar.length > 0 && (
              <tr>
                <th colSpan={spalten.length + 2} className="sticky left-0 p-0 text-left bg-[var(--sm-grund)]">
                  <button
                    onClick={() => setPluginsOffen((o) => !o)}
                    aria-expanded={pluginsOffen}
                    className="flex items-center gap-1 pl-2 pt-4 pb-1 text-[11px] font-bold uppercase tracking-wide text-[var(--sm-text2)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--sm-blau)]"
                  >
                    {pluginsOffen ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                    Plugins und eigene Ordner, an alle
                    <span className="sm-zahl font-semibold normal-case tracking-normal ml-1">{pluginsSichtbar.length}</span>
                    {!pluginsOffen && pluginsSichtbar.some((p) => p.stoerung) && (
                      <span className="ml-2 normal-case tracking-normal text-[var(--sm-ocker-text)]">angehalten</span>
                    )}
                  </button>
                </th>
              </tr>
            )}
            {pluginsOffen && pluginsSichtbar.map(zeileRender)}
          </tbody>
        </table>
      </div>
      <footer className="shrink-0 px-5 py-1.5 border-t border-[var(--sm-linie)] flex items-center gap-4">
        <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--sm-text2)]" aria-label="Legende">
          {(
            [
              [{ zustand: "aktuell" }, "aktuell"],
              [{ zustand: "laedt", prozent: 60 }, "lädt"],
              [{ zustand: "aktuell", teil: true }, "nur Unterordner"],
              [{ zustand: "angehalten" }, "angehalten"],
              [{ zustand: "unbekannt" }, "unbekannt"],
            ] as const
          ).map(([z, t]) => (
            <li key={t} className="flex items-center gap-1">
              <ZellSymbol z={z as never} size={12} />
              {t}
            </li>
          ))}
        </ul>
        <span className="ml-auto text-[11px] text-[var(--sm-text2)] hidden md:inline">
          <kbd className="font-mono">/</kbd> suchen · Pfeiltasten in der Tabelle · Enter öffnet
        </span>
      </footer>
      {ich && ich.freiD == null && (
        <p className="shrink-0 px-5 py-2 text-[11px] text-[var(--sm-text2)] border-t border-[var(--sm-linie)]">
          Dieser Rechner hat kein Laufwerk D: — Abonnieren geht nur auf den Windows-Rechnern mit D:.
        </p>
      )}
    </section>
  );
}
