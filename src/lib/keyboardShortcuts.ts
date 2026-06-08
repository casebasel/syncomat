import { useEffect } from "react";

/**
 * Blockiert WebView2-Default-Shortcuts die in einer Tauri-App nicht
 * sinnvoll sind:
 *
 * - Ctrl/Cmd+F   = Find-on-Page (oeffnet die WebView2-eigene Find-Bar)
 *                  Triggerte Marlons Tag-Eingabe-Konflikt auf Windows.
 * - Ctrl/Cmd+G   = Find Next (analog)
 * - F3           = Find Next (Windows-Tastatur-Shortcut)
 * - Ctrl/Cmd+P   = Print Page (WebView2 oeffnet System-Dialog)
 * - Ctrl/Cmd+R   = Reload (kompletter App-Reset, verliert Modal-State)
 * - F5           = Reload (analog)
 * - Ctrl/Cmd+S   = Save Page (WebView2 will HTML als Datei speichern)
 *
 * Macht KEINE Ausnahmen fuer Input-Felder — Marlon's Tag-Editor nutzt
 * Enter/Backspace zum Bearbeiten, keiner der geblockten Shortcuts wird
 * intern gebraucht.
 */
export function useBlockBrowserShortcuts() {
  useEffect(() => {
    const blockedWithMeta = new Set(["f", "g", "p", "r", "s"]);
    const onKey = (e: KeyboardEvent) => {
      const meta = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (e.key === "F3" || e.key === "F5") {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (meta && blockedWithMeta.has(k)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    // capture-phase damit der WebView2-Find-Hook nicht zuerst dran ist
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, []);
}
