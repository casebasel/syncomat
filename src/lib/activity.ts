import { useEffect, useState } from "react";
import { bus, type EventHandler, type SyncEvent } from "./syncthing";

/**
 * Sync-Event für die Activity-Feed-UI. Stammt entweder aus Syncthings
 * ItemFinished oder LocalChangeDetected event-stream.
 *
 * Phase 1 (v0.2.0): Events leben nur im Memory der laufenden Session.
 * Phase 2 (v0.2.1): Activity-Archiv in app_data_dir mit Rotation.
 */
export type ActivityEvent = {
  /** lokale UUID — kein Syncthing-event-id weil wir mehrere sources mergen */
  id: string;
  /** unix ms (für sortierung + display) */
  ts: number;
  folderId: string;
  /** relativer Pfad innerhalb des Folders */
  path: string;
  /** Bytes — 0 wenn unbekannt */
  size: number;
  /** 'down' = vom Peer empfangen, 'up' = an Peer gesendet, 'local' = lokale
   * Änderung erkannt (nicht durch Sync), 'conflict' = sync-conflict-File. */
  direction: "down" | "up" | "local" | "conflict";
  /** Device-ID des Peers (kurz) — leer bei 'local' */
  peer: string;
  /** Art der Änderung */
  action: "added" | "modified" | "deleted" | "conflict";
};

const MAX_EVENTS_PER_FOLDER = 200;

// Modul-Cache: pro Folder die letzten N Events. Geteilt zwischen mehreren
// useFolderActivity-Subscribern (falls jemand zwei FolderInspectors parallel
// hat — z.B. zukünftig Split-Screen).
const cache = new Map<string, ActivityEvent[]>();
const subscribers = new Map<string, Set<() => void>>();

function notifyFolder(folderId: string) {
  const subs = subscribers.get(folderId);
  if (subs) for (const fn of subs) fn();
  // Plus alle wildcard-Subscriber (Globale Activity-View)
  const wildcardSubs = subscribers.get("__all__");
  if (wildcardSubs) for (const fn of wildcardSubs) fn();
}

