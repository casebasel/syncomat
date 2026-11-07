import { useEffect, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";
import type { DeviceID, Endpoint } from "../../lib/syncthing";
import type { Zeile } from "../../lib/uebersicht";
import type { GeraeteRolle } from "../../lib/abo";
import { aboAbbrechen, aboStarten, aboVorbereiten, gb, type AboVorbereitung } from "../../lib/nasProjekte";

/** Feld rechts: ein Projekt abonnieren — ganz oder nur Unterordner (E28).
 * Öffnen holt das Inhaltsverzeichnis (nichts wird geladen); „Abonnieren“
 * prüft den Platz für die Auswahl und startet; Schliessen räumt wieder weg. */
export function AboFeld({
  ep,
  myID,
  rolle,
  zeile,
  onFertig,
  onSchliessen,
  vorschau,
}: {
  ep: Endpoint;
  myID: DeviceID;
  rolle: GeraeteRolle;
  zeile: Zeile;
  onFertig: () => void;
  onSchliessen: () => void;
  /** Nur für die Vorschau-Seite: fertige Vorbereitung statt Abfrage. */
  vorschau?: AboVorbereitung;
}) {
  const p = zeile.angebot!;
  const [schritt, setSchritt] = useState("Laufwerk D: prüfen …");
  const [v, setV] = useState<AboVorbereitung | null>(vorschau ?? null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [ganz, setGanz] = useState(true);
  const [auswahl, setAuswahl] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const gestartet = useRef(false);
  const vRef = useRef<AboVorbereitung | null>(null);

  useEffect(() => {
    if (vorschau) return;
    let cancelled = false;
    aboVorbereiten(ep, p, myID, rolle, (t) => !cancelled && setSchritt(t))
      .then((res) => {
        vRef.current = res;
        if (cancelled) void aboAbbrechen(ep, p.folderId, res.ziel);
        else setV(res);
      })
      .catch((e) => !cancelled && setFehler(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
      // Geschlossen ohne Abonnieren: vorbereiteten Ordner wieder entfernen.
      if (!gestartet.current && vRef.current) void aboAbbrechen(ep, p.folderId, vRef.current.ziel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.folderId]);

  const bytes = v
    ? ganz
      ? v.globalBytes
      : v.ordner.filter((o) => auswahl.has(o.name)).reduce((a, o) => a + o.bytes, 0)
    : 0;
  const kannStarten = !!v && !busy && (ganz || auswahl.size > 0);

  const start = async () => {
    if (!v) return;
    setBusy(true);
    setFehler(null);
    try {
      await aboStarten(ep, p, v, ganz ? [] : [...auswahl], rolle);
      gestartet.current = true;
      onFertig();
    } catch (e) {
      setFehler(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside
      aria-labelledby="abofeld-titel"
      className="w-[360px] shrink-0 border-l border-[var(--sm-linie)] bg-[var(--sm-grund)] text-[var(--sm-text)] flex flex-col"
    >
      <header className="h-12 shrink-0 pl-0 pr-2 flex items-center gap-2.5 bg-[var(--sm-kopf)] text-[var(--sm-kopf-text)]">
        <span aria-hidden className="self-stretch w-[3px]" style={{ background: zeile.farbe ?? "transparent" }} />
        <h2 id="abofeld-titel" className="flex-1 truncate text-[15px] font-bold" dir="auto">
          {zeile.name}
        </h2>
        <button
          onClick={onSchliessen}
          aria-label="Schliessen"
          className="size-8 rounded flex items-center justify-center text-[var(--sm-kopf-text2)] hover:text-[var(--sm-kopf-text)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--sm-blau)]"
        >
          <X className="size-4" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        <p className="text-[13px] text-[var(--sm-text2)]">
          Auf diesem Rechner abonnieren. Die Arbeitskopie kommt nach{" "}
          <span className="font-mono text-[var(--sm-text)]">D:\{zeile.name}</span> und wird mit dem NAS abgeglichen.
        </p>

        {!v && !fehler && (
          <p className="flex items-center gap-2 text-[13px]" role="status">
            <Loader2 className="size-4 animate-spin text-[var(--sm-blau)]" />
            {schritt}
          </p>
        )}

        {v && (
          <fieldset className="space-y-1">
            <legend className="text-[11px] font-bold uppercase tracking-wide text-[var(--sm-text2)] mb-1.5">Was abonnieren</legend>
            <label className="flex items-center gap-2.5 h-9 px-2 -mx-2 rounded hover:bg-[var(--sm-flaeche)] cursor-pointer">
              <input type="radio" name="umfang" checked={ganz} onChange={() => setGanz(true)} className="accent-[var(--sm-blau)]" />
              <span className="flex-1 text-[13px] font-semibold">Ganzes Projekt</span>
              <span className="sm-zahl font-mono text-[12px] text-[var(--sm-text2)]">{gb(v.globalBytes)}</span>
            </label>
            <label className="flex items-center gap-2.5 h-9 px-2 -mx-2 rounded hover:bg-[var(--sm-flaeche)] cursor-pointer">
              <input
                type="radio"
                name="umfang"
                checked={!ganz}
                onChange={() => setGanz(false)}
                disabled={v.ordner.length === 0}
                className="accent-[var(--sm-blau)]"
              />
              <span className="flex-1 text-[13px] font-semibold">Nur diese Ordner</span>
            </label>
            <ul className={`ml-6 border-l border-[var(--sm-linie)] pl-3 ${ganz ? "opacity-50" : ""}`}>
              {v.ordner.map((o) => (
                <li key={o.name}>
                  <label className="flex items-center gap-2.5 h-8 cursor-pointer">
                    <input
                      type="checkbox"
                      disabled={ganz}
                      checked={!ganz && auswahl.has(o.name)}
                      onChange={(e) =>
                        setAuswahl((prev) => {
                          const n = new Set(prev);
                          if (e.target.checked) n.add(o.name);
                          else n.delete(o.name);
                          return n;
                        })
                      }
                      className="accent-[var(--sm-blau)]"
                    />
                    <span className="flex-1 font-mono text-[12px]" dir="auto">
                      {o.name}
                    </span>
                    <span className="sm-zahl font-mono text-[12px] text-[var(--sm-text2)]">{gb(o.bytes)}</span>
                  </label>
                </li>
              ))}
              {v.ordner.length === 0 && <li className="text-[12px] text-[var(--sm-text2)] py-1">Keine Unterordner.</li>}
            </ul>
            {!ganz && v.dateienOben > 0 && (
              <p className="ml-6 pl-3 text-[11px] text-[var(--sm-text2)]">
                Lose Dateien direkt im Projekt ({gb(v.dateienOben)}) kommen bei einer Auswahl nicht mit.
              </p>
            )}
          </fieldset>
        )}

        {fehler && (
          <p role="alert" className="text-[13px] text-[var(--sm-ocker-text)] font-semibold">
            {fehler}
          </p>
        )}
      </div>

      <footer className="shrink-0 border-t border-[var(--sm-linie)] px-4 py-3 space-y-2">
        {v && (
          <p className="sm-zahl text-[12px] text-[var(--sm-text2)]">
            braucht <span className="font-semibold text-[var(--sm-text)]">{gb(bytes)}</span> · Laufwerk D: {gb(v.totalBytes)}
          </p>
        )}
        <div className="flex gap-2">
          <button
            onClick={() => void start()}
            disabled={!kannStarten}
            className="flex-1 h-8 rounded-md bg-[var(--sm-blau)] text-white text-[13px] font-semibold disabled:opacity-40 flex items-center justify-center gap-1.5 outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--sm-blau)]"
          >
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            Abonnieren
          </button>
          <button
            onClick={onSchliessen}
            className="h-8 px-3 rounded-md border border-[var(--sm-linie)] text-[13px] hover:bg-[var(--sm-flaeche)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--sm-blau)]"
          >
            Abbrechen
          </button>
        </div>
      </footer>
    </aside>
  );
}
