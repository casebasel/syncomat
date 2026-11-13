import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  WAECHTER_FOLDER_ID,
  getFolderStatus,
  patchDevice,
  putDevice,
  putFolder,
  revertFolder,
  type Config,
  type Device,
  type DeviceID,
  type Endpoint,
} from "./syncthing";

// ── Kanal des Speicher-Wächters `syncomat-waechter` ──────────────
//
// Marlon 13.11.2026 („alles der Reihe nach“): Welche Geräte es gibt und unter
// welcher Adresse, steht fest beim Wächter — nicht mehr, was sich Rechner
// gegenseitig vorstellen (Introducer) oder was syncomat aus Verbindungen
// lernt. Der Wächter schreibt am Hub (sendonly) `geraete.json` und später
// `inhalt/<folder_id>.json`; jeder Rechner führt den Ordner receiveonly im
// App-Datenordner und liest nur. Was dort lokal auftaucht, wird zurückgesetzt
// — es gilt immer der Stand des Wächters (BESITZ: Ordner gehört dem Wächter).

export type GeraetEintrag = {
  id: DeviceID;
  name: string;
  rolle?: "arbeitsplatz" | "render" | "node" | "nas";
  adressen: string[];
  /** Kommt auch von ausserhalb des Studios (Mac): zusätzlich „dynamic“. */
  unterwegs?: boolean;
  /** Nur damit wird ein Gerät entfernt — ein fehlendes bleibt. */
  entfernt?: boolean;
};
export type GeraeteListe = { schema: 1; geschrieben: string; geraete: GeraetEintrag[] };

const TAKT_MS = 60_000;

function liesListe(raw: string | null): GeraeteListe | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as GeraeteListe;
    if (d?.schema !== 1 || !Array.isArray(d.geraete)) return null;
    const ok = d.geraete.filter(
      (g) =>
        typeof g?.id === "string" &&
        /^[A-Z0-9]{7}(-[A-Z0-9]{7}){7}$/.test(g.id) &&
        typeof g.name === "string" &&
        Array.isArray(g.adressen) &&
        g.adressen.every((a) => typeof a === "string" && /^(tcp|quic):\/\/[\w.[\]:-]+$/.test(a)),
    );
    return { ...d, geraete: ok };
  } catch {
    return null;
  }
}

/** Soll-Adressen eines Geräts: im Studio genau die Liste, sonst (oder wenn
 * das Gerät „unterwegs“ ist oder keine feste Adresse hat) zusätzlich dynamic. */
export function sollAdressen(g: GeraetEintrag, imStudio: boolean): string[] {
  const fest = [...new Set(g.adressen)];
  return imStudio && !g.unterwegs && fest.length > 0 ? fest : [...fest, "dynamic"];
}

/**
 * Legt den Kanal an (receiveonly, geteilt mit dem Hub), liest geraete.json
 * und setzt Geräte und Adressen danach. Liefert die Liste (oder null, solange
 * es keine gibt — dann bleibt alles, wie es ist).
 */
export function useWaechterKanal({
  ep,
  ready,
  config,
  myID,
  hubIds,
  imStudio,
}: {
  ep: Endpoint | null;
  ready: boolean;
  config: Config | null;
  myID: DeviceID | null;
  /** Geräte ohne syncomat (der NAS-Hub). */
  hubIds: Set<DeviceID>;
  imStudio: boolean;
}): GeraeteListe | null {
  const [liste, setListe] = useState<GeraeteListe | null>(null);
  const stand = useRef({ config, imStudio, hubIds });
  stand.current = { config, imStudio, hubIds };
  const busy = useRef(false);

  useEffect(() => {
    if (!ep || !ready || !myID) return;
    let cancelled = false;
    const takt = async () => {
      const { config, imStudio, hubIds } = stand.current;
      if (busy.current || !config) return;
      busy.current = true;
      try {
        // 1) Ordner anlegen bzw. mit dem Hub teilen.
        const hubs = [...hubIds].filter((id) => config.devices.some((d) => d.deviceID === id));
        const vorhanden = config.folders.find((f) => f.id === WAECHTER_FOLDER_ID);
        if (!vorhanden && hubs.length > 0) {
          const path = await invoke<string>("waechter_folder_path");
          await putFolder(ep, {
            id: WAECHTER_FOLDER_ID,
            label: "syncomat-waechter",
            path,
            type: "receiveonly",
            paused: false,
            devices: [{ deviceID: myID }, ...hubs.map((deviceID) => ({ deviceID }))],
            ignorePerms: true,
            fsWatcherEnabled: true,
            fsWatcherDelayS: 2,
            rescanIntervalS: 300,
            maxConflicts: 0,
          });
        } else if (vorhanden) {
          const fehlt = hubs.filter((id) => !vorhanden.devices.some((d) => d.deviceID === id));
          if (fehlt.length > 0 || vorhanden.type !== "receiveonly") {
            await putFolder(ep, {
              ...vorhanden,
              type: "receiveonly",
              devices: [...vorhanden.devices, ...fehlt.map((deviceID) => ({ deviceID }))],
            });
          }
          // Lokal Hineingelegtes/Geändertes verwerfen — es gilt der Stand des Wächters.
          const s = await getFolderStatus(ep, WAECHTER_FOLDER_ID).catch(() => null);
          if (s && s.state === "idle" && (s.receiveOnlyTotalItems ?? 0) > 0) await revertFolder(ep, WAECHTER_FOLDER_ID).catch(() => {});
        }

        // 2) geraete.json lesen.
        const l = liesListe(await invoke<string | null>("waechter_lesen", { rel: "geraete.json" }).catch(() => null));
        if (cancelled) return;
        setListe(l);
        if (!l) return;

        // 3) Geräte eintragen / Adressen setzen / ausdrücklich entfernte nehmen.
        for (const g of l.geraete) {
          if (g.id === myID) continue;
          const d = config.devices.find((x) => x.deviceID === g.id);
          if (g.entfernt) {
            // Bewusst nicht automatisch löschen, bis es einen echten Fall gibt:
            // nur pausieren, damit nichts mehr fliesst (rückgängig machbar).
            if (d && !d.paused) await patchDevice(ep, g.id, { paused: true }).catch(() => {});
            continue;
          }
          const soll = sollAdressen(g, imStudio);
          if (!d) {
            const neu: Device = {
              deviceID: g.id,
              name: g.name,
              addresses: soll,
              introducer: false,
              skipIntroductionRemovals: true,
              autoAcceptFolders: false,
              paused: false,
            };
            await putDevice(ep, neu).catch((e) => console.warn("[waechter] Gerät eintragen", g.id.slice(0, 7), e));
            continue;
          }
          const patch: Partial<Device> = {};
          if (JSON.stringify(d.addresses) !== JSON.stringify(soll)) patch.addresses = soll;
          if (d.introducer) patch.introducer = false;
          if (d.skipIntroductionRemovals !== true) patch.skipIntroductionRemovals = true;
          if (!d.name?.trim() && g.name) patch.name = g.name;
          if (Object.keys(patch).length > 0) await patchDevice(ep, g.id, patch).catch(() => {});
        }
      } catch (e) {
        console.warn("[waechter] Kanal", e);
      } finally {
        busy.current = false;
      }
    };
    const erst = setTimeout(() => void takt(), 8_000);
    const t = setInterval(() => void takt(), TAKT_MS);
    return () => {
      cancelled = true;
      clearTimeout(erst);
      clearInterval(t);
    };
  }, [ep?.url, ready, myID]);

  return liste;
}
