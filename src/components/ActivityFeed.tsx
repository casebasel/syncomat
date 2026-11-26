import { useState } from "react";
import { ArrowDown, ArrowUp, Ban, Check, ChevronRight, FileX, Info, Pencil } from "lucide-react";
import {
  buendeln,
  fmtActivityBytes,
  fmtActivityTime,
  istBuendel,
  useFolderActivity,
  type ActivityEvent,
  type Buendel,
} from "../lib/activity";

// Aktivität eines Ordners im schmalen Feld rechts (Marlon 26.11.2026: „Zeilen
// zu lang, ich sehe nur Zeiten, nicht welches File“). Darum:
// - zuerst der Dateiname, darunter klein der Ordner, in der Mitte gekürzt
//   (erste 7 Zeichen … letzter Ordner)
// - viele gleiche Änderungen hintereinander als eine Zeile („18 Dateien
//   empfangen“), aufklappbar
// - nur die neuesten Einträge, Rest auf Wunsch

const ERSTE = 30;

/** Ordner eines Pfads, kurz: „03_UNREAL/MocapLive/Content/Maps“ → „03_UNRE…/Maps“. */
export function ordnerKurz(pfad: string): string {
  const teile = pfad.split(/[\\/]/).filter(Boolean);
  teile.pop(); // Dateiname weg
  if (teile.length === 0) return "Stammordner";
  if (teile.length === 1) return teile[0]!.length > 14 ? `${teile[0]!.slice(0, 7)}…` : teile[0]!;
  const erster = teile[0]!.length > 7 ? `${teile[0]!.slice(0, 7)}…` : `${teile[0]!}/…`;
  return `${erster}/${teile[teile.length - 1]}`;
}
const dateiname = (pfad: string) => pfad.split(/[\\/]/).filter(Boolean).pop() ?? pfad;

/** Gemeinsamer Ordner aller Pfade eines Bündels. */
function gemeinsamerOrdner(pfade: string[]): string {
  const zerlegt = pfade.map((p) => p.split(/[\\/]/).filter(Boolean).slice(0, -1));
  const erster = zerlegt[0] ?? [];
  let n = erster.length;
  for (const z of zerlegt) {
    let i = 0;
    while (i < n && i < z.length && z[i] === erster[i]) i++;
    n = i;
  }
  return erster.slice(0, n).join("/");
}

export function ActivityFeed({
  folderId,
  onResolveConflict,
}: {
  folderId: string;
  onResolveConflict?: () => void;
}) {
  const items = useFolderActivity(folderId);
  const [alle, setAlle] = useState(false);

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-[var(--sm-linie)] px-3 py-4 text-center">
        <p className="text-[12px] text-[var(--sm-text2)]">
          Noch keine Aktivität. Änderungen hier und von anderen Rechnern erscheinen, sobald sie passieren.
        </p>
      </div>
    );
  }

  const eintraege = buendeln(items);
  const sichtbar = alle ? eintraege : eintraege.slice(0, ERSTE);

  return (
    <div>
      <div
        role="log"
        aria-live="polite"
        aria-label="Sync-Aktivität"
        className="rounded-lg border border-[var(--sm-linie)] divide-y divide-[var(--sm-linie)]"
      >
        {sichtbar.map((x) =>
          istBuendel(x) ? (
            <BuendelZeile key={x.id} b={x} />
          ) : (
            <EinzelZeile key={x.id} event={x} onResolveConflict={onResolveConflict} />
          ),
        )}
      </div>
      {eintraege.length > ERSTE && (
        <button
          onClick={() => setAlle(!alle)}
          className="mt-1.5 text-[12px] text-[var(--sm-blau)] font-semibold hover:underline outline-none focus-visible:ring-2 focus-visible:ring-[var(--sm-blau)] rounded"
        >
          {alle ? "Weniger zeigen" : `Ältere zeigen (${eintraege.length - ERSTE})`}
        </button>
      )}
    </div>
  );
}

const WAS: Record<string, string> = {
  down: "empfangen",
  up: "gesendet",
  local: "hier geändert",
  conflict: "Konflikt",
};
function wasText(e: { direction: ActivityEvent["direction"]; action?: string }) {
  if (e.action === "deleted") return e.direction === "local" ? "hier gelöscht" : "gelöscht";
  return WAS[e.direction] ?? "";
}

function NasHaken({ nas }: { nas?: ActivityEvent["nas"] }) {
  if (!nas) return null;
  return nas === "bestaetigt" ? (
    <span className="inline-flex items-center gap-0.5 text-[var(--sm-gruen)]" title="Das NAS hat diesen Stand">
      <Check className="size-3.5" aria-hidden /> NAS
    </span>
  ) : (
    <span title="Noch nicht beim NAS bestätigt">wartet aufs NAS</span>
  );
}

