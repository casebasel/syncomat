import { useEffect, useRef, useState } from "react";
import {
  patchDevice,
  type Connection,
  type Device,
  type DeviceID,
  type Endpoint,
} from "./syncthing";

// ── Netzwerk-Pfad-Erkennung + 10GbE-Bevorzugung ──────────────────
//
// Hintergrund (siehe Netz-Audit in ROADMAP.md): Syncthing klassifiziert sowohl
// das schnelle 10GbE-LAN (192.168.100.x) als auch ZeroTier (192.168.191.x) als
// "tcp-lan" und nimmt die Verbindung, die ZUERST steht — kein Bevorzugen mit
// Fallback eingebaut. Wir helfen "weich" nach: die schnelle Adresse pro Gerät
// merken + als statische Adresse fest hinterlegen (zusätzlich zu "dynamic").
// Sie wird dann immer mitversucht und gewinnt im schnellen LAN meist das
// Connect-Rennen (niedrige Latenz), ZeroTier bleibt als Fallback erhalten.
//
// WICHTIG (Datensicherheit): wir fassen NUR Adressen an, die wir selbst gesetzt
// haben (in `pinnedByUs` getrackt). Manuell eingetragene Adressen bleiben immer
// unberührt — auch beim Abschalten.

const FAST_SUBNET_LS = "syncomat.network.fastSubnet";
const PREFER_LS = "syncomat.network.prefer10gbe";
const LEARNED_LS = "syncomat.network.fastAddrs"; // deviceID -> "tcp://192.168.100.x:22000"
const PINNED_LS = "syncomat.network.pinnedByUs"; // deviceID -> die von UNS gesetzte Adresse

/** Default: Marlons 10GbE-Subnetz. Über die Einstellungen änderbar. */
export const DEFAULT_FAST_SUBNET = "192.168.100.";

export function getFastSubnet(): string {
  return localStorage.getItem(FAST_SUBNET_LS) || DEFAULT_FAST_SUBNET;
}

export type NetPath = "fast" | "slow" | "none";

