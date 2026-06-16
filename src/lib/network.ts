import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  patchDevice,
  type Connection,
  type Device,
  type DeviceID,
  type Endpoint,
} from "./syncthing";

// ── Netzwerk-Pfad-Erkennung + clusterweite 10GbE-Bevorzugung ─────
//
// Syncthing klassifiziert 10GbE-LAN (192.168.100.x) UND ZeroTier (192.168.191.x)
// beide als "tcp-lan" und nimmt die Verbindung, die zuerst steht. Wir helfen
// "weich" nach: schnelle Adresse pro Gerät merken + fest hinterlegen.
//
// NEU (v0.9.8): Die gemerkten Adressen werden cluster-weit GESYNCT — jeder Node
// schreibt seine bekannten schnellen Adressen in `.syncomat/net-hints/<id>.json`
// (Syncthing propagiert das), liest alle Peer-Dateien + merged. So kennt jeder
// Node die 10GbE-Adresse JEDES Geräts, auch ohne es je selbst dort gesehen zu
// haben. Plus: manuelle Eingabe für Geräte, die kein Node je auf 10GbE sah (NAS).

const FAST_SUBNET_LS = "syncomat.network.fastSubnet";
const PREFER_LS = "syncomat.network.prefer10gbe";
const LEARNED_LS = "syncomat.network.fastAddrs"; // sticky: selbst beobachtete
const MANUAL_LS = "syncomat.network.manualAddrs"; // vom User eingetragen
const PINNED_LS = "syncomat.network.pinnedByUs"; // von UNS gesetzte Adressen

export const DEFAULT_FAST_SUBNET = "192.168.100.";

export function getFastSubnet(): string {
  return localStorage.getItem(FAST_SUBNET_LS) || DEFAULT_FAST_SUBNET;
}

export type NetPath = "fast" | "local" | "slow" | "none";

