---
name: syncomat
description: Projekte × Rechner als dichtes, ruhiges Formular. Gemeinsame Grundwerte mit der Seite des Speicher-Wächters (07.11.2026).
colors:
  grund: "#ffffff"
  flaeche: "#f4f5f7"
  linie: "#d9dce1"
  linie-fein: "#eceef1"
  text: "#111317"
  text2: "#5b616b"
  kopf: "#111317"
  kopf-text: "#ffffff"
  kopf-text2: "#b8bec8"
  blau: "oklch(0.55 0.2 262)"
  blau-flaeche: "oklch(0.95 0.03 262)"
  ocker: "oklch(0.62 0.13 75)"
  ocker-flaeche: "oklch(0.95 0.04 80)"
  ocker-text: "oklch(0.5 0.11 70)"
  rot: "oklch(0.55 0.2 27)"
  ich: "oklch(0.97 0.012 262)"
  grund-dunkel: "#0e0f12"
  flaeche-dunkel: "#17191d"
  linie-dunkel: "#2a2d33"
  linie-fein-dunkel: "#1e2126"
  text-dunkel: "#eceef1"
  text2-dunkel: "#9aa1ac"
  kopf-dunkel: "#000000"
  kopf-text2-dunkel: "#9aa1ac"
  blau-dunkel: "oklch(0.66 0.17 262)"
  blau-flaeche-dunkel: "oklch(0.27 0.06 262)"
  ocker-dunkel: "oklch(0.72 0.13 75)"
  ocker-flaeche-dunkel: "oklch(0.28 0.05 75)"
  ocker-text-dunkel: "oklch(0.76 0.13 75)"
  rot-dunkel: "oklch(0.65 0.19 27)"
  ich-dunkel: "oklch(0.2 0.02 262)"
  projekt-00-bleu-outremer-31: "#4E6498"
  projekt-01-bleu-ceruleen-31: "#366C8E"
  projekt-02-ceruleen-vif: "#5A8A93"
  projekt-03-vert-anglais: "#2C695A"
  projekt-04-vert-59: "#559778"
  projekt-05-vert-olive-vif: "#A4AA35"
  projekt-06-ombre-naturelle-moyenne: "#877C6A"
  projekt-07-orange: "#DE6433"
  projekt-08-terre-sienne-brique: "#A86A5D"
  projekt-09-rose-vif: "#DE8DA0"
  projekt-10-rouge-rubia: "#901442"
  projekt-11-gris-59: "#616F74"
typography:
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"SF Pro Text\", \"Segoe UI\", system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 700
    letterSpacing: "-0.025em"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"SF Pro Text\", \"Segoe UI\", system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
  body-strong:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"SF Pro Text\", \"Segoe UI\", system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 600
  control:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"SF Pro Text\", \"Segoe UI\", system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
  secondary:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"SF Pro Text\", \"Segoe UI\", system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 400
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"SF Pro Text\", \"Segoe UI\", system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 700
    letterSpacing: "0.025em"
  mono:
    fontFamily: "ui-monospace, \"SF Mono\", \"SFMono-Regular\", Menlo, Consolas, monospace"
    fontSize: "11px"
    fontWeight: 400
    fontFeature: "\"tnum\" 1"
rounded:
  sm: "0.25rem"
  md: "0.375rem"
  voll: "9999px"
spacing:
  zeile: "2.25rem"
  kopf: "3rem"
  werkzeug: "2.75rem"
  bedienung: "1.75rem"
  rand: "1.25rem"
  feld-rand: "1rem"
  leiste: "80px"
  feld-breite: "360px"
  projektkante: "3px"
