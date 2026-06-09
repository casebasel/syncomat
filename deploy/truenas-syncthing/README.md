# Syncthing-Hub auf TrueNAS — Deploy-Paket (Phase 1)

Vanilla Syncthing-Daemon als always-on Cluster-Node, synct in `tank/Syncthing`,
abgesichert über ZFS-Snapshots. **Kein Syncomat-GUI** auf der NAS — der Hub ist
nur ein weiteres Syncthing-Gerät.

> **Netz (wichtig):** Cluster + GUI laufen über **`192.168.100.100`** (Live-Netz, wo
> Mac + Windows-Render leben). `192.168.191.17` ist nur SSH/Management.

## Deploy
```bash
# Paket liegt unter ~/syncthing-hub auf der NAS:
sudo bash ~/syncthing-hub/setup.sh
```
Das Script: legt `tank/Syncthing` an, chownt auf `3003:3002` (ndisplay) + setgid,
kopiert die Compose nach `/mnt/Apps/syncthing/`, startet den Container, gibt die
**Device-ID** aus. Idempotent — kann gefahrlos erneut laufen.

## Nach dem Deploy (in dieser Reihenfolge)

**1. GUI absichern.** `http://192.168.100.100:8384` → Settings → GUI → Benutzer + Passwort.
*(Die GUI ist nur im Live-Netz erreichbar, kein Tunnel. Wer sie auch über ZeroTier
braucht: `STGUIADDRESS=0.0.0.0:8384` in der Compose — aber erst NACH Passwort.)*

**2. NAS pairen.** Auf einem Desktop (Syncomat) die NAS-Device-ID hinzufügen, ODER
in der NAS-GUI ein Desktop-Gerät hinzufügen. Am NAS-Device **statische Adressen** setzen:
```
tcp://192.168.100.100:22000, tcp://10.35.253.1:22000, dynamic
```
Introducer + Auto-Share bieten dem NAS danach automatisch alle Ordner an.

**3. Ordner annehmen — IMMER als `Receive Only`.** Pro angebotenem Ordner in der NAS-GUI:
- Folder Type → **Receive Only** (der NAS schreibt nie zurück → ein Desktop-Fehler kann nicht den Cluster zerstören).
- Path → `/var/syncthing/data/<Projekt>` (landet in `tank/Syncthing`).
- **`.stignore` setzen** (Ignore Patterns, identisch zu den Desktops, siehe unten) —
  sonst meldet Receive-Only die nicht-übertragenen Caches als „out of sync".
- (Optional) `maxConflicts` niedrig halten — die NAS-GUI hat das nicht im UI; per
  REST: `PATCH /rest/config/folders/<id> {"maxConflicts":10}`.

**4. ZFS-Snapshots = das eigentliche Backup.** TrueNAS-UI → Data Protection →
Periodic Snapshot Task auf `tank/Syncthing`: z.B. stündlich (24 h) + täglich (14–30 d)
+ wöchentlich (8 w). **Erst scharf schalten, NACHDEM der Erst-Scan durch ist.**
> Syncthing repliziert auch Löschungen — `Receive Only` schützt nur vor Zurückschreiben,
> NICHT vor empfangenen Löschungen. Die einzige echte Lösch-/Ransomware-Sicherung sind
> diese Snapshots.

**5. Quota.** `tank/Syncthing` eine Quota geben (TrueNAS-UI) — ein voller Pool legt
sonst auch Supabase/Gitea lahm (gleicher `tank`).

## `.stignore` für Unreal-Ordner (auf der NAS pro Ordner setzen)
```
// Bare patterns matchen in jeder Tiefe
DerivedDataCache
Intermediate
Build
Binaries
Saved
**/Plugins/*/Intermediate
**/Plugins/*/Binaries
**/Plugins/*/Saved
**/Plugins/*/DerivedDataCache
*.pdb
*.obj
```
> Cache/Build-Artefakte sind pro Maschine regenerierbar — gehören NICHT ins Backup.
> Identisch zu Syncomats Preset (`src/lib/unreal.ts`).

## Wartung
- **Version:** Image ist auf `syncthing/syncthing:2.1.1` gepinnt = Syncomat-Sidecar-Version.
  Beim Desktop-Update grob mitziehen (gleiche Major-Version 2.x).
- **inotify** (große Projekte): falls Ordner „still" auf Polling zurückfallen →
  `fs.inotify.max_user_watches=524288` am Host (TrueNAS Init-Script, da `/etc` teils ephemer).
- **Restore testen:** einmal eine Datei aus `/mnt/tank/Syncthing/.zfs/snapshot/<snap>/...`
  zurückholen — ein Backup, das nie getestet wurde, ist keins.

## Risiko-Kurzliste (Details: `docs/truenas-node-konzept.md`)
- 🔴 Receive-Only erzwingen + Snapshots = Pflicht, sonst 4. Spiegel statt Backup.
- 🔴 PUID/PGID **muss** 3003:3002 sein (sonst gehören Sync-Dateien root, Render-Nodes blind).
- 🔴 GUI nie ohne Passwort über Tunnel.
- 🟡 NAS als Introducer unnötig — nach Pairing auf den Desktops `introducer:false` am NAS-Device.
- 🟡 Neuer/leerer Desktop kann Massenlöschung Richtung NAS auslösen → Snapshot ist das Netz.
