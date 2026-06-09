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
 *   1. Gerät zur Syncthing-Config hinzufügen — introducer:false (kein Mesh,
 *      explizites Pairing).
 *   2. Alle eigenen Ordner EINMALIG mit dem Gerät teilen. „Configure once": ein
 *      angenommenes Gerät bekommt meine Ordner. Bewusste Einmal-Aktion beim Klick,
 *      KEIN Hintergrund-Loop (der war das Überraschungs-Problem aus Sprint #1).
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
    introducer: false,
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