components:
  kopfzeile:
    backgroundColor: "{colors.kopf}"
    textColor: "{colors.kopf-text}"
    typography: "{typography.title}"
    height: "{spacing.kopf}"
    padding: "0 1.25rem"
  button-handlung:
    backgroundColor: "{colors.blau}"
    textColor: "{colors.kopf-text}"
    typography: "{typography.body-strong}"
    rounded: "{rounded.md}"
    height: "2rem"
  button-neben:
    backgroundColor: "{colors.grund}"
    textColor: "{colors.text}"
    typography: "{typography.control}"
    rounded: "{rounded.md}"
    height: "{spacing.bedienung}"
    padding: "0 0.625rem"
  button-neben-hover:
    backgroundColor: "{colors.flaeche}"
  filter-aktiv:
    backgroundColor: "{colors.text}"
    textColor: "{colors.grund}"
    typography: "{typography.control}"
    height: "{spacing.bedienung}"
  suche:
    backgroundColor: "{colors.flaeche}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    height: "{spacing.bedienung}"
    width: "14rem"
  tabellenzeile:
    backgroundColor: "{colors.grund}"
    typography: "{typography.body-strong}"
    height: "{spacing.zeile}"
  tabellenzeile-gewaehlt:
    backgroundColor: "{colors.blau-flaeche}"
  leiste:
    backgroundColor: "{colors.kopf}"
    textColor: "{colors.kopf-text2}"
    width: "{spacing.leiste}"
  abofeld:
    backgroundColor: "{colors.grund}"
    textColor: "{colors.text}"
    width: "{spacing.feld-breite}"
---

# Design System: syncomat

## Overview

**Creative North Star: "Das ruhige Formular"**

syncomat zeigt eine Lage, keinen Feed. Die Hauptfläche ist eine Tabelle Projekte × Rechner, dicht gesetzt wie ein Formular: Rang entsteht aus Gewicht, Linie und Grossbuchstaben, nicht aus Grösse. Eine schwarze Kopfzeile pro Bereich sagt die Lage in zwei Zahlen, darunter liegt eine weisse (bzw. fast schwarze) Fläche mit feinen Graphit-Linien. Zustände tragen sich über Formen, nicht über Farbe; Farbe ist knapp und jede Farbe hat genau eine Bedeutung.

Die Welt teilt ihre Grundwerte mit der Seite des Speicher-Wächters (abgestimmt 07.11.2026): dieselben Neutraltöne, dieselbe Handlungsfarbe, dieselbe Projektfarbe pro projekt.id. Hell und Dunkel folgen dem System (`prefers-color-scheme`), Bedienelemente bleiben Standard-Bedienelemente (Radio, Checkbox, Segment, Suchfeld). Abgelehnt ist das Karten-Dashboard mit Seitenleiste voller Ordner und Geräte.

Texte sind sachlich: keine Bilder, keine Analogien. Die festen Wörter sind Projekte auf dem NAS, Abonnieren, Abo beenden, Arbeitskopie, Rechner, NAS.

**Key Characteristics:**
- Tabelle als Hauptfläche, Zeilen 2.25rem hoch, nur Haarlinien als Trennung.
- Schwarze Kopfzeile je Bereich: Titel links, zwei Zahlen rechts.
- Zustand als Form (Punkt, Ring, Halbpunkt, Strich, leer, gestrichelter Kreis), Wort immer daneben oder als Tooltip.
- Vier Farbbedeutungen: Blau Handlung, Ocker angehalten, Rot Datenverlust, Projektfarbe Erkennung.
- System-Grotesk für alles, Mono mit Tabellenziffern für Grössen und Pfade.
- Flach: keine Schatten, Tiefe nur über Kopfzeilen-Schwarz und Linien.

## Colors

Neutral und fast farblos; Farbe tritt nur auf, wenn sie etwas bedeutet.

### Primary
- **Handlungsblau** (`blau`, dunkel `blau-dunkel`): Primärknopf (Abonnieren, Akzeptieren), Textlinks und Zellen-Hover „Abonnieren“, Fokusring aller Bedienelemente, und der Ring einer Zelle, die gerade lädt (die laufende Handlung). Sonst nirgends.
- **Handlungsfläche** (`blau-flaeche`): gewählte Tabellenzeile, Textauswahl, Anfangsfarbe des Zellwechsel-Signals.

