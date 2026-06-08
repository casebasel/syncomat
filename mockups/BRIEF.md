# Syncomat — Redesign Brief (Direction C: Arc-Sidebar / Tag-zentriert)

Quelle: `/impeccable shape app-redesign` · Probes gezeigt am 2026-06-08 · Direction C gewählt.

## 1. Feature Summary

Komplettes UI-Redesign der Syncomat-Hauptansicht: weg von der aktuellen Single-Column-Liste, hin zu einem zweispaltigen Layout mit Tag-gruppierter Sidebar (200–220 px) und einem Hauptbereich, der vom **Aktivitäts-Feed** des ausgewählten Folders dominiert wird. Inspiriert von Tower (Git-Client, Commit-Liste als Hauptmotiv) und Arc (Sidebar-zentrierte Navigation), Resilio liefert die Status-Granularität. Zielgruppe sind die Studio-Kollegen, die täglich zwischen Unreal-Workspaces und Footage-Folders wechseln und nicht zehn Clicks brauchen wollen, um zu sehen *was passiert ist*.

## 2. Primary User Action

**„Sehen welcher Folder gerade was synct (oder warum nicht) — und im selben Atemzug Probleme auflösen, ohne ein Modal."**

Die Aktivitäts-Liste ist der zentrale Beweis, dass die App läuft. Konflikte sind Inline-Zeilen im Feed (statt separate Sektion), Auflösen ist ein Klick aus dem Feed-Eintrag.

## 3. Design Direction

- **Color strategy**: Restrained — System-adaptives Neutral (warmes Off-White light / fast-Schwarz dark), ein blauer Akzent (`#2563eb`, bereits in der App) für Brand-Marker und aktive Sidebar-States, sonst Status-Farben (emerald/amber/rose) ausschliesslich an Sync-State-Pillen + Dots. Kein Pastell-Tag-Palette mehr in der Brand-Surface; Tags behalten ihre Farb-Hash-Palette nur für Chips, nicht für die Sidebar-Gruppen-Headings.
- **Theme scene sentence**: Marlon checkt nach einem 4-Stunden-UE-Cooking-Run kurz auf den Sync, im hellen Studio-Raum gegen 14:00 — die App muss in unter 2 Sekunden sagen *„alle 10 Projekte synct, ein Konflikt in orderA"*, ohne dass er hineinklickt; abends im Edit-Suite mit gedimmtem Licht soll dieselbe Information ohne Augen-Schock dasselbe Verhalten haben. → **System-adaptiv (light + dark)**, kein dark-only.
- **Anchor references**:
  - **Tower** (Mac-Git-Client) → Commit-Liste als Hauptmotiv im Detail-View, Inspector-Stil, Mono-font für Pfade, kompakte Action-Bars
  - **Arc Browser** → Sidebar dominant, sehr schlanke Gruppen-Headings, weiche Hover-States
  - **Resilio** → Status-Granularität (Synchron, Wartet, Synct, Fehler, Konflikt) + dichte Info pro Card

## 4. Scope

- **Fidelity**: Brief jetzt = Wireframe; nächste Phase = Implementation direkt in der echten App (production-grade, kein Zwischen-Prototyp). Mid-Fi überspringen weil DESIGN.md durch PRODUCT.md + Mockups ausreichend pinnt.
- **Breadth**: Komplette Hauptansicht inkl. aller bisher implementierten Surfaces (Folders, Devices, Tags, Conflicts, Settings, Modals).
- **Interactivity**: Shipped-quality. Direkt in `src/App.tsx` + Components.
- **Time intent**: Polish-bis-zur-Ship-Qualität. Kein Quick-Sketch — Studio-Kollegen sollen die App ohne Anleitung verstehen.

## 5. Layout Strategy

