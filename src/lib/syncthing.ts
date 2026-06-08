import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";

// ============================================================
// Types — only the fields we actually read in the UI.
// ============================================================

export type Endpoint = { url: string; api_key: string };
export type DeviceID = string; // 56 chars, dash-separated groups
export type FolderID = string;

export type SystemStatus = {
  myID: DeviceID;
  uptime: number;
  cpuPercent: number;
};

export type Connection = {
  connected: boolean;
  address: string;
  clientVersion: string;
  inBytesTotal: number;
  outBytesTotal: number;
};

export type Connections = {
  connections: Record<DeviceID, Connection>;
  total: { inBytesTotal: number; outBytesTotal: number };
};

export type FolderVersioning = {
  type: "" | "trashcan" | "simple" | "staggered" | "external";
  params?: Record<string, string>;
};

export type Folder = {
  id: FolderID;
  label: string;
  path: string;
  type: "sendreceive" | "sendonly" | "receiveonly";
  paused: boolean;
  devices: { deviceID: DeviceID }[];
  versioning?: FolderVersioning;
  ignorePerms?: boolean;
  caseSensitiveFS?: boolean;
};

export type FolderError = { path: string; error: string };
export type FolderErrorList = { folder: FolderID; errors: FolderError[] };
export type FolderIgnores = { ignore: string[] | null; expanded: string[] | null };

export type Device = {
  deviceID: DeviceID;
  name: string;
  addresses: string[];
  introducer: boolean;
  autoAcceptFolders: boolean;
  paused: boolean;
};

export type Config = { folders: Folder[]; devices: Device[] };

export type PendingFolder = {
  folderID: FolderID;
  offeredBy: Record<
    DeviceID,
    { time: string; label: string; receiveEncrypted: boolean }
  >;
};

export type PendingDevice = {
  deviceID: DeviceID;
  time: string;
  address: string;
  name: string;
};

export type FolderStatus = {
  state: string;
  globalBytes: number;
  localBytes: number;
  needBytes: number;
  errors: number;
  pullErrors: number;
};

export type SyncEvent = {
  id: number;
  globalID: number;
  time: string;
  type: string;
  data: unknown;
};

// ============================================================
// Helpers
// ============================================================

export function shortDeviceID(id: DeviceID): string {
  if (id.length <= 16) return id;
  return `${id.slice(0, 7)}…${id.slice(-7)}`;
}

// ============================================================
// REST primitive
// ============================================================