### Secondary
- **Ocker** (`ocker`): angehalten. Als Fläche oder Form: der Strich in der Zelle, Zahl-Marke in der Leiste, Rahmen der Hinweisboxen, Ocker-Knopf mit schwarzer Schrift. Auf der schwarzen Kopfzeile auch als Schrift („1 angehalten“).
- **Ocker-Schrift** (`ocker-text`): Ocker als Text oder Symbol auf heller Fläche, dunkler gestellt, damit 11–13 px mindestens 4.5:1 halten.
- **Ocker-Fläche** (`ocker-flaeche`): Hintergrund der Hinweisboxen im Detail.

### Tertiary
- **Verlustrot** (`rot`): ausschliesslich drohender oder eingetretener Datenverlust. Fehler, Offline, Konflikte und Warnungen sind nicht rot.
- **Projektfarben** (`projekt-00` … `projekt-11`): Le Corbusier, Polychromie architecturale (ab 08.11.2026, für alle Apps gleich): 0 `#4E6498` bleu outremer 31 · 1 `#366C8E` bleu céruléen 31 · 2 `#5A8A93` céruléen vif · 3 `#2C695A` vert anglais · 4 `#559778` vert 59 · 5 `#A4AA35` vert olive vif · 6 `#877C6A` ombre naturelle moyenne · 7 `#DE6433` orange · 8 `#A86A5D` terre sienne brique · 9 `#DE8DA0` rose vif · 10 `#901442` rouge rubia · 11 `#616F74` gris 59. Index = FNV-1a 32 Bit über die UTF-8-Bytes der projekt.id, mod 12 (`src/lib/projektFarbe.ts`, identisch in der Seite des Speicher-Wächters). Erscheint nur als 3-px-Kante.
- **Gemeinsam mit den Stage-Apps** (stage-system `DESIGN-GEMEINSAM.md`, Familie Datenzentrale, 08.11.2026): `--sm-ocker` = `warn` (Tag `oklch(0.490 0.115 70)`, Nacht `oklch(0.820 0.140 80)`), keine Hinweisfläche mehr in Ocker; `--sm-rot` = `rot` (Tag `oklch(0.480 0.180 25)`, Nacht `oklch(0.710 0.170 25)`), nur Datenverlust; nach jedem Klick sofort ein Zeichen (Wartetext am Knopf, Knopf gesperrt).
- **Zeichen je Zelle (Marlon 08.11.2026):** Füllung = Fortschritt, Farbe = Gewissheit, Ring = Teil-Abo. ● `--sm-gruen` (= `ok` aus DESIGN-GEMEINSAM) aktuell und bestätigt · ◔ blau lädt, Kuchen füllt sich · ○ abonniert, 0 % · ● grau aus, letzter Stand · ⦿ nur Unterordner (Ring + innen dieselben Zeichen) · ▬ gold angehalten · gestrichelt unbekannt. Beim Projektnamen derselbe Punkt als Zusammenfassung über alle Rechner mit Abo. Damit ist „Ok ohne Farbe“ für syncomat aufgehoben: Grün = bestätigt in Ordnung.

### Neutral
- **Grund** (`grund`): Arbeitsfläche, Tabelle, Felder.
- **Fläche** (`flaeche`): Hover, Suchfeld, Hinweiszeile unter der Werkzeugleiste.
- **Linie** (`linie`): Kopf- und Bereichsgrenzen, Rahmen von Bedienelementen. **Feine Linie** (`linie-fein`): Zeilentrennung in der Tabelle.
- **Text** (`text`) und **Zweittext** (`text2`): Inhalt und alles Sekundäre (Grössen, Spaltenköpfe, Legende).
- **Kopf** (`kopf`, dunkel reines Schwarz) mit **Kopfschrift** (`kopf-text`) und **Kopf-Zweitschrift** (`kopf-text2`): Kopfzeilen und Leiste.
- **Dieser Rechner** (`ich`): leichte Blau-Tönung der Spalte des eigenen Rechners (Kopf voll, Zellen 60 %).

### Named Rules
**The Rot-nur-für-Verlust Rule.** Rot steht ausschliesslich für Datenverlust. Wer Rot für einen Fehler, eine Warnung oder „offline“ nimmt, entwertet das einzige Signal, das sofort gelesen werden muss.