```
┌─ Sidebar (200–220 px) ─┬─────── Main (flex-1) ──────────────────┐
│ Brand + Sync-Action    │ Folder-Header (Name, Tags, Status,     │
│ ─────────────          │   Pause/Settings)                       │
│ TAG-GRUPPE #unreal     │ ─────────────                           │
│   ▸ Folder A (sel.)    │ Aktivitäts-Feed (Hauptmotiv)            │
│   ▸ Folder B           │   Eine Zeile pro Sync-Event:            │
│ TAG-GRUPPE #footage    │   Time · Direction · Peer · Pfad · Size │
│   ▸ Folder C           │   Konflikt-Zeile mit Inline-Auflösen   │
│ TAG-GRUPPE #archive    │ ─────────────                           │
│   ▸ Folder D (paused)  │ Konflikt-Sammelbox (wenn welche da)     │
│ ─────────────          │ Footer: Pfad · Finder · Web-UI Link    │
│ + Ordner               │                                          │
│ ─────────────          │                                          │
│ GERÄTE                 │                                          │
│   ● x7950 (this Mac)   │                                          │
│   ○ studio (offline)   │                                          │
│ + Gerät                │                                          │
└────────────────────────┴─────────────────────────────────────────┘
Statusbar: Aktuell · Rate · Index-RAM · Version · letztes Sync
```

**Hierarchie**: Sidebar-Gruppen-Headings (10 px uppercase tracked) → Folder-Items (12 px medium) → Selected Folder (Pille-Background + Text-Color-Highlight). Im Main-Bereich: Folder-Name (18 px bold) → Status-Pill + Meta (11 px) → Aktivitäts-Zeilen (11 px font-mono für Pfade, tabular-nums für Bytes).

**Whitespace-Disziplin**: Sidebar ist *dicht*, Main-Bereich ist *atmend*. Sektionen im Main durch 20 px-Vertical-Gap getrennt, innerhalb von Sektionen 0–8 px Zeilen-Padding. Kein Whitespace nur zur Mood-Konstruktion — jede Lücke trennt zwei Sachen, die unterscheidbar sein müssen.

## 6. Key States

| State | Was sichtbar | Was fehlt vs. Default | Was passiert |
|---|---|---|---|
| **Default** (1+ Folder, 1+ Peer) | Sidebar voll, Main = Aktivitäts-Feed | — | — |
| **Empty** (frische App, 0 Folder, 0 Peer) | Sidebar: Brand + "+ Ordner" + "+ Gerät" + "Code einlösen" | keine Gruppen, kein Main-Inhalt | Main zeigt 3-Schritt-Onboarding (Code generieren / einlösen / Folder anlegen) |
| **Loading** (Syncthing-Boot 0–3s) | Sidebar skeleton, Main spinner mit "Sync-Dienst startet" | normale Aktion gegraut | Nach `ready`-Event → swap |
| **Selected folder w/o peers** | Sidebar normal, Main = "Nur lokal, lade Peer ein" | kein Activity-Feed | Activity-Feed durch CTA-Karte ersetzen |
| **Selected folder w/ conflict** | Wie default, plus amber-Zeile im Feed + Sammelbox unten | — | Klick auf "Auflösen" öffnet Conflict-Modal |
| **Peer offline** | Sidebar-Device-Dot grau, Main Activity-Header sagt "studio · offline seit 14:32" | live transfer-Zahlen | Statusbar: "Wartet auf Peer" |
| **Sync läuft** (needBytes > 0) | Activity-Feed scrollt, oberer Folder-Header zeigt "Synct · 23 % von 1.2 GB" | — | Progress-Bar im Header |
| **Sync-Fehler / Disk voll / Permission** | Folder-Header amber, Activity-Top-Zeile = Error-Eintrag mit "Ansehen"-Link | normale Activity-Zeilen drunter | Klick öffnet FolderErrorsModal |
| **Konflikt-Modal aktiv** | Wie default, Modal über Main (Modal-Logik bleibt) | — | Inline-Refresh nach Close (v0.1.21 fix) |
| **Settings-Modal** | Wie default, Modal überlagert | — | dito |

## 7. Interaction Model