async function api<T = unknown>(
  ep: Endpoint,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${ep.url}${path}`, {
    ...init,
    headers: { ...init?.headers, "X-API-Key": ep.api_key },
  });
  if (!res.ok) {
    throw new Error(`${init?.method ?? "GET"} ${path} → ${res.status} ${res.statusText}`);
  }
  // POST /scan returns empty body
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

// ============================================================
// REST endpoints (Briefing §6)
// ============================================================

export const getStatus = (ep: Endpoint) =>
  api<SystemStatus>(ep, "/rest/system/status");
export const getPing = (ep: Endpoint) =>
  api<{ ping: string }>(ep, "/rest/system/ping");
export const getConnections = (ep: Endpoint) =>
  api<Connections>(ep, "/rest/system/connections");
export const getConfig = (ep: Endpoint) => api<Config>(ep, "/rest/config");

type PendingFoldersRaw = Record<FolderID, { offeredBy: PendingFolder["offeredBy"] }>;
export async function getPendingFolders(ep: Endpoint): Promise<PendingFolder[]> {
  const raw = await api<PendingFoldersRaw>(ep, "/rest/cluster/pending/folders");
  return Object.entries(raw).map(([folderID, v]) => ({
    folderID,
    offeredBy: v.offeredBy,
  }));
}

type PendingDevicesRaw = Record<DeviceID, Omit<PendingDevice, "deviceID">>;
export async function getPendingDevices(ep: Endpoint): Promise<PendingDevice[]> {
  const raw = await api<PendingDevicesRaw>(ep, "/rest/cluster/pending/devices");
  return Object.entries(raw).map(([deviceID, v]) => ({ deviceID, ...v }));
}

export const getFolderStatus = (ep: Endpoint, id: FolderID) =>
  api<FolderStatus>(ep, `/rest/db/status?folder=${encodeURIComponent(id)}`);

export const scanFolder = (ep: Endpoint, id: FolderID) =>
  api<void>(ep, `/rest/db/scan?folder=${encodeURIComponent(id)}`, {
    method: "POST",
  });

export const scanAllFolders = (ep: Endpoint, folders: Folder[]) =>
  Promise.all(folders.map((f) => scanFolder(ep, f.id)));

export const deletePendingDevice = (ep: Endpoint, id: DeviceID) =>
  api<void>(ep, `/rest/cluster/pending/devices?device=${encodeURIComponent(id)}`, {
    method: "DELETE",
  });

export const deletePendingFolder = (
  ep: Endpoint,
  folderID: FolderID,
  deviceID: DeviceID,
) =>
  api<void>(
    ep,
    `/rest/cluster/pending/folders?folder=${encodeURIComponent(folderID)}&device=${encodeURIComponent(deviceID)}`,
    { method: "DELETE" },
  );

export const putFolder = (ep: Endpoint, folder: Folder) =>
  api<void>(ep, `/rest/config/folders/${encodeURIComponent(folder.id)}`, {
    method: "PUT",
    body: JSON.stringify(folder),
    headers: { "Content-Type": "application/json" },
  });

export const putDevice = (ep: Endpoint, device: Device) =>
  api<void>(ep, `/rest/config/devices/${encodeURIComponent(device.deviceID)}`, {
    method: "PUT",
    body: JSON.stringify(device),
    headers: { "Content-Type": "application/json" },
  });

export const patchDevice = (
  ep: Endpoint,
  deviceID: DeviceID,
  partial: Partial<Device>,
) =>
  api<void>(ep, `/rest/config/devices/${encodeURIComponent(deviceID)}`, {
    method: "PATCH",
    body: JSON.stringify(partial),
    headers: { "Content-Type": "application/json" },
  });

export const deleteDevice = (ep: Endpoint, deviceID: DeviceID) =>
  api<void>(ep, `/rest/config/devices/${encodeURIComponent(deviceID)}`, {
    method: "DELETE",
  });

// ── Cross-OS support: folder errors + ignores ─────────────────

export const getFolderErrors = (ep: Endpoint, folderID: FolderID) =>
  api<FolderErrorList>(
    ep,
    `/rest/folder/errors?folder=${encodeURIComponent(folderID)}&perpage=200`,
  );

export const getFolderIgnores = (ep: Endpoint, folderID: FolderID) =>
  api<FolderIgnores>(ep, `/rest/db/ignores?folder=${encodeURIComponent(folderID)}`);

export const setFolderIgnores = (
  ep: Endpoint,
  folderID: FolderID,
  ignore: string[],
) =>
  api<void>(ep, `/rest/db/ignores?folder=${encodeURIComponent(folderID)}`, {
    method: "POST",
    body: JSON.stringify({ ignore }),
    headers: { "Content-Type": "application/json" },
  });

/**
 * Heuristik: ist der Fehler ein Windows-Namens-Problem (illegal char, reserved name)?
 * Syncthing-Fehlertexte sind keyword-basiert; wir fangen die häufigsten.
 */
export function isWindowsNameError(err: string): boolean {
  const s = err.toLowerCase();
  return (
    s.includes("illegal") ||
    s.includes("invalid character") ||
    s.includes("invalid filename") ||
    s.includes("reserved name") ||
    s.includes("invalid path") ||
    /[:?*<>|"]/.test(err)
  );
}

// ============================================================
// Event stream (long-poll on /rest/events)
// ============================================================

export async function* subscribeEvents(
  ep: Endpoint,
  since = 0,
  signal?: AbortSignal,
): AsyncIterable<SyncEvent> {
  while (!signal?.aborted) {
    const res = await fetch(
      `${ep.url}/rest/events?since=${since}&timeout=60`,
      { headers: { "X-API-Key": ep.api_key }, signal },
    );
    if (!res.ok) throw new Error(`/rest/events → ${res.status}`);
    const events = (await res.json()) as SyncEvent[];
    for (const e of events) {
      yield e;
      since = e.id;
    }
  }
}

// ============================================================
// Shared event bus — one subscriber per endpoint, fan-out to listeners.
// ============================================================

type EventHandler = (e: SyncEvent) => void;

class EventBus {
  private endpoint: Endpoint | null = null;
  private listeners = new Set<EventHandler>();
  private abort: AbortController | null = null;

  setEndpoint(ep: Endpoint | null) {
    if (this.endpoint?.url === ep?.url && this.endpoint?.api_key === ep?.api_key) return;
    this.stop();
    this.endpoint = ep;
    if (ep && this.listeners.size > 0) this.start();
  }

  add(handler: EventHandler) {
    this.listeners.add(handler);
    if (this.endpoint && !this.abort) this.start();
  }

  remove(handler: EventHandler) {
    this.listeners.delete(handler);
    if (this.listeners.size === 0) this.stop();
  }

  private start() {
    if (!this.endpoint || this.abort) return;
    const ctrl = new AbortController();
    this.abort = ctrl;
    void this.loop(this.endpoint, ctrl.signal);
  }

  private stop() {
    this.abort?.abort();
    this.abort = null;
  }

  private async loop(ep: Endpoint, signal: AbortSignal) {
    let since = 0;
    let backoff = 1000;
    while (!signal.aborted) {
      try {
        for await (const event of subscribeEvents(ep, since, signal)) {
          for (const h of this.listeners) {
            try {
              h(event);
            } catch (err) {
              console.error("[syncthing] event handler threw", err);
            }
          }
          since = event.id;
          backoff = 1000;
        }
      } catch (e) {
        if (signal.aborted) return;
        console.warn(
          "[syncthing] event stream broken, reconnecting in",
          backoff,
          "ms",
          e,
        );
        await new Promise((r) => setTimeout(r, backoff));
        backoff = Math.min(30_000, backoff * 2);
      }
    }
  }
}

const bus = new EventBus();

// ============================================================
// React hooks
// ============================================================

export function useEndpoint(): Endpoint | null {
  const [endpoint, setEndpoint] = useState<Endpoint | null>(null);

  useEffect(() => {
    let cancelled = false;
    invoke<Endpoint>("syncthing_endpoint")
      .then((ep) => {
        if (!cancelled) {
          setEndpoint(ep);
          bus.setEndpoint(ep);
        }
      })
      .catch((e) => console.error("[syncthing] endpoint invoke failed", e));
    return () => {
      cancelled = true;
    };
  }, []);

  return endpoint;
}

export function useSyncthingReady(ep: Endpoint | null): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!ep) return;
    setReady(false);

    let cancelled = false;
    const unlistenP = listen("syncthing://ready", () => {
      if (!cancelled) setReady(true);
    });

    // Fallback ping-probe — closes the race when listener registers after event.
    (async () => {
      while (!cancelled) {
        try {
          await getPing(ep);
          if (!cancelled) setReady(true);
          return;
        } catch {
          await new Promise((r) => setTimeout(r, 500));
        }
      }
    })();

    return () => {
      cancelled = true;
      unlistenP.then((fn) => fn());
    };
  }, [ep?.url, ep?.api_key]);

  return ready;
}

type Loadable<T> = { data: T | null; error: Error | null };

/**
 * Wires an initial fetch plus event-driven revalidation.
 * `shouldRefetch` decides whether a given SyncEvent should trigger a refetch.
 */
function useLoadable<T>(
  ep: Endpoint | null,
  ready: boolean,
  fetcher: (ep: Endpoint) => Promise<T>,
  shouldRefetch: (e: SyncEvent) => boolean,
  deps: unknown[] = [],
): Loadable<T> {
  const [state, setState] = useState<Loadable<T>>({ data: null, error: null });
  const lastDebounce = useRef(0);

  useEffect(() => {
    if (!ep || !ready) return;
    let cancelled = false;

    const refetch = () => {
      fetcher(ep).then(
        (data) => !cancelled && setState({ data, error: null }),
        (error: Error) => !cancelled && setState((s) => ({ ...s, error })),
      );
    };

    refetch();

    const handler: EventHandler = (e) => {
      if (!shouldRefetch(e)) return;
      // 200ms debounce — coalesce burst (ItemFinished etc.)
      const now = Date.now();
      lastDebounce.current = now;
      setTimeout(() => {
        if (lastDebounce.current === now && !cancelled) refetch();
      }, 200);
    };
    bus.add(handler);

    return () => {
      cancelled = true;
      bus.remove(handler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ep?.url, ep?.api_key, ready, ...deps]);

  return state;
}

const NEVER = () => false;
const ON = (...types: string[]) => (e: SyncEvent) => types.includes(e.type);

export const useStatus = (ep: Endpoint | null, ready: boolean) =>
  useLoadable(ep, ready, getStatus, NEVER);

export const useConnections = (ep: Endpoint | null, ready: boolean) =>
  useLoadable(ep, ready, getConnections, ON("DeviceConnected", "DeviceDisconnected"));

export const useConfig = (ep: Endpoint | null, ready: boolean) =>
  useLoadable(ep, ready, getConfig, ON("ConfigSaved"));

export const usePendingFolders = (ep: Endpoint | null, ready: boolean) =>
  useLoadable(ep, ready, getPendingFolders, ON("PendingFoldersChanged"));

export const usePendingDevices = (ep: Endpoint | null, ready: boolean) =>
  useLoadable(ep, ready, getPendingDevices, ON("PendingDevicesChanged"));

export const useFolderStatus = (
  ep: Endpoint | null,
  ready: boolean,
  folderId: FolderID | null,
) =>
  useLoadable(
    ep,
    ready && !!folderId,
    (e) => getFolderStatus(e, folderId!),
    ON("StateChanged", "FolderSummary", "FolderErrors", "ItemFinished", "LocalIndexUpdated"),
    [folderId],
  );

// ── Transfer-Rate (bytes/sec + 1h history) ─────────────────────

export type TransferRateState = {
  inBps: number;
  outBps: number;
  historyIn: number[]; // 1-min buckets, last 60 (newest right)
  historyOut: number[];
};

/**
 * Pollt /rest/system/connections und berechnet Delta-Rates.
 * History: 1-Minuten-Buckets (gemittelt aus 1s-Samples), max 60 Einträge.
 */
export function useTransferRate(
  ep: Endpoint | null,
  ready: boolean,
  samplingMs = 1000,
): TransferRateState {
  const [state, setState] = useState<TransferRateState>({
    inBps: 0,
    outBps: 0,
    historyIn: [],
    historyOut: [],
  });

  // Mutable state outside React renders.
  const probeRef = useRef({
    lastIn: 0,
    lastOut: 0,
    lastT: 0,
    bucketMinute: 0,
    bucketInSum: 0,
    bucketOutSum: 0,
    bucketCount: 0,
    historyIn: [] as number[],
    historyOut: [] as number[],
  });

  useEffect(() => {
    if (!ep || !ready) return;
    let cancelled = false;
    probeRef.current = {
      lastIn: 0,
      lastOut: 0,
      lastT: 0,
      bucketMinute: 0,
      bucketInSum: 0,
      bucketOutSum: 0,
      bucketCount: 0,
      historyIn: [],
      historyOut: [],
    };

    const tick = async () => {
      try {
        const c = await getConnections(ep);
        if (cancelled) return;
        const now = Date.now();
        const inB = c.total?.inBytesTotal ?? 0;
        const outB = c.total?.outBytesTotal ?? 0;
        const p = probeRef.current;

        if (p.lastT > 0) {
          const dtSec = Math.max(0.001, (now - p.lastT) / 1000);
          const inBps = Math.max(0, (inB - p.lastIn) / dtSec);
          const outBps = Math.max(0, (outB - p.lastOut) / dtSec);

          const currentMinute = Math.floor(now / 60_000);
          if (p.bucketMinute === 0) p.bucketMinute = currentMinute;
          if (currentMinute > p.bucketMinute) {
            const inAvg = p.bucketCount > 0 ? p.bucketInSum / p.bucketCount : 0;
            const outAvg = p.bucketCount > 0 ? p.bucketOutSum / p.bucketCount : 0;
            p.historyIn.push(inAvg);
            p.historyOut.push(outAvg);
            if (p.historyIn.length > 60) p.historyIn.shift();
            if (p.historyOut.length > 60) p.historyOut.shift();
            p.bucketMinute = currentMinute;
            p.bucketInSum = 0;
            p.bucketOutSum = 0;
            p.bucketCount = 0;
          }
          p.bucketInSum += inBps;
          p.bucketOutSum += outBps;
          p.bucketCount += 1;

          setState({
            inBps,
            outBps,
            historyIn: [...p.historyIn],
            historyOut: [...p.historyOut],
          });
        }
        p.lastIn = inB;
        p.lastOut = outB;
        p.lastT = now;
      } catch {
        // network blip, ignore
      }
    };

    tick();
    const id = setInterval(tick, samplingMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [ep?.url, ep?.api_key, ready, samplingMs]);

  return state;
}

export type AggregateStatus = {
  state: "idle" | "syncing" | "error";
  needBytes: number;
  errorCount: number;
  lastUpdate: Date | null;
};

export function useAggregateStatus(
  ep: Endpoint | null,
  ready: boolean,
  folders: Folder[],
): AggregateStatus {
  const [agg, setAgg] = useState<AggregateStatus>({
    state: "idle",
    needBytes: 0,
    errorCount: 0,
    lastUpdate: null,
  });
  const ids = folders.map((f) => f.id).join(",");

  useEffect(() => {
    if (!ep || !ready) {
      setAgg({ state: "idle", needBytes: 0, errorCount: 0, lastUpdate: null });
      return;
    }
    let cancelled = false;

    const refetch = async () => {
      if (folders.length === 0) {
        if (!cancelled)
          setAgg({ state: "idle", needBytes: 0, errorCount: 0, lastUpdate: new Date() });
        return;
      }
      const results = await Promise.all(
        folders.map((f) => getFolderStatus(ep, f.id).catch(() => null)),
      );
      if (cancelled) return;
      let errorCount = 0;
      let needBytes = 0;
      for (const s of results) {
        if (!s) continue;
        errorCount += (s.errors || 0) + (s.pullErrors || 0);
        needBytes += s.needBytes || 0;
      }
      const state: AggregateStatus["state"] =
        errorCount > 0 ? "error" : needBytes > 0 ? "syncing" : "idle";
      setAgg({ state, needBytes, errorCount, lastUpdate: new Date() });
    };

    refetch();

    const handler: EventHandler = (e) => {
      if (
        e.type === "FolderSummary" ||
        e.type === "FolderErrors" ||
        e.type === "StateChanged" ||
        e.type === "ConfigSaved" ||
        e.type === "ItemFinished"
      ) {
        refetch();
      }
    };
    bus.add(handler);

    return () => {
      cancelled = true;
      bus.remove(handler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ep?.url, ep?.api_key, ready, ids]);

  return agg;
}