**The Ok-ist-farblos Rule.** „Aktuell“ hat keine Farbe: ein gefüllter Punkt in Textfarbe. Kein Grün für den Normalfall.

**The Eine-Handlungsfarbe Rule.** Blau heisst „hier kann oder wird gehandelt“. Ocker heisst angehalten, sonst nichts.

**The Projektfarbe-nur-für-Projekte Rule.** Nur Projekte bekommen eine Farbe, immer als 3-px-Kante direkt am Namen. Plugins, eigene Ordner und offene Ordner bekommen keine.

## Typography

**Display Font:** keine; der Titel ist die grösste Stufe.
**Body Font:** System-Grotesk (`-apple-system`, SF Pro Text, Segoe UI, system-ui)
**Label/Mono Font:** `ui-monospace` (SF Mono, Menlo, Consolas) mit Tabellenziffern

**Character:** Native Formularschrift ohne eigene Stimme. Die Skala ist eng (11 / 12 / 13 / 15 px); Unterschiede entstehen über Gewicht und Grossbuchstaben.

### Hierarchy
- **Title** (700, 15px, leicht enger): Bereichstitel in der Kopfzeile („Übersicht“, Projektname im Detail und im Abonnieren-Feld).
- **Body** (400, 13px): Inhalt, Sätze im Feld, Kopfzeilen-Zahlen. **Body-strong** (600, 13px): Projektnamen in der Tabelle, Optionen im Abonnieren-Feld, Primärknopf.
- **Control** (400, 12px): Filter-Segment, Nebenknöpfe, Rechnername im Spaltenkopf (600, eigener Rechner 700).
- **Secondary** (400–600, 11px): Grössen, Legende, Tastaturhinweis, Statusleiste, Zustandswort „angehalten“ (600, `ocker-text`).
- **Label** (700, 11px, Grossbuchstaben, 0.025em): Spalten- und Gruppenköpfe der Tabelle („Projekt“, „Projekte auf dem NAS 20“, „Plugins“) und Feld-Legenden („Was abonnieren“). Eine angehängte Zahl bleibt in normaler Schreibung.
- **Mono** (400, 10–12px, Tabellenziffern): Grössen (GB/TB), freier Platz pro Rechner, Pfade (`D:\…`), Prozent im Ladering, Version.

### Named Rules
**The Gewicht-statt-Grösse Rule.** Rang über Gewicht, Linie und Grossbuchstaben. Keine Stufe über 15 px.

**The Ziffern-stehen-still Rule.** Jede Zahl, die sich ändert oder in einer Spalte steht, trägt Tabellenziffern (`.sm-zahl` bzw. Mono).

## Layout

Fensteraufbau von links nach rechts: **Leiste** (80px, schwarz; 80 statt 56 px, damit „Einstellungen“ unter dem Symbol ganz lesbar ist) mit drei Bereichen (Übersicht, Aktivität, Einstellungen unten). Dann die **Hauptfläche**: Kopfzeile (3rem), Werkzeugleiste (2.75rem: Suche 14rem, Filter-Segment Alle · Auf diesem Rechner · Mit Störung, „Neu prüfen“), Tabelle, Fusszeile mit Legende und Tastaturhinweis. Rechts klappt das **Abonnieren-Feld** bzw. das **Detail** ein (360px), mit eigener schwarzer Kopfzeile. Ganz unten die Statusleiste.

Die Tabelle: erste Spalte sticky (280px) mit Projektkante, Name, Grösse; danach „Dieser Rechner“ (getönt), dann je Rechner eine Spalte (90–132px) mit Kopf aus Online-Punkt, Name, Rolle, „frei“ in Mono. Kopfzeile der Tabelle sticky. Zeilen 2.25rem, getrennt durch die feine Linie. Gruppen „Projekte auf dem NAS“ und „Plugins“ (eingeklappt) als Label-Zeilen.

Rhythmus: Seitenrand 1.25rem in Kopf, Werkzeug- und Fusszeile; 1rem innen in den Feldern. Die Wurzelschrift ist 16.5px, darum sind alle rem-Werte einen Tick luftiger als im Browser-Standard; Schriftgrössen sind in px festgelegt und davon unberührt.

