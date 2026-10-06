# Syncomat — Audit-Bericht 2026-10-06 (Stand v0.9.12)

Fünf parallele Prüfer (Architektur, Datenfluss, Konsistenz, Robustheit/Sicherheit, Ideen) über alle 13 Bereiche der Inventur (`AUDIT_FINDINGS.md`). Funde mit Datei:Zeile; doppelte Funde zusammengeführt. Kritischer Fund #1 vom Hauptagent selbst gegengeprüft.

## Urteil

Die App funktioniert im Kern und ist für ihre Größe ordentlich kommentiert, hat aber drei strukturelle Schwächen. **(1) Sicherheit beim Koppeln:** Während ein Einladungscode gültig ist, wird jedes Gerät automatisch aufgenommen, als Introducer und mit allen Ordnern; der Code ist nur 4-stellig. **(2) Einstellungen über Geräte hinweg:** Mehrere selbstgebaute Abgleich-Mechanismen (folder-defaults, geteilte Ignore-Liste aus v0.9.12, net-hints) haben Lücken — `(?d).*` ignoriert `.syncomat/` selbst, Zeitstempel-Vergleiche über Geräte hinweg, Rückfall auf Standardwerte bei fehlender Datei. **(3) Hintergrund-Logik im Webview:** Alle Automatiken laufen als React-Effekte, mit dreifachem Status-Polling, ohne Erkennung eines abgestürzten Sync-Dienstes. Dazu kommen kein Test-/Lint-Netz und viel kopierte Logik (Ordner anlegen vs. verknüpfen, 8 Byte-Formatierer, 2× deriveSyncState).

## Umgesetzt in v0.9.13

- **Koppeln:** Auto-Annehmen höchstens 15 min, schließt nach dem ersten Gerät; bei mehreren gleichzeitig anklopfenden Geräten wird keins automatisch angenommen (Hinweis im Code-Dialog). *Offen:* längerer Rendezvous-Code (Worker-Deploy), Bindung an die Device-ID des Einlösers, Introducer/Auto-Share-Vertrauen.
- **`.syncomat/` nie ignorieren:** `!/.syncomat` vor dem Hidden-Muster; Wartung v4 trägt es bei bestehenden Ordnern nach.
- **Ordner-Einstellungen:** Erst-Abgleich ohne Datei nur bei vollständig synchronem Ordner und mit Ist-Werten statt Standardwerten; unlesbare Datei = Fehler statt „fehlt"; „angewendet" per Versionskennung statt Zeitstempel-Vergleich; Neu-Abgleich, wenn eine ältere Version die Liste verloren hat; unbekannte Felder bleiben beim Speichern erhalten (Rust `serde(flatten)`); kein paralleler Durchlauf; Negationen bei der Vereinigung vorne; „Anlegen"/„Optimieren" behalten die Hidden-Muster; Einstellungs-Dialog schreibt nur geänderte Felder auf den neuesten Stand.
- **Sync-Dienst-Absturz:** Rust-Supervisor startet Syncthing mit Backoff neu (gleicher Port/Key), Frontend setzt „bereit" zurück und liest den Event-Strom neu; Beenden wartet nicht mehr pauschal 8 s.
- **Rechte/Befehle:** `shell:allow-execute`, `opener:allow-open-path` und ungenutzte Fenster-Rechte entfernt, npm-Paket `@tauri-apps/plugin-shell` entfernt; „Alle Konflikte lösen" nur noch mit denselben Prüfungen/Grenzen wie die Liste.
- **Kleinkram:** Fehlerzahlen wurden doppelt gezählt (`pullErrors` = Alias von `errors`) — behoben; Tray „Beenden"/„Bei Anmeldung starten"; `.claude/settings.local.json` aus dem Repo.

**Bewusst offen** (größer oder riskant ohne Test auf echten Geräten): strikte CSP, Pfad-Prüfung der Rust-Befehle gegen die Syncthing-Ordner, ein Status-Store statt drei Abfrage-Wegen, Automatiken nach Rust, `#include`-basierte Ignore-Liste, Tests/CI, Aufräumen (toter Code, Doku, Binaries).

## Top 5 (Wirkung × Aufwand)

