---
version: 1
slug: "src-app-tsx"
primary_target: "src/App.tsx"
related_targets: ["src/components/Sidebar.tsx"]
---

# Surface: syncomat Hauptfenster (Operate)

Scope: ganzes App-Fenster (Tauri, Windows/macOS), Mode Operate. Gemeinsame Richtung mit der Seite des Speicher-Wächters (Datenzentrale), Grundwerte abgestimmt am 07.11.2026.

Audience/Job: Studio-Crew, ~30 Projekte, ~10 Rechner. Sehen, welches Projekt wo liegt und ob es aktuell ist; ein Projekt (ganz oder Unterordner) mit zwei Klicks abonnieren; Abo beenden; Störungen finden.

Constraints: Rot nur für Datenverlust; keine Bilder/Analogien in Texten; Begriffe Projekte auf dem NAS · Abonnieren · Abo beenden · Arbeitskopie · Rechner; Hell und Dunkel nach System; Bedienelemente nach Standard; Tastatur (/ Suche, Pfeile, Enter).

## Direction contract

THESIS: Die Übersicht Projekte × Rechner als dichtes, ruhiges Formular: Rang über Gewicht, Linie und Grossbuchstaben statt Grösse; verweigert das Karten-Dashboard mit Seitenleiste voller Ordner und Geräte.

OWN-WORLD: Weiss bzw. #0E0F12, Graphit-Linien #D9DCE1/#2A2D33, Text #111317/#ECEEF1; eine Handlungsfarbe Blau #2867E4, Ocker #B37903 für angehalten, Rot #CC2827 nur Datenverlust; je Projekt eine 3-px-Kante aus 12 Tönen (FNV-1a mod 12, 0 Lindgrün … 11 Moos). System-Grotesk 13 px, Mono mit Tabellenziffern für Zahlen/Pfade. Schwarze Kopfzeile je Bereich mit zwei weissen Zahlen.

STORY: Öffnen → Kopfzeile sagt die Lage in zwei Zahlen; Tafel zeigt, wo jedes Projekt liegt; leere Zelle dieses Rechners klicken → Unterordner wählen → Abonnieren; Zelle zeigt Fortschritt; Projektname öffnet Detail mit Abo beenden.

FIRST VIEWPORT: Links schmale Leiste (Übersicht · Aktivität · Einstellungen, 56 px). Oben schwarze Kopfzeile „Übersicht“ + „412 GB frei auf D: · 3 Abos“. Darunter Suche + Filter (Alle · Auf diesem Rechner · Mit Störung). Hauptfläche: Tabelle, erste Spalte Projekt (Kante + Name + Grösse), dann Spalte „Dieser Rechner“ hervorgehoben, dann je Rechner eine Spalte mit Kopf (Name, online-Punkt, Rolle, frei auf D:). Zellen mit Formen ● ◔ ◐ Ocker-Strich leer. Gruppe „Plugins“ eingeklappt unten. Rechts klappt das Detail bzw. das Abonnieren-Feld ein (360 px).

FORM: Dichte Formulartypografie mit Projektkante — Position 1 meiner Liste (Pick), mit der Projektkante aus der zugeteilten Richtung (Projektfarben, Position 4) gefügt; seed key 89777433.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

Signature: Zellen-Formen tragen den Zustand ohne Farbe; Ladefortschritt füllt den Ring live; eine Zelle, die sich ändert, hebt sich kurz (200 ms) ab.