**Tastatur:** „/“ fokussiert die Suche. Die Tabelle ist ein Roving-Tabindex: nur eine Zelle ist tabbar, Pfeiltasten wandern, Enter öffnet (Projektname: Detail; leere Zelle dieses Rechners: Abonnieren).

## Elevation & Depth

Völlig flach, keine Schatten. Tiefe entsteht durch drei Mittel: das Schwarz von Kopfzeile und Leiste gegen die helle Fläche, Graphit-Linien zwischen Bereichen, und Tönung (`flaeche` für Hover, `blau-flaeche` für Auswahl, `ich` für die eigene Spalte). Das eingeklappte Feld rechts liegt neben, nicht über der Tabelle; getrennt durch eine Linie.

### Named Rules
**The Linie-statt-Schatten Rule.** Grenzen sind Linien oder Schwarz, nie ein Schatten.

## Shapes

Kleine, leise Rundungen nur an Bedienelementen: Knöpfe, Suchfeld, Filter-Segment und Hinweisboxen 0.375rem, kleine Textknöpfe 0.25rem, Zahl-Marken voll rund. Tabelle, Kopfzeilen, Leiste und Felder sind rechtwinklig.

**Zustandsformen der Abos (rund, 14px, in syncomat gebaut):**
- aktuell: gefüllter Punkt in Textfarbe
- lädt: Ring in Linienfarbe, Anteil live in Blau gefüllt, Prozent in Mono daneben
- nur Unterordner: Kreis mit halber Füllung
- angehalten: waagrechter Ocker-Strich (4px hoch)
- nicht abonniert: leer (beim eigenen Rechner bei Hover „+ Abonnieren“ in Blau)
- unbekannt: gestrichelter Kreis in Zweittext, 0.55 Deckkraft
- offline: dieselbe Form mit 0.62 Deckkraft, Wort „(offline, letzter Stand)“

**Zustandsformen der Ordner (eckig, Konvention der Seite des Speicher-Wächters, nicht in syncomat gebaut):** offen □, zugeordnet ■ in Projektfarbe, wird verschoben eckiger Ring mit Anteil, im Projekt ✓, gesperrt ⊘. Rund heisst Abo auf einem Rechner, eckig heisst Ordner auf dem NAS; die beiden Apps tauschen die Formen nie.

**Rechner-Punkt:** online gefüllter Punkt in Textfarbe, offline leerer Ring.

### Named Rules
**The Form-trägt-Zustand Rule.** Jeder Zustand ist ohne Farbe an der Form lesbar, und das Wort steht daneben oder im Tooltip.

## Components

### Kopfzeile
Schwarz (`kopf`), 3rem hoch, in jedem Bereich und in jedem Feld. Titel (Title-Stufe) links, rechts genau zwei Zahlen in Kopfschrift fett mit Kopf-Zweitschrift dazwischen („412 GB frei auf D: · 12 Abos hier“); eine Störung kommt als Ocker-Zusatz dazu. Im Detail und im Abonnieren-Feld beginnt die Kopfzeile mit der 3-px-Projektkante, Symbolknöpfe (2rem) rechts in Kopf-Zweitschrift, beim Hover weiss.

### Buttons
- **Shape:** 0.375rem.
- **Handlung:** Blau, weisse Schrift 13px 600, 2rem hoch. Nur für die eine Handlung eines Feldes (Abonnieren, Akzeptieren). Gesperrt 0.4 Deckkraft.
- **Neben:** Linienrahmen, Grund, 12–13px, Hover `flaeche` (Neu prüfen, Abbrechen, Abo beenden).
- **Angehalten-Handlung:** Ocker-Fläche mit schwarzer Schrift, nur in Ocker-Hinweisboxen.
- **Textknopf:** Blau 11px 600 ohne Rahmen (Rechner koppeln), Hover `flaeche`.
- **Fokus:** überall 2px Ring in Blau (innen bei Zellen und Leiste).

### Chips
- **Filter-Segment:** ein Rahmen, Segmente durch Linien getrennt, 12px; gewähltes Segment invertiert (Textfarbe als Fläche, Grund als Schrift, 600). Als Radiogruppe ausgezeichnet.

