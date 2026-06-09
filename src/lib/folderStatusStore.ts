import { useEffect, useState } from "react";
import {
  bus,
  getFolderStatus,
  type Endpoint,
  type EventHandler,
  type FolderID,
  type FolderStatus,
} from "./syncthing";

/**
 * Geteilter Folder-Status-Cache. Vorher: jedes `useFolderStatus(folderId)`
 * macht eigene HTTP-Polls + eigenen Event-Bus-Subscriber. Bei einer Sidebar
 * mit 5 Folders + FolderInspector des selektierten Folders wurden so 6
 * parallele Fetches für denselben Folder-Status getriggert, alle 200 ms
 * bei jedem ItemFinished-Burst.
 *
 * Jetzt: ein einziger Cache-Eintrag pro folderId, ein einziger event-handler
 * insgesamt. Alle subscribed Hooks rendern aus demselben Cache und werden
 * über Pub/Sub benachrichtigt.
 *
 * Trade-off: nur eine Endpoint-Instanz wird supported (was bei Syncomat eh
 * der Fall ist — wir reden mit GENAU einem lokalen Syncthing). Wenn das
 * jemals mehr werden müsste, müsste der cache nach Endpoint-URL gekeyed werden.
 */

const cache = new Map<FolderID, FolderStatus | null>();
const subscribers = new Map<FolderID, Set<() => void>>();
const inflight = new Map<FolderID, Promise<void>>();
let currentEndpoint: Endpoint | null = null;
let handlerAttached = false;
let scheduledTimer: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_MS = 200;

function notifyFolder(folderId: FolderID) {
  const subs = subscribers.get(folderId);
  if (subs) for (const fn of subs) fn();
}

async function fetchOne(ep: Endpoint, folderId: FolderID) {
  // De-dupe in-flight: wenn schon ein Fetch läuft, returne dessen Promise
  const existing = inflight.get(folderId);
  if (existing) return existing;
  const promise = (async () => {
    try {
      const status = await getFolderStatus(ep, folderId);
      cache.set(folderId, status);
      notifyFolder(folderId);
    } catch (e) {
      console.warn(`[folder-status] ${folderId} fetch failed:`, e);
    } finally {
      inflight.delete(folderId);
    }
  })();
  inflight.set(folderId, promise);
  return promise;
}

function scheduleRefetchAll() {
  if (scheduledTimer || !currentEndpoint) return;
  scheduledTimer = setTimeout(() => {
    scheduledTimer = null;
    if (!currentEndpoint) return;
    const ids = Array.from(subscribers.keys());
    void Promise.all(ids.map((id) => fetchOne(currentEndpoint!, id)));
  }, DEBOUNCE_MS);
}

function refetchAllImmediate() {
  if (!currentEndpoint) return;
  const ids = Array.from(subscribers.keys());
  void Promise.all(ids.map((id) => fetchOne(currentEndpoint!, id)));
}

const handler: EventHandler = (e) => {
  // Immediate refetch bei Config-Änderungen + Errors — UI darf nicht stale sein
  if (e.type === "ConfigSaved" || e.type === "FolderErrors") {
    refetchAllImmediate();
    return;
  }
  // Debounced bei high-rate events (ItemFinished feuert tausendfach bei Big-Sync)
  if (
    e.type === "FolderSummary" ||
    e.type === "StateChanged" ||
    e.type === "ItemFinished" ||
    e.type === "LocalIndexUpdated"
  ) {
    scheduleRefetchAll();
  }
};

function ensureHandlerAttached() {
  if (handlerAttached) return;
  bus.add(handler);
  handlerAttached = true;
}

/**
 * Drop-in-Replacement für useFolderStatus aus syncthing.ts.
 * Teilt den Cache + event-handler über alle Hook-Instanzen.
 */
export function useSharedFolderStatus(
  ep: Endpoint | null,
  ready: boolean,
  folderId: FolderID | null,
): { data: FolderStatus | null } {
  const [, forceUpdate] = useState({});

  useEffect(() => {
    if (!ep || !ready || !folderId) return;
    currentEndpoint = ep;
    ensureHandlerAttached();
    let subs = subscribers.get(folderId);
    if (!subs) {
      subs = new Set();
      subscribers.set(folderId, subs);
    }
    const onUpdate = () => forceUpdate({});
    subs.add(onUpdate);
    // Initial-Fetch wenn cache leer
    if (!cache.has(folderId)) {
      void fetchOne(ep, folderId);
    } else {
      // bei einem späteren mount mit cache-hit: re-render damit der hook
      // den letzten state sieht
      forceUpdate({});
    }
    return () => {
      const s = subscribers.get(folderId);
      if (s) {
        s.delete(onUpdate);
        if (s.size === 0) subscribers.delete(folderId);
      }
    };
  }, [ep?.url, ep?.api_key, ready, folderId]);

  return { data: folderId ? cache.get(folderId) ?? null : null };
}

// (Sprint #2) getAllCachedStatuses + subscribeAllStatusChanges entfernt —
// toter Code (null Aufrufer).
