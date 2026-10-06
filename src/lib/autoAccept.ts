// Auto-Accept-Fenster: Wenn dieses Gerät einen Einladungs-Code erzeugt, wird für
// die Gültigkeitsdauer des Codes ein Fenster "geschärft". Eingehende Pending-
// Devices werden in der Zeit automatisch akzeptiert — ohne manuelles "Annehmen".
//
// Begründung: Ein Mensch kann eine 56-Zeichen-Device-ID ohnehin nicht
// gegenprüfen — ein manueller Prompt wäre Security-Theater.
//
// ABER (Audit 06.10.2026): Das Fenster ist NICHT an den Code gebunden — jedes
// Gerät, das in der Zeit anklopft, wird angenommen (als Introducer, mit allen
// Ordnern). Die Device-ID dieses Geräts ist kein Geheimnis (steht in jedem
// Code, ist allen Peers bekannt). Deshalb seit v0.9.13:
//  - höchstens MAX_WINDOW_MS offen, egal wie lange der Code gültig ist
//  - schließt sich nach dem ersten angenommenen Gerät (disarmAutoAccept)
//  - klopfen mehrere Geräte gleichzeitig an, wird keins automatisch angenommen
//    (Banner "Akzeptieren" bleibt als manueller Weg)
//
// Bewusst localStorage (nicht State): überlebt das Schließen des Code-Panels und
// sogar einen App-Neustart innerhalb des Fensters.

const KEY = "syncomat:autoAcceptUntil";

/** Längste Zeit, die das Fenster offen bleibt (15 min) — der Gegenüber löst
 * den Code typischerweise sofort ein. */
export const MAX_WINDOW_MS = 15 * 60 * 1000;

/** Schärft das Auto-Accept-Fenster bis `untilMs` (ms seit Epoch). Verlängert nur,
 *  verkürzt nie (mehrere Codes -> spätestes Ende gewinnt). */
export function armAutoAccept(untilMs: number): void {
  try {
    const capped = Math.min(untilMs, Date.now() + MAX_WINDOW_MS);
    const prev = Number(localStorage.getItem(KEY) ?? "0");
    if (capped > prev) localStorage.setItem(KEY, String(Math.floor(capped)));
  } catch {
    /* localStorage nicht verfügbar -> Feature still aus, kein Crash */
  }
}

/** True, solange das geschärfte Fenster noch nicht abgelaufen ist. */
export function autoAcceptActive(): boolean {
  try {
    return Date.now() < Number(localStorage.getItem(KEY) ?? "0");
  } catch {
    return false;
  }
}

/** Fenster sofort schließen — nach dem ersten angenommenen Gerät. */
export function disarmAutoAccept(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ohne Storage war das Fenster nie offen */
  }
}
