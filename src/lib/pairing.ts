import {
  putDevice,
  putFolder,
  deletePendingDevice,
  type Endpoint,
  type Folder,
} from "./syncthing";

/**
 * Ein Gerät annehmen — die EINE atomare Accept-Funktion (Sprint #6). Genutzt vom
 * Pending-Banner (App.tsx) UND vom Code-Anzeigen-Flow (CodeShowModal), damit beide
 * Wege identisch sind. Macht drei Dinge in fester Reihenfolge:
 *
 *   1. Gerät zur Syncthing-Config hinzufügen — introducer:true: es stellt seine
 *      Peers vor, sodass ein neu gekoppeltes Gerät den GANZEN Cluster bekommt.
 *   2. Alle eigenen Ordner sofort mit dem Gerät teilen. Die Auto-Share-
 *      Reconciliation (App.tsx) hält das danach clusterweit aktuell — Marlons
 *      Modell „ein Gerät koppeln → alles im Umlauf bekommen".
 *   3. Pending-Eintrag wegräumen, damit das Banner nicht nachhallt.
 */
export async function acceptDevice(
  ep: Endpoint,
  pd: { deviceID: string; name?: string | null },
  folders: Folder[],
): Promise<void> {
  await putDevice(ep, {
    deviceID: pd.deviceID,
    name: pd.name || pd.deviceID.slice(0, 7),
    addresses: ["dynamic"],
    introducer: true,
    autoAcceptFolders: false,
    paused: false,
  });

  // Promise.allSettled: ein einzelner Folder-PUT-Fehler bricht die anderen nicht ab.
  await Promise.allSettled(
    folders.map((f) => {
      if (f.devices.some((d) => d.deviceID === pd.deviceID)) {
        return Promise.resolve();
      }
      return putFolder(ep, {
        ...f,
        devices: [...f.devices, { deviceID: pd.deviceID }],
      });
    }),
  );

  await deletePendingDevice(ep, pd.deviceID).catch(() => {});
}
