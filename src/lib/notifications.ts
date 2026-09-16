import { useEffect, useRef, useState } from "react";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import type { Connection, DeviceID, Device, PendingDevice, PendingFolder } from "./syncthing";
import type { UpdateState } from "./updater";

const LS_KEY = "syncomat.notifications.enabled";

/**
 * User-Setting "Benachrichtigungen aktiviert" persistiert in localStorage.
 * Default = true (opt-out, weil das Ganze ja eine Tray-App ist die im
 * Hintergrund läuft — ohne Notifications merkst du nicht wenn Peers online
 * gehen).
 */
export function useNotificationsEnabled() {
  const [enabled, setEnabledState] = useState<boolean>(() => {
    const raw = localStorage.getItem(LS_KEY);
    return raw === null ? true : raw === "1";
  });
  const setEnabled = (v: boolean) => {
    setEnabledState(v);
    localStorage.setItem(LS_KEY, v ? "1" : "0");
  };
  return { enabled, setEnabled };
}

async function notify(title: string, body: string): Promise<void> {
  try {
    let granted = await isPermissionGranted();
    if (!granted) {
      const perm = await requestPermission();
      granted = perm === "granted";
    }
    if (granted) {
      await sendNotification({ title, body });
    }
  } catch (e) {
    console.warn("[notifications] send failed", e);
  }
}

/**
 * Triggert OS-Notifications bei relevanten Events.
 * Vergleicht aktuellen State mit prev-State, ignoriert First-Mount damit
 * beim App-Start nicht ein Schwall von "X verbunden"-Notifications fliegt.
 */
export function useNotificationTriggers({
  enabled,
  connections,
  devices,
  pendingDevices,
  pendingFolders,
  updateState,
}: {
  enabled: boolean;
  connections: Record<DeviceID, Connection>;
  devices: Device[];
  pendingDevices: PendingDevice[];
  pendingFolders: PendingFolder[];
  updateState: UpdateState;
}) {
  const prevConnectedRef = useRef<Set<DeviceID> | null>(null);
  /** Wann ein Gerät offline ging — Reconnects nach kurzem Flackern (IPv6↔IPv4-
   * Re-Dial, 10GbE-Pin, WLAN-Wackler) sollen NICHT jedes Mal melden. */
  const offlineSinceRef = useRef<Map<DeviceID, number>>(new Map());
  const mountedAtRef = useRef<number>(Date.now());
  /** Bereits gemeldete Anfragen/Angebote — pro ID, nicht pro Zähler: ein
   * wiederangebotener Ordner (Auto-Share) darf nicht x-mal "neu" heissen. */
  const seenPendingDevicesRef = useRef<Set<DeviceID> | null>(null);
  const seenPendingFoldersRef = useRef<Set<string> | null>(null);
  const prevUpdateKindRef = useRef<UpdateState["kind"] | null>(null);

  // Nach dem Start trudeln die Geräte über 10–60 s ein — das ist kein Ereignis.
  const STARTUP_GRACE_MS = 90_000;
  // Ein Gerät gilt erst nach so langer Abwesenheit wieder als "neu online".
  const MIN_OFFLINE_MS = 60_000;

  const labelFor = (id: DeviceID): string => {
    const dev = devices.find((d) => d.deviceID === id);
    return dev?.name?.trim() || id.slice(0, 7);
  };

  // ── Connections: Peer ist (nach echter Abwesenheit) wieder online ──
  useEffect(() => {
    const now = Date.now();
    const nowConnected = new Set<DeviceID>(
      Object.entries(connections)
        .filter(([, c]) => c.connected)
        .map(([id]) => id as DeviceID),
    );
    const prev = prevConnectedRef.current;
    if (prev === null) {
      prevConnectedRef.current = nowConnected;
      return; // First mount: nicht notifien
    }
    const offlineSince = offlineSinceRef.current;
    for (const id of prev) {
      if (!nowConnected.has(id) && !offlineSince.has(id)) offlineSince.set(id, now);
    }
    const inGrace = now - mountedAtRef.current < STARTUP_GRACE_MS;
    for (const id of nowConnected) {
      if (prev.has(id)) continue;
      const since = offlineSince.get(id);
      offlineSince.delete(id);
      if (!enabled || inGrace) continue;
      // Unbekannte Abwesenheit (offline seit vor unserem Tracking) zählt als lang.
      if (since !== undefined && now - since < MIN_OFFLINE_MS) continue;
      void notify("Syncomat", `${labelFor(id)} ist online`);
    }
    prevConnectedRef.current = nowConnected;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Object.entries(connections).map(([id, c]) => `${id}:${c.connected ? 1 : 0}`).join(","), enabled]);

  // ── Pending-Devices: neue Verbindungs-Anfrage (einmal pro Gerät) ──
  useEffect(() => {
    const ids = pendingDevices.map((d) => d.deviceID);
    const seen = seenPendingDevicesRef.current;
    if (seen === null) {
      seenPendingDevicesRef.current = new Set(ids);
      return;
    }
    for (const pd of pendingDevices) {
      if (seen.has(pd.deviceID)) continue;
      seen.add(pd.deviceID);
      if (!enabled) continue;
      const who = pd.name?.trim() || pd.deviceID.slice(0, 7) || "unbekannt";
      void notify("Neue Verbindungs-Anfrage", `${who} möchte sich verbinden`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingDevices.map((d) => d.deviceID).join(","), enabled]);

  // ── Pending-Folders: neuer Ordner verfügbar (einmal pro Ordner-ID) ──
  useEffect(() => {
    const seen = seenPendingFoldersRef.current;
    if (seen === null) {
      seenPendingFoldersRef.current = new Set(pendingFolders.map((p) => p.folderID));
      return;
    }
    for (const pf of pendingFolders) {
      if (seen.has(pf.folderID)) continue;
      seen.add(pf.folderID);
      if (!enabled) continue;
      // PendingFolder.label liegt in offeredBy[firstPeer].label
      const firstOffered = Object.values(pf.offeredBy)[0];
      const label = firstOffered?.label || pf.folderID || "Neuer Ordner";
      void notify("Neuer Ordner verfügbar", `„${label}" wartet auf Verknüpfung`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingFolders.map((p) => p.folderID).join(","), enabled]);

  // ── Updater state change → "Update v0.1.x verfügbar" ──
  useEffect(() => {
    const kind = updateState.kind;
    const prev = prevUpdateKindRef.current;
    if (prev === null) {
      prevUpdateKindRef.current = kind;
      return;
    }
    if (enabled && kind === "available" && prev !== "available") {
      const version =
        updateState.kind === "available" ? updateState.update.version : "?";
      void notify("Update verfügbar", `Syncomat v${version} kann installiert werden`);
    }
    prevUpdateKindRef.current = kind;
  }, [updateState.kind, enabled, updateState]);
}
