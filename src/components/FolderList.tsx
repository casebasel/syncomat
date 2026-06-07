import type {
  Connection,
  Device,
  DeviceID,
  Endpoint,
  Folder,
  PendingFolder,
} from "../lib/syncthing";
import { LinkedFolderCard, PendingFolderCard } from "./FolderCard";

export function FolderList({
  linked,
  pending,
  endpoint,
  ready,
  devices,
  connections,
  myID,
  onLink,
  onPauseToggle,
  onRename,
}: {
  linked: Folder[];
  pending: PendingFolder[];
  endpoint: Endpoint | null;
  ready: boolean;
  devices: Device[];
  connections: Record<DeviceID, Connection>;
  myID: DeviceID | null;
  onLink: (pf: PendingFolder) => void;
  onPauseToggle: (f: Folder) => void;
  onRename: (f: Folder, newLabel: string) => void;
}) {
  const all = linked.length + pending.length;

  if (all === 0) {
    return (
      <p className="text-xs text-neutral-500 dark:text-neutral-500">
        Noch keine Ordner. Verknüpfe einen, sobald ein Gerät welche anbietet.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {linked.map((f) => (
        <LinkedFolderCard
          key={f.id}
          folder={f}
          endpoint={endpoint}
          ready={ready}
          devices={devices}
          connections={connections}
          myID={myID}
          onPauseToggle={onPauseToggle}
          onRename={onRename}
        />
      ))}
      {pending.map((pf) => (
        <PendingFolderCard
          key={pf.folderID}
          pending={pf}
          devices={devices}
          onLink={onLink}
        />
      ))}
    </div>
  );
}
