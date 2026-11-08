import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { ChevronDown, ChevronRight, Loader2, X } from "lucide-react";
import { bytesDerAuswahl, describeFolderError, type BaumKnoten, type DeviceID, type Endpoint } from "../../lib/syncthing";
import type { Spalte, Zeile } from "../../lib/uebersicht";
import {
  EXFAT_HINWEIS,
  aboDateisystemErlaubt,
  istAuswahlPfad,
  istExfat,
  istWindows,
  normalisiereAuswahl,
  projekteWurzel,
  setzeProjekteWurzel,
  type GeraeteRolle,
} from "../../lib/abo";
import {
  aboAbbrechen,
  aboAuswahlAendern,
  aboBeenden,
  aboStarten,
  aboVorbereiten,
  baumVonOrdner,
  gb,
  inhaltHolen,
} from "../../lib/nasProjekte";
import type { Wunsch, WunschArt, WunschErgebnis } from "../../lib/wuensche";

// ── Auswahl je Projekt × Rechner ─────────────────────────────────
//
// Ein Klick auf einen Schnittpunkt der Übersicht: was von diesem Projekt auf
// diesem Rechner liegt — „Alles“ oder „Benutzerdefiniert“ mit Ordnerbaum.
// Für diesen Rechner wird direkt ausgeführt; für einen anderen Rechner geht
// ein Wunsch über den internen Kanal, den der Rechner selbst (mit seinen
// eigenen Prüfungen) ausführt, sobald er läuft.

type Baum = { baum: BaumKnoten[]; globalBytes: number };

const abgedeckt = (sel: string[], pfad: string) => sel.some((s) => pfad === s || pfad.startsWith(s + "/"));
const teilweise = (sel: string[], pfad: string) => !abgedeckt(sel, pfad) && sel.some((s) => s.startsWith(pfad + "/"));

function finde(baum: BaumKnoten[], pfad: string): BaumKnoten | null {
  for (const n of baum) {
    if (n.pfad === pfad) return n;
    if (pfad.startsWith(n.pfad + "/")) return finde(n.kinder, pfad);
  }
  return null;
}

/** Einen Ordner an- oder abwählen. Ist ein Elternordner gewählt, wird er beim
 * Abwählen in seine übrigen Unterordner aufgeteilt. */
export function umschalten(sel: string[], k: BaumKnoten, baum: BaumKnoten[]): string[] {
  if (!abgedeckt(sel, k.pfad)) {
    return normalisiereAuswahl([...sel.filter((s) => !s.startsWith(k.pfad + "/")), k.pfad]);
  }
  const ahn = sel.find((s) => k.pfad === s || k.pfad.startsWith(s + "/"))!;
  const neu = sel.filter((s) => s !== ahn);
  let n = finde(baum, ahn);
  if (!n) throw new Error(`„${ahn}“ steht nicht im Ordnerbaum — Auswahl bitte neu öffnen.`);
  while (n && n.pfad !== k.pfad) {
    const weiter: BaumKnoten | undefined = n.kinder.find((c) => k.pfad === c.pfad || k.pfad.startsWith(c.pfad + "/"));
    if (!weiter) throw new Error(`„${k.pfad}“ steht nicht im Ordnerbaum.`);
    for (const c of n.kinder) {
      if (c === weiter) continue;
      // Ein Geschwister, das sich nicht wählen lässt, fiele sonst still weg.
      if (!istAuswahlPfad(c.pfad)) {
        throw new Error(
          `„${k.name}“ lässt sich nicht einzeln abwählen: daneben liegt „${c.name}“, das sich nicht wählen lässt. „${n.name}“ ganz an- oder abwählen.`,
        );
      }
      neu.push(c.pfad);
    }
    n = weiter;
  }
  const ergebnis = normalisiereAuswahl(neu);
  // Nichts darf beim Bereinigen verloren gehen (sonst wird es still abgewählt).
  if (ergebnis.length !== new Set(neu.map((p) => p.normalize("NFC"))).size && neu.every((p) => !neu.some((q) => q !== p && p.startsWith(q + "/")))) {
    throw new Error("Auswahl liess sich nicht sauber bilden — bitte neu öffnen.");
  }
  return ergebnis;
}

