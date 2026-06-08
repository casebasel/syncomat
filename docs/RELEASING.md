# Releases & OTA-Updates

## Setup (einmalig — was du manuell machen musst)

Die Auto-Update-Pipeline ist eingebaut, aber zwei GitHub-Secrets müssen gesetzt werden bevor der erste Release läuft.

### 1. Signing-Key in den GitHub-Secrets ablegen

Der Key ist lokal generiert in `syncomat-updater.key` (gitignored). Inhalt eines Files in den GitHub-Secret kopieren:

```bash
# Inhalt des Private-Keys (ohne Newlines wo nicht nötig)
pbcopy < syncomat-updater.key
```

Dann auf GitHub:
- Repo → Settings → Secrets and variables → Actions → "New repository secret"
- **Name:** `TAURI_SIGNING_PRIVATE_KEY`
- **Value:** (paste from clipboard)

Plus (für leer-Password, wir nutzen kein Password):
- **Name:** `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
- **Value:** *(leer lassen oder ein Passwort wenn der Key eines hat)*

### 2. Backup des Private-Keys

**Sehr wichtig:** Wenn `syncomat-updater.key` verloren geht, kannst du keine Updates mehr signieren → bestehende User können nicht mehr updaten. Backup empfohlen:
- 1Password / Bitwarden Secure Note
- Encrypted Disk Image auf TrueNAS
- Hardware-Key wie YubiKey (optional)

### 3. Public-Key prüfen

Der Public-Key ist eingebrannt in `src-tauri/tauri.conf.json` unter `plugins.updater.pubkey` — wird bei jedem App-Build mitgepackt. Wenn du den Private-Key ROTIERST (z.B. nach Kompromittierung), musst du den Public-Key dort ersetzen UND alle User müssen die App einmal manuell neu installieren.

## Release auslösen

```bash
# Patch-version-bump in package.json + src-tauri/Cargo.toml + src-tauri/tauri.conf.json
# (alle drei!)

git add package.json src-tauri/Cargo.toml src-tauri/tauri.conf.json src-tauri/Cargo.lock
git commit -m "v0.1.1"
git tag v0.1.1
git push && git push --tags
```

GitHub Actions baut + signiert + lädt die Assets ins Release hoch. Innerhalb von ~10 Minuten haben deine User automatisch das Update-Banner.

## Was im Release passiert

1. `tauri-action` baut die App für `aarch64-apple-darwin` (Apple Silicon)
2. Die `.dmg` + `.app.tar.gz` werden signiert mit dem Private-Key
3. `latest.json` wird generiert mit:
   ```json
   {
     "version": "0.1.1",
     "notes": "Auto-generated build...",
     "pub_date": "...",
     "platforms": {
       "darwin-aarch64": {
         "url": "https://github.com/casebasel/syncomat/releases/download/v0.1.1/Syncomat.app.tar.gz",
         "signature": "..."
       }
     }
   }
   ```
4. Beim nächsten App-Start: Updater holt `latest.json` → vergleicht Version → wenn neuer:
   App zeigt Banner "Update verfügbar: v0.1.1" → User klickt Installieren → App lädt + verifiziert Signatur → installiert + restartet

## Windows-Build später hinzufügen

In `.github/workflows/release.yml` einfach in die matrix erweitern:

```yaml
matrix:
  include:
    - platform: macos-latest
      target: aarch64-apple-darwin
      args: '--target aarch64-apple-darwin'
    - platform: windows-latest
      target: x86_64-pc-windows-msvc
      args: '--target x86_64-pc-windows-msvc'
```

Der `fetch-syncthing.sh` muss auf Windows mit Git-Bash laufen (sollte er — sind alles POSIX-Operationen mit curl + unzip).

## Code Signing für macOS Gatekeeper (separat von Tauri-Updater-Signing!)

Was wir aktuell signieren ist nur die **Updater-Signatur** (Tauri's eigenes Format). Damit macOS die App OHNE "Open from unknown developer"-Warnung startet, brauchst du zusätzlich:

- Apple Developer Account ($99/Jahr)
- Developer ID Certificate
- Notarization-Setup

In `tauri-action` heißen die Env-Vars `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`. Nicht für v1 nötig, wenn du nur deine eigenen Geräte updatest.

## Troubleshooting

**Update-Banner erscheint nie:**
- Check `https://github.com/casebasel/syncomat/releases/latest/download/latest.json` ist erreichbar (404 = Release nicht gepublished oder kein latest.json-Asset)
- Check `plugins.updater.endpoints` in `tauri.conf.json` zeigt auf richtige URL
- DevTools Console im App-Fenster zeigt errors

**Signatur-Verifikation schlägt fehl:**
- Public-Key in `tauri.conf.json` muss dem Private-Key matchen mit dem signiert wurde
- Wenn du Keys gewechselt hast: User müssen App manuell neu installieren (alter Public-Key kann neue Signaturen nicht verifizieren)

**Build schlägt fehl wegen Syncthing-Sidecar:**
- `fetch-syncthing.sh` muss vor `tauri build` laufen (ist in workflow.yml drin)
- Wenn Syncthing Version updates kommen: `scripts/fetch-syncthing.sh` `VERSION="v2.X.X"` anpassen