function EinzelZeile({ event, onResolveConflict }: { event: ActivityEvent; onResolveConflict?: () => void }) {
  const isConflict = event.direction === "conflict" || event.action === "conflict";
  const Icon = directionIcon(event);
  if (event.direction === "app") {
    return (
      <div className="px-3 py-2 flex gap-2.5">
        <Icon className={`size-4 shrink-0 mt-0.5 ${directionColor(event)}`} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] text-[var(--sm-text)]">{event.text}</p>
          <p className="text-[12px] text-[var(--sm-text2)]">{fmtActivityTime(event.ts)} · syncomat</p>
        </div>
      </div>
    );
  }
  const wer = event.direction === "local" ? "hier" : event.peer || "";
  return (
    <div className={`px-3 py-2 flex gap-2.5 ${isConflict ? "bg-[var(--sm-flaeche)]" : ""}`} title={event.path}>
      <Icon className={`size-4 shrink-0 mt-0.5 ${directionColor(event)}`} aria-label={directionLabel(event)} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[var(--sm-text)]" dir="auto">
            {dateiname(event.path)}
          </span>
          {isConflict ? (
            <button onClick={onResolveConflict} className="shrink-0 text-[12px] font-semibold text-[var(--sm-ocker-text)] hover:underline">
              Auflösen →
            </button>
          ) : (
            event.size > 0 && <span className="shrink-0 sm-zahl text-[12px] text-[var(--sm-text2)]">{fmtActivityBytes(event.size)}</span>
          )}
        </div>
        <div className="flex items-baseline gap-1.5 text-[12px] text-[var(--sm-text2)] min-w-0">
          <span className="sm-zahl shrink-0">{fmtActivityTime(event.ts)}</span>
          <span aria-hidden>·</span>
          <span className="truncate min-w-0" dir="auto">{ordnerKurz(event.path)}</span>
          {wer && (
            <>
              <span aria-hidden>·</span>
              <span className="shrink-0 truncate max-w-[7rem]">{wer}</span>
            </>
          )}
          <span className="ml-auto shrink-0"><NasHaken nas={event.nas} /></span>
        </div>
      </div>
    </div>
  );
}

function BuendelZeile({ b }: { b: Buendel }) {
  const [offen, setOffen] = useState(false);
  const e0 = b.events[0]!;
  const Icon = directionIcon(e0);
  const dateien = b.events.filter((e) => e.path !== b.oben);
  const anzahl = dateien.length || b.events.length;
  const bytes = b.events.reduce((a, e) => a + (e.size || 0), 0);
  const ordner = gemeinsamerOrdner(dateien.map((e) => e.path)) || b.oben;
  const peers = [...new Set(b.events.map((e) => e.peer).filter(Boolean))];
  const wer = b.direction === "local" ? "hier" : peers.length === 1 ? peers[0] : peers.length > 1 ? `${peers.length} Rechner` : "";
  const bestaetigt = b.events.every((e) => e.nas === "bestaetigt");
  const wartet = b.events.some((e) => e.nas === "wartet");
  return (
    <div>
      <button
        onClick={() => setOffen(!offen)}
        aria-expanded={offen}
        title={ordner}
        className="w-full px-3 py-2 flex gap-2.5 text-left hover:bg-[var(--sm-flaeche)] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--sm-blau)]"
      >
        <Icon className={`size-4 shrink-0 mt-0.5 ${directionColor(e0)}`} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[var(--sm-text)]">
              <ChevronRight className={`inline size-3.5 -mt-0.5 mr-0.5 transition-transform ${offen ? "rotate-90" : ""}`} aria-hidden />
              {anzahl} {anzahl === 1 ? "Datei" : "Dateien"} {wasText(e0)}
            </span>
            {bytes > 0 && <span className="shrink-0 sm-zahl text-[12px] text-[var(--sm-text2)]">{fmtActivityBytes(bytes)}</span>}
          </div>
          <div className="flex items-baseline gap-1.5 text-[12px] text-[var(--sm-text2)] min-w-0">
            <span className="sm-zahl shrink-0">
              {fmtActivityTime(b.bis)}
            </span>
            <span aria-hidden>·</span>
            <span className="truncate min-w-0" dir="auto">{ordnerKurz(`${ordner}/x`)}</span>
            {wer && (
              <>
                <span aria-hidden>·</span>
                <span className="shrink-0 truncate max-w-[7rem]">{wer}</span>
              </>
            )}
            <span className="ml-auto shrink-0">
              {bestaetigt ? <NasHaken nas="bestaetigt" /> : wartet ? <NasHaken nas="wartet" /> : null}
            </span>
          </div>
        </div>
      </button>
      {offen && (
        <ul className="pl-9 pr-3 pb-2 space-y-0.5">
          {dateien.slice(0, 200).map((e) => (
            <li key={e.id} className="flex items-baseline gap-2 text-[12px]" title={e.path}>
              <span className="min-w-0 flex-1 truncate text-[var(--sm-text)]" dir="auto">{dateiname(e.path)}</span>
              {e.size > 0 && <span className="shrink-0 sm-zahl text-[var(--sm-text2)]">{fmtActivityBytes(e.size)}</span>}
            </li>
          ))}
          {dateien.length > 200 && <li className="text-[12px] text-[var(--sm-text2)]">… und {dateien.length - 200} weitere</li>}
        </ul>
      )}
    </div>
  );
}

function directionIcon(e: ActivityEvent) {
  if (e.direction === "app") return Info;
  if (e.action === "deleted") return FileX;
  if (e.direction === "conflict" || e.action === "conflict") return Ban;
  if (e.direction === "up") return ArrowUp;
  if (e.direction === "local") return Pencil;
  return ArrowDown;
}

function directionColor(e: ActivityEvent): string {
  if (e.direction === "app") return "text-[var(--sm-blau)]";
  if (e.action === "deleted") return "text-[var(--sm-text2)]";
  if (e.direction === "conflict" || e.action === "conflict") return "text-[var(--sm-ocker-text)]";
  if (e.direction === "up") return "text-[var(--sm-blau)]";
  if (e.direction === "local") return "text-[var(--sm-text)]";
  return "text-[var(--sm-gruen)]";
}

function directionLabel(e: ActivityEvent): string {
  if (e.action === "deleted") return "Gelöscht";
  if (e.direction === "conflict") return "Konflikt";
  if (e.direction === "up") return "Hochgeladen";
  if (e.direction === "local") return "Hier neu/geändert";
  return "Empfangen";
}
