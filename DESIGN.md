# Design

Token-System für Syncomat ab v0.2.0 (Direction C, Arc-Sidebar + Tower-Activity-Feed).
Konsumiert via Tailwind v4 utility-classes. Was hier definiert ist, ist die *eine* Quelle für Status-Farben, Sidebar-Maße und Typo-Skala.

## Color tokens

Light + Dark via `prefers-color-scheme`. Alle Farben sind über Tailwind-Defaults gemappt; eigene Custom-Werte nur wenn nötig.

### Surface

| Token | Light | Dark |
|---|---|---|
| `surface.base` | `bg-neutral-50` (#fafafa) | `bg-neutral-950` (#0a0a0a) |
| `surface.elevated` | `bg-white` | `bg-neutral-900` |
| `surface.sidebar` | `bg-neutral-100/60` | `bg-neutral-950/40` |
| `surface.hover` | `hover:bg-neutral-100` | `hover:bg-neutral-800/60` |
| `surface.selected` | `bg-blue-100/70` + `ring-1 ring-blue-200` | `bg-blue-950/60` + `ring-1 ring-blue-500/30` |

### Border / Divider

| Token | Light | Dark |
|---|---|---|
| `border.default` | `border-neutral-200` | `border-neutral-800` |
| `border.subtle` | `border-neutral-100` | `border-neutral-900` |
| `divider` | `divide-neutral-200` | `divide-neutral-800` |

### Text

| Token | Light | Dark |
|---|---|---|
| `text.primary` | `text-neutral-900` (#171717) | `text-neutral-100` |
| `text.secondary` | `text-neutral-500` | `text-neutral-400` |
| `text.tertiary` | `text-neutral-400` | `text-neutral-500` |
| `text.disabled` | `text-neutral-300` | `text-neutral-700` |
| `text.brand` | `text-blue-700` | `text-blue-300` |

### Brand

| Token | Wert |
|---|---|
| `brand.primary` | `bg-blue-600` (#2563eb) — App-Icon, primäre Actions |
| `brand.primary.hover` | `bg-blue-700` |
| `brand.text-on-primary` | `text-white` |
| `brand.accent` | `text-blue-600 / text-blue-400` für Links und sekundäre Highlights |

### Status

Status-Pillen + Dots haben strikt definierte Farben damit die Ampel WCAG-AA hält. Text auf Pille kontrastiert ≥4.5:1 gegen Pillen-Background.

| State | Dot | Pillen-BG | Pillen-Text | Bedeutung |
|---|---|---|---|---|
| `synced` | `bg-emerald-500` | `bg-emerald-100 / bg-emerald-950/40` | `text-emerald-700 / text-emerald-300` | Synct + Peer online + ok |
| `syncing` | `bg-blue-500 animate-pulse` | `bg-blue-100 / bg-blue-950/40` | `text-blue-700 / text-blue-300` | Bytes fließen |
| `scanning` | `bg-blue-400 animate-pulse` | dito | dito | Lokaler Rescan |
| `waiting-peer` | `bg-amber-500` | `bg-amber-100 / bg-amber-950/40` | `text-amber-700 / text-amber-300` | Peer offline |
| `waiting-data` | `bg-amber-500 animate-pulse` | dito | dito | Peer online, Bytes ausstehend |
| `error` | `bg-rose-500` | `bg-rose-100 / bg-rose-950/40` | `text-rose-700 / text-rose-300` | Datei-Fehler |
| `conflicts` | `bg-amber-600` | dito | dito | Sync-Conflict-Files |
| `paused` | `bg-neutral-400 / bg-neutral-600` | `bg-neutral-200 / bg-neutral-800` | `text-neutral-600 / text-neutral-400` | User-paused |
| `local-only` | `bg-neutral-300 / bg-neutral-700` | `bg-neutral-100 / bg-neutral-900` | `text-neutral-500` | Keine Peers |

`@media (prefers-reduced-motion: reduce)` → alle `animate-pulse`-Klassen werden via Tailwind base-styles zu opacity-static.

### Tags (Hash-Palette)

Tags behalten 8-Farben-Pastell-Palette aus v0.1.20 (`lib/tags.ts`). Wird NUR auf Tag-Chips angewendet, NICHT auf Sidebar-Gruppen-Headings oder andere Brand-Surfaces.

## Spacing

| Token | Wert |
|---|---|
| `sidebar.width` | `w-56` (224 px) |
| `sidebar.padding.x` | `px-1.5` (group items) / `px-3` (group headings) |
| `inspector.padding.x` | `px-6` |
| `inspector.section.gap` | `space-y-5` (20 px zwischen Sektionen) |
| `activity.row.padding` | `px-3 py-2` |
| `activity.row.gap` | `gap-3` zwischen Time / Direction / Peer / Path / Size |
| `gutter.title-to-meta` | `mt-1` (8 px) |

Sidebar ist dicht (kein extra Whitespace), Main-Bereich atmet (20 px Sektion-Gaps).

## Typography

Stack: `-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif` (Mac + Win native, kein web-font-Download).

Mono: `ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace`.

| Token | Tailwind | Pixel | Wo |
|---|---|---|---|
| `text.title` | `text-lg font-bold` | 18 px / 700 | Folder-Header Name |
| `text.section` | `text-sm font-bold` | 14 px / 700 | Sidebar Brand, Modal-Title |
| `text.body` | `text-xs` | 12 px / 400 | Folder-Items, Status-Pillen |
| `text.body.medium` | `text-xs font-medium` | 12 px / 500 | Sidebar Items |
| `text.meta` | `text-[11px]` | 11 px / 400 | Aktivitäts-Zeilen, Footer |
| `text.eyebrow` | `text-[10px] uppercase tracking-wider font-semibold` | 10 px / 600 | Sidebar Group-Headings, Inspector-Section-Headings |
| `text.tabular` | `font-mono text-[11px] tabular-nums` | 11 px mono | Activity-Pfade, Byte-Werte |

**Hierarchie-Verhältnis**: 18 / 14 / 12 / 11 / 10 — Faktor 1.2–1.3 zwischen Steps. Kein Flat-Scale.

`text-wrap: balance` auf alle h1–h3.

## Components

### Sidebar
- Width 224 px fixed
- Vertikales Scroll wenn Inhalt überläuft
- Border-Right gegen Main
- Sektionen durch `border-t` getrennt:
  1. Brand + Sync-Button (top)
  2. Folder-Tag-Gruppen (eine Sektion pro Tag, Heading mit Disclosure-Chevron + Count)
  3. "Ohne Tag"-Sektion (am Ende der Folder-Liste)
  4. "+ Ordner" Button
  5. Geräte-Sektion
  6. "+ Gerät / Code"-Button

### FolderInspector
- Header: Folder-Icon (40 px) · Name (18 px) · Tag-Chips · Status-Pille + Meta
- Aktionen rechts: Pausieren · Einstellungen (Icon-Buttons)
- Body-Sektionen (gap 20 px):
  1. Konflikt-Banner (wenn count > 0) — amber rounded-lg, "Auflösen"-Button rechts
  2. Activity-Feed — rounded-lg border mit divide-y rows
  3. Konflikt-Sammelbox (wenn relevant — gleich wie 1, sekundär gerendert)
  4. Footer-Meta: Pfad mono · Finder + Web-UI Links

### ActivityRow
- Höhe ~32 px (compact)
- Hover-Background
- Konflikt-Zeile hat amber-50/15-Background für Tonsignal
- Spalten: `time (w-12 mono) · direction (w-3.5) · peer (w-14 mono) · path (mono truncate flex-1) · size/action (right-aligned tabular)`

### Statusbar
- Höhe 28 px, fixed bottom
- Links: Aktuell-Status-Text
- Rechts: RAM · Version · "vor X s"

## Empty / Loading States

- **Empty (no folders, no peers)**: Sidebar zeigt nur Brand + drei Action-Buttons (`+ Ordner`, `Code anzeigen`, `Code einlösen`). Main zeigt 3-Step-Onboarding-Karte mit Verb-Labels.
- **Loading (Syncthing-Boot)**: Sidebar-Skeleton (drei graue Placeholder-Bars), Main-Spinner mit Text `Sync-Dienst startet …`.
- **No selection**: Wenn 1+ Folder existiert aber keiner selektiert, Default = ersten Folder selektieren.
- **Selected folder ohne Peers**: Activity-Feed-Sektion ersetzt durch CTA-Karte: `Nur lokal. Lade ein zweites Gerät ein damit dieser Ordner synct.` mit `Code anzeigen`-Button.
- **Activity-Feed leer (frischer Folder)**: Karte: `Noch keine Aktivität. Sync läuft im Hintergrund.`

## Motion

- Hover/Selection-Transitions: `transition-colors duration-100 ease-out`
- Sidebar-Tag-Group-Toggle: keine Höhen-Animation (Layout-Property), nur instant-collapse via `hidden`. Disclosure-Chevron dreht via `transition-transform`.
- Activity-Feed: neue Zeile wird oben eingefügt mit `transition: opacity 200ms ease-out` von 0→1, nicht slide-down. Bei reduced-motion: instant.
- Status-Dots `animate-pulse` → bei reduced-motion via Tailwind base auf `opacity-100` static.
- Modal-Open / Close: bleibt aktuelles Backdrop-Fade.

## Accessibility

- Focus-Ring: `focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2` auf alle Buttons und Klick-fähigen Items.
- Sidebar-Folder-Liste: `role="list"` + `role="listitem"`, Aria-Selected auf selected.
- Activity-Feed: `role="log" aria-live="polite"` damit Screenreader neue Events ankündigen (gedrosselt durch aria-live).
- Status-Pillen: Text-Label IMMER sichtbar, nicht nur Farbe (für Farbenblinde + Reduced-Motion).
- Folder-Name + Pfad mit `dir="auto"` für Filename-RTL-Support (Unreal-Asset-Namen sind manchmal mixed).
