// ── Projektfarbe ─────────────────────────────────────────────────
//
// Jedes Projekt hat eine feste Erkennungsfarbe, in syncomat und auf der Seite
// des Speicher-Wächters gleich (abgestimmt 07.11.2026): FNV-1a 32 Bit über die
// UTF-8-Bytes der projekt.id, mod 12, über diese Reihe. Nur für Projekte —
// Plugins, eigene Ordner und offene Ordner bekommen keine Farbe.
// Palette: Le Corbusier, Polychromie architecturale (Marlon 08.11.2026, über
// stage-system, für alle Apps gleich; Rechnung unverändert, nur die 12 Werte).

export const PROJEKT_FARBEN = [
  { name: "Bleu outremer 31", nr: "32020", css: "#4E6498" },
  { name: "Bleu céruléen 31", nr: "32030", css: "#366C8E" },
  { name: "Céruléen vif", nr: "32031", css: "#5A8A93" },
  { name: "Vert anglais", nr: "32040", css: "#2C695A" },
  { name: "Vert 59", nr: "4320G", css: "#559778" },
  { name: "Vert olive vif", nr: "4320F", css: "#A4AA35" },
  { name: "Ombre naturelle moyenne", nr: "32141", css: "#877C6A" },
  { name: "Orange", nr: "32080", css: "#DE6433" },
  { name: "Terre sienne brique", nr: "32121", css: "#A86A5D" },
  { name: "Rose vif", nr: "4320C", css: "#DE8DA0" },
  { name: "Rouge rubia", nr: "32101", css: "#901442" },
  { name: "Gris 59", nr: "4320H", css: "#616F74" },
] as const;

/** FNV-1a 32 Bit über die UTF-8-Bytes. */
export function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (const b of new TextEncoder().encode(s)) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function projektFarbIndex(projektId: string): number {
  return fnv1a32(projektId) % PROJEKT_FARBEN.length;
}

export function projektFarbe(projektId: string): string {
  return PROJEKT_FARBEN[projektFarbIndex(projektId)]!.css;
}

/** projekt.id aus der Folder-ID eines Abo-Ordners: `dz-<projekt.id>-<n>`. */
export function projektIdAusFolderId(folderId: string): string | null {
  const m = /^dz-(.+)-\d+$/.exec(folderId);
  return m ? m[1]! : null;
}
