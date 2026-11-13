import {
  putDevice,
  putFolder,
  deletePendingDevice,
  type Endpoint,
  type Folder,
} from "./syncthing";
import { istSystemOrdner } from "./syncthing";
import { isAboFolderId } from "./datenzentrale";

/**
 * Ein Gerät annehmen — die EINE atomare Accept-Funktion (Sprint #6). Genutzt vom
 * Pending-Banner (App.tsx) UND vom Code-Anzeigen-Flow (CodeShowModal), damit beide
 * Wege identisch sind. Macht drei Dinge in fester Reihenfolge:
 *
 *   1. Gerät zur Syncthing-Config hinzufügen — ohne Introducer (seit 13.11.2026;
 *      die übrigen Geräte kommen fest aus geraete.json des Wächters).
 *   2. Die eigenen Ordner mit dem Gerät teilen (einmalig beim Koppeln; ein
 *      automatisches Nachteilen an alle gibt es nicht mehr).
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
    // Kein Introducer mehr (13.11.2026): Geräte kommen fest aus geraete.json.
    introducer: false,
    skipIntroductionRemovals: true,
    autoAcceptFolders: false,
    paused: false,
  });

  // Promise.allSettled: ein einzelner Folder-PUT-Fehler bricht die anderen nicht ab.
  // Abo-Ordner (dz-…) gehören nur den abonnierten Rechnern, der interne Kanal
  // pflegt seine Geräte selbst — beide nie hier an ein neues Gerät teilen.
  await Promise.allSettled(
    folders
      .filter((f) => !isAboFolderId(f.id) && !istSystemOrdner(f.id))
      .map((f) => {
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