1. **🔴 Auto-Annehmen an den Code binden** — `src/App.tsx:193-207`, `src/lib/autoAccept.ts`, `CodeShowModal.tsx:149`. Heute: jedes Pending-Device wird während der ganzen Code-Gültigkeit (7–30 Tage) akzeptiert, `introducer:true`, alle Ordner read-write; Rendezvous-Code nur 10⁴ Werte, `Math.random`. **Fix:** Fenster nach dem ersten Annehmen schließen und auf ~15 min begrenzen; Rendezvous-Code 6–8 Zeichen aus `crypto.getRandomValues`; mittelfristig nur die Device-ID annehmen, die den Code eingelöst hat.
2. **🔴 `.syncomat/` nie ignorieren** — `src/lib/folderSettings.ts:19,102`. `(?d).*` (versteckte Dateien ignorieren) trifft `.syncomat/` → Tags, Papierkorb, geteilte Ignore-Liste und Netzwerk-Hinweise syncen für diese Ordner nicht mehr. **Fix:** `!/.syncomat` immer als erste Zeile jeder generierten Liste.
3. **🟠 Abgleich der Ordner-Einstellungen robust machen** (v0.9.12-Nacharbeit) — `folderSettings.ts`, `folder_settings.rs`.
   - Fehlende/kaputte `folder-defaults.json` → Erst-Abgleich schreibt Standardwerte (Papierkorb aus, Tags leer) und überschreibt clusterweit.
   - „Schon angewendet" per Zeitstempel-Vergleich über Geräte (Uhren, gleiche Sekunde) → besser per `updated_by:updated_at`.
   - Ältere Versionen werfen das `ignores`-Feld beim Speichern weg → `#[serde(flatten)]` für unbekannte Felder.
   - „Optimieren"/„Anlegen" schreiben die Liste ohne Hidden-Muster; kein Schutz gegen parallele Läufe der 30-s-Schleife; Negationen landen bei der Vereinigung hinten (wirkungslos).
   - **Alternative prüfen:** Syncthings eingebautes `#include .syncomat/ignore` — dann folgt auch der NAS-Hub ohne Syncomat.
4. **🟠 Absturz des Sync-Dienstes erkennen** — `src-tauri/src/sidecar.rs:76-93`, `syncthing.ts:524-585`. Beendet sich Syncthing (OOM, Crash), wird das nur geloggt; die UI zeigt weiter „aktuell". **Fix:** bei `Terminated` Event senden, mit Backoff neu starten, Banner „Sync-Dienst gestoppt".
5. **🟠 Unnötige Berechtigungen und gefährliche Befehle schließen** — `capabilities/default.json:17-26` (`shell:allow-execute` mit beliebigen Argumenten, vom Frontend nie genutzt), `tauri.conf.json` (`csp: null`), `conflicts.rs:336-401` (`resolve_all` löscht jede Datei mit `.sync-conflict-` im Namen, ohne die Prüfungen der Liste), Pfad-Befehle ohne Abgleich gegen die Syncthing-Ordner. **Fix:** Berechtigung + npm-Paket entfernen, strikte CSP, `resolve_all` nur auf die angezeigte Liste, Pfade in Rust gegen `config.folders` prüfen.

## Alle Funde nach Schwere

### Kritisch
- [3 Pairing] App.tsx:193-207 — Auto-Accept nimmt jedes Gerät während der Code-Gültigkeit an (siehe Top 1). *Bestätigt.*

### Hoch
- [3] pair-worker/src/index.js:38-41,94-101, rendezvous.ts:35-53 — 4-stelliger Code, Rate-Limit in KV nicht atomar, `Math.random`; GET verbrennt den Code.
- [3] redeemFlow.ts:96-104 + App.tsx:124-153 — Einlöser vertraut `payload.iss` blind (introducer, alle eigenen Ordner geteilt).
- [3/13] App.tsx:155-169,124-153 — alle Peers werden Introducer, jeder Ordner mit jedem Gerät geteilt; ein kompromittiertes Gerät verbreitet sich clusterweit.
- [3] CodeShowModal.tsx:80-90,164-185 — manueller Annehmen-Pfad praktisch unerreichbar; `inviteMarkRedeemed` läuft nie.
- [5] folderSettings.ts:19,102 — `(?d).*` ignoriert `.syncomat/` (Top 2).
- [5] folderSettings.ts:290-299,199-201 — Erst-Abgleich ohne Datei schreibt Standardwerte clusterweit.
- [5] folderSettings.ts:320-325 — Zeitstempel-Vergleich über Geräte; gleichzeitiger Erst-Abgleich kann Listen auseinanderlaufen lassen.
- [5] folder_settings.rs:18-47 — ältere Clients verwerfen `ignores` beim Schreiben.
- [5] FolderSettingsModal.tsx:139-144, CreateFolderModal.tsx:135 — Preset roh per `setFolderIgnores`, Hidden-Muster gehen lokal verloren.
- [4] CreateFolderModal.tsx:104-144 vs App.tsx:328-378 — Ordner-Aufbau doppelt und auseinandergelaufen (Tuning ohne Preset, Peers, geteilte Liste, falscher Kommentar).
- [2] sidecar.rs:76-93 — Syncthing-Absturz bleibt unbemerkt (Top 4).
- [7] conflicts.rs:336-401 — `resolve_all` ohne Validierung/Grenzen.
- [8] folderStatusStore.ts:59-90, syncthing.ts:796-899 — drei parallele Abfrage-Wege für `/rest/db/status`, Store holt bei jedem Event alle Ordner.
- [11] capabilities/default.json:17-26 — `shell:allow-execute` (Top 5).

