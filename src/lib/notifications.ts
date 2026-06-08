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
  const prevPendingDeviceCountRef = useRef<number | null>(null);
  const prevPendingFolderCountRef = useRef<number | null>(null);
  const prevUpdateKindRef = useRef<UpdateState["kind"] | null>(null);

  const labelFor = (id: DeviceID): string => {
    const dev = devices.find((d) => d.deviceID === id);
    return dev?.name?.trim() || id.slice(0, 7);
  };

  // ── Connections: neuer Peer ist online → "Verbunden mit Mac-Marlon" ──
  useEffect(() => {
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
    if (!enabled) {
      prevConnectedRef.current = nowConnected;
      return;
    }
    for (const id of nowConnected) {
      if (!prev.has(id)) {
        void notify("Syncomat", `${labelFor(id)} ist online`);
      }
    }
    prevConnectedRef.current = nowConnected;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Object.entries(connections).map(([id, c]) => `${id}:${c.connected ? 1 : 0}`).join(","), enabled]);

  // ── Pending-Devices: neuer Code eingelöst → "Neue Verbindungs-Anfrage" ──
  useEffect(() => {
    const count = pendingDevices.length;
    const prev = prevPendingDeviceCountRef.current;
    if (prev === null) {
      prevPendingDeviceCountRef.current = count;
      return;
    }
    if (enabled && count > prev) {
      const latest = pendingDevices[pendingDevices.length - 1];
      const who = latest?.name?.trim() || latest?.deviceID.slice(0, 7) || "unbekannt";
      void notify("Neue Verbindungs-Anfrage", `${who} möchte sich verbinden`);
    }
    prevPendingDeviceCountRef.current = count;
  }, [pendingDevices.length, enabled]);

  // ── Pending-Folders: neuer Ordner verfügbar → "Ordner Foo verfügbar" ──
  useEffect(() => {
    const count = pendingFolders.length;
    const prev = prevPendingFolderCountRef.current;
    if (prev === null) {
      prevPendingFolderCountRef.current = count;
      return;
    }
    if (enabled && count > prev) {
      const latest = pendingFolders[pendingFolders.length - 1];
      // PendingFolder.label liegt in offeredBy[firstPeer].label
      const firstOffered = latest ? Object.values(latest.offeredBy)[0] : undefined;
      const label = firstOffered?.label || latest?.folderID || "Neuer Ordner";
      void notify("Neuer Ordner verfügbar", `„${label}" wartet auf Verknüpfung`);
    }
    prevPendingFolderCountRef.current = count;
  }, [pendingFolders.length, enabled]);

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
