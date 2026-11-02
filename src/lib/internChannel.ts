import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef } from "react";
import {
  INTERN_FOLDER_ID,
  putFolder,
  type DeviceID,
  type Endpoint,
  type Folder,
  type Config,
} from "./syncthing";

// ── Interner Kanal `syncomat-intern` ─────────────────────────────
//
// Ein kleiner Syncthing-Ordner im App-Datenordner, den jedes syncomat-Gerät
// mit derselben Folder-ID anlegt und mit allen Geräten teilt. Weil beide
// Seiten ihn schon kennen, verbinden sie sich ohne Angebot/Annehmen. Darüber
// reisen Versionen („Alle Geräte aktualisieren") und später weitere
// Steuerinfos — unabhängig davon, welche Nutzer-Ordner ein Gerät abonniert hat.
// Bis v0.9.16 liefen die Versionen über die Marketplace-Ordner; ein Gerät
// ohne Abo (MacBook) sah nichts.
//
// Geräte ohne syncomat (der NAS-Hub, vanilla Syncthing) bekommen den Ordner
// nur angeboten und ignorieren ihn.

/** Legt den internen Ordner an und hält seine Geräteliste auf „alle Peers". */
export function useInternFolder(
  ep: Endpoint | null,
  ready: boolean,
  config: Config | null,
  myID: DeviceID | null,
): Folder | null {
  const intern = config?.folders.find((f) => f.id === INTERN_FOLDER_ID) ?? null;
  const busyRef = useRef(false);
  const peerKey = (config?.devices ?? [])
    .map((d) => d.deviceID)
    .filter((id) => id !== myID)
    .sort()
    .join(",");
  const sharedKey = intern ? intern.devices.map((d) => d.deviceID).sort().join(",") : "";

  useEffect(() => {
    if (!ep || !ready || !config || !myID || busyRef.current) return;
    const peers = config.devices.map((d) => d.deviceID).filter((id) => id !== myID);
    const missing = intern ? peers.filter((id) => !intern.devices.some((d) => d.deviceID === id)) : peers;
    if (intern && missing.length === 0) return;
    busyRef.current = true;
    (async () => {
      try {
        if (intern) {
          await putFolder(ep, {
            ...intern,
            devices: [...intern.devices, ...missing.map((deviceID) => ({ deviceID }))],
          });
          return;
        }
        const path = await invoke<string>("intern_folder_path");
        await putFolder(ep, {
          id: INTERN_FOLDER_ID,
          label: "syncomat-intern",
          path,
          type: "sendreceive",
          paused: false,
          devices: [{ deviceID: myID }, ...peers.map((deviceID) => ({ deviceID }))],
          ignorePerms: true,
          fsWatcherEnabled: true,
          fsWatcherDelayS: 2,
          rescanIntervalS: 300,
          // Eine Datei pro Gerät — echte Konflikte gibt es hier nicht.
          maxConflicts: 0,
        });
        console.log("[intern] Ordner syncomat-intern angelegt:", path);
      } catch (e) {
        console.warn("[intern] anlegen/teilen fehlgeschlagen", e);
      } finally {
        busyRef.current = false;
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ep?.url, ep?.api_key, ready, myID, peerKey, sharedKey, !!intern]);

  return intern;
}
