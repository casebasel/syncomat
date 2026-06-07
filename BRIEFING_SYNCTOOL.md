# BRIEFING — Syncthing GUI ("SyncTool")

> Handoff-Dokument für Claude Code. Enthält alle Entscheidungen aus der Konzeptphase.
> Philosophie: super simpel. Ein Fenster, kein Login, kein Tab-Wirrwarr.

---

## 1. Was wir bauen

Eine eigene, minimalistische Desktop-GUI über **Syncthing**. Syncthing macht das eigentliche
Syncen (P2P, verschlüsselt, OS-unabhängig); unser Tool ist ein schlankes Frontend, das die
Syncthing-REST-API anspricht und das Pairing/Discovery resilio-artig bequem macht.

**Ziel-Erlebnis:** Computer 1 hat Sync-Ordner. Wenn ich das Tool auf Computer 2 öffne, sehe ich
sofort "diese Ordner gibt es zum Syncen" und verknüpfe sie mit einem Klick + lokalem Pfad +
eigenem Anzeigenamen. Alle Geräte gleichberechtigt (Mesh), kein zentraler Hub.

---

## 2. Tech-Stack

- **Tauri** (Rust-Core + Web-Frontend) — native Binaries für **macOS (M-Series)** und **Windows (x64)**
- Frontend: **TypeScript + React + Tailwind** (passt zu bestehendem Stack des Nutzers)
- **Syncthing als gebündelte Sidecar-Binärdatei** (`syncthing` für mac, `syncthing.exe` für win),
  via Tauri `externalBin` / sidecar mitgeliefert und vom Tool beim Start gespawnt
- Kommunikation mit Syncthing ausschließlich über dessen **REST-API** auf `127.0.0.1:8384`

---

## 3. Architektur-Entscheidungen (WICHTIG, nicht umwerfen)

### 3a. Mesh statt Hub
Jedes Gerät ist gleichberechtigter Peer (wie Resilio). Erreicht über Syncthings native P2P-Natur
plus zwei Flags:
- **`autoAcceptFolders: true`** auf vertrauenswürdigen Geräten → angebotene Ordner ohne Nachfrage übernehmbar
- **Introducer-Flag** auf dem Pairing-Gegengerät → neue Peers lernen automatisch alle anderen Peers
  desselben Ordners kennen und vernetzen sich selbst. Das ist der Mechanismus, der "jeder mit jedem"
  automatisch wachsen lässt.

### 3b. Key zum Reinkommen, ID zum Drinbleiben
- **Intern arbeitet das Tool IMMER mit Device-IDs.** Das ist die Wahrheit, die Syncthing speichert.
  Device-ID = Fingerprint des TLS-Zerts, läuft nicht ab, allein wertlos (Gegenseite muss eintragen).
- **Der "Key" ist NUR eine Einladungs-Bequemlichkeit** (Resilio-Komfort). Er bündelt in einem Code:
  - Device-ID des Einladenden
  - Folder-ID(s)
  - Introducer-Flag
  - read-only vs read-write
- **Sicherheitsregeln für Keys (bewusst so gewählt):**
  - **Einmalig** (gilt für genau ein Gerät, danach verbraucht) — KEIN ewig gültiger Generalschlüssel
  - **read-only als Default**, read-write nur durch bewusstes Umschalten pro Key
  - nach Pairing wird der Key wertlos; die Device-ID hält die Beziehung
- Key-Format: kompaktes base64-JSON oder kurzer Code. Beim Einlösen entpackt das Tool den Key,
  trägt Gegengerät mit autoAccept + introducer ein, übernimmt Ordner.

### 3c. Custom-Ordnernamen
- Nutzt Syncthings **`label`-Feld** pro Ordner (gerätelokal, NICHT synchronisiert).
- Beim Verknüpfen fragt das Tool nach einem eigenen Anzeigenamen; verknüpfte Ordner umbenennbar (Stift-Icon).
- Echte `folderID` bleibt im Hintergrund; UI zeigt nur das Label.

---

## 4. Cross-OS (Mac ↔ Windows) — drei Schutzmechanismen EINBAUEN

Cross-OS-Sync läuft über dieselbe Engine, ist grundsätzlich unproblematisch. ABER diese drei
Fallen MÜSSEN abgefangen werden, sonst gibt es stille Sync-Fehler:

1. **Pfade plattformverschieden.** Niemals den Pfad vom anderen Gerät übernehmen. Beim Verknüpfen
   IMMER nativen Pfad-Picker des lokalen OS zeigen. Syncthing speichert lokalen Pfad pro Gerät getrennt.

2. **Windows-unzulässige Dateinamen.** Zeichen wie `: ? | * < >` und reservierte Namen (`CON`, `PRN`,
   `AUX`, `NUL`, `COM1`…) sind auf mac/linux erlaubt, auf Windows nicht. Syncthing meldet dann pro Datei
   einen Fehler (Rest synct weiter). **Das Tool muss diese Fehler in der Statusbar klar anzeigen**
   ("X Dateien können auf Windows nicht angelegt werden — Namen mit : ? *"), nicht verschlucken.
   Quelle: `/rest/db/status` + Event-Stream (`LocalIndexUpdated`, `FolderErrors`).

