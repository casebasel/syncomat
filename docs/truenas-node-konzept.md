# Konzept: TrueNAS-Sync-Node (Syncthing-Hub auf ZFS)

> **Stand 2026-06-09.** Erarbeitet aus Multi-Agent-Recherche (Codebase + TrueNAS-Recon
> + Syncthing-Server-Betrieb + Integration + Adversarial-Check). Die TrueNAS wurde dabei
> read-only inspiziert — die Zahlen unten sind **echt**, nicht angenommen.
>
> **Ziel:** eine always-on Syncthing-Node auf TrueNAS, die direkt in ein ZFS-Dataset
> synct → 24/7-Sync-Partner + (über ZFS-Snapshots) versioniertes Backup.

---

## 0. TL;DR — die drei Wahrheiten vorweg

1. **Der NAS läuft *vanilla Syncthing* (headless Docker), NICHT Syncomat.** Syncomat ist die
   Desktop-GUI. Der NAS ist „nur" ein weiteres Syncthing-Gerät im Cluster, das die Desktops
   wie jeden anderen Rechner pairen. Folder-Pfad auf dem NAS = **manuell** (Syncthing-Web-UI),
   weil Syncomat *keinen Pfad auf einem fremden Node setzen kann* (verifiziert im Code).

2. **„Backup" entsteht NICHT durch Syncthing, sondern durch ZFS-Snapshots.** Syncthing
   repliziert auch **Löschungen**. Ein `rm` auf einem Desktop (oder ein zurückgesetzter,
   leerer Desktop-Ordner) löscht den NAS-Inhalt mit. Echte Lösch-/Ransomware-Sicherung kommt
   **ausschließlich** aus ZFS Periodic Snapshots. `receive-only` schützt nur davor, dass der
   NAS *zurückschreibt* — nicht davor, dass er Löschungen *empfängt*.

3. **Es ist heute machbar (Phase 1, ~1–2 h Setup)** — aber mit ein paar harten Pflicht-
   Einstellungen (UID 3003:3002, receive-only erzwingen, Snapshots scharf, GUI-Auth).
   Bequemes Verwalten aus Syncomat heraus wäre Phase 2 (Code-Ausbau).

---

## 1. Was auf der TrueNAS wirklich vorliegt (Recon-Befund)

| Fakt | Wert |
|---|---|
| Pool `tank` | 28 TB, **24.4 TB frei** |
| Bestehendes Backup-Dataset | `tank/Replication/SyncReplicationBackup` (2.6 TB) — dein Resilio/Replication-Ziel, Sub-Datasets `UnrealLive`, `UnrealWorkspace`, `VP_Projekte`, `PerforceResillio`, `WorkshopFCB`, `Presentations`, `run` |
| Owner der Unreal-Daten | **`ndisplay` = UID 3003 / GID 3002**, Verzeichnisse `drwxrwx---` (nur gruppen-schreibbar) |
| Docker | v27.5.0, läuft. `truenas_admin` (UID 950) hat **keinen** Socket-Zugriff → `sudo` nötig |
| Bestehende Stacks | `/mnt/Apps/` (supabase-*, gitea, filebrowser via Dockge), Cloudflared-Config `/mnt/Apps/cloudflared/config.yml` |
| Stolperfalle | verwaiste Katalog-Syncthing-App unter `/mnt/.ix-apps/app_mounts/syncthing/config` (UID 568) — **nicht** wiederverwenden |
| Ports 8384 / 22000 / 21027 | frei |

**Konsequenz:** Der Container **muss** als `PUID=3003 PGID=3002` laufen, sonst gehören frisch
gesyncte Dateien `root` und die nDisplay-Render-Nodes verlieren den Zugriff (fällt erst im
Unreal-Workflow auf, nicht als Sync-Fehler).

---

## 2. Das Kernproblem (ehrlich): Pfad-Setzen ist remote nicht möglich

Verifiziert im Syncomat-Code:
- `putFolder()` (`src/lib/syncthing.ts`) schreibt **immer** gegen den *lokalen* Syncthing
  (Tauri-Sidecar). Es gibt keine `putFolderOnDevice(remote, …)`.
- `LinkFolderModal` nutzt den Tauri-`open()`-Dialog → nur **lokale** Pfade wählbar.
- Syncthing-Semantik: `PUT /rest/config/folders/{id}` ändert nur die Config *dieses* Node.
  Andere Nodes bekommen das Folder nur **angeboten** (pending) und müssen lokal annehmen +
  ihren Pfad selbst eintragen.

