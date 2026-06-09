# Roadmap

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
>
> **Ausgeliefert:** v0.8.6 (#1–#3) · v0.8.7 (Fixes) · v0.8.8 (#4b, #5) ·
> v0.8.9 (Config-Konflikt-Auto-Clean, Recovery-Screen, #6) · v0.9.0 (#7 Krypto
> raus, Politur) · v0.9.1 (Bulk-Konflikt-Auflösung) · v0.9.2 (Auto-Mesh zurück).

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
