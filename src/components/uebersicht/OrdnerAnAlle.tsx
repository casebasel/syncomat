import { useState } from "react";
import { Loader2, Plus } from "lucide-react";

export type Angebot = {
  id: string;
  name: string;
  /** Namen der anbietenden Rechner */
  von: string[];
  onAnnehmen: () => void;
  onAblehnen: () => Promise<void>;
};

export type OrdnerZeile = { id: string; name: string; bytes: number | null; stoerung: boolean; onOeffnen: () => void };

const gb = (n: number | null) => (n == null ? "" : n >= 1e12 ? `${(n / 1e12).toFixed(1)} TB` : n >= 1e9 ? `${(n / 1e9).toFixed(0)} GB` : `${(n / 1e6).toFixed(0)} MB`);

/** Ordner, die mit ALLEN Rechnern abgeglichen werden (Plugins u. ä.) — im
 * Gegensatz zu den Projekten (Abo je Rechner, in der Übersicht): anlegen,
 * Angebote anderer Rechner annehmen, bestehende öffnen. */
export function OrdnerAnAlle({
  angebote,
  ordner,
  onAnlegen,
}: {
  angebote: Angebot[];
  ordner: OrdnerZeile[];
  onAnlegen: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  return (
    <section className="flex-1 min-w-0 flex flex-col overflow-hidden bg-[var(--sm-grund)] text-[var(--sm-text)]">
      <header className="h-12 shrink-0 px-5 flex items-center justify-between bg-[var(--sm-kopf)] text-[var(--sm-kopf-text)]">
        <h1 className="text-[15px] font-bold tracking-tight">Ordner an alle</h1>
        <p className="sm-zahl text-[13px] text-[var(--sm-kopf-text2)]">
          <span className="font-semibold text-[var(--sm-kopf-text)]">{ordner.length}</span> abgeglichen
          {angebote.length > 0 && (
            <>
              {" · "}
              <span className="font-semibold text-[var(--sm-kopf-text)]">{angebote.length}</span> angeboten
            </>
          )}
        </p>
      </header>
      <div className="flex-1 overflow-y-auto px-5 py-4">
        <div className="flex items-start gap-4 max-w-[760px] mb-5">
          <p className="flex-1 text-[13px] text-[var(--sm-text2)]">
            Ordner, die auf allen Rechnern gleich sein sollen — zum Beispiel die Unreal-Plugins. Projekte vom NAS
            stehen in der Übersicht und werden je Rechner abonniert.
          </p>
          <button
            onClick={onAnlegen}
            className="shrink-0 h-8 px-3 rounded-md bg-[var(--sm-blau)] text-white text-[13px] font-semibold inline-flex items-center gap-1.5 outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--sm-blau)]"
          >
            <Plus className="size-3.5" strokeWidth={2.5} />
            Ordner an alle
          </button>
        </div>
        {fehler && (
          <p role="alert" className="mb-3 text-[13px] font-semibold text-[var(--sm-ocker-text)]">
            {fehler}
          </p>
        )}
        <h2 className="text-[11px] font-bold uppercase tracking-wide text-[var(--sm-text2)] mb-1">
          Angeboten von anderen Rechnern <span className="sm-zahl normal-case tracking-normal">{angebote.length}</span>
        </h2>
        <p className="text-[12px] text-[var(--sm-text2)] max-w-[760px] mb-2">
          Abgeglichen wird erst nach „Annehmen“. Dabei wählst du, wo der Ordner hier liegt — einen vorhandenen oder einen neuen.
        </p>
        {angebote.length === 0 ? (
          <p className="text-[13px] text-[var(--sm-text2)] mb-6">Keine offenen Angebote.</p>
        ) : (
          <ul className="max-w-[760px] border-t border-[var(--sm-linie)] mb-6">
            {angebote.map((a) => (
              <li key={a.id} className="flex items-center gap-3 h-12 border-b border-[var(--sm-linie-fein)]">
                <div className="flex-1 min-w-0">
                  <div className="truncate text-[13px] font-semibold" dir="auto">
                    {a.name}
                  </div>
                  <div className="truncate text-[11px] text-[var(--sm-text2)]">von {a.von.join(", ")}</div>
                </div>
                <button
                  onClick={a.onAnnehmen}
                  disabled={!!busy}
                  className="h-7 px-3 rounded-md bg-[var(--sm-blau)] text-white text-[12px] font-semibold disabled:opacity-40 outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--sm-blau)]"
                >
                  Annehmen …
                </button>
                <button
                  onClick={async () => {
                    setBusy(a.id);
                    setFehler(null);
                    try {
                      await a.onAblehnen();
                    } catch (e) {
                      setFehler(e instanceof Error ? e.message : String(e));
                    } finally {
                      setBusy(null);
                    }
                  }}
                  disabled={!!busy}
                  title="Nicht annehmen — wird nicht mehr angeboten"
                  className="h-7 px-3 rounded-md border border-[var(--sm-linie)] text-[12px] hover:bg-[var(--sm-flaeche)] disabled:opacity-40 inline-flex items-center gap-1.5 outline-none focus-visible:ring-2 focus-visible:ring-[var(--sm-blau)]"
                >
                  {busy === a.id && <Loader2 className="size-3 animate-spin" />}
                  Ablehnen
                </button>
              </li>
            ))}
          </ul>
        )}

        <h2 className="text-[11px] font-bold uppercase tracking-wide text-[var(--sm-text2)] mb-1">
          Mit allen abgeglichen <span className="sm-zahl normal-case tracking-normal">{ordner.length}</span>
        </h2>
        {ordner.length === 0 ? (
          <p className="text-[13px] text-[var(--sm-text2)]">Noch keiner. „Ordner an alle“ wählt einen aus.</p>
        ) : (
          <ul className="max-w-[760px] border-t border-[var(--sm-linie)]">
            {ordner.map((o) => (
              <li key={o.id} className="border-b border-[var(--sm-linie-fein)]">
                <button
                  onClick={o.onOeffnen}
                  className="w-full h-10 flex items-center gap-3 px-1 text-left hover:bg-[var(--sm-flaeche)] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--sm-blau)]"
                >
                  <span className="flex-1 min-w-0 truncate text-[13px] font-semibold" dir="auto">
                    {o.name}
                  </span>
                  {o.stoerung && <span className="text-[11px] font-semibold text-[var(--sm-ocker-text)]">angehalten</span>}
                  <span className="sm-zahl font-mono text-[11px] text-[var(--sm-text2)]">{gb(o.bytes)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
