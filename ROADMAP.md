# Roadmap

Was als nächstes ansteht. Strikt sortiert: oben = bald, unten = vielleicht/später.

## Geplant

### 1. Conflict-Resolution — Ein-Klick-Auflösung
**Was Syncthing macht:** Bei gleichzeitiger Bearbeitung derselben Datei auf zwei Geräten gewinnt eine Version, die andere wird umbenannt zu `<datei>.sync-conflict-YYYYMMDD-HHMMSS-<DEVICE>.<ext>`. Beide liegen lokal nebeneinander im Folder.

**Was die App machen soll:**
- Conflict-Counter-Badge auf jeder FolderCard wenn `sync-conflict-*` Files im Folder liegen
- Klick auf Badge → Modal mit Liste aller Konflikte pro Folder
- Pro Konflikt zwei Vorschau-Zeilen (Größe, Modified-Date je Version) + drei Buttons:
  - **"Lokale Version behalten"** → löscht alle `.sync-conflict-*`-Varianten
  - **"Remote-Version übernehmen"** → ersetzt lokale Version mit der Konflikt-Datei, löscht Suffix
  - **"Beide behalten"** → benennt Konflikt-Datei zu `<datei>.von-<peer>.<ext>` um (lesbarer)
- Glob-Pattern-Detection: `**/*.sync-conflict-*.*`
- Lese-Zugriff via `tauri-plugin-fs` oder eigene Rust-commands

**Aufwand:** ~1 Session. Braucht neuen Rust-Command `list_conflicts(folder_path)` + neue Komponente `ConflictResolverModal`.

### 2. Settings-Page
Erste systematische Settings-Section. Inhalte:
- Eigene Device-ID anzeigen + Copy-Button (manchmal braucht man die für manual Syncthing-Web-UI)
- "Jetzt nach Updates suchen" + Auto-Check-Toggle (default an, in localStorage gespeichert)
- "Issuer-Secret rotieren" → invalidiert alle ausstehenden Einladungs-Codes (Security-Notfall-Button)
- Bandbreiten-Limits (read/write KB/s, schreibt syncthing-config)
- Discovery-Mode: Local + Global + Relay an/aus
- Link "Syncthing Web-UI öffnen" für Power-User (öffnet `http://127.0.0.1:<port>` im Browser)
- App-Version + Build-Info

**Aufwand:** ~1 Session.

### 3. Auto-Periodic-Update-Check
Aktuell checkt der Updater nur einmal beim App-Start. Bei einer App die im Tray dauerhaft läuft heißt das: wenn der User nie restartet, sieht er nie ein Update.

**Fix:** alle 6h re-check via `setInterval` in `useUpdater`. Trivial.

## Should-fix aus Adversarial-Reviews (v1.x-Stretch)

Defensive Härtung — keine aktuellen Bugs:

- **`consumed_codes` TTL statt 200er-Cap** — bei >200 Redemptions kann ein alter Code theoretisch repeated werden. Schema-Bump nötig (consumed_at-Timestamp persistieren, 35d TTL).
- **Modal a11y** — Focus-Trap + Focus-Restore beim Close + aria-labels (WCAG 2.4.3)
- **`s`-Feld charset-Check vor `atob()`** in `invite.ts` — granularer reason statt JS-Exception bei corruptem code
- **JSON.parse-Reviver durch Object.keys-Whitelist ersetzen** — cleaner als Reviver der nur 3 prototype-keys verwirft

## Nice-to-have (Ideen)

- **QR-Code-Anzeige** für Einladungs-Codes (zusätzlich zu Copy-Paste) — schöner für Phone-zu-Mac-Transfer
- **System-Notifications** für "Peer hat sich verbunden", "Update verfügbar", "Sync-Fehler" (`tauri-plugin-notification`)
- **Detail-Drilldown pro Folder** — Click auf Folder-Karte → Modal mit: bytes-In/Out, last-Sync, Device-pro-Folder Übersicht, Fehler-Liste
- **Globaler Pause-Button** in der Statusbar (pausiert alle Folders auf einmal)
- **Aktive-Einladungen-Verwaltung-Erweiterung** — Redeemed-Codes mit "Gerät entfernen"-Button (revoke post-pair: DELETE device + alle folder-shares)

## Verschoben (explizit)

- **Platzhalter-Feature ("Files-on-Demand")** — riesiges Unterfangen (macOS FileProvider Framework / Windows Cloud Files API). Reden wir später drüber.
- **Apple Codesigning** — braucht Apple Developer Account ($99/Jahr) + Notarization-Setup. Aktuell muss User beim ersten Start Rechtsklick → Öffnen → bestätigen.
- **Windows Authenticode-Signing** — EV-Certificate ~$300/Jahr. Aktuell SmartScreen-Warning beim ersten Start, "Trotzdem ausführen" akzeptieren.
- **Multi-User-Studio-Sharing** — aktuelles Modell ist "Marlons eigene Geräte unter sich". Mit Studio-Kollegen würde RW-Default → RO + Auto-Share-on-Pair komplett überdacht (siehe alter Adversarial-Review-Output).

## Blocker für mehr Verifikation

- **Live-Pairing-Test mit 2 Rechnern** — bisher single-machine smoke-tests. Code generieren auf Mac, Windows-Workstation einlösen, beobachten:
  - Auto-Share-on-Pair: gehen Mac-Folders auf Windows als Pending auf?
  - Verknüpfen-Flow: nativer Pfad-Picker auf Windows
  - Cross-OS-Namensfehler: Datei mit `:` auf Mac anlegen → erscheint Warndreieck auf Windows-Folder?
  - ZeroTier-Adressen-Hint: wenn beide nicht im selben LAN, Global Discovery + adr-Feld nötig
