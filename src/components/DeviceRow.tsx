import type { Connection, Device, DeviceID } from "../lib/syncthing";
import { DevicePill } from "./DevicePill";

export function DeviceRow({
  devices,
  connections,
  myID,
}: {
  devices: Device[];
  connections: Record<DeviceID, Connection>;
  myID: DeviceID | null;
}) {
  const peers = devices.filter((d) => d.deviceID !== myID);

  if (peers.length === 0) {
    return (
      <p className="text-xs text-neutral-500 dark:text-neutral-500">
        Noch keine Geräte verbunden.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-2">
      {peers.map((d) => (
        <DevicePill
          key={d.deviceID}
          name={d.name || d.deviceID.slice(0, 7)}
          connected={!!connections[d.deviceID]?.connected}
        />
      ))}
    </div>
  );
}