function Knoten({
  k,
  sel,
  aktiv,
  offen,
  onOffen,
  onWahl,
  tiefe,
}: {
  k: BaumKnoten;
  sel: string[];
  aktiv: boolean;
  offen: Set<string>;
  onOffen: (p: string) => void;
  onWahl: (k: BaumKnoten) => void;
  tiefe: number;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const an = abgedeckt(sel, k.pfad);
  const halb = teilweise(sel, k.pfad);
  const waehlbar = istAuswahlPfad(k.pfad);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = aktiv && halb;
  }, [aktiv, halb]);
  const auf = offen.has(k.pfad);
  return (
    <li>
      <div className="flex items-center gap-1 h-8" style={{ paddingLeft: tiefe * 16 }}>
        {k.kinder.length > 0 ? (
          <button
            onClick={() => onOffen(k.pfad)}
            aria-label={auf ? `${k.name} zuklappen` : `${k.name} aufklappen`}
            aria-expanded={auf}
            className="size-6 shrink-0 rounded flex items-center justify-center text-[var(--sm-text2)] hover:text-[var(--sm-text)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--sm-blau)]"
          >
            {auf ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          </button>
        ) : (
          <span className="size-6 shrink-0" />
        )}
        <label
          className={`flex-1 min-w-0 flex items-center gap-2 h-8 ${aktiv && waehlbar ? "cursor-pointer" : ""}`}
          title={waehlbar ? undefined : "Name enthält Zeichen, die sich nicht wählen lassen"}
        >
          <input
            ref={ref}
            type="checkbox"
            disabled={!aktiv || !waehlbar}
            checked={aktiv ? an : true}
            onChange={() => onWahl(k)}
            className="accent-[var(--sm-blau)] shrink-0"
          />
          <span className={`flex-1 min-w-0 truncate text-[13px] ${waehlbar ? "" : "text-[var(--sm-text2)] line-through"}`} dir="auto">
            {k.name}
          </span>
          <span className="sm-zahl font-mono text-[12px] text-[var(--sm-text2)] shrink-0">{gb(k.bytes)}</span>
        </label>
      </div>
      {auf && k.kinder.length > 0 && (
        <ul>
          {k.kinder.map((c) => (
            <Knoten key={c.pfad} k={c} sel={sel} aktiv={aktiv} offen={offen} onOffen={onOffen} onWahl={onWahl} tiefe={tiefe + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function AuswahlFeld({
  ep,
  myID,
  rolle,
  zeile,
  spalte,
  offenerWunsch,
  ergebnisVomZiel,
  laeuftHier,
  onSenden,
  onZuruecknehmen,
  onSchliessen,
  aktionen,
  onUeberallBeenden,
  ausblenden,
  vorschauBaum,
}: {
  ep: Endpoint | null;
  myID: DeviceID | null;
  rolle: GeraeteRolle;
  zeile: Zeile;
  spalte: Spalte;
  /** Gesendeter, noch nicht erledigter Wunsch für diesen Schnittpunkt. */
  offenerWunsch: Wunsch | null;
  /** Ergebnis, das der Zielrechner für den letzten Wunsch gemeldet hat. */
  ergebnisVomZiel: WunschErgebnis | null;
  /** Dieser Rechner führt gerade einen Wunsch für dieses Projekt aus. */
  laeuftHier: boolean;
  onSenden: (art: WunschArt, auswahl: string[], vorher: string[] | null, loeschen?: boolean) => void;
  onZuruecknehmen: (id: string) => void;
  onSchliessen: () => void;
  /** Ordner-Aktionen für das eigene Abo (Explorer, Details, Fortsetzen …). */
  aktionen?: {
    explorer: () => void;
    details: () => void;
    fortsetzen: (() => void) | null;
    konflikte: (() => void) | null;
    fehler: (() => void) | null;
  };
  /** In der Übersicht ausblenden (fertiges Projekt) — nur Ansicht dieses Rechners. */
  ausblenden?: { aus: boolean; setzen: (aus: boolean) => void };
  /** Abo auf ALLEN Rechnern beenden (hier direkt, sonst als Wunsch). */
  onUeberallBeenden?: (loeschen: boolean) => Promise<string>;
  /** Nur für die Vorschau-Seite. */
  vorschauBaum?: Baum;
}) {
  const zelle = zeile.zellen[spalte.id] ?? { zustand: "unbekannt" as const };
  const abonniert = spalte.ich ? !!zeile.hier : zelle.zustand !== "nicht" && zelle.zustand !== "unbekannt";
  const startAuswahl = offenerWunsch?.art === "auswahl" ? offenerWunsch.auswahl : (zelle.auswahl ?? []);
  const [benutzer, setBenutzer] = useState(startAuswahl.length > 0);
  const [sel, setSel] = useState<string[]>(startAuswahl);
  const [baum, setBaum] = useState<Baum | null>(vorschauBaum ?? null);
  const [baumFehler, setBaumFehler] = useState<string | null>(null);
  const [offen, setOffen] = useState<Set<string>>(() => new Set(startAuswahl.flatMap((p) => p.split("/").slice(0, -1).map((_, i, t) => t.slice(0, i + 1).join("/")))));
  const [busy, setBusy] = useState<string | null>(null);
  const [meldung, setMeldung] = useState<{ ok: boolean; text: string } | null>(null);
  const [ueberallFragen, setUeberallFragen] = useState(false);
  const [beendenFragen, setBeendenFragen] = useState(false);
  /** Beim Beenden den Ordner löschen (nur, was sicher auf dem NAS ist). */
  const [ordnerLoeschen, setOrdnerLoeschen] = useState(true);

  // Ordnerbaum holen: aus dem eigenen Abo, sonst nur das Inhaltsverzeichnis vom NAS.
  useEffect(() => {
    if (vorschauBaum || !ep || !myID) return;
    // Schon geladen (z. B. Angebot kurz weg und wieder da): nicht neu holen —
    // sonst entsteht mit dem Neuverbinden eine Schleife (v0.9.31).
    const quelle = zeile.hier ? "hier" : zeile.angebot ? "angebot" : null;
    if (baum && quelle !== "hier") return;
    let cancelled = false;
    if (quelle) setBaumFehler(null);
    const holen = zeile.hier
      ? baumVonOrdner(ep, zeile.folderId)
      : zeile.angebot
        ? inhaltHolen(ep, zeile.angebot, myID)
        : Promise.reject(
            new Error(
              spalte.ich
                ? "Das NAS bietet dieses Projekt diesem Rechner (noch) nicht an — freigeben auf der Seite des Speicher-Wächters. Sobald das Angebot da ist, erscheint hier der Ordnerbaum."
                : "Dieser Rechner bekommt das Projekt nicht angeboten — der Ordnerbaum ist hier nicht abrufbar. „Alles“ lässt sich trotzdem senden.",
            ),
          );
    holen
      .then((b) => !cancelled && setBaum(b))
      .catch((e) => !cancelled && setBaumFehler(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zeile.folderId, !!zeile.hier, !!zeile.angebot]);

  const neu = benutzer ? normalisiereAuswahl(sel) : [];
  const vorher = normalisiereAuswahl(zelle.auswahl ?? []);
  const geaendert = !abonniert || neu.join("\n") !== vorher.join("\n") || (zelle.auswahl === undefined && abonniert);
  const bytes = baum ? bytesDerAuswahl(baum.baum, neu, baum.globalBytes) : null;
  const leer = benutzer && neu.length === 0;
  // Wo Projekte hier liegen: Windows D:\Projekte\, Mac ein gewählter Ordner.
  const [wurzel, setWurzel] = useState(projekteWurzel);
  useEffect(() => {
    const neu = () => setWurzel(projekteWurzel());
    window.addEventListener("syncomat-wurzel", neu);
    return () => window.removeEventListener("syncomat-wurzel", neu);
  }, []);
  const windows = !!wurzel;
  const wurzelWaehlen = async () => {
    try {
      const pfad = await open({ directory: true, title: "Ordner für Projekte (statt Laufwerk D:)" });
      if (typeof pfad === "string") {
        // macOS schützt Downloads, Dokumente und Schreibtisch — Syncthing kommt
        // dort ohne Freigabe nicht hinein („folder path missing“, 08.11.2026).
        if (/\/(Downloads|Documents|Desktop)(\/|$)/.test(pfad)) {
          setMeldung({
            ok: false,
            text: "Bitte einen Ordner ausserhalb von Downloads, Dokumente und Schreibtisch wählen — macOS lässt Syncthing dort nicht hinein. Zum Beispiel einen neuen Ordner „Projekte“ im Benutzerordner.",
          });
          return;
        }
        setzeProjekteWurzel(pfad);
      }
    } catch (e) {
      setMeldung({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  };

  const ausfuehren = async (was: string, f: () => Promise<string>) => {
    setBusy(was);
    setMeldung(null);
    try {
      setMeldung({ ok: true, text: await f() });
    } catch (e) {
      setMeldung({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  const hierUebernehmen = () =>
    ausfuehren("Übernehmen …", async () => {
      if (!ep || !myID) throw new Error("Syncthing nicht bereit.");
      if (zeile.hier) return aboAuswahlAendern(ep, zeile.hier, neu, rolle, myID, (t) => setBusy(t));
      if (!zeile.angebot) throw new Error("Das NAS bietet dieses Projekt hier nicht an.");
      const v = await aboVorbereiten(ep, zeile.angebot, myID, rolle, (t) => setBusy(t));
      let hinweis: string | null = null;
      try {
        hinweis = await aboStarten(ep, zeile.angebot, v, neu, rolle);
      } catch (e) {
        await aboAbbrechen(ep, zeile.angebot.folderId, v.ziel, zeile.angebot.anbieter);
        throw e;
      }
      return `Abonniert. Die Daten kommen jetzt vom NAS.${hinweis ? ` ${hinweis}` : ""}`;
    });
  const hierBeenden = () =>
    ausfuehren("Abo beenden …", async () => {
      if (!ep || !myID || !zeile.hier) throw new Error("Nicht abonniert.");
      return aboBeenden(ep, zeile.hier, myID, ordnerLoeschen);
    });

  const name = spalte.ich ? "diesem Rechner" : spalte.name;
  // Abos auf NTFS; exFAT erlaubt mit einmaligem Hinweis (Marlon 07.11.2026);
  // alles andere (FAT32 …) gesperrt. Bekannt aus disk_info (hier) bzw. der Notiz.
  const fsFalsch = !!spalte.dFs && !aboDateisystemErlaubt(spalte.dFs);
  const exfat = istExfat(spalte.dFs);
  const [exfatGesehen, setExfatGesehen] = useState(() => {
    try {
      return localStorage.getItem("syncomat.hinweis.exfat") === "1";
    } catch {
      return false;
    }
  });
  const kannHier = spalte.ich && windows && !(fsFalsch && !zeile.hier);
  // Was der Sender beim Ziel sieht — reist mit dem Wunsch (Gegenprobe am Ziel).
  const vorherFern: string[] | null | undefined = abonniert ? zelle.auswahl : null;
  const kannFern = !spalte.ich && spalte.kannWuensche && vorherFern !== undefined;

  return (
    <aside
      aria-labelledby="auswahl-titel"
      className="w-[380px] shrink-0 border-l border-[var(--sm-linie)] bg-[var(--sm-grund)] text-[var(--sm-text)] flex flex-col"
    >
      <header className="h-12 shrink-0 pl-0 pr-2 flex items-center gap-2.5 bg-[var(--sm-kopf)] text-[var(--sm-kopf-text)]">
        <span aria-hidden className="self-stretch w-[3px]" style={{ background: zeile.farbe ?? "transparent" }} />
        <h2 id="auswahl-titel" className="flex-1 min-w-0 truncate text-[16px] font-bold" dir="auto">
          {zeile.name}
          <span className="font-normal text-[var(--sm-kopf-text2)]"> · {spalte.ich ? "dieser Rechner" : spalte.name}</span>
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
        <p className="text-[14px] text-[var(--sm-text2)]">
          {abonniert
            ? `Was von ${zeile.name} auf ${name} liegt. Nicht Gewähltes bleibt auf dem NAS.`
            : `${zeile.name} ist auf ${name} nicht abonniert.`}
          {!spalte.ich && " Ausgeführt wird am Rechner selbst, mit seinen Prüfungen — ist er aus, sobald er läuft."}
        </p>

        {spalte.ich && zelle.ungesichert && (
          <div className="text-[14px] text-[var(--sm-ocker-text)] space-y-1" role="alert">
            <p className="font-semibold">
              {zelle.ungesichert.anzahl} Datei(en) liegen hier ausserhalb der Auswahl. Sie werden nicht abgeglichen und nicht auf dem NAS gesichert.
            </p>
            <ul className="font-mono text-[12px]">
              {zelle.ungesichert.beispiele.map((b) => (
                <li key={b} className="truncate" dir="auto">{b}</li>
              ))}
            </ul>
            <p className="text-[13px]">Sichern: auf „Alles“ wechseln oder die Dateien in einen gewählten Ordner verschieben.</p>
          </div>
        )}
        {!spalte.ich && !spalte.kannWuensche && (
          <p className="text-[14px] font-semibold text-[var(--sm-ocker-text)]">
            {spalte.name} läuft mit einer älteren syncomat-Version und nimmt noch keine Auswahl von anderen Rechnern an.
          </p>
        )}
        {fsFalsch && !abonniert && (
          <p className="text-[13px] font-semibold text-[var(--sm-ocker-text)]">
            D: {spalte.ich ? "dieses Rechners" : `von ${spalte.name}`} ist {spalte.dFs} — Abos brauchen NTFS oder exFAT.
          </p>
        )}
        {exfat && !abonniert && !exfatGesehen && (
          <div className="rounded-md border border-[var(--sm-linie)] px-3 py-2 text-[12px] space-y-1.5">
            <p>
              {spalte.ich ? EXFAT_HINWEIS : EXFAT_HINWEIS.replace("D: ist", `D: von ${spalte.name} ist`)}
            </p>
            <button
              onClick={() => {
                setExfatGesehen(true);
                try {
                  localStorage.setItem("syncomat.hinweis.exfat", "1");
                } catch {
                  /* dann erscheint der Hinweis wieder — schadet nicht */
                }
              }}
              className="text-[var(--sm-blau)] font-semibold hover:underline"
            >
              Verstanden
            </button>
          </div>
        )}
        {spalte.ich && istWindows() && !abonniert && wurzel && (
          <p className="text-[13px] text-[var(--sm-text2)]">
            Die Arbeitskopie kommt nach <span className="font-mono text-[var(--sm-text)] break-all">{wurzel}{zeile.name}</span>.
          </p>
        )}
        {spalte.ich && !istWindows() && (
          <div className="rounded-md border border-[var(--sm-linie)] px-3 py-2 text-[13px] space-y-1.5">
            <p className="font-semibold">Ordner für Projekte</p>
            {wurzel ? (
              <p>
                Abos kommen nach <span className="font-mono break-all">{wurzel}{zeile.name}</span> — auf diesem Mac anstelle von Laufwerk D:.{" "}
                <button onClick={() => void wurzelWaehlen()} className="text-[var(--sm-blau)] font-semibold hover:underline">
                  ändern
                </button>
              </p>
            ) : (
              <>
                <p className="text-[var(--sm-text2)]">
                  Auf dem Mac gibt es kein Laufwerk D:. Wähle einmal einen Ordner (z. B. „Projekte“ im Benutzerordner oder auf einer externen SSD) — darin liegen die Projekte wie unter Windows in D:.
                </p>
                <button
                  onClick={() => void wurzelWaehlen()}
                  className="h-7 px-2.5 rounded-md bg-[var(--sm-blau)] text-white text-[13px] font-semibold"
                >
                  Ordner wählen …
                </button>
              </>
            )}
          </div>
        )}

        {(zelle.zustand === "angehalten" || zelle.konflikte || zelle.dateifehler) && (
          <div className="rounded-md border border-[var(--sm-linie)] px-3 py-2 text-[14px] space-y-1.5" role="alert">
            {zelle.zustand === "angehalten" && (() => {
              const d = zelle.grund && zelle.grund !== "Pausiert" ? describeFolderError(zelle.grund) : null;
              const macGeschuetzt =
                spalte.ich && !istWindows() && !!zeile.hier && /folder path missing/i.test(zelle.grund ?? "") &&
                /\/(Downloads|Documents|Desktop)(\/|$)/.test(zeile.hier.path);
              return (
                <>
                  <p className="font-semibold text-[var(--sm-ocker-text)]">{d ? d.title : `Angehalten${zelle.grund ? `: ${zelle.grund}` : ""}`}</p>
                  {macGeschuetzt ? (
                    <p className="text-[12px]">
                      Der Ordner fehlt — gelöscht, verschoben, oder in Downloads/Dokumente/Schreibtisch, wo macOS Syncthing nicht hineinlässt.
                      Abo beenden (ohne Löschen), unter „Ordner für Projekte“ einen Ordner ausserhalb wählen (z. B. ~/Projekte) und neu abonnieren.
                    </p>
                  ) : (
                    d && <p className="text-[12px]">{d.action}</p>
                  )}
                </>
              );
            })()}
            {!!zelle.konflikte && <p className="font-semibold text-[var(--sm-ocker-text)]">{zelle.konflikte} Konflikt(e) — zwei Fassungen derselben Datei.</p>}
            {!!zelle.dateifehler && <p className="font-semibold text-[var(--sm-ocker-text)]">{zelle.dateifehler} Datei(en) lassen sich nicht abgleichen.</p>}
            {spalte.ich && aktionen && (
              <div className="flex flex-wrap gap-2 pt-0.5">
                {aktionen.fortsetzen && (
                  <button onClick={aktionen.fortsetzen} className="h-7 px-2.5 rounded-md bg-[var(--sm-blau)] text-white text-[13px] font-semibold">
                    Fortsetzen
                  </button>
                )}
                {aktionen.konflikte && (
                  <button onClick={aktionen.konflikte} className="h-7 px-2.5 rounded-md border border-[var(--sm-linie)] text-[13px] font-semibold hover:bg-[var(--sm-flaeche)]">
                    Konflikte auflösen
                  </button>
                )}
                {aktionen.fehler && (
                  <button onClick={aktionen.fehler} className="h-7 px-2.5 rounded-md border border-[var(--sm-linie)] text-[13px] font-semibold hover:bg-[var(--sm-flaeche)]">
                    Fehler ansehen
                  </button>
                )}
              </div>
            )}
            {!spalte.ich && <p className="text-[13px] text-[var(--sm-text2)]">Beheben am Rechner {spalte.name} selbst.</p>}
          </div>
        )}

        {spalte.ich && zeile.hier && aktionen && (
          <div className="flex flex-wrap gap-2">
            <button
              onClick={aktionen.explorer}
              className="h-7 px-2.5 rounded-md border border-[var(--sm-linie)] text-[13px] font-semibold hover:bg-[var(--sm-flaeche)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--sm-blau)]"
            >
              Im Explorer öffnen
            </button>
            <button
              onClick={aktionen.details}
              className="h-7 px-2.5 rounded-md border border-[var(--sm-linie)] text-[13px] font-semibold hover:bg-[var(--sm-flaeche)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--sm-blau)]"
            >
              Ordner-Details
            </button>
          </div>
        )}

        <fieldset className="space-y-1" disabled={!!busy}>
          <legend className="text-[12px] font-bold uppercase tracking-wide text-[var(--sm-text2)] mb-1.5">Umfang</legend>
          <label className="flex items-center gap-2.5 h-9 px-2 -mx-2 rounded hover:bg-[var(--sm-flaeche)] cursor-pointer">
            <input type="radio" name="umfang" checked={!benutzer} onChange={() => setBenutzer(false)} className="accent-[var(--sm-blau)]" />
            <span className="flex-1 text-[14px] font-semibold">Alles</span>
            {baum && <span className="sm-zahl font-mono text-[13px] text-[var(--sm-text2)]">{gb(baum.globalBytes)}</span>}
          </label>
          <label className="flex items-center gap-2.5 h-9 px-2 -mx-2 rounded hover:bg-[var(--sm-flaeche)] cursor-pointer">
            <input
              type="radio"
              name="umfang"
              checked={benutzer}
              onChange={() => setBenutzer(true)}
              disabled={!baum || baum.baum.length === 0}
              className="accent-[var(--sm-blau)]"
            />
            <span className="flex-1 text-[14px] font-semibold">Benutzerdefiniert</span>
          </label>

          {!baum && !baumFehler && (
            <p className="flex items-center gap-2 text-[13px] text-[var(--sm-text2)] pl-1" role="status">
              <Loader2 className="size-3.5 animate-spin text-[var(--sm-blau)]" />
              Ordnerbaum vom NAS holen (es wird nichts geladen) …
            </p>
          )}
          {baumFehler && <p className="text-[13px] text-[var(--sm-text2)] pl-1">{baumFehler}</p>}
          {baum && (
            <ul className={`mt-1 border-l border-[var(--sm-linie)] ml-1 ${benutzer ? "" : "opacity-50"}`}>
              {baum.baum.map((k) => (
                <Knoten
                  key={k.pfad}
                  k={k}
                  sel={sel}
                  aktiv={benutzer}
                  offen={offen}
                  tiefe={0}
                  onOffen={(p) =>
                    setOffen((o) => {
                      const n = new Set(o);
                      if (n.has(p)) n.delete(p);
                      else n.add(p);
                      return n;
                    })
                  }
                  onWahl={(k) => {
                    try {
                      setSel(umschalten(sel, k, baum.baum));
                      setMeldung(null);
                    } catch (e) {
                      setMeldung({ ok: false, text: e instanceof Error ? e.message : String(e) });
                    }
                  }}
                />
              ))}
              {baum.baum.length === 0 && <li className="text-[13px] text-[var(--sm-text2)] py-1 pl-3">Keine Unterordner.</li>}
            </ul>
          )}
          {benutzer && (
            <p className="text-[12px] text-[var(--sm-text2)] pt-1">
              Lose Dateien direkt im Projekt und in übergeordneten Ordnern kommen bei einer Auswahl nicht mit.
            </p>
          )}
        </fieldset>

        {offenerWunsch && (
          <div className="rounded-md border border-[var(--sm-linie)] bg-[var(--sm-flaeche)] px-3 py-2 text-[13px] space-y-1" role="status">
            <p>
              <span className="font-semibold">Gesendet</span> ·{" "}
              {offenerWunsch.art === "beenden"
                ? "Abo beenden"
                : offenerWunsch.auswahl.length === 0
                  ? "Alles"
                  : `${offenerWunsch.auswahl.length} Ordner`}{" "}
              · {spalte.online ? `${spalte.name} führt es aus …` : `${spalte.name} ist aus und führt es beim Start aus.`}
            </p>
            <button onClick={() => onZuruecknehmen(offenerWunsch.id)} className="text-[var(--sm-blau)] font-semibold hover:underline">
              Zurücknehmen
            </button>
          </div>
        )}
        {!offenerWunsch && ergebnisVomZiel && !spalte.ich && (
          <p className={`text-[13px] ${ergebnisVomZiel.ok ? "text-[var(--sm-text2)]" : "font-semibold text-[var(--sm-ocker-text)]"}`} role="status">
            {spalte.name}: {ergebnisVomZiel.text}
          </p>
        )}
        {laeuftHier && (
          <p className="flex items-center gap-2 text-[13px]" role="status">
            <Loader2 className="size-3.5 animate-spin text-[var(--sm-blau)]" />
            Ein anderer Rechner hat eine Änderung geschickt — wird gerade ausgeführt.
          </p>
        )}
        {meldung && (
          <p role={meldung.ok ? "status" : "alert"} className={`text-[14px] ${meldung.ok ? "" : "font-semibold text-[var(--sm-ocker-text)]"}`}>
            {meldung.text}
          </p>
        )}
      </div>

      <footer className="shrink-0 border-t border-[var(--sm-linie)] px-4 py-3 space-y-2">
        <p className="sm-zahl text-[13px] text-[var(--sm-text2)]">
          {bytes != null ? (
            <>
              braucht <span className="font-semibold text-[var(--sm-text)]">{gb(bytes)}</span>
            </>
          ) : (
            "Grösse unbekannt"
          )}
          {spalte.freiD != null && <> · frei {spalte.ich && !istWindows() ? "im Projektordner" : "auf D:"} {gb(spalte.freiD)}</>}
        </p>
        {busy && (
          <p className="flex items-center gap-2 text-[13px]" role="status">
            <Loader2 className="size-3.5 animate-spin text-[var(--sm-blau)]" />
            {busy}
          </p>
        )}
        <div className="flex gap-2">
          {spalte.ich ? (
            <button
              onClick={() => void hierUebernehmen()}
              disabled={!kannHier || !!busy || leer || !geaendert || laeuftHier || (!zeile.hier && !zeile.angebot)}
              className="flex-1 h-8 rounded-md bg-[var(--sm-blau)] text-white text-[14px] font-semibold disabled:opacity-40 outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--sm-blau)]"
            >
              {zeile.hier ? "Übernehmen" : "Abonnieren"}
            </button>
          ) : (
            <button
              onClick={() => {
                try {
                  onSenden("auswahl", neu, vorherFern ?? null);
                } catch (e) {
                  setMeldung({ ok: false, text: e instanceof Error ? e.message : String(e) });
                }
              }}
              disabled={!kannFern || leer || (!geaendert && !offenerWunsch) || (fsFalsch && !abonniert)}
              className="flex-1 h-8 rounded-md bg-[var(--sm-blau)] text-white text-[14px] font-semibold disabled:opacity-40 outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--sm-blau)]"
            >
              An {spalte.name} senden
            </button>
          )}
          {abonniert && (
            <button
              onClick={() => setBeendenFragen(true)}
              disabled={spalte.ich ? !zeile.hier || !!busy || laeuftHier : !kannFern}
              className="h-8 px-3 rounded-md border border-[var(--sm-linie)] text-[14px] hover:bg-[var(--sm-flaeche)] disabled:opacity-40 outline-none focus-visible:ring-2 focus-visible:ring-[var(--sm-blau)]"
            >
              Abo beenden
            </button>
          )}
        </div>
        {beendenFragen && (
          <div className="rounded-md border border-[var(--sm-linie)] px-3 py-2 text-[13px] space-y-2">
            <p className="font-semibold">Abo {spalte.ich ? "auf diesem Rechner" : `auf ${spalte.name}`} beenden?</p>
            <label className="flex items-start gap-2 cursor-pointer">
              <input type="checkbox" checked={ordnerLoeschen} onChange={(e) => setOrdnerLoeschen(e.target.checked)} className="mt-0.5 accent-[var(--sm-blau)]" />
              <span>
                Ordner {spalte.ich ? "hier" : `auf ${spalte.name}`} löschen
                <span className="block text-[12px] text-[var(--sm-text2)]">
                  Nur, was sicher auf dem NAS liegt. Was nie dort war (z. B. Autosaves), bleibt liegen und wird gemeldet.
                </span>
              </span>
            </label>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setBeendenFragen(false);
                  if (spalte.ich) void hierBeenden();
                  else onSenden("beenden", [], vorherFern ?? null, ordnerLoeschen);
                }}
                className="h-7 px-2.5 rounded-md bg-[var(--sm-text)] text-[var(--sm-grund)] text-[13px] font-semibold"
              >
                Abo beenden
              </button>
              <button onClick={() => setBeendenFragen(false)} className="h-7 px-2.5 rounded-md border border-[var(--sm-linie)] text-[13px]">
                Abbrechen
              </button>
            </div>
          </div>
        )}
        {leer && <p className="text-[12px] text-[var(--sm-ocker-text)]">Mindestens einen Ordner wählen — oder „Alles“.</p>}
        {ausblenden && (
          <button
            onClick={() => ausblenden.setzen(!ausblenden.aus)}
            className="block pt-1 text-[13px] text-[var(--sm-text2)] hover:text-[var(--sm-text)] underline-offset-2 hover:underline"
          >
            {ausblenden.aus ? "In der Übersicht wieder zeigen" : "In der Übersicht ausblenden (nur hier, Daten bleiben)"}
          </button>
        )}
        {onUeberallBeenden && (
          <div className="pt-1 text-[13px]">
            {!ueberallFragen ? (
              <button
                onClick={() => setUeberallFragen(true)}
                disabled={!!busy}
                className="text-[var(--sm-text2)] hover:text-[var(--sm-text)] underline-offset-2 hover:underline disabled:opacity-40"
              >
                Projekt fertig? Abo auf allen Rechnern beenden …
              </button>
            ) : (
              <div className="space-y-1.5">
                <p>
                  {zeile.name} auf allen Rechnern beenden? Jeder Rechner prüft vorher, dass das NAS alles von ihm hat.
                </p>
                <label className="flex items-start gap-2 cursor-pointer">
                  <input type="checkbox" checked={ordnerLoeschen} onChange={(e) => setOrdnerLoeschen(e.target.checked)} className="mt-0.5 accent-[var(--sm-blau)]" />
                  <span>Ordner auf den Rechnern löschen (nur, was sicher auf dem NAS liegt)</span>
                </label>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setUeberallFragen(false);
                      void ausfuehren("Abos beenden …", () => onUeberallBeenden(ordnerLoeschen));
                    }}
                    className="h-7 px-2.5 rounded-md bg-[var(--sm-text)] text-[var(--sm-grund)] font-semibold"
                  >
                    Überall beenden
                  </button>
                  <button onClick={() => setUeberallFragen(false)} className="h-7 px-2.5 rounded-md border border-[var(--sm-linie)]">
                    Abbrechen
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
        {!abonniert && bytes != null && spalte.freiD != null && bytes > spalte.freiD && (
          <p className="text-[12px] font-semibold text-[var(--sm-ocker-text)]">
            Passt nicht aufs Laufwerk von {spalte.ich ? "diesem Rechner" : spalte.name} — weniger Ordner wählen.
          </p>
        )}
      </footer>
    </aside>
  );
}
