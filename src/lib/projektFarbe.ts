// ── Projektfarbe ─────────────────────────────────────────────────
//
// Jedes Projekt hat eine feste Erkennungsfarbe, in syncomat und auf der Seite
// des Speicher-Wächters gleich (abgestimmt 07.11.2026): FNV-1a 32 Bit über die
// UTF-8-Bytes der projekt.id, mod 12, über diese Reihe. Nur für Projekte —
// Plugins, eigene Ordner und offene Ordner bekommen keine Farbe.
// Alle Töne ≥ 3,3:1 gegen #FFFFFF und #0E0F12 (nachgerechnet).

export const PROJEKT_FARBEN = [
  { name: "Lindgrün", css: "oklch(0.60 0.15 128)" },
  { name: "Grün", css: "oklch(0.58 0.15 148)" },
  { name: "Smaragd", css: "oklch(0.60 0.13 165)" },
  { name: "Türkis", css: "oklch(0.60 0.11 190)" },
  { name: "Petrol", css: "oklch(0.56 0.10 210)" },
  { name: "Stahlblau", css: "oklch(0.58 0.09 232)" },
  { name: "Indigo", css: "oklch(0.55 0.15 280)" },
  { name: "Violett", css: "oklch(0.58 0.16 300)" },
  { name: "Purpur", css: "oklch(0.58 0.16 318)" },
  { name: "Pflaume", css: "oklch(0.58 0.15 338)" },
  { name: "Oliv", css: "oklch(0.60 0.11 108)" },
  { name: "Moos", css: "oklch(0.50 0.09 140)" },
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