function uid(): string {
  // Schnell + collision-resistent genug für UI-Keys
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function addEvent(ev: ActivityEvent) {
  const list = cache.get(ev.folderId) ?? [];
  // Dedup nahezu-identische Events (gleicher Pfad + direction innerhalb 500 ms)
  const dup = list.find(
    (e) =>
      e.path === ev.path &&
      e.direction === ev.direction &&
      Math.abs(e.ts - ev.ts) < 500,
  );
  if (dup) return;
  const next = [ev, ...list].slice(0, MAX_EVENTS_PER_FOLDER);
  cache.set(ev.folderId, next);
  notifyFolder(ev.folderId);
}

/**
 * Globaler Listener auf den Syncthing-Event-Bus. Muss EINMAL beim App-Start
 * gemountet werden — daher der `useActivityListener`-Hook in App.tsx.
 */
function handleSyncEvent(e: SyncEvent) {
  if (e.type === "ItemFinished") {
    const d = e.data as {
      folder: string;
      item: string;
      action: string;
      type: string;
      error?: string;
    };
    if (!d?.folder || !d?.item) return;
    const action: ActivityEvent["action"] =
      d.action === "delete" ? "deleted" : d.action === "metadata" ? "modified" : "added";
    addEvent({
      id: uid(),
      ts: Date.now(),
      folderId: d.folder,
      path: d.item,
      size: 0, // Syncthing liefert size nicht im ItemFinished-event
      direction: "down",
      peer: "",
      action,
    });
  } else if (e.type === "LocalChangeDetected") {
    const d = e.data as { folderID: string; path: string; type: string; action: string };
    if (!d?.folderID || !d?.path) return;
    addEvent({
      id: uid(),
      ts: Date.now(),
      folderId: d.folderID,
      path: d.path,
      size: 0,
      direction: "local",
      peer: "",
      action: d.action === "deleted" ? "deleted" : "modified",
    });
  } else if (e.type === "RemoteChangeDetected") {
    const d = e.data as { folderID: string; path: string; modifiedBy: string; action: string };
    if (!d?.folderID || !d?.path) return;
    addEvent({
      id: uid(),
      ts: Date.now(),
      folderId: d.folderID,
      path: d.path,
      size: 0,
      direction: "down",
      peer: d.modifiedBy?.slice(0, 7) ?? "",
      action: d.action === "deleted" ? "deleted" : "modified",
    });
  }
}

let attached = false;
function ensureAttached() {
  if (attached) return;
  const handler: EventHandler = handleSyncEvent;
  bus.add(handler);
  attached = true;
}

/**
 * Hook für die Globale Activity-View: merget Events von ALLEN folderIds
 * und gibt die jüngsten 200 sortiert zurück. Nutzt denselben Modul-Cache
 * + Subscribe-Pattern wie useFolderActivity, aber listened für alle.
 */
export function useAllActivity(): ActivityEvent[] {
  const [items, setItems] = useState<ActivityEvent[]>(() => collectAll());

  useEffect(() => {
    ensureAttached();
    const onUpdate = () => setItems(collectAll());
    // Subscribe auf ALLE Folder-IDs die jemals im Cache landen
    const wildcardKey = "__all__";
    let subs = subscribers.get(wildcardKey);
    if (!subs) {
      subs = new Set();
      subscribers.set(wildcardKey, subs);
    }
    subs.add(onUpdate);
    return () => {
      const s = subscribers.get(wildcardKey);
      if (s) {
        s.delete(onUpdate);
        if (s.size === 0) subscribers.delete(wildcardKey);
      }
    };
  }, []);

  return items;
}

function collectAll(): ActivityEvent[] {
  const merged: ActivityEvent[] = [];
  for (const list of cache.values()) {
    merged.push(...list);
  }
  merged.sort((a, b) => b.ts - a.ts);
  return merged.slice(0, MAX_EVENTS_PER_FOLDER);
}

/**
 * Hook für FolderInspector: liefert die Events des aktuell selektierten Folders,
 * neu-sortiert (jüngste oben). Subscribed sich beim Mount, unsubscribed beim
 * Unmount. Listener ist global und läuft ab dem ersten Subscriber durch.
 */
export function useFolderActivity(folderId: string | null): ActivityEvent[] {
  const [items, setItems] = useState<ActivityEvent[]>(() =>
    folderId ? cache.get(folderId) ?? [] : [],
  );

  useEffect(() => {
    if (!folderId) {
      setItems([]);
      return;
    }
    ensureAttached();
    const onUpdate = () => setItems(cache.get(folderId) ?? []);
    let subs = subscribers.get(folderId);
    if (!subs) {
      subs = new Set();
      subscribers.set(folderId, subs);
    }
    subs.add(onUpdate);
    // initial fetch
    setItems(cache.get(folderId) ?? []);
    return () => {
      const s = subscribers.get(folderId);
      if (s) {
        s.delete(onUpdate);
        if (s.size === 0) subscribers.delete(folderId);
      }
    };
  }, [folderId]);

  return items;
}

/** Formatiert einen Event-Zeitstempel relativ. */
export function fmtActivityTime(ts: number): string {
  const now = Date.now();
  const date = new Date(ts);
  const ageMs = now - ts;
  if (ageMs < 60_000) return "gerade";
  if (ageMs < 60 * 60_000) return `${Math.floor(ageMs / 60_000)} min`;
  // Heute: HH:MM
  const today = new Date(now);
  if (
    date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear()
  ) {
    return date.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  }
  // Gestern
  const y = new Date(now - 24 * 3600_000);
  if (
    date.getDate() === y.getDate() &&
    date.getMonth() === y.getMonth() &&
    date.getFullYear() === y.getFullYear()
  ) {
    return "gestern";
  }
  return date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
}

/** Formatiert Bytes klein für die rechte Spalte. */
export function fmtActivityBytes(n: number): string {
  if (n === 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