**Heißt:** Wenn Auto-Share dem NAS einen Ordner anbietet, muss **auf dem NAS** (Web-UI oder
REST) der Ordner akzeptiert *und der Ziel-Pfad gesetzt* werden. Das ist der einzige manuelle
Schritt — und gleichzeitig der Hebel für Phase 2 (siehe §6).

---

## 3. Deployment (Phase 1, heute machbar)

Eigenes `docker-compose` unter `/mnt/Apps/syncthing/` — konsistent mit den Supabase-Stacks,
**nicht** die ix-Katalog-App.

```yaml
# /mnt/Apps/syncthing/docker-compose.yml
# Syncthing-Hub auf TrueNAS — 24/7 Cluster-Node + ZFS-Snapshot-Backup
# Vanilla Syncthing-Daemon (headless, KEIN Syncomat-GUI).
name: syncthing-hub          # eindeutig -> kein Service-Override (Noa-Lehre)

services:
  syncthing:
    image: syncthing/syncthing:1.27   # PINNEN auf die Sidecar-Version (nicht :latest)
    container_name: syncthing-hub
    hostname: truenas-hub             # so erscheint die Node im Cluster
    restart: unless-stopped
    network_mode: host                # Pflicht: lokale Discovery (21027/UDP) + ZeroTier-Bind
    environment:
      - PUID=3003                      # ndisplay -> darf in die Unreal-Datasets schreiben
      - PGID=3002
      - TZ=Europe/Zurich
      - UMASK=0002                     # neue Dateien bleiben group-writable (GID 3002)
      - STGUIADDRESS=192.168.191.17:8384   # GUI NICHT an 0.0.0.0 (Auth-Risiko, §7)
    volumes:
      - /mnt/Apps/syncthing/config:/var/syncthing/config   # Identität/DB — muss Redeploys überleben
      - /mnt/tank/Syncthing:/var/syncthing/data            # eigenes Dataset (s.u.)
# host-mode + ports: zusammen = Compose-Fehler. Bei host-mode KEIN ports-Block.
```

**Vor dem ersten Start:**
```bash
ssh -t truenas 'sudo zfs create tank/Syncthing'                 # eigenes Dataset (eigene Snapshot-Policy)
ssh -t truenas 'sudo mkdir -p /mnt/Apps/syncthing/config'
ssh -t truenas 'sudo chown -R 3003:3002 /mnt/Apps/syncthing/config /mnt/tank/Syncthing'
ssh -t truenas 'sudo docker compose -f /mnt/Apps/syncthing/docker-compose.yml up -d'
```
> Warum eigenes `tank/Syncthing` statt ins bestehende `SyncReplicationBackup`: saubere,
> unabhängige Snapshot-Policy, kein Konflikt mit der laufenden Resilio-Replication, und eine
> **Quota** möglich (§7, Blast-Radius).

**Gotchas (alle real, aus dem Recon):**
- `truenas_admin` ohne Docker-Socket → alle `docker`-Befehle via `ssh -t truenas 'sudo …'` (das `-t` für TTY).
- `network_mode: host` ist quasi Pflicht — in `bridge` funktioniert die lokale Broadcast-Discovery (21027/UDP) **nicht**.
- Config-Dir vor erstem Start chownen, sonst legt das Image `config.xml` als `root` an.
- Die verwaiste ix-App (`/mnt/.ix-apps/.../syncthing`, UID 568) deaktiviert lassen — sie kollidiert sonst auf 8384/22000.

---

## 4. Syncthing-Server-Semantik (so wird der Hub ein Backup, kein Spiegel)

- **Folder-Type: `receiveonly`** für *jeden* Ordner auf dem NAS. Der NAS ist Ziel, nie Quelle.
  Verhindert, dass eine NAS-seitige Abweichung (ZFS-Rollback, manueller `touch`) als gültige
  Änderung an die Arbeitsmaschinen propagiert. **Aber:** schützt *nicht* vor empfangenen
  Löschungen — dafür siehe Snapshots.
- **ZFS-Snapshots = die Backup-Wahrheit.** Periodic Snapshot Task auf `tank/Syncthing`,
  z.B. stündlich (24 h) + täglich (14–30 d) + wöchentlich (8 w). **Erst scharf schalten,
  nachdem der Erst-Scan der Daten durch ist.** Syncthing-File-Versioning (`.stversions`)
  auf dem NAS **aus** — es dupliziert sich nur in die Snapshots und bläht Inodes.
- **Ignore identisch zum Desktop:** die Unreal-Junk-Dirs (`DerivedDataCache`, `Intermediate`,
  `Build`, `Binaries`, `Saved`, `*.pdb/*.obj`) gehören auch auf dem NAS ignoriert (nicht
  regenerierbarer Cache ≠ Backup). **`.stignore` wird NICHT automatisch verteilt** — pro
  Ordner auf dem NAS setzen (`.stignore`-Datei im Ordner-Root oder `POST /rest/db/ignores`).
  Sonst markiert `receiveonly` die nicht-übertragenen Caches als „Local Additions" und der
  Ordner steht dauerhaft auf *out of sync*.
