# Testplan vor jedem Release

Kurz und gezielt (Marlon, 08.11.2026: „nicht riesig, aber sehr smart“). Jedes Release:
**fester Kern zur Datensicherheit + genau das, was sich geändert hat.** Getestet wird die
echte App mit einer Testfassung, nicht die Vorschau.

## Ablauf

1. Testfassung: Version `X.Y.Z-test.N` setzen, Tag `vX.Y.Z-test.N` auf dem Branch pushen.
   Der Workflow macht daraus eine **Vorabversion** — die automatische Aktualisierung sieht sie
   nicht, die Studio-Rechner bleiben unberührt.
2. Installieren auf **render** (Windows, NTFS) und dem **MacBook** (APFS, über ZeroTier).
   Der Mac muss **entsperrt** sein: gesperrt schläft die Oberfläche von syncomat, Wünsche
   warten dann bis zum Entsperren (08.11.2026). Windows läuft auch gesperrt weiter.
   x3950 (exFAT) nur, wenn Laufwerks-Code geändert wurde.
3. Testen mit `TEST_SYNCOMAT` (enthält absichtlich Umlaute, NFD-Namen, Leerzeichen, `&`,
   Klammern, `[alt]`). Gesteuert über Wünsche im internen Kanal — derselbe Code wie ein Klick.
4. Nach **jedem** Schritt prüfen: NAS-Dateizahl unverändert (ausser gewollt), `needDeletes 0`,
   keine `*.sync-conflict*` (seit 11.11.2026 gibt es nie Konfliktkopien), Rechner `idle`/`need 0`.
5. Spuren aufräumen, Ergebnis-Tabelle an Marlon, erst dann Release-Okay einholen.

## Kern (jedes Mal, ~10 min)

| # | Schritt | Erwartung |
|---|---|---|
| K1 | Abonnieren benutzerdefiniert (2 Ordner, einer mit Umlaut) | nur diese Ordner lokal, Ziel `D:\Projekte\<NAME>` bzw. Mac-Projektordner |
| K2 | Verkleinern | abgewählte Dateien lokal weg, NAS unverändert |
| K3 | Vergrössern auf Alles mit **neuer** lokaler Datei | Datei kommt aufs NAS, 0 Konflikte |
| K4 | Vergrössern, während lokal eine **ältere Fassung** einer NAS-Datei liegt | NAS-Fassung (neuer) gewinnt überall, keine Konfliktkopie |
| K5 | Veralteter Wunsch (`vorher` falsch) | abgelehnt, nichts geändert |
| K6 | Abo beenden **mit Löschen**, mit einer nie abgeglichenen Datei (z. B. `Saved/Autosaves`) | Abo weg, Gesichertes gelöscht, die lokale Datei bleibt und wird gemeldet |
| K7 | Abo beenden mit Löschen ohne Reste | Ordner ganz weg; Angebot kommt zurück (≤ 1 min) |
| K8 | `.stfolder` löschen, Ordner voll | ≤ 1 min: Marke neu, Abgleich läuft, Eintrag in Aktivität |
| K9 | `.stfolder` löschen und Ordner leeren | kurz „Nur empfangen“, Dateien kommen zurück, NAS unverändert, danach wieder „Senden & Empfangen“ |
| K10 | Gleiche Datei auf zwei Rechnern ändern | neuere gewinnt überall, keine Konfliktkopie |

## Je nach Änderung zusätzlich

- **Oberfläche/Feld rechts:** Ordnerbaum lädt (auch wenn das Angebot erst später kommt),
  „Benutzerdefiniert“ wählbar, kein Hin-und-her (Schleife!), Knöpfe aktiv.
- **Laufwerk/Platz:** Mac mit wenig Platz, exFAT (x3950), Hinweis statt Sperre.
- **Wünsche/Kanal:** Ziel ausgeschaltet → führt beim Start aus; ausgeschaltete vorgestellte
  Rechner blockieren nichts.
- **Update-Mechanik:** Versionsanzeige „Alle Geräte“, ausgeschaltete Rechner.
- **Rust (Löschen/Prüfen):** `cargo test` + K2/K6 auf beiden Plattformen.

## Gelernt (warum dieser Plan)

07./08.11.2026 gingen v0.9.27–0.9.35 nacheinander raus, fast jede mit einem Fehler, den erst
der echte Einsatz zeigte: Syncthing meldet „keine Fehler“ als `null`; Ordnerbaum holen strich
das Angebot (Schleife); 100-GiB-Reserve sperrte den Mac; Syncthing entfernt `.stfolder` beim
Herausnehmen; der Hub stellt Rechner vor (introducedBy), ausgeschaltete blockierten das Löschen.
Keiner davon war mit Unit-Tests oder der Vorschau zu sehen.
