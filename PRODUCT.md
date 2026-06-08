# Product

## Register

product

## Users

Filmstudio-Crew (Marlon + Kollegen) auf macOS und Windows. Technisch versiert (arbeiten mit Unreal Engine, Footage, grossen Asset-Folders), kennen Sync-Tools, wollen kein Hand-Holding. Nutzungs-Kontext: zwischen Studio-Workstations und mobilen Macs unterwegs; Sync läuft permanent im Hintergrund, App wird nur angeschaut wenn etwas zu prüfen oder einzurichten ist.

Job-to-be-done: Folder zwischen den eigenen Rechnern teilen ohne Cloud-Account, ohne Sync-Limits, ohne dass Engine-Caches oder Build-Output mitfliegen. Auf einen Blick sehen ob alles läuft. Wenn nicht: was und warum, in 2 Klicks zur Lösung.

## Product Purpose

Resilio-Style P2P-Sync, gebaut auf Syncthing als bewährter Engine, aber mit einem UI das für **Creative-Workloads** (Unreal-Projekte, RAW-Footage, Asset-Bibliotheken) optimiert ist statt für generische Dokument-Sync. Erfolg = der User vergisst dass die App läuft, ausser wenn sie ihn aktiv informieren MUSS (Konflikt, Peer offline beim Cooking, Disk voll).

Konkret abgegrenzt zu Syncthing-Web-UI: Syncomat ist die *kuratierte Surface* die Default-Entscheidungen trifft (Unreal-Preset, Auto-Share, Tags), und nur die paar Knöpfe zeigt die ein Studio-Mensch tatsächlich braucht. Wer in die Tiefe will, bekommt einen direkten Sprung in die Web-UI.

## Brand Personality

Verlässlich, präzise, sachlich. Werkzeug-Tone statt Service-Tone. Drei Worte: **Werkzeug. Direkt. Schweizer-Präzision.** Die App spricht den User als Profi an, nicht als Kunden. Keine Aufmunterungen ("Super, alles synchron!"), keine Notifications mit Emojis, keine "Möchtest du..." Vorschläge wo ein klarer Status reicht. Wenn etwas funktioniert: Status sagt es, kommentarlos. Wenn etwas nicht funktioniert: konkrete Diagnose + nächste Aktion in Verbform.

## Anti-references

- **Dropbox / iCloud-Style**: keine "Dein Kram ist sicher"-Aufmunterungen, keine Riesen-Onboarding-Modals, keine cloudige Pastell-Ästhetik. Wenn die UI sich anfühlt wie ein Verbraucherprodukt, ist sie für die falsche Audience.
- **Syncthing-Web-UI**: keine 20-Settings-pro-Folder direkt im Hauptscreen, keine raw JSON, keine Devices-Tabellen mit 12 Spalten zur Diagnose. Power-Features bleiben hinter einem "Erweitert"-Klick.
- **Mainstream-SaaS-Dashboards**: keine identischen Card-Grids mit Icon+Heading+Text, keine Hero-Metric-Templates ("142 Files synced!"), keine kleinen-Caps-Eyebrows über jeder Section ("FOLDERS · DEVICES"), keine Gradient-Headlines, keine Glassmorphism-als-Default.
- **Apple-Notes-Minimal**: kein leerer Whitespace-Aesthetic. Die Anti-Cluster sind übersichtlich, aber nicht steril. Whitespace dient Hierarchie, nicht Mood.

## Design Principles

1. **Status auf einen Blick, Details auf einen Klick.** Der Hauptscreen muss in unter 2 Sekunden beantworten: läuft alles? Welcher Folder hat ein Problem? Wer ist online? Erst der Klick öffnet die ausführliche Sicht.

2. **Werkzeug-Vokabular.** Keine "Magie", keine "Cloud", keine "Sync-Wunder". Sätze beginnen mit Verben ("Verknüpfen", "Tag hinzufügen", "Konflikt auflösen"). Status sind Zustandsbeschreibungen ("Synchron", "Wartet auf Mac-Studio"), nicht Bewertungen ("Alles bestens!").

3. **Default-Entscheidungen, nicht Default-Fragen.** Wenn 99 % der Studio-User dieselbe Antwort wählen würden (Auto-Share an alle Geräte, Unreal-Preset für ein UE-Projekt, Tags syncen), trifft die App die Entscheidung still. Das User-Override ist immer da, aber nicht im Weg.

4. **Dichte mit Hierarchie.** Resilio-Stil viele Information pro Card, aber durch Typographie und Farbe gegliedert (primärer Status gross, Details kleiner-grauer). Nicht jede Zahl in derselben Grösse — sonst wird's zur Datenwand wie Syncthing-Web-UI.

5. **Tools verraten ihr Stack-Vertrauen.** Wenn die App Syncthing nutzt, sagt sie das (Power-User-Link zur Web-UI in Settings). Sie versteckt ihre Engine nicht, aber sie zwingt den Engine-Stack auch keinem auf der nicht will.

## Accessibility & Inclusion

WCAG 2.1 AA als Baseline. Alle Modals haben Focus-Trap + aria-labelledby (bereits implementiert in v0.1.13). System-adaptives Theme (light + dark folgt OS-Setting) — kein dark-only weil Studio-Räume tagsüber hell sind. Reduced-Motion respektiert: pulsierende Sync-Status-Animationen müssen einen statischen Fallback haben. Kontrast für Status-Pillen (insbesondere amber/orange) sollte WCAG-AA-konform sein gegen beide Themes — der aktuelle SyncStatusBadge nutzt amber-700/dark-amber-300 als Text, das ist grenzwertig und muss in DESIGN.md sauber definiert werden.

Tastatur-Navigation komplett möglich, ohne Maus. Mac-Spezifika (Cmd-Shortcuts), Windows-Spezifika (Ctrl) — beides via Tauri-OS-Detection.