3. **Case-Sensitivity.** mac/win sind case-insensitive, linux nicht. Neuere Syncthing-Versionen haben
   eingebaute Case-Erkennung → **anlassen** (default). Relevant nur falls ein Linux-Gerät (TrueNAS)
   dazukommt.

---

## 5. UI-Layout (durchiteriert, super simpel — EIN Fenster)

Reihenfolge von oben nach unten:

1. **Kopf:** App-Icon + Name "Sync" + **Ampel** darunter.
   - Ampel dreistufig: grün = ≥1 Gerät verbunden / gelb = Geräte konfiguriert aber keins erreichbar /
     rot = keine Geräte oder Syncthing läuft nicht.
   - Text: "Verbunden · N Geräte". N aus `/rest/system/connections` (Felder mit `connected:true`).
   - Rechts oben: **"Jetzt syncen"-Button** → `POST /rest/db/scan` für jeden Ordner (forciert Scan).

2. **Geräte-Reihe:** je Gerät eine kleine Pille mit Status-Punkt + Gerätename. Skaliert auf beliebig viele.

3. **Ordner-Liste:** je Ordner eine Karte:
   - Ordner-Icon + **Custom-Name** + Stift-Icon (umbenennen)
   - Meta-Zeile: Quellgerät + Status ("Computer 1 · synct" / "Laptop · verfügbar")
   - rechts: grünes Check wenn verknüpft+synct, sonst **"Verknüpfen"-Button**
   - "Verknüpfen" → fragt Custom-Namen → nativer Pfad-Picker → `PUT /rest/config/folders/{id}`

4. **Statusbar (unten, abgetrennt):** aggregierter Zustand links ("Aktuell · alles synchron" /
   "Synchronisiere… X%" / "Fehler in Ordner Y" / Cross-OS-Namensfehler), rechts "zuletzt: …".

5. **Geräte-Verwaltung (resilio-artig):** zwei Aktionen
   - **"Code anzeigen"** → erzeugt Einladungs-Key (Optionen: einmalig/Zeitlimit, read-only/read-write)
   - **"Code einlösen"** → Feld zum Einfügen eines Keys

Designsprache: flach, weiße Flächen, 0.5px Borders, viel Weißraum, eine Akzentfarbe. Keine Tabs,
kein Login. (Optik wurde im Chat als Mockup bestätigt.)

---

## 6. Relevante Syncthing-REST-Endpoints

- `GET  /rest/system/status` — Status, eigene Device-ID, Uptime
- `GET  /rest/system/connections` — verbundene Geräte (für Ampel + Zähler)
- `GET  /rest/config` — komplette Config
- `GET  /rest/cluster/pending/devices` — Geräte, die sich verbinden wollen (Discovery)
- `GET  /rest/cluster/pending/folders` — angebotene, noch nicht akzeptierte Ordner (die "verfügbar"-Liste)
- `PUT  /rest/config/folders/{id}` — Ordner anlegen/ändern (inkl. lokalem `path` + `label`)
- `PUT  /rest/config/devices/{id}` — Gerät eintragen (inkl. `autoAcceptFolders`, `introducer`)
- `GET  /rest/db/status?folder={id}` — Sync-Status + Fehler pro Ordner
- `POST /rest/db/scan?folder={id}` — Scan forcieren ("Jetzt syncen")
- `GET  /rest/events` — Long-Polling Event-Stream für Live-Updates (statt Polling bevorzugen)

Auth: API-Key aus `config.xml` lesen (oder beim ersten Start via `--gui-apikey` setzen), als
`X-API-Key`-Header mitschicken. Selbstsigniertes HTTPS → lokal TLS-Verify entsprechend handhaben.

---

## 7. Erste Schritte für Claude Code (Vorschlag)

1. Tauri-Projekt scaffolden (TS/React/Tailwind), `externalBin` für Syncthing-Sidecar konfigurieren
2. Rust-Seite: Syncthing-Prozess-Lifecycle (spawn beim Start, kill beim Beenden), API-Key-Bootstrap
3. TS-API-Client für die Endpoints aus §6, plus Event-Stream-Abo
4. UI nach §5 (Komponenten: Header/Ampel, GeräteReihe, OrdnerListe, OrdnerKarte, Statusbar, KeyDialoge)
5. Key-Encode/Decode + autoAccept/introducer-Verdrahtung (§3b)
6. Cross-OS-Schutz (§4): Pfad-Picker-Pflicht, Fehleranzeige Windows-Namen, Case-Default
7. Cross-Platform-Build mac + win

## Offene Detailfragen (in Claude Code klären)
- Key-Transport: reiner Copy-Paste-String, oder zusätzlich QR? (Copy-Paste reicht für v1)
- Persistenz der Labels: nur in Syncthing-`label` oder zusätzlich App-eigene Settings-Datei?
- Soll das Tool Syncthing mitliefern (Sidecar) oder vorhandene Installation nutzen? (Empfehlung: Sidecar)
