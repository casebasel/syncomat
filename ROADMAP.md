# Roadmap

> **🧩 Stand 2026-11-07 — Unterordner je Rechner (Branch `feat-ui-uebersicht`, v0.9.27).**
> Klick auf einen Schnittpunkt Projekt × Rechner → „Alles“ oder „Benutzerdefiniert“ mit
> Ordnerbaum. Für jeden Rechner von jedem Rechner aus. Sicherheitsregeln (live auf i9 geprüft):
> - Verkleinern nur, wenn das NAS alles von hier hat; dann Ignore setzen, scannen, Gegenprobe
>   (`/rest/db/file` → `ignored`), dann HIER löschen, was abgeglichen war und jetzt abgewählt ist
>   (`src-tauri/src/auswahl.rs`). Eine neuere Datei → nichts gelöscht, alte Auswahl zurück.
>   Geschütztes (Autosaves, `.waechter`, Rolle) bleibt immer.
> - Vergrössern nur, wo lokal nichts liegt (sonst könnten alte lokale Dateien neuere auf dem NAS
>   überschreiben).
> - Andere Rechner: Wunsch über den internen Kanal (`.syncomat/wunsch/<ID>.json`), neuester je
>   Projekt gewinnt, Ausführung am Zielrechner mit dessen Prüfungen, Ergebnis in seiner
>   Abos-Notiz. Der NAS-Hub trägt `syncomat-intern` (empfangend, seit 07.11.), darum holen
>   ausgeschaltete Rechner beim Start alles nach.
> - Die geltende Auswahl steht in der `.stignore` (Quelle der Wahrheit), die Notiz meldet sie
>   allen (`abos[].auswahl`), `status.json` ebenso.
> - **Ablage (Marlon 08.11.2026, ab v0.9.34):** Windows `D:\Projekte\<NAME>` statt `D:\<NAME>`
>   (gleicher Name wie `tank/Projekte`); ältere Abos bleiben, wo sie sind. Mac: ein gewählter
>   „Ordner für Projekte“. exFAT erlaubt (Hinweis), FAT32 nie.