### Mittel
- [11] tauri.conf.json `csp:null` + Pfad-Befehle ohne Ordner-Prüfung; `reveal` startet .app/.exe.
- [2] sidecar.rs:42-43,141-167 — fehlgeschlagener Start unsichtbar, UI hängt auf „startet noch".
- [3] invite.ts:104, pairing.ts — „Nur Lesen" wird angezeigt, aber nicht durchgesetzt.
- [3] invitesStore.ts:34-42, invites.rs — `invite_list/find/revoke` ungenutzt; Ausgabe-Logik in der Komponente statt in lib.
- [4] LinkFolderModal.tsx:65-111 — keine Warnung bei nicht-leerem Ziel oder überlappenden Ordnerpfaden (mit maxConflicts=0 riskant).
- [4] LinkFolderModal.tsx:201-229 — Preset-Wahl beim Verknüpfen wird von der geteilten Liste überschrieben.
- [4] LinkFolderModal/CreateFolderModal — ~150 Zeilen kopiert (Pfad, Schätzung, Preset, RAM-Hinweis).
- [5] union() hängt Negationen hinten an; Dedupe ohne `(?d)`-Normalisierung.
- [5] FolderSettingsModal.tsx:96-103 — Speichern überschreibt Peer-Änderungen (Tags/Papierkorb) mit Stand beim Öffnen; Papierkorb nicht aus `folder.versioning` initialisiert.
- [5] folderSettings.ts:274-350 — keine Sperre gegen parallele `checkAll`-Läufe.
- [5] Jedes Gerät mit Schreibrecht steuert ungeprüft die `.stignore` aller anderen (Größe/Inhalt nicht validiert).
- [5] folder_settings.rs/network_hints.rs/invites.rs — atomares Schreiben 3× implementiert, `.json.tmp`-Reste nur bei net-hints aufgeräumt.
- [5] tags.ts ↔ folderSettings.ts — Ringimport.
- [6] maxConflicts/ignorePerms/weakHash an 4 Stellen definiert; localStorage teils ohne try/catch (Render-Crash möglich).
- [6] maxConflicts=0 ohne Versionierung als Standard — Verlierer weg (bewusste Entscheidung, aber: Uhr-Abweichung eines Geräts überschreibt neuere Arbeit).
- [7] conflicts.rs — Namens-Parsing 3×, Prune-Listen 3× auseinandergelaufen.
- [8] syncthing.ts:870-881 — „Throttle" ist reiner Debounce → Status friert während laufender Syncs ein.
- [8] Sidebar/FolderInspector/GlobalActivityView — `deriveSyncState` doppelt, dritte abweichende Variante.
- [10] SettingsModal.tsx:78-90 — eigener Header, Esc schließt nicht.
- [12] `.claude/settings.local.json` eingecheckt; `.github/skills/impeccable` (83 Dateien); 54 MB Binaries im Git ohne Prüfsumme.
- [13] App.tsx 850 Zeilen: Daten, drei Cluster-Automatiken, Routing, drei Bildschirme.
- [13] App.tsx:144-155, pairing.ts:36-46 — ganze Ordner-Objekte per PUT aus veraltetem Stand → setzen Wartungs-Änderungen zurück; doppelte PUTs beim Koppeln.
- [1] api(): Fehlertexte wie „PUT /rest/… → 500" landen roh in der deutschen UI (23 Stellen).
- [3] „Ablehnen" bei Geräten nicht dauerhaft (Gerät kommt wieder), bei Ordnern dauerhaft.