- **Sidebar-Klick auf Folder**: Main wechselt sofort (kein Tab-State, keine Animation > 100 ms). Aktivitäts-Feed wird neu gefüllt.
- **Sidebar-Klick auf Tag-Heading**: kollabiert/expandiert die Gruppe (Disclosure). Persistiert in `localStorage`.
- **Sidebar-Hover**: weicher Background-Shift (50 ms ease-out).
- **+ Ordner**: öffnet CreateFolderModal (bleibt wie v0.1.21, inkl. Workload-Detect + Preset).
- **+ Gerät**: öffnet ein neues Modal mit zwei Tabs: **Code anzeigen** + **Code einlösen** (vereinigt die bisherigen zwei Buttons, weil sie zusammengehören).
- **Klick auf Geräte-Eintrag in Sidebar**: öffnet Device-Detail-Modal (welche Folders mit ihm geteilt, Last-Seen, Adresse, "Gerät entfernen") — neuer Screen, ersetzt die bisher fehlende Device-Detail-Sicht.
- **Activity-Zeile Klick**: bei Sync-Events nichts (passiver Log), bei Konflikt-Zeile öffnet ConflictResolverModal.
- **Folder-Header Settings-Icon**: bleibt FolderSettingsModal.
- **Drag&Drop**: Folder von einer Tag-Gruppe in eine andere = Tag-Wechsel (bonus, nicht v1).
- **Reduced-Motion**: alle Hover- und Slide-Übergänge crossfade-fallback.

## 8. Content Requirements

**Status-Vokabular** (kein Marketing-Sprech):

- `Synchron` (war: "Synchron" ✓)
- `Synct` mit Progress (`Synct · 23 % von 1.2 GB`)
- `Scant` (während Rescan)
- `Wartet auf <Peer-Name>` (statt generisches "Wartet auf Peer")
- `Wartet auf Daten` (Peer online, Bytes ausstehend)
- `Fehler · <count> Datei(en)` mit klickbarem Detail
- `Konflikt · <count>`
- `Pausiert` (mit Pause-Datum: `Pausiert seit 12.05.`)
- `Nur lokal` (kein Peer im Folder)

**Activity-Feed-Zeile Format**:
```
14:21  ↓  studio   ProjectA/Content/Maps/Lobby.umap          18.2 MB
14:15  ⊘  studio   ProjectA/Saved/log.txt                    Konflikt auflösen →
13:45  ↑  →studio  ProjectA/Content/Maps/Editor.umap         31.4 MB
gestern ↓  studio   ProjectD/Content/Audio/intro.wav           4.8 MB
```

Spalten: Time (mono, 10 px, w-12) · Direction-Glyph (↓/↑/⊘, color-coded) · Peer (mono, w-14, ↑ präfix bei Upload) · Pfad (mono truncate flex-1) · Byte-Größe oder Action-Link (tabular-nums right-aligned).

**Realistische Ranges**:
- Folders: 0 (empty), 3 (Marlon typisch), 10–20 (Studio-Power), 50+ (edge)
- Tags: 0–8 typisch, 20+ edge → Sidebar scroll
- Activity-Events: 50/Stunde während Sync, 0–5/Stunde idle. Feed zeigt latest 100, "weitere laden" am Boden.
- Dateipfade: bis 200 Zeichen tief (Unreal-Pakete). Truncate left-side (start mit `…`) damit der Filename rechts immer sichtbar bleibt.

**Empty State Microcopy**:
- App leer, keine Peers: "Lade dein zweites Gerät ein, dann teilst du Ordner. Code generieren →"
- Selected Folder ohne Peers: "Nur lokal. Verbinde Geräte über Code anzeigen, oder warte auf eine Einladung."
- Activity-Feed leer (Folder gerade angelegt): "Noch keine Aktivität. Sync läuft im Hintergrund."

**Error-Microcopy** (Wortwahl-Disziplin: Diagnose + nächste Aktion):
- Sync-Fehler: `12 Dateien können nicht synct werden — Fehler ansehen →`
- Peer dauerhaft offline: `studio seit 3 Tagen offline. Adresse prüfen?`
- Disk-voll: `Zielplatte fast voll (97 %). Sync pausiert. Speicher freigeben`

## 9. Recommended References

