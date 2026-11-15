import { useEffect, useState } from "react";

// ── Darstellung: System · Hell · Dunkel (Design System „Filmstudio Stage“) ──
//
// Jede Ansicht folgt der Systemeinstellung, mit Umschalter (Marlon 15.11.2026).
// Gesetzt wird immer der aufgelöste Satz auf <html data-theme="tag|nacht">;
// die Farben (App.css) und Tailwinds `dark:` hängen daran.

export type ThemaWahl = "system" | "hell" | "dunkel";
const LS = "syncomat.thema";
const mq = () => window.matchMedia?.("(prefers-color-scheme: dark)");

export function themaLesen(): ThemaWahl {
  try {
    const v = localStorage.getItem(LS);
    return v === "hell" || v === "dunkel" ? v : "system";
  } catch {
    return "system";
  }
}

export function themaAnwenden(w: ThemaWahl = themaLesen()) {
  const nacht = w === "dunkel" || (w === "system" && !!mq()?.matches);
  document.documentElement.dataset.theme = nacht ? "nacht" : "tag";
}

/** Beim Start einmal: anwenden und Systemwechsel verfolgen (nur bei „System“). */
export function themaStarten() {
  themaAnwenden();
  mq()?.addEventListener?.("change", () => {
    if (themaLesen() === "system") themaAnwenden("system");
  });
}

export function useThema(): [ThemaWahl, (w: ThemaWahl) => void] {
  const [wahl, setWahl] = useState<ThemaWahl>(themaLesen);
  useEffect(() => themaAnwenden(wahl), [wahl]);
  const setzen = (w: ThemaWahl) => {
    try {
      localStorage.setItem(LS, w);
    } catch {
      /* ohne Speicher nur für diese Sitzung */
    }
    setWahl(w);
  };
  return [wahl, setzen];
}