### Niedrig (Auswahl)
- Toter Code: `useFolderStatus`, `shortDeviceID`, `deletePendingFolder`, `systemBrowse`, `shortDeviceIdFrom`, `workload_detect`, `Statusbar.aggregate`, `QUICK_PAIR_ENABLED`, Rust-Crates `hmac/sha2/base64`, Vorlagen-SVGs, `opener:allow-open-path`, ungenutzte Fenster-Rechte.
- Veraltete Kommentare/Doku: HMAC-Code (redeemFlow, autoAccept, invites.rs, README), maintenance-Kommentar nennt nicht existierendes `seedSharedIgnores`, ROADMAP/BRIEFING veraltet, README nennt MIT ohne LICENSE.
- `pullErrors` + `errors` addiert → Fehlerzahlen evtl. doppelt (zu prüfen).
- 8 Byte-Formatierer, 2× `fmtExpiry`, gemischte Begriffe („Einladungscode"/„Einladungs-Code", „Annehmen"/„Akzeptieren", „Bei Login"/„Bei Anmeldung", Tray „Quit").
- sidecar.rs: Beenden wartet immer volle 8 s; Runtime-JSON per String-Parsing.
- Windows-Installer `taskkill /IM syncthing.exe` beendet jedes Syncthing des Nutzers hart; Updater fährt Sidecar nicht sauber herunter.
- Konflikt-Suche läuft alle 5 min über jeden Ordner, obwohl mit maxConflicts=0 kaum noch Konflikte entstehen.
- Benachrichtigungen beim Start für schon bekannte Geräte/Ordner; „Gerät ist online" ist Rauschen.
- Events-Bus startet mit `since=0`, Zeitstempel `Date.now()` statt `e.time`.
- api() ohne Timeout; Netzwerk-Hinweise ungeprüft übernommen, alte Pins sammeln sich.
- fetch-syncthing.sh ohne Prüfsumme/Signatur.

## Ideen & Chancen
1. **Geteilte Ignore-Liste über Syncthings `#include`** statt eigenem Abgleich — der NAS-Hub folgt automatisch, Seeding/Union/localStorage-Marker fallen weg (vorher prüfen: Verhalten bei noch fehlender Include-Datei).
2. **Ein generischer Mechanismus „synchronisiertes Dokument pro Gerät"** (`.syncomat/<name>/<deviceID>.json`) statt drei Varianten — keine Sync-Konflikte mehr möglich.
3. **Hintergrund-Automatiken nach Rust** (ein tokio-Task) — läuft auch bei verstecktem Fenster zuverlässig, UI nur noch Anzeige.
4. **Ein Status-Store aus `FolderSummary`-Events** — ersetzt drei Abfrage-Wege, spart CPU bei großen Unreal-Ordnern.
5. **Fehler-Klassifizierung** (`errorKinds.ts`): vorübergehende Fehler gelb „wird wiederholt", erst nach 10 min rot — weniger „rote Fehler".
6. **Releases als Entwurf** (`releaseDraft: true`): erst auf einem Rechner testen, dann veröffentlichen — kein Code nötig.
7. **Minimales Sicherheitsnetz:** `npm run check` (tsc + vitest + clippy + cargo test), ~15 Unit-Tests für Ignore-Logik/Parsing, CI bei jedem Push, Pre-Push-Hook.
8. **NAS-Hub per Standardwerten konfigurieren** (`/rest/config/defaults/folder` receive-only, Pfad `/var/syncthing/data/`) — neue Ordner landen automatisch am richtigen Ort.
9. **Netzwerk-Hinweis-Sync streichen** (ROADMAP sagte YAGNI; ~300 Zeilen) zugunsten manueller schneller Adresse pro Gerät.
10. Ordner-Richtlinie (`folderPolicy`) einmal definieren und bei jedem `ConfigSaved` diff-only anwenden — keine Wartungs-Versionsmarker mehr.
11. Polling pausieren, wenn das Fenster versteckt ist; Benachrichtigungen nur bei Handlungsbedarf.
12. Aufräumen: Binaries per Cache/LFS, `.github/skills` raus, Doku (README/ROADMAP) auf aktuellen Stand, Version nur an einer Stelle.

## Abdeckung

| # | Bereich | Arch | Daten | Konsistenz | Robustheit | Ideen |
|---|---|---|---|---|---|---|
| 1 | Syncthing-API-Client | ✅ | ✅ | ✅ | ✅ | ✅ |
| 2 | Sidecar-Lifecycle | ✅ | ✅ | ✅ | ✅ | ✅ |
| 3 | Pairing/Invites/Rendezvous | ✅ | ✅ | ✅ | ✅ | ✅ |
| 4 | Ordner-Anlage/-Verknüpfung | ✅ | ✅ | ✅ | ✅ | ✅ |
| 5 | Ordner-Einstellungen/Replikation | ✅ | ✅ | ✅ | ✅ | ✅ |
| 6 | Wartung/Migrationen | ✅ | ✅ | ✅ | ✅ | ✅ |
| 7 | Konflikte | ✅ | ✅ | ✅ | ✅ | ✅ |
| 8 | Status/Aktivität/Fehler-UI | ✅ | ✅ | ✅ | ✅ | ✅ |
| 9 | Netzwerk | ✅ | ✅ | ✅ | ✅ | ✅ |
| 10 | Einstellungen/Autostart/Updater | ✅ | ✅ | ✅ | ✅ | ✅ |
| 11 | Tauri-Konfiguration/Sicherheit | ✅ | — (kein Datenfluss) | ✅ | ✅ | ✅ |
| 12 | Build/Release/Repo | ✅ | — (kein Datenfluss) | ✅ | ✅ | ✅ |
| 13 | App-Shell | ✅ | ✅ | ✅ | ✅ | ✅ |