### Inputs / Fields
- **Suche:** `flaeche`, Linienrahmen, 0.375rem, 14rem breit, Lupe links, Platzhalter „Projekt suchen /“. Fokus: Rahmen Blau plus 2px Ring Blau 25 %.
- **Radio und Checkbox:** native Elemente mit Akzent Blau, Zeilen 2.25rem bzw. 2rem, Grösse in Mono rechts.

### Navigation
- **Leiste:** 80px, schwarz, Symbol (18px, Strich 1.75) über dem Wort. Aktiv: Kopfschrift fett auf 15 % Weiss; sonst Kopf-Zweitschrift. Zahl-Marke oben rechts als Ocker-Kreis mit schwarzer Ziffer (Störungen, Update).

### Übersichtstabelle (Signature)
Zeile: Projektkante 3px, Name Body-strong, optional „angehalten“ in Ocker-Schrift, Grösse Mono rechts. Zelle: Zustandsform zentriert, ganze Zelle ist ein Knopf. Hover der Zeile `flaeche`, gewählte Zeile `blau-flaeche`. Legende der Formen immer in der Fusszeile.

**Zellwechsel-Signal:** Ändert sich der Zustand einer Zelle, startet sie in `blau-flaeche` und blendet in 200ms (cubic-bezier(0.16, 1, 0.3, 1)) auf transparent. Nicht beim ersten Laden, aus bei `prefers-reduced-motion`.

### Abonnieren-Feld
360px rechts, schwarze Kopfzeile mit Projektkante. Ein Satz, wohin die Arbeitskopie kommt (Pfad in Mono). Fieldset „Was abonnieren“: Ganzes Projekt oder Nur diese Ordner (Unterordner eingerückt an einer Linie, Pfade und Grössen in Mono). Fuss: Platzbedarf („braucht … · Laufwerk D: …“) mit Tabellenziffern, Handlung „Abonnieren“ plus Neben-Knopf.

### Projekt-Detail
Schwarze Kopfzeile mit Projektkante und Symbolknöpfen. Darunter Metazeile (12px, Tabellenziffern). Hinweisboxen für angehalten in Ocker (Rahmen `ocker`, Fläche `ocker-flaeche`, Symbol `ocker-text`), neutrale Box „Abonniert vom NAS“ mit „Abo beenden“. Fuss mit Pfad in Mono.

## Do's and Don'ts

### Do:
- **Do** jedem Bereich und jedem Feld eine schwarze Kopfzeile geben: Titel links, zwei Zahlen rechts.
- **Do** Zustände über die runden Formen zeigen und das Wort daneben oder im Tooltip mitgeben.
- **Do** Ocker als Schrift auf heller Fläche immer als `ocker-text` setzen; `ocker` nur als Fläche, Form oder auf Schwarz.
- **Do** die Projektfarbe aus `projektFarbe(projekt.id)` nehmen und nur als 3-px-Kante direkt am Namen zeigen.
- **Do** Grössen, Pfade und laufende Zahlen in Mono oder mit Tabellenziffern setzen.
- **Do** die festen Wörter verwenden: Projekte auf dem NAS, Abonnieren, Abo beenden, Arbeitskopie, Rechner, NAS.
- **Do** die Tastatur tragen lassen: „/“ Suche, Pfeile in der Tabelle, Enter öffnet.

### Don't:
- **Don't** Rot für etwas anderes als Datenverlust verwenden.
- **Don't** den Normalfall „aktuell“ einfärben, auch nicht grün.
- **Don't** Blau für Schmuck oder Status nehmen; Blau ist Handlung und ihr laufender Fortschritt.
- **Don't** Plugins, eigenen Ordnern oder offenen Ordnern eine Projektfarbe geben.
- **Don't** die runden Abo-Formen und die eckigen Ordner-Formen der Seite des Speicher-Wächters vermischen.
- **Don't** Schatten oder Karten-Raster einführen; Grenzen sind Linien.
- **Don't** Bilder oder Analogien in Texte schreiben.
- **Don't** Schrift über 15 px setzen.