- **Tuning fehlt im vanilla Daemon.** Syncomats adaptives `tuneFolderForSize` (u.a.
  `maxConflicts:10`, `rescanIntervalS`, `fsWatcher`) gilt am NAS **nicht** — manuell/Script
  nachbauen, sonst sammelt der Hub Konflikte unbegrenzt (`maxConflicts:-1`).
- **Discovery:** Global + Local Discovery am NAS an. Den NAS **direkt** mit jedem Desktop per
  Code koppeln (nicht nur via Introducer) — die **Geräte-Adressen aber auf `dynamic` lassen**
  (Default). Syncomat schreibt sie ohnehin immer als `dynamic` (`src/lib/redeemFlow.ts` →
  `[...hints, "dynamic"]`, `src/lib/pairing.ts` → `["dynamic"]`); manuell gepflegte Pro-Gerät-
  Statics auf dem NAS werden beim Re-Pair/Introducer also wieder Richtung `dynamic` überschrieben
  und kämpfen nur gegen dieses Modell. Der **eine** Hebel sitzt NAS-seitig: `listenAddresses`
  explizit auf die zwei echten Cluster-Pfade beschränken (`tcp://192.168.100.100:22000`,
  `quic://…:22000`, `tcp://192.168.191.17:22000`, `quic://…:22000`, `dynamic`) statt `default`
  (= `0.0.0.0`). Sonst announced der host-mode-NAS **alle ~13 Docker-Bridges + IPv6-ULAs**, und
  die introduced Desktops flappen zwischen toten Adressen — **das** war die Wurzel des
  Connection-Flappings, nicht fehlende Pro-Gerät-Statics. Sauber announcender NAS + `dynamic` +
  Global Discovery genügt desktop-seitig. (`setup.sh` setzt die `listenAddresses` automatisch.)

---

## 5. Wie der NAS in Syncomats Modell passt

„Ein Gerät koppeln → alles im Umlauf bekommen" (v0.9.4) gilt für den NAS **identisch**:
1. NAS einmalig pairen (Code auf Desktop erzeugen → NAS-Device-ID in NAS-Web-UI eintragen,
   oder umgekehrt).
2. Introducer + Auto-Share-Reconciliation bieten dem NAS automatisch alle Ordner an.
3. **Manueller Schritt:** auf dem NAS jeden Pending-Folder annehmen + Pfad
   (`/var/syncthing/data/<Projekt>` → ZFS-Dataset) setzen, auf `receiveonly` stellen, `.stignore`
   setzen.
4. Sync läuft. ZFS-Snapshots laufen separat.

---

## 6. Phasen-Plan

**Phase 1 — heute (vanilla, manuell):** Deployment §3, Setup §4/§5. Voll funktionsfähig,
Setup-Aufwand ein paar Stunden (großteils Erst-Scan/Hash der 2.6 TB).

**Phase 2 — Syncomat managt den NAS remote (2–3 Sprints):** Syncthing hat eine REST-API +
einen **Verzeichnis-Browser** (`/rest/browser`). Damit *kann* Syncomat den NAS-Pfad remote
setzen:
- Neuer Endpoint-Typ in Syncomat: nicht nur `127.0.0.1:8384`, sondern auch
  `https://192.168.191.17:8384` + NAS-API-Key (sicher gespeichert, mode `0600`, wie `invites.json`).
- Tauri-Kommando `acceptFolderOn(remoteEndpoint, folderId, localPath)` → `PUT /rest/config/folders`
  gegen den NAS.
- „Server/NAS"-Node-Typ in der Geräte-Liste: Pending-Folders annehmen + Pfad via Filebrowser-
  Dialog (`/rest/browser`), Health (Disk-Free, Uptime), Restart.

**Phase 3 — voll managed:** NAS wie ein Desktop in Syncomat, inkl. Pfad-Picker, Status-Polling,
receive-only-Default für Server-Nodes.

---

## 7. Risiken & Pflicht-Einstellungen (aus dem Adversarial-Check)