Beim Implementieren laden:
- `reference/layout.md` — Sidebar + Main Grid-Topologie, Sticky-Header-Pattern
- `reference/interaction-design.md` — Activity-Feed-Scroll-Verhalten, Modal-Triggers
- `reference/typeset.md` — Mono-Pfade, tabular-nums, Hierarchie-Scale
- `reference/colorize.md` — Status-Pillen-Kontrast WCAG, Tag-Hash-Palette nochmal prüfen
- `reference/harden.md` — Error-States, Edge-Cases (empty/loading/offline-peer)
- `reference/audit.md` — am Schluss vor Release

Nicht laden: `animate.md` (kein Motion-Heavy-Design), `bolder.md` (Werkzeug-Tone, nicht expressiv).

## 10. Open Questions → Entscheidungen

Hier sind die wenigen offenen Punkte, die ich vorab entscheide statt zu fragen — du widersprichst wenn was nicht passt.

- **Window-Größe**: aktuell 480×720. Brief impliziert 760×640 minimum. **Entscheidung**: neue Defaults `width: 880, height: 640, minWidth: 720, minHeight: 540`. Tray bleibt — App wird einfach breiter wenn geöffnet.
- **Folder ohne Tag**: erscheinen unter einer Gruppe mit Heading `OHNE TAG` am Boden der Folder-Sektion in der Sidebar.
- **Multi-Tag-Folder**: erscheinen unter ihrem **ersten Tag** in der Sidebar (Verbleib in tags-Array-Order). Tag-Filter im Sidebar-Heading-Klick zeigt alle Folders mit diesem Tag im Main (Filter-Mode). Direction C's "Multi-Tag → mehrfach in Sidebar" wird verworfen — zu unübersichtlich.
- **History-Tab aus Direction B**: nicht gebraucht — Activity-Feed pro Folder ersetzt eine globale History. Wenn doch jemand will, kommt es als Settings-Eintrag „Globale Aktivität…" als Modal.
- **Pending-Folder-Anfragen**: erscheinen als Banner-Karte oben im Main, sobald jemand selektiert wird der pending-Status hat. Plus ein kleiner Sidebar-Indikator (`#pending`-Gruppe oder ein eigener Bereich oberhalb der Tags).
- **Activity-Feed-Performance**: bei Unreal-Initial-Sync mit 500k Files entsteht massiver Event-Storm. Activity-Feed cappt bei 200 Einträgen + live nur die neusten 30; älteres wird stündlich in `activity-archive-<date>.jsonl` rotiert (lokale Datei in `app_data_dir/`). Anzeigen nur on-demand via "weitere laden".
- **DESIGN.md schreiben**: ja, parallel zum Brief. Token-System (CSS vars für Status-Farben, Sidebar-Width, Activity-Row-Height) → leicht später re-themable.
- **Migrations-Stufen**: in zwei Releases, nicht ein big-bang. **Phase 1 (v0.2.0)**: neue Sidebar + Activity-Feed nur für ein Folder gleichzeitig (replace current Folder-Liste). Phase 2 (v0.2.1): Device-Detail-Modal, Pending-Folder-Banner, Activity-Archiv.

---

## ✅ Bestätigung

Wenn du sagst **„passt, los"** → ich implementiere Phase 1 (v0.2.0) direkt in der App:
- Window-Größe ändern in `tauri.conf.json`
- `App.tsx` Layout: Sidebar + Main statt aktueller Single-Column
- Neue `Sidebar.tsx` Component (Tag-gruppiert + Geräte + Add-Buttons)
- `FolderInspector.tsx` Component (Header + Activity-Feed + Konflikt-Sammler)
- `ActivityFeed.tsx` Component mit Event-Subscription via `bus`-Hook + neue Rust-`folder_activity_log`-Backend
- DESIGN.md schreiben (parallel)
- Backward-Kompat-Test (alle bestehenden Modals bleiben funktional)

Phase 2 würde ich danach in einem zweiten Release nachlegen.

Wenn was am Brief nicht passt — Folder ohne Tag, Window-Größe, Activity-Feed-Verhalten, Migration in zwei Stufen, etc. — sag's jetzt, dann passe ich an.