/** Adresse vom Schema befreien ("tcp://1.2.3.4:22000" -> "1.2.3.4:22000"). */
function bare(address: string): string {
  return address.replace(/^\w+:\/\//, "");
}

/** Liegt die Adresse im schnellen Subnetz? */
function inFastSubnet(address: string, fastSubnet: string): boolean {
  return bare(address).startsWith(fastSubnet);
}

/**
 * Klassifiziert die aktive Verbindungs-Adresse:
 * - "fast"  → im schnellen Subnetz (10GbE)
 * - "slow"  → verbunden, aber über einen anderen Pfad (ZeroTier/Relais/WAN)
 * - "none"  → nicht verbunden
 */
export function classifyPath(
  address: string | undefined | null,
  fastSubnet = getFastSubnet(),
): NetPath {
  if (!address) return "none";
  return inFastSubnet(address, fastSubnet) ? "fast" : "slow";
}

/** Bytes/s menschenlesbar — für die Speed-Anzeige in der Statusbar. */
export function fmtSpeed(bps: number): string {
  if (bps < 1024) return `${Math.max(0, Math.round(bps))} B/s`;
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(0)} KB/s`;
  if (bps < 1024 * 1024 * 1024) return `${(bps / (1024 * 1024)).toFixed(1)} MB/s`;
  return `${(bps / (1024 * 1024 * 1024)).toFixed(2)} GB/s`;
}

// ── Settings-Hooks (localStorage-persistiert) ────────────────────

/** Toggle "10GbE bevorzugen". Default AUS — bewusst opt-in, weil es die
 * Geräte-Adressen in Syncthings Config anfasst. */
export function usePrefer10GbE() {
  const [enabled, setEnabledState] = useState<boolean>(
    () => localStorage.getItem(PREFER_LS) === "1",
  );
  const setEnabled = (v: boolean) => {
    setEnabledState(v);
    localStorage.setItem(PREFER_LS, v ? "1" : "0");
  };
  return { enabled, setEnabled };
}

/** Das als "schnell" geltende Subnetz (Präfix), z.B. "192.168.100.". */
export function useFastSubnet() {
  const [subnet, setSubnetState] = useState<string>(getFastSubnet);
  const setSubnet = (v: string) => {
    const t = v.trim();
    setSubnetState(t);
    localStorage.setItem(FAST_SUBNET_LS, t);
  };
  return { subnet, setSubnet };
}

// ── localStorage-Maps ────────────────────────────────────────────

function loadMap(key: string): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(key) || "{}") as Record<string, string>;
  } catch {
    return {};
  }
}
function saveMap(key: string, m: Record<string, string>) {
  try {
    localStorage.setItem(key, JSON.stringify(m));
  } catch (e) {
    console.warn(`[network] persist ${key} failed`, e);
  }
}

/** Gelernte schnelle Adressen (deviceID → "tcp://…") für die UI. */
export function getLearnedFastAddrs(): Record<string, string> {
  return loadMap(LEARNED_LS);
}

/** addresses[] mit fester schneller Adresse VORNE — fügt nur HINZU, entfernt
 * nie etwas Bestehendes (manuelle Adressen bleiben). "dynamic" als Fallback. */
function withFastPinned(current: string[], fast: string): string[] {
  if (current.includes(fast)) return current;
  const next = [fast, ...current.filter((a) => a !== fast)];
  if (!next.includes("dynamic")) next.push("dynamic");
  return next;
}

/**
 * Lernt laufend die schnelle Adresse jedes Geräts (sobald es mal über das
 * schnelle Subnetz verbunden ist) und — wenn `enabled` — hinterlegt sie fest in
 * der Syncthing-Geräte-Config. Bei `enabled=false` wird NUR der von uns
 * gesetzte Pin wieder entfernt (manuelle Adressen bleiben immer unberührt).
 * Idempotent: schreibt nur bei echter Änderung, `appliedRef` verhindert Churn.
 */
export function usePrefer10GbE_apply(
  ep: Endpoint | null,
  ready: boolean,
  connections: Record<DeviceID, Connection>,
  devices: Device[],
  enabled: boolean,
  fastSubnet: string,
): void {
  const appliedRef = useRef<Record<DeviceID, string>>({});

  // Stabiler Key: nur neu laufen wenn sich verbundene Adressen oder
  // Geräte-Adressen wirklich ändern (nicht bei jedem Render).
  const connKey = Object.entries(connections)
    .filter(([, c]) => c.connected && c.address)
    .map(([id, c]) => `${id}@${bare(c.address)}`)
    .sort()
    .join(",");
  const devKey = devices
    .map((d) => `${d.deviceID}:${d.addresses.join("|")}`)
    .sort()
    .join(",");

  useEffect(() => {
    if (!ep || !ready) return;
    let cancelled = false;

    // 1. Lernen — schnelle Adressen merken (immer, auch disabled; für die UI).
    const learned = loadMap(LEARNED_LS);
    let learnedChanged = false;
    for (const [id, c] of Object.entries(connections)) {
      if (c.connected && c.address && inFastSubnet(c.address, fastSubnet)) {
        const addr = `tcp://${bare(c.address)}`;
        if (learned[id] !== addr) {
          learned[id] = addr;
          learnedChanged = true;
        }
      }
    }
    if (learnedChanged) saveMap(LEARNED_LS, learned);

    // 2. Anwenden — NUR unsere eigenen Pins (pinnedByUs) anfassen.
    (async () => {
      const pinned = loadMap(PINNED_LS);
      let pinnedChanged = false;

      for (const dev of devices) {
        if (cancelled) return;
        const id = dev.deviceID;

        if (enabled) {
          const fast = learned[id];
          if (!fast) continue; // noch keine schnelle Adresse gesehen
          if (dev.addresses.includes(fast)) {
            if (pinned[id] !== fast) {
              pinned[id] = fast; // existierenden Pin als unseren adoptieren
              pinnedChanged = true;
            }
            continue;
          }
          const next = withFastPinned(dev.addresses, fast);
          const nextStr = JSON.stringify(next);
          if (appliedRef.current[id] === nextStr) continue;
          try {
            await patchDevice(ep, id, { addresses: next });
            appliedRef.current[id] = nextStr;
            pinned[id] = fast;
            pinnedChanged = true;
          } catch (e) {
            console.warn(`[network] pin ${id} failed`, e);
          }
        } else {
          // Disabled: nur die von UNS gesetzte Adresse wieder rausnehmen.
          const ourAddr = pinned[id];
          if (!ourAddr) continue;
          if (dev.addresses.includes(ourAddr)) {
            const rest = dev.addresses.filter((a) => a !== ourAddr);
            if (!rest.includes("dynamic")) rest.push("dynamic");
            const nextStr = JSON.stringify(rest);
            if (appliedRef.current[id] !== nextStr) {
              try {
                await patchDevice(ep, id, { addresses: rest });
                appliedRef.current[id] = nextStr;
              } catch (e) {
                console.warn(`[network] unpin ${id} failed`, e);
              }
            }
          }
          delete pinned[id];
          pinnedChanged = true;
        }
      }

      if (pinnedChanged) saveMap(PINNED_LS, pinned);
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ep?.url, ep?.api_key, ready, enabled, fastSubnet, connKey, devKey]);
}
