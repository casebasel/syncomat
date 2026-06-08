# Syncomat

P2P-Sync ohne Login. Desktop-Wrapper über [Syncthing](https://syncthing.net) für macOS und Windows. Resilio-Sync-Stil ohne Cloud-Account.

Built für Creative-Workloads — Unreal-Engine-Projekte, RAW-Footage, Asset-Bibliotheken — mit Defaults die `DerivedDataCache/` und `Intermediate/` automatisch raushalten.

## Features

- **P2P ohne Cloud**: Syncthing-Engine, kein Server, keine Account-Pflicht
- **Einladungs-Code-Pairing**: HMAC-signierte Codes, einmalig nutzbar, mit Ablaufzeit (QR-optional)
- **Auto-Share**: alle gepairten Geräte sehen sich automatisch gegenseitig (Resilio-Stil)
- **Unreal-Engine-Preset**: erkennt `.uproject` automatisch, setzt `.stignore` mit Engine-Cache-Patterns + tuned Syncthing-Config (fsWatcher, Block-Size, Hashers)
- **Tags zum Gruppieren**: Tags syncen sich zwischen Geräten — gleiche Sidebar-Struktur überall
- **Konflikt-Auflöser**: ein Klick statt manuelle Suche nach `.sync-conflict-*`-Files
- **Aktivitäts-Feed**: pro Folder + globale Übersicht aller Sync-Events
- **System-adaptive UI**: Light/Dark folgt OS — passt zu hellen Studio-Räumen tagsüber, gedimmten Edit-Suites abends
- **Signed OTA-Updates**: Minisign-verifizierte Auto-Updates via GitHub Releases

## Download

Letztes Release: [GitHub Releases](https://github.com/casebasel/syncomat/releases/latest)

- **macOS (Apple Silicon)**: `Syncomat_X.Y.Z_aarch64.dmg`
- **Windows (x64)**: `Syncomat_X.Y.Z_x64-setup.exe`

Beim ersten Start zeigt macOS „App von unbekanntem Entwickler" — Rechtsklick → Öffnen.

## Stack

- **Frontend**: React 19 · TypeScript · Tailwind v4 · Vite
- **Backend**: Tauri 2 (Rust + WebView)
- **Sync-Engine**: Syncthing v2.x (bundled als Sidecar)
- **Distribution**: tauri-action via GitHub Actions, Minisign-signierte Updates

## Architektur

```
┌──────────────────────────────────────────────┐
│ Syncomat.app                                 │
│  ├─ Tauri/Rust (sidecar-spawn, file-system)  │
│  └─ React UI (Sidebar + Inspector)           │
│        │                                     │
│        ▼ REST + Events (localhost only)      │
│  ┌──────────────────┐                        │
│  │ Syncthing v2.x   │                        │
│  │ (bundled binary) │                        │
│  └──────────────────┘                        │
│        │                                     │
└────────┼─────────────────────────────────────┘
         │ BEP (Block Exchange Protocol)
         ▼
   ┌──────────────────┐
   │ andere Geräte    │
   │ (P2P)            │
   └──────────────────┘
```

Tags + Folder-Defaults werden über eine versteckte Datei `.syncomat/folder-defaults.json` IM Folder synct — die Datei reist mit den User-Files mit, kein Backend-Channel nötig.

## Development

```bash
# JS-Deps
npm install

# Syncthing-Sidecar-Binaries holen (einmalig, ~56 MB)
npm run fetch:syncthing

# Dev-Server (Hot-Reload für React + Rust)
npm run tauri dev

# Production-Build
npm run tauri build
```

Builds für beide Plattformen entstehen über `.github/workflows/release.yml` beim Push eines `v*`-Tags. Signing-Keys für OTA-Updates liegen in GitHub-Secrets (siehe `docs/RELEASING.md`).

## Strategische Doku

- [`PRODUCT.md`](./PRODUCT.md) — Zielgruppe, Brand-Personality, Anti-Referenzen
- [`DESIGN.md`](./DESIGN.md) — Token-System (Farben, Spacing, Typo)
- [`BRIEFING_SYNCTOOL.md`](./BRIEFING_SYNCTOOL.md) — ursprünglicher Konzept-Brief
- [`ROADMAP.md`](./ROADMAP.md) — was als nächstes kommt
- [`mockups/BRIEF.md`](./mockups/BRIEF.md) — UI-Redesign-Brief (v0.2.0)

## Lizenz

MIT — siehe [LICENSE](./LICENSE) falls noch nicht hinzugefügt.