> **🧭 Stand 2026-11-02 (abends) — syncomat wird Datenagent der Datenzentrale.**
> Massgebend: Repo `casebasel/datenzentrale`, `docs/KONZEPT.md` bis Commit c86b938 —
> Kapitel 9, 11, 17a (E1–E35), 18. Das geht allem darunter vor.
>
> **Jetzt (E18, E32):** bis Schritt 3 **nur Fehlerbehebungen**. Reihenfolge der Datenzentrale:
> Archiv nach Projekt (live seit 02.11.) → „Heute" (live) → Katalog → **syncomat Schritt 3** →
> Bibliotheken. Bis dahin räumt der Python-Speicher-Wächter auf den Rechnern auf (E17). Die
> Datenzentrale ist die gewachsene Seite des Speicher-Wächters; dort melden sich die Datenagenten
> später an (E31). Gebaut wird nur auf Marlons direkten Auftrag in der syncomat-Session, auf
> eigenem Branch.
>
> **Entscheide, die syncomat betreffen:**
> - **Verteilung (E6, E28, E29):** Projekte nur auf Abruf — „**Abonnieren**" / „**Abo beenden**"
>   (Begriffe der Oberfläche). Gezielt auf einen oder mehrere Rechner auf einmal, ganz oder je
>   Unterordner, nach Platzprüfung auf `D:`. „Arbeitskopie" bleibt — eine Arbeitskopie zählt nie
>   als Kopie. Unreal-Plugins bleiben „an alle" (Eigenschaft des Ordners, `verteilung: "alle"`).
>   Kurskorrektur 2 gilt für Projekte nicht mehr.
> - **NAS-Ablage (E21–E24):** nach Projekt, nie nach Rechner. Laufend: `tank/Projekte/<NAME>`,
>   ein Dataset je Projekt (live seit 02.11.: `ndisplay` 3003:3002, `2775`, Snapshot-Aufgaben
>   17–19 rekursiv: stündlich 24 h, täglich 30 d, wöchentlich 8 w; Datasets legt der Wächter beim
>   ersten Archiv-Auftrag an). Abgeschlossen: `_Sammelstelle/<NAME>/`. Namen wie auf dem NAS,
>   Dataset-Namen nur `A–Z a–z 0–9 _ -`. Ein Syncthing-Ordner = genau ein Dataset.
> - **Gerüst (E25):** 00–09 bestätigt (07 frei, dazu `TESTS`); Ordner entstehen nur bei Bedarf.
> - **Geräteprofil (E3):** Rolle `projekte` = **`D:`** auf allen Rechnern (je 2 TB); NAS-Projekte
>   zusätzlich als **`N:`**, **nur lesend** (E41: ein Löschen über `N:` würde sich sofort auf alle
>   Abos verteilen; ins NAS schreiben nur syncomat-Abos und Aufträge der Datenzentrale). Rolle beim
>   Start über die Volume-ID prüfen. Vorarbeiten: Ada `D:`
>   freiräumen. x3950 `D:` bleibt exFAT: Marlon 07.11.2026 — exFAT ist für Abos erlaubt (mit
>   einmaligem Hinweis „ohne Journal“), FAT32 nie; Zeitvergleich beim Verkleinern dort ±20 ms.
> - **NAS sendet (E2):** nur die Projekt-Ordner „senden und empfangen" (Snapshots,
>   Syncthing-Papierkorb, Prüfung beim Anlegen: Mount über mountinfo/Geräte-ID, nicht `.stfolder`).
>   Marketplace bleibt auf dem NAS „nur empfangen".
> - **Konflikte (E10, erledigt):** `maxConflicts=1` seit v0.9.16 — der Verlierer bleibt als
>   `.sync-conflict-…`. **E20:** Echtzeit ohne Sperren, kein Ein-/Auschecken (nie zwei Personen
>   am selben Projekt); Netz = Konfliktkopie + stündliche Snapshots.
> - **E26:** Der Wächter führt Datei für Datei zusammen, überschreibt nie; abweichende Fassungen
>   liegen daneben als `name.konflikt-<rechner>-<JJJJMMTT>-<kennung>.endung` — normale Dateien,
>   keine Syncthing-Konflikte.
> - **Betrieb (E27, E34):** auch während nDisplay und Aufnahmen weiter abgleichen, keine Pause,
>   keine Bandbreitengrenze. **E33:** auch Render-Rechner senden und empfangen; Ausnahmen je Rolle.
> - **„Fertig" (E30):** drei Handlungen — **Abo beenden** (nur dieser Rechner) · **Pausieren**
>   (alle Arbeitskopien weg, Projekt bleibt in `tank/Projekte`) · **Abschliessen** (Archiv).
>   Entfernt wird erst, wenn das NAS nachweislich vollständig ist.
> - **E35:** `Saved/Autosaves` wird nicht abgeglichen und gilt beim Abo-Ende und Archivieren als
>   verwerfbar. **E16:** Footage verteilt syncomat nicht.
> - **`.waechter/`** (Eingang des Wächters in `tank/Projekte/<NAME>/` und `_Sammelstelle/<NAME>/`,
>   root `0700`): nie anfassen, nie verteilen — wie `.stfolder` und `.syncomat`. Der Wächter
>   archiviert nicht in ein Projekt, das schon synchronisiert wird (`.stfolder`) — klären in
>   Schritt 3.
>
> **Bauliste Schritt 3** (Umfang ca. 4–6 Releases, noch nicht bauen):
> 1. **Abonnieren:** Quelle `tank/Projekte/<NAME>`, Ziel `D:` (Rolle `projekte`), auf mehrere
>    Rechner auf einmal, ganz oder je Gerüst-Unterordner (lokale Ignore-Auswahl, nie `(?d)`),
>    mit Platzprüfung; nur in leere Ziele.
> 2. **Abo beenden / Pausieren / Abschliessen** (E30). Vorbedingung: Live-Test, dass lokales
>    Löschen ignorierter Dateien nicht auf andere Geräte wirkt. „NAS vollständig" nur nach Scan,
>    im Leerlauf, `needItems = needDeletes = 0`, `remoteState` gültig je Gerät; löschen erst nach
>    einem Scan mit dem neuen Muster.
> 3. **Ignore je Rolle** über zwei Schichten (Basis im Ordner, lokale Schicht je Rolle):
>    - Arbeitsplatz: `Saved/Logs`, `Saved/Crashes`, `Saved/Config`, `Saved/Concert`,
>      `Saved/Autosaves` aus; `Saved/MovieRenders` bleibt im Abgleich.
>    - Render-Rechner: ganz `Saved/`, `Intermediate/`, `DerivedDataCache/`, `.vs/`, `*.tmp`.
>    - `Binaries/` und `Plugins/` neu im Abgleich, nur `*.pdb` ausgenommen (heute ignoriert).
>    - `Saved/Config` heute noch abgeglichen, künftig ausgenommen.
>    - Die heutige gemeinsame Ignore-Liste (v0.9.12, überall gleich) wird dafür umgebaut.
> 4. **Lokale `status.json` je Rechner** (Wunsch der Stage): Zustand je abonniertem Projekt,
>    `needBytes`/`needItems`, Fehler, Zeitstempel; Datei statt HTTP; Form legt die Systemkarte fest.
>    Dazu je Projekt und Rechner der Stand **„alles auf dem NAS"** (E44: eine „Version" = gesperrter
>    ZFS-Snapshot entsteht erst, wenn alle Abo-Rechner fertig hochgeladen haben). Bedingungen: Rechner
>    verbunden, Ordner dort im Leerlauf (Scan durch), NAS `needFiles = 0` und kein offener Stand
>    dieses Rechners. Ein ausgeschalteter Rechner mit ungesendeten Änderungen ist von aussen
>    unsichtbar → gilt als „nicht bestätigt", nie als „fertig". Kein Zurückspulen auf dem NAS.
> 5. **Plugins:** Updates nur ausserhalb von Aufnahmen; vor dem nDisplay-Start prüfen, dass
>    Marketplace auf allen Render-Rechnern 100 % hat.
> 6. **Scanner + Datenagent-Kern** als Rust-Crates (gemeinsam mit dem NAS-Agenten), Regeln als
>    JSON, müssen die Tests des Wächters bestehen (datengetrieben, E17). Prüfsummen (E40, beim
>    Umbau entscheiden): Vorschlag XXH3-128 für Projekt-/Mediendateien wie beim Ingest, SHA-256
>    für KI-Modelle (Abgleich mit Hugging Face/Civitai); jedes Manifest nennt seinen Algorithmus.
>    Signierte Aufträge,
>    Regeln lokal durchsetzen, Vorbedingungen beim Ausführen neu prüfen. `syncomat://reveal`.
> 7. **Oberfläche neu (E19)** mit dem Begriff „Abonnieren": zuerst `PRODUCT.md` und Richtung mit
>    `/impeccable`, abgestimmt mit dem Datenzentrale-Entwurf.
>
> **Ausgeliefert seit v0.9.4:** … · v0.9.12 (gemeinsame Ignore-Liste) · v0.9.14 (Preset
> „Unreal-Plugins") · v0.9.15 (angehaltene Ordner sichtbar: Marke/Pfad fehlt) · v0.9.16
> („Alle Geräte aktualisieren", `maxConflicts=1`, `(?d)` nur für OS-Reste und Caches) · v0.9.17
> (interner Kanal `syncomat-intern`) · v0.9.18–v0.9.20 (Fern-Update: Notiz je Ordner, 15-s-Takt,
> Fortschritt und sofortiges Feedback, Nachfragen alle 2 min).

> **Stand 2026-06-09.** Konsolidiert aus zwei Multi-Agent-Audits (UX-Logik + Vereinfachung),
> die zur **selben Wurzel** führen. Diese Datei ist die Single Source of Truth.
> Volle Audit-Outputs (50 UX-Findings, 40 Vereinfachungs-Items) liegen in den
> Workflow-Transkripten dieser Session.
>
> **Kurskorrektur (nach Marlons Test):** Config-Sync ist GEWOLLT (configure once —
> Settings + Tags einmal einstellen, gilt überall). Die Regel ist NICHT „nichts
> syncen", sondern: **zerstörerische Aktionen (Löschen) + stille Überraschungen
> (Geräte/Ordner von selbst) raus — harmlose Config-Replikation bleibt.** Der
> folder-defaults-Kanal bleibt also; nur Lösch-Mechanik + stille Automatiken sind
> weg. Schritte unten, die „Kanal/Tags löschen" sagen, sind dadurch überholt.
>
> **Kurskorrektur 2 (v0.9.2, nach x3950-Real-Test):** Marlons Kern-Modell ist
> **„ein Gerät koppeln → ALLES im Umlauf bekommen"**. Dafür sind **Introducer +
> Auto-Share + Auto-Accept ZURÜCK** (in #1 fälschlich entfernt). Die damaligen
> „Überraschungen" waren **Bugs** (Config-Wipe, Geister-Delete/-Konflikte) — nicht
> die Automatiken. Die Bugs sind seit v0.8.5–v0.9.1 gefixt, also laufen die
> Automatiken jetzt sauber (mit x3950 bestätigt). **#1 ist überholt — Introducer/
> Auto-Share NICHT wieder entfernen.** Künftig nur eingrenzen, wenn Multi-Person/
> Fremd-Geräte dazukommen (dann Introducer auf eigene Geräte scopen).
> ⚠️ **Für Projekte überholt seit 02.11.2026 (E6, siehe oben).**
>
> **Ausgeliefert:** v0.8.6 (#1–#3) · v0.8.7 (Fixes) · v0.8.8 (#4b, #5) ·
> v0.8.9 (Config-Konflikt-Auto-Clean, Recovery-Screen, #6) · v0.9.0 (#7 Krypto
> raus, Politur) · v0.9.1 (Bulk-Konflikt-Auflösung) · v0.9.2 (Auto-Mesh zurück) ·
> v0.9.3 (Politur: pauseDates/selectedFolder) · v0.9.4 (Tag-Dashboard).

---

## 🌐 Netz & TrueNAS-Node — Erkenntnisse (v0.9.4+, real verifiziert)

**Ist-Stand 02.11.2026 (auf dem NAS geprüft):** Der Hub (`syncthing-hub`, Config
`/mnt/Apps/syncthing`) führt **nur die vier Marketplace-Ordner** (5.5–5.8), alle `receiveonly` in
`tank/Syncthing`. **Projekte laufen nicht über ihn**; `Sync/run`, `UnrealLive`, `Presentations` sind
reine SMB-Freigaben auf `m2_4TB/Sync`. Resilio ist seit 01.11.2026 überall entfernt (E15).
Snapshots auf `tank/Syncthing` seit 02.11.2026 (TrueNAS-Aufgaben 14–16): stündlich 24 h,
täglich 03:05 für 30 Tage, wöchentlich Mo 03:10 für 8 Wochen. Die Marketplace-Ordner bleiben auf dem
NAS „nur empfangen" (E2 gilt nur für Projekt-Ordner). Der folgende Absatz beschreibt den ursprünglichen Plan.

**Backup-Hub läuft:** vanilla Syncthing 2.1.1 in Docker (host-mode) auf TrueNAS, synct
`receiveonly` in `tank/Syncthing`, Unreal-Caches ignoriert. Setup-Paket: `deploy/truenas-syncthing/`.
Pairing + Ordner-Annehmen wurden „von Hand" über die NAS-REST-API gemacht (= Phase B manuell).

**Netz-Topologie (an den Interface-Namen verifiziert, nicht angenommen):**
- `192.168.100.x` (`br1`) = **10GbE-Live** — Windows-Render + NAS, schnell, **primär**.
- `192.168.191.x` (`ztbtorevpj`) = **ZeroTier** — MacBook-Pfad + Fallback (nur der Mac ist drauf).
- `10.35.253.1` (`incusbr0`) = **Incus-VM-Bridge — irrelevant**, gehört NIE in die Cluster-Config
  (war kurzzeitig fälschlich als „ZeroTier" in `listenAddresses` — korrigiert).

**Flapping-Bug + Fix:** host-mode-NAS mit `listenAddresses: default` (0.0.0.0) announced ALLE ~13
Docker-Bridges + IPv6-ULAs → Peers liefen in Timeouts (90 % offline). **Fix:** `listenAddresses`
NAS-seitig auf die 2 echten Pfade beschränken (`192.168.100.100` + `192.168.191.17` + relay). Damit
bleiben Geräte-Adressen überall `dynamic` (Syncomat-Default) — **keine Pro-Gerät-Statics nötig.**

**Speed-Erkenntnis (Syncthing-Quellcode UND Resilio-Doku verifiziert):** Syncthing kann 10GbE NICHT
automatisch gegenüber ZeroTier bevorzugen — beide sind private Ranges → beide `tcp-lan`, gleiche
Priorität → **„first-to-connect wins", kein Durchsatz-Vergleich.** Weder `connectionPriority*` noch
Adress-Reihenfolge noch `alwaysLocalNet` ändern das. Resilio hat dasselbe Sticky-Cache-Verhalten
(„peer expiration = 0" zum Lösen), bietet aber **„network interface per share"** als expliziten Knopf.

**Entscheidung (bewusst, YAGNI):** Per-Gerät-„bevorzugte-schnelle-Adresse"-Feature **NICHT bauen.**
Grund: Multi-Source-Pull mildert es (NAS zieht Gross-Daten parallel von den 10GbE-Peers), laufende
Deltas sind klein, und der Knopf widerspricht „configure-once". → **Reaktivieren NUR**, wenn Gross-
Transfers nachweislich regelmässig kriechen, weil Nodes auf ZeroTier kleben. Dann Resilio-Stil:
„per-device fast address", die Syncomat **bewahrt** (statt sie mit `dynamic` zu überschreiben).

**Offen:** Phase B (NAS-Verwaltung in Syncomat) liegt als BETA auf Branch `feat-nas-management`
(ungetestet gegen Live-NAS; CORS-Frage Webview→Remote-API offen). ZFS-Snapshot-Task + Quota auf
`tank/Syncthing` = Marlons TODO in der TrueNAS-UI (das ist die eigentliche Backup-Sicherung).

---

## 🧭 Nordstern & Richtung

Nach einem Tag voller reaktiver Fixes ist die Richtung jetzt **eine**, bewusst gewählt:

> **Syncthing ist die einzige Wahrheit.** Syncomat ist eine ehrliche GUI davor —
> liest live aus Syncthings REST-API, schreibt Änderungen per PUT/PATCH zurück.

**Zwei eiserne Regeln:**
1. Die App schreibt **niemals** etwas über sich selbst in einen gesyncten Ordner.
2. **Nichts** passiert still im Hintergrund — jede Geräte-/Ordner-Aktion ist ein sichtbarer, bewusster Klick.

**Die zentrale Erkenntnis:** Die UX-Probleme und das „Monster"-Gefühl haben **dieselbe Ursache** —
App-Zustand über den Sync-Kanal replizieren + drei stille Hintergrund-Automatiken. Darum ist
**Vereinfachung = UX-Fix**. Wir härten nichts mehr nach; wir entfernen die Ursachen. Weniger Code
**und** mehr Vertrauen, in einem Zug. ~50–60 % der Codebasis kann weg, ohne den Zweck anzutasten.

**Tempo:** bewusst, nicht überstürzt. Der Sprint läuft auf einem Branch, **Schritt für Schritt**,
Cluster nach jedem Schritt getestet. Lieber langsam und vorhersehbar als noch ein Patch im Eifer.

---

## 🛠️ Der Weg — Vereinfachungs-Sprint (gerankt)

Reihenfolge = grösste Komplexitäts-Reduktion pro Aufwand zuerst. In Klammern: welches
UX-Problem / welche Bug-Klasse der Schritt **ursachlos** beseitigt.

1. **`[DELETE/S]` Die drei stillen Automatiken raus** — introducer-Migration (App.tsx ~189-207),
   Auto-Share-Reconciliation (~150-179), Auto-Accept-Loop (~214-236) + `introducer:true`→`false`
   an allen 4 Stellen. → *behebt „Geräte tauchen von selbst auf" + „Entfernen wirkt nicht" +
   Re-Pair-Churn auf einen Schlag. Reines Löschen.* (UX-Trust-Breaker #3, #4)
2. **`[DELETE/S]` Toter Code** — `useActiveInvites`, `deriveDisplayStatus`, `getAllCachedStatuses`,
   `subscribeAllStatusChanges` (alle null Aufrufer, verifiziert) + `invite_check_consumed` (TOCTOU).
   → *null Aufrufer = null Verhaltensänderung. Risikoloser Auftakt.*
3. **`[DELETE/M]` Cluster-Delete komplett** — clusterWide-Checkbox, `deletion_requested`/`_by`,
   remove()-Propagation, acceptClusterDelete, roter Banner, alle Guards. „Entfernen" = nur lokal
   aus dem Sync nehmen (Dateien bleiben), auf anderem Gerät ggf. dort selbst. → *die gefährlichste
   Bug-Klasse weg; genau Marlons #5-Wunsch.* (UX-Trust-Breaker #5)
4. **`[DELETE/L]` Der folder-defaults-Replikations-Kanal** — `folder_settings.rs`,
   `folderSettings.ts`, 30s-Poll, beide localStorage-Dedup-Maps, Staleness-Guard, Auth-Check +
   **Tags-Subsystem**. `ignore_hidden`/`trashcan` werden rein lokale Toggles. → ***die Wurzel.***
   *Geister-Delete + verschwindende Ordner als KLASSE weg, nicht einzeln.* (UX-Trust-Breaker #1)
5. **`[DELETE/S]` Blocklist raus** — `ignored_folders.rs` + `ignored.ts` + Re-Enable-Pfad.
   → *fällt nach #1 trocken; erfüllt „kein Blocklist-Apparat" direkt.*
6. **`[MERGE/M]` Eine atomare `acceptDevice()`** — alle Aufrufer darauf: putDevice(introducer:false)
   + Folder-Share einmalig + deletePendingDevice. → *entfernt die 3-Pfade-Inkonsistenz.* (UX #10)
7. **`[DELETE/M]` HMAC-Security-Theater raus** — Code = simples `base64url(JSON)`; invites.rs
   Replay-Schutz auf eine HashMap + ein TTL. → *echter Schutz (Syncthing-TLS + consume_once)
   bleibt; der mitreisende Signatur-Key war null realer Schutz.*
8. **`[SIMPLIFY/S]` Pairing-Politur** — Auto-Accept one-shot oder ganz weg (immer sichtbarer
   Pending-Banner), `selectedFolder`-Effect → reine Render-Ableitung, `pauseDates.ts` löschen.
9. **`[DELETE/S]` Cloud-Abhängigkeit + Dashboard-Nachbau** — Pair-Worker/Rendezvous entkoppeln
   oder streichen; `GlobalActivityView` + `FolderErrorsModal` → „In Syncthing-Web-UI öffnen"-Button.
10. **`[MERGE/M]` Letzte Konsolidierung** — `folder_stats` auf einen Walk; Status-Polling auf
    einen Pfad; `usePoll(fetcher, ms)`-Helper; Unreal-Tuning → ein `.stignore`-Preset + 1-2
    Settings; Conflict-Resolver → reine Anzeige + „Im Finder zeigen". (UX #14)

### Parallel / danach (aus UX-Audit, nicht vom Sprint automatisch erledigt)
- **`[critical]` Wipe von Erststart unterscheiden** — persistenter `hasEverConfigured`-Marker
  (in app_data, nicht localStorage). Ist er gesetzt aber alles leer → **Recovery-Screen** statt
  fröhlichem Welcome. Das eine kritische UX-Finding, das eigenständig bleibt. (UX-Trust-Breaker #2)
- **`[high/S]`** Statusbar lügt beim Boot nicht grün „Alle Ordner synchron" (ready-Prop durchreichen).
- **`[high/S]`** Terminologie-Sweep: „Peer"→„Gerät", ein Verb für Accept, „Verfügbar"→handlungsorientiert.

---

## ✅ Behalten — der Kern

- **`sidecar.rs`** — Syncthing-Spawn + graceful Shutdown (POST /rest/system/shutdown, Schutz gegen
  leveldb-Korruption/Stunden-Rescan) + Waisen-Kill. Der irreduzible Kern.
- **`syncthing.ts`** — typed REST-Wrapper + **ein** Event-Stream-Listener (keine zweite Cache-Engine).
- **`invites.rs` Replay-Schutz** — `consume_once`, atomar gegen TOCTOU (abgespeckt auf 1 Map + 1 TTL).
- **Pending-Device-Banner** mit Accept/Reject — die einzige Pairing-UI.
- **Ordner-Erstellung** — Pfad-Picker + explizite „mit welchen Geräten teilen"-Checkboxen.
- **Unreal-`.stignore`-Preset** — das eine Default-Ignore-Set (spart real 10-50 GB). Der echte Mehrwert.
- **Status-Anzeige** — Sidebar (Ordner + Geräte) + Statusbar, rein lesend.
- **Tray-Lifecycle** — Fenster schliessen = Tray, Sync läuft weiter, optional Autostart.
- **Minisign-OTA-Updater** — tauri-plugin-updater + UpdateBanner.

---

## 📉 Vorher → Nachher (verifiziert)

| | vorher | nachher |
|---|---|---|
| LOC | ~10.350 | ~4.500–5.000 |
| Rust-Module | 8 | 2 Kern |
| App-Effects | 7 | ~3 |
| Timer (setInterval) | 8 | ~2 |
| `introducer:true`-Stellen | 4 + Migration | **0** |
| App-Config durch Sync-Kanal | 3 Kanäle | **0** |
| betriebene Cloud-Teile | 1 (Worker) | 0 / optional |

**Bug-Klassen, die strukturell verschwinden:** Geister-Delete · verschwindende Ordner ·
„Geräte tauchen auf" · „Entfernen wirkungslos"/Re-Pair-Churn · Rescan-Bombe auf 20-80 GB ·
Security-Theater. Ursachlos, nicht gepflastert.

---

## 🧊 Aktueller Cluster-Zustand (NICHT heute reparieren)

Nach dem heutigen Chaos sind die 3 Geräte (MacBook 4CZONVS, x7950, x5950) halb-gepairt; die zwei
Windows sehen sich noch nicht (Stern statt Mesh, weil Ordner a dort noch nicht angenommen).
**Dateien sind alle sicher auf Platte.** Nicht heute Nacht dagegen ankämpfen — sobald Sprint-#1
landet (vorhersehbares Pairing ohne Introducer-Magie), sauber neu aufsetzen.

---

## Verschoben (explizit)

- **Files-on-Demand / Platzhalter** — riesig (macOS FileProvider / Windows Cloud Files API). Später.
- **Apple Codesigning** — Developer Account ($99/J) + Notarization. Aktuell Rechtsklick→Öffnen.
- **Windows Authenticode** — EV-Cert ~$300/J. Aktuell SmartScreen „Trotzdem ausführen".
- **Multi-User-Studio-Sharing** — aktuelles Modell ist „eigene Geräte unter sich". Mit Fremden
  würde RW→RO + explizites Share-Set + (kein) Introducer komplett neu gedacht.

---

## Erledigt (Historie / Kontext)

- **Native-Redesign (v0.6.0–v0.8.0)** — Schriftstack, dezente Scrollbars, alle Overlay-Modals →
  Inline-Panels (PanelShell), Modal.tsx gelöscht. Marlons „Web-App-Gefühl"-Kritik adressiert.
- **v0.8.1** — Cluster-Delete-Timing (scan + Grace). *(wird in Sprint-#3 ganz entfernt)*
- **v0.8.2–v0.8.3** — Device-Aktionen als Header-Icons; Erststart-Panel-Bug.
- **v0.8.4** — introducer + Auto-Accept + Finder-Button. *(introducer/Auto-Accept werden in
  Sprint-#1/#8 wieder entfernt — war Over-Engineering, vom Audit bestätigt.)*
- **v0.8.5** — Relaunch-Selbstheilung (Waisen-syncthing graceful killen, Config-Flush). Behebt den
  Update-Wipe, der die heutige Kaskade ausgelöst hat. Bleibt.

---

## Blocker für mehr Verifikation

- **Live-3-Geräte-Test** (teils erledigt heute): Pairing über LAN funktioniert; Mesh-Bildung und
  „Verfügbar"→Verknüpfen-Flow auf Windows noch sauber durchspielen — am besten erst nach dem Sprint,
  wenn Pairing vorhersehbar ist.
