#!/usr/bin/env bash
# Syncthing-Hub auf TrueNAS — Phase-1-Setup.
# MIT SUDO AUSFUEHREN:   sudo bash setup.sh
# Idempotent: legt nur an was fehlt, ueberschreibt keine Daten.
#
# Netz-Topologie (WICHTIG):
#   Cluster/GUI laufen ueber 192.168.100.100 (Live-Netz, wo Mac + Windows-Render leben).
#   192.168.191.17 ist nur der SSH-/Management-Pfad.
set -euo pipefail

DATASET="tank/Syncthing"
DATA="/mnt/tank/Syncthing"
APPDIR="/mnt/Apps/syncthing"
PUID=3003; PGID=3002
HERE="$(cd "$(dirname "$0")" && pwd)"

echo "== Syncthing-Hub Setup =="
[ "$(id -u)" -eq 0 ] || { echo "FEHLER: bitte mit sudo ausfuehren (sudo bash setup.sh)"; exit 1; }

echo "[1/6] ZFS-Dataset $DATASET ..."
if zfs list "$DATASET" >/dev/null 2>&1; then echo "      existiert schon."; else zfs create "$DATASET"; echo "      angelegt."; fi

echo "[2/6] Verzeichnisse ..."
mkdir -p "$APPDIR/config" "$DATA"

echo "[3/6] Ownership $PUID:$PGID (ndisplay) + setgid ..."
chown -R "$PUID:$PGID" "$APPDIR/config" "$DATA"
chmod 2775 "$DATA"   # setgid: neue Dateien/Ordner erben GID $PGID -> Render-Nodes behalten Zugriff

echo "[4/6] Compose nach $APPDIR kopieren ..."
cp -v "$HERE/docker-compose.yml" "$APPDIR/docker-compose.yml"

echo "[5/6] Container starten ..."
docker compose -f "$APPDIR/docker-compose.yml" up -d

echo "[6/6] Auf Config warten + Device-ID lesen ..."
for i in $(seq 1 30); do
  [ -f "$APPDIR/config/config.xml" ] && break
  sleep 1
done
DEVID="$(grep -oE '<device id="[A-Z0-9-]{63}"' "$APPDIR/config/config.xml" 2>/dev/null | head -1 | grep -oE '[A-Z0-9-]{63}' || true)"

echo
echo "================ FERTIG ================"
echo "GUI (nur im Live-Netz): http://192.168.100.100:8384"
echo "NAS Device-ID: ${DEVID:-<noch nicht bereit — gleich: sudo grep device\\ id $APPDIR/config/config.xml>}"
echo
echo "NAECHSTE SCHRITTE -> README.md:"
echo "  1) GUI oeffnen, Settings -> GUI: Benutzer + Passwort setzen."
echo "  2) NAS mit einem Desktop pairen (Device-ID oben). Statische Adressen am NAS-Device:"
echo "       tcp://192.168.100.100:22000  (Live)   +   tcp://10.35.253.1:22000 (ZeroTier)"
echo "  3) Angebotene Ordner als 'Receive Only' annehmen, Pfad /var/syncthing/data/<Projekt>, .stignore setzen."
echo "  4) TrueNAS-UI: Periodic Snapshot Task auf tank/Syncthing + Quota."
echo "========================================"
