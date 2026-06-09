#!/usr/bin/env bash
# Syncthing-Hub auf TrueNAS — Phase-1-Setup.
# MIT SUDO AUSFUEHREN:   sudo bash setup.sh
# Idempotent: legt nur an was fehlt, ueberschreibt keine Daten.
#
# Netz-Topologie (WICHTIG):
#   Cluster/GUI laufen ueber 192.168.100.100 (Live-Netz, wo Mac + Windows-Render leben).
#   192.168.191.17 ist nur der SSH-/Management-Pfad.
set -euo pipefail
# PATH haerten: zfs/docker liegen in /sbin + /usr/sbin — unter restriktivem
# sudo secure_path sonst evtl. nicht gefunden.
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:${PATH:-}"

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

echo "[6/6] Auf Config warten, Device-ID + API-Key lesen, GUI-Passwort setzen ..."
for i in $(seq 1 30); do
  [ -f "$APPDIR/config/config.xml" ] && break
  sleep 1
done
DEVID="$(grep -oE '<device id="[A-Z0-9-]{63}"' "$APPDIR/config/config.xml" 2>/dev/null | head -1 | grep -oE '[A-Z0-9-]{63}' || true)"
APIKEY="$(grep -oE '<apikey>[^<]+</apikey>' "$APPDIR/config/config.xml" 2>/dev/null | sed -E 's#</?apikey>##g' | head -1 || true)"

# GUI-Passwort setzen (best-effort), damit die GUI nicht auth-los offen ist (auch
# nicht im Live-Netz/ZeroTier). Schlaegt es fehl -> manuell in der GUI setzen.
GUIPW=""
if [ -n "$APIKEY" ]; then
  sleep 2
  GUIPW="$(openssl rand -base64 12 2>/dev/null || head -c 12 /dev/urandom | base64)"
  curl -fsS -X PATCH "http://localhost:8384/rest/config/gui" \
    -H "X-API-Key: $APIKEY" -H "Content-Type: application/json" \
    -d "{\"user\":\"admin\",\"password\":\"$GUIPW\"}" >/dev/null 2>&1 || GUIPW="(automatisch fehlgeschlagen -> in der GUI setzen)"
fi

# Listen-Adressen NAS-seitig auf die zwei ECHTEN Cluster-Pfade beschraenken (best-effort):
#   192.168.100.100 = Live-Netz, 192.168.191.17 = ZeroTier. Default waere 'default' (= 0.0.0.0) —
#   dann announced der host-mode-Container ALLE ~13 Docker-Bridges + IPv6-ULAs und die Desktops
#   flappen zwischen toten Adressen. Diese Whitelist loest das NAS-seitig, sodass die Geraete-
#   Adressen ueberall schlicht 'dynamic' bleiben koennen (Syncomat-Default, kein Pro-Geraet-Static).
#   Analog zum GUI-Passwort-PATCH oben. Schlaegt es fehl -> GUI: Settings > Connections.
LADDR=""
if [ -n "$APIKEY" ]; then
  curl -fsS -X PATCH "http://localhost:8384/rest/config/options" \
    -H "X-API-Key: $APIKEY" -H "Content-Type: application/json" \
    -d '{"listenAddresses":["tcp://192.168.100.100:22000","quic://192.168.100.100:22000","tcp://192.168.191.17:22000","quic://192.168.191.17:22000","dynamic"]}' \
    >/dev/null 2>&1 && LADDR="gesetzt: 100.100 (Live) + 192.168.191.17 (ZeroTier)" \
    || LADDR="(automatisch fehlgeschlagen -> GUI: Settings > Connections)"
fi

echo
echo "================ FERTIG ================"
echo "GUI:  http://192.168.100.100:8384  (lokal)   |   http://192.168.191.17:8384  (ZeroTier, fuer den Mac remote)"
echo "GUI-Login:    admin / ${GUIPW:-<in der GUI setzen>}"
echo "Listen-Adr.:  ${LADDR:-<in der GUI: Settings > Connections>}"
echo "NAS Device-ID: ${DEVID:-<gleich: sudo grep 'device id' $APPDIR/config/config.xml>}"
echo "API-Key (fuer Syncomat -> Server-Node):  ${APIKEY:-<gleich: sudo grep apikey $APPDIR/config/config.xml>}"
echo
echo "NAECHSTE SCHRITTE -> README.md:"
echo "  1) NAS mit einem Desktop pairen (Device-ID oben). Geraete-Adressen = 'dynamic' lassen (Default) —"
echo "     KEINE Pro-Geraet-Statics. Listen-Adressen sind oben schon NAS-seitig beschraenkt (s. 'Listen-Adr.')."
echo "  2) Angebotene Ordner als 'Receive Only' annehmen, Pfad /var/syncthing/data/<Projekt>, .stignore."
echo "     ODER bequem aus Syncomat: GERAETE -> Server-Icon -> NAS mit URL + API-Key oben verbinden."
echo "  3) TrueNAS-UI: Periodic Snapshot Task auf tank/Syncthing + Quota."
echo "========================================"