| Sev | Risiko | Mitigation |
|---|---|---|
| 🔴 | **Desktop-Löschung propagiert auf den NAS** (Auto-Share legt `sendreceive` an) | Jeden NAS-Ordner auf `receiveonly` zwingen (`PATCH /rest/config/folders/<id> {"type":"receiveonly"}`). Da Auto-Accept ständig neue `sendreceive`-Folder erzeugt → **Cron-Reconcile-Script** auf dem NAS (alle 5–10 min: `receiveonly` + `.stignore` + `maxConflicts` setzen). |
| 🔴 | **Ohne ZFS-Snapshots ist es kein Backup** | Snapshot-Task vor dem ersten Sync scharf; Retention so, dass eine übers-Wochenende-unbemerkte Massenlöschung im Fenster liegt. |
| 🔴 | **Leerer/zurückgesetzter Desktop löscht alles** | Ein neu aufgesetzter Desktop bekommt via Auto-Share alle Ordner als `sendreceive` — wenn lokal leer, droht Massenlöschung Richtung NAS. **Neuen Desktop nie mit leeren Ordnern in den Cluster lassen**, bevor er gesynct hat. ZFS-Snapshot ist das Sicherheitsnetz. |
| 🔴 | **UID-Mismatch** | `PUID=3003 PGID=3002` + `UMASK=0002`; nach erstem Sync `ssh truenas 'stat <datei>'` → Owner prüfen. |
| 🔴 | **Auth-lose GUI über Tunnel = offene Cluster-Steuerung** | GUI-User/Passwort **vor** Go-Live; besser Cloudflare Access davor; am besten GUI nur an LAN/ZeroTier binden (`STGUIADDRESS=192.168.191.17:8384`), Tunnel nur wenn echt nötig. |
| 🟡 | **NAS wird zwangs-Introducer** (Code setzt `introducer:true`, App-Migration auch) | NAS-ID von der Introducer-Migration ausnehmen (kleine Code-Änderung) **oder** akzeptieren. Ein 24/7-Hub muss kein Introducer sein — die Desktops reichen. |
| 🟡 | **Auto-Accept-Fenster nimmt bis zu 30 d *jedes* Gerät** | Codes mit **kurzer** TTL erzeugen (Minuten/Stunden). Fehlt: ein „Fenster jetzt schließen"-Knopf. |
| 🟡 | **Konflikt-Lawine** (vanilla `maxConflicts:-1`) | `maxConflicts` am NAS setzen; `receiveonly` reduziert es stark. |
| 🟡 | **Erst-Scan 2.6 TB + inotify-Limit** | `fs.inotify.max_user_watches=524288` auf dem Host (TrueNAS Init-Script, da `/etc` teils ephemer); Index-DB auf SSD-Dataset; Erst-Sync im LAN, nicht ZeroTier; Container 2–4 GB RAM. |
| 🟡 | **Pool-Quota / Blast-Radius** | **Quota** auf `tank/Syncthing` — ein voller Pool legt sonst *alle* Stacks (Supabase ×6, Gitea) auf demselben `tank` lahm. |

---

## 8. Offene Entscheidungen für dich

1. **GUI öffentlich (Tunnel) oder nur LAN/ZeroTier?** → Security-Knackpunkt. Empfehlung: erstmal nur LAN/ZeroTier.
2. **NAS Introducer ja/nein?** → Empfehlung: nein (Code-Ausnahme oder manuell aus).
3. **ZeroTier-IP des NAS** konkret prüfen (`ssh truenas 'ip -4 a'`) — die Adress-Whitelist
   (`invite.ts`) erlaubt `10/8`, `172.16/12`, `192.168/16` und nur `100.64–100.127`. Liegt die
   echte ZT-IP außerhalb, lehnt der Code sie als Adress-Hint ab.
4. **Brauchen die Render-Nodes Schreib- oder nur Lesezugriff** auf gesyncte Dateien? → bestimmt `UMASK`.
5. **Welche Ordner überhaupt auf den NAS?** (alle Tags vs nur die wichtigen) — und mit `.stignore` für Unreal-Caches.
6. **Snapshot-Retention** (wie lange zurück?) + **pro Projekt ein Sub-Dataset** (Snapshots/Quotas pro Projekt) oder flacher Baum?
7. **Restore testen.** Ein Backup, das nie zurückgespielt wurde, ist keins — konkreter Restore-Pfad (`zfs rollback` vs Einzeldatei aus `.zfs/snapshot/`) einmal üben.

---

## 9. Nächster konkreter Schritt

Wenn du loslegen willst: ich kann **Phase 1 end-to-end vorbereiten** — Compose + die `chown`/
`zfs create`-Befehle + ein Reconcile-Script (`receiveonly` + `.stignore` + Tuning) + die
Snapshot-Task-Empfehlung. Deploy machst du (oder ich per `ssh -t truenas 'sudo …'`, mit deiner
Freigabe). Sag Bescheid — dann wird aus dem Konzept ein laufender Hub.
