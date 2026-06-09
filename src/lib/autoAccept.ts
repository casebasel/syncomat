// Auto-Accept-Fenster: Wenn dieses Gerät einen Einladungs-Code erzeugt, wird für
// die Gültigkeitsdauer des Codes ein Fenster "geschärft". Eingehende Pending-
// Devices werden in der Zeit automatisch akzeptiert — ohne manuelles "Annehmen".
//
// Begründung: Der Code (HMAC-signiert, ablaufend, einmalig via Rendezvous) IST
// die Authentifizierung. Ein Mensch kann eine 56-Zeichen-Device-ID ohnehin nicht
// gegenprüfen — der manuelle Prompt war Security-Theater. Die Sicherheit gleicht
// exakt der Code-Gültigkeit: nur wer den Code hat, kennt die Device-ID und kann
// sich verbinden. Kürzeres Fenster gewünscht? -> kürzere Code-Gültigkeit wählen.
//
// Bewusst localStorage (nicht State): überlebt das Schließen des Code-Panels und
// sogar einen App-Neustart innerhalb des Fensters.

const KEY = "syncomat:autoAcceptUntil";

/** Schärft das Auto-Accept-Fenster bis `untilMs` (ms seit Epoch). Verlängert nur,
 *  verkürzt nie (mehrere Codes -> spätestes Ende gewinnt). */
export function armAutoAccept(untilMs: number): void {
  try {
    const prev = Number(localStorage.getItem(KEY) ?? "0");
    if (untilMs > prev) localStorage.setItem(KEY, String(Math.floor(untilMs)));
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