function bare(address: string): string {
  return address.replace(/^\w+:\/\//, "");
}
function inFastSubnet(address: string, fastSubnet: string): boolean {
  return bare(address).startsWith(fastSubnet);
}
/** IPv6 Link-Local (fe80::…) = lokales Netz (evtl. sogar 10GbE über IPv6).
 * NICHT mit ZeroTier in einen Topf werfen. */
function isLinkLocal(address: string): boolean {
  const a = bare(address).toLowerCase();
  return a.startsWith("[fe80:") || a.startsWith("fe80:");
}

/**
 * - "fast"  → schnelles Subnetz (10GbE)
 * - "local" → IPv6-Link-Local: lokal, aber Interface unbekannt (evtl. 10GbE)
 * - "slow"  → anderer Pfad (ZeroTier / Relais / WAN)
 * - "none"  → nicht verbunden
 */
export function classifyPath(
  address: string | undefined | null,
  fastSubnet = getFastSubnet(),
): NetPath {
  if (!address) return "none";
  if (inFastSubnet(address, fastSubnet)) return "fast";
  if (isLinkLocal(address)) return "local";
  return "slow";
}

/** Bytes/s menschenlesbar — für die Speed-Anzeige in der Statusbar. */
export function fmtSpeed(bps: number): string {
  if (bps < 1024) return `${Math.max(0, Math.round(bps))} B/s`;
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(0)} KB/s`;
  if (bps < 1024 * 1024 * 1024) return `${(bps / (1024 * 1024)).toFixed(1)} MB/s`;
  return `${(bps / (1024 * 1024 * 1024)).toFixed(2)} GB/s`;
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

// ── Settings-Hooks ───────────────────────────────────────────────

/** Toggle "10GbE bevorzugen". Default AUS — opt-in, fasst Geräte-Adressen an. */
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

/** Manuell eingetragene schnelle Adressen (deviceID → "tcp://…") — für Geräte,
 * die kein Node je über 10GbE gesehen hat (z.B. die NAS auf 192.168.100.100). */
export function useNetworkManual() {
  const [manual, setManualState] = useState<Record<string, string>>(() => loadMap(MANUAL_LS));
  const setManual = (deviceID: string, addr: string) => {
    setManualState((prev) => {
      const next = { ...prev };
      const t = addr.trim();
      if (t) next[deviceID] = t; // roh speichern; tcp:// wird bei Nutzung ergänzt
      else delete next[deviceID];
      saveMap(MANUAL_LS, next);
      return next;
    });
  };
  return { manual, setManual };
}

// ── Hints: beobachten + clusterweit syncen + mergen ──────────────

type HintFile = { by?: string; at?: number; hints?: Record<string, string> };

/**
 * Liefert die GEMERGTE 10GbE-Adress-Karte (deviceID → "tcp://…"):
 *   selbst beobachtet (sticky) ∪ manuell ∪ von Peers gesynct.
 * Wenn `enabled`, werden die eigenen Hints in `.syncomat/net-hints/<id>.json`
 * jedes Ordners geschrieben (nur bei Änderung) und die der Peers gelesen.
 */
export function useNetworkHints(
  ep: Endpoint | null,
  ready: boolean,
  folders: { id: string; path: string }[],
  myID: string | null,
  connections: Record<DeviceID, Connection>,
  manual: Record<string, string>,
  enabled: boolean,
  fastSubnet: string,
): Record<string, string> {
  const [merged, setMerged] = useState<Record<string, string>>(() => ({
    ...loadMap(LEARNED_LS),
    ...loadMap(MANUAL_LS),
  }));
  const lastWrittenRef = useRef<string>("");

  const learnKey = Object.entries(connections)
    .filter(([, c]) => c.connected && c.address && inFastSubnet(c.address, fastSubnet))
    .map(([id, c]) => `${id}@${bare(c.address)}`)
    .sort()
    .join(",");
  const folderKey = folders.map((f) => f.path).sort().join(",");
  const manualKey = JSON.stringify(manual);

  useEffect(() => {
    if (!ep || !ready) return;
    let cancelled = false;

    // 1. Sticky: aktuell über das schnelle Subnetz verbundene Geräte merken.
    const learned = loadMap(LEARNED_LS);
    let lc = false;
    for (const [id, c] of Object.entries(connections)) {
      if (c.connected && c.address && inFastSubnet(c.address, fastSubnet)) {
        const a = `tcp://${bare(c.address)}`;
        if (learned[id] !== a) {
          learned[id] = a;
          lc = true;
        }
      }
    }
    if (lc) saveMap(LEARNED_LS, learned);

    // Manuell eingetragene Adressen formatieren (tcp:// ergänzen) — gewinnen.
    const manualFmt: Record<string, string> = {};
    for (const [k, v] of Object.entries(manual)) {
      const t = v.trim();
      if (t) manualFmt[k] = /^\w+:\/\//.test(t) ? t : `tcp://${t}`;
    }
    const own = { ...learned, ...manualFmt };

    const run = async () => {
      const combined: Record<string, string> = { ...own };
      if (enabled && myID && folders.length > 0) {
        const ownStr = JSON.stringify(own);
        const shouldWrite =
          ownStr !== lastWrittenRef.current && Object.keys(own).length > 0;
        const content = JSON.stringify({ by: myID, at: Date.now(), hints: own });
        for (const f of folders) {
          if (cancelled) return;
          try {
            if (shouldWrite) {
              await invoke("network_hints_write", {
                folderPath: f.path,
                deviceId: myID,
                content,
              });
            }
            const raws = await invoke<string[]>("network_hints_read_all", {
              folderPath: f.path,
            });
            for (const raw of raws) {
              try {
                const parsed = JSON.parse(raw) as HintFile;
                if (parsed.hints) {
                  for (const [k, v] of Object.entries(parsed.hints)) {
                    if (!combined[k]) combined[k] = v; // own hat Vorrang
                  }
                }
              } catch {
                /* korrupte/halbgeschriebene Datei → ignorieren */
              }
            }
          } catch (e) {
            console.warn("[network-hints] sync failed", e);
          }
        }
        if (shouldWrite && !cancelled) lastWrittenRef.current = ownStr;
      }
      if (!cancelled) setMerged(combined);
    };

    run();
    const id = enabled ? setInterval(run, 60_000) : undefined;
    return () => {
      cancelled = true;
      if (id) clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ep?.url, ep?.api_key, ready, myID, enabled, fastSubnet, learnKey, folderKey, manualKey]);

  return merged;
}

// ── Pinnen ───────────────────────────────────────────────────────

/** addresses[] mit fester schneller Adresse VORNE — fügt nur HINZU, entfernt nie
 * etwas Bestehendes (manuelle Adressen bleiben). "dynamic" als Fallback. */
function withFastPinned(current: string[], fast: string): string[] {
  if (current.includes(fast)) return current;
  const next = [fast, ...current.filter((a) => a !== fast)];
  if (!next.includes("dynamic")) next.push("dynamic");
  return next;
}

/**
 * Pinnt die schnellen Adressen aus `hints` in die Syncthing-Geräte-Config (wenn
 * `enabled`), sonst entfernt es NUR die von uns gesetzten Pins wieder (manuelle
 * Adressen bleiben unberührt). Idempotent gegen Reconnect-Churn (appliedRef).
 */
export function usePrefer10GbE_apply(
  ep: Endpoint | null,
  ready: boolean,
  devices: Device[],
  enabled: boolean,
  hints: Record<string, string>,
): void {
  const appliedRef = useRef<Record<DeviceID, string>>({});

  const devKey = devices
    .map((d) => `${d.deviceID}:${d.addresses.join("|")}`)
    .sort()
    .join(",");
  const hintsKey = JSON.stringify(hints);

  useEffect(() => {
    if (!ep || !ready) return;
    let cancelled = false;

    (async () => {
      const pinned = loadMap(PINNED_LS);
      let pinnedChanged = false;

      for (const dev of devices) {
        if (cancelled) return;
        const id = dev.deviceID;

        if (enabled) {
          const fast = hints[id];
          if (!fast) continue;
          if (dev.addresses.includes(fast)) {
            if (pinned[id] !== fast) {
              pinned[id] = fast;
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
  }, [ep?.url, ep?.api_key, ready, enabled, devKey, hintsKey]);
}
