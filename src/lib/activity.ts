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
  direction: "down" | "up" | "local" | "conflict" | "app";
  /** Device-ID des Peers (kurz) — leer bei 'local' */
  peer: string;
  /** Art der Änderung */
  action: "added" | "modified" | "deleted" | "conflict";
  /** Nur bei „local“: wartet aufs NAS bzw. das NAS hat den Stand (bestätigt). */
  nas?: "wartet" | "bestaetigt";
  /** Nur bei „app“: was syncomat getan hat, in Worten. */
  text?: string;
};

const MAX_EVENTS_PER_FOLDER = 2000;
const MAX_GESAMT = 5000;
const LS = "syncomat.aktivitaet";

// Modul-Cache: pro Folder die letzten N Events. Geteilt zwischen mehreren
// useFolderActivity-Subscribern (falls jemand zwei FolderInspectors parallel
// hat — z.B. zukünftig Split-Screen).
const cache = new Map<string, ActivityEvent[]>();
const subscribers = new Map<string, Set<() => void>>();

// Protokoll bleibt über Neustarts und Updates erhalten (Marlon 09.11.2026:
// „das Protokoll vollständiger“) — die letzten MAX_GESAMT Einträge.
try {
  const alt = JSON.parse(localStorage.getItem(LS) ?? "[]") as ActivityEvent[];
  if (Array.isArray(alt)) {
    for (const e of alt) {
      if (!e?.folderId || !e?.id) continue;
      const l = cache.get(e.folderId) ?? [];
      l.push(e);
      cache.set(e.folderId, l);
    }
  }
} catch {
  /* ohne Speicher nur diese Sitzung */
}
let speichernTimer: ReturnType<typeof setTimeout> | null = null;
function speichern() {
  if (speichernTimer) return;
  speichernTimer = setTimeout(() => {
    speichernTimer = null;
    try {
      const alle = [...cache.values()].flat().sort((a, b) => b.ts - a.ts).slice(0, MAX_GESAMT);
      localStorage.setItem(LS, JSON.stringify(alle));
    } catch {
      /* voll oder gesperrt — dann nur im Speicher */
    }
  }, 2000);
}

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
  speichern();
}

/** Schritt von syncomat selbst ins Protokoll (Abo, Auswahl, Beenden, Wunsch). */
export function protokolliere(folderId: string, text: string, action: ActivityEvent["action"] = "modified") {
  addEvent({ id: uid(), ts: Date.now(), folderId, path: "", size: 0, direction: "app", peer: "", action, text });
}

/** Ordner mit lokalen Änderungen, die noch aufs NAS warten. */
export function ordnerMitWartenden(): string[] {
  return [...cache.entries()].filter(([, l]) => l.some((e) => e.nas === "wartet")).map(([id]) => id);
}

/** Das NAS hat den Stand dieses Ordners vollständig: alle lokalen Änderungen
 * bis `bis` (ms) als „beim NAS“ bestätigen. */
export function nasBestaetigt(folderId: string, bis: number) {
  const l = cache.get(folderId);
  if (!l) return;
  let geaendert = false;
  const next = l.map((e) => {
    if (e.nas === "wartet" && e.ts <= bis) {
      geaendert = true;
      return { ...e, nas: "bestaetigt" as const };
    }
    return e;
  });
  if (!geaendert) return;
  cache.set(folderId, next);
  notifyFolder(folderId);
  speichern();
}

/**
 * Globaler Listener auf den Syncthing-Event-Bus. Muss EINMAL beim App-Start
 * gemountet werden — daher der `useActivityListener`-Hook in App.tsx.
 */
/** Eigene Steuerdateien von syncomat (interner Kanal, Notizen) gehören nicht ins Protokoll. */
const intern = (folderId: string, path: string) =>
  folderId === "syncomat-intern" || folderId === "syncomat-waechter" || path === ".syncomat" || path.startsWith(".syncomat/") || path.startsWith(".syncomat\\");

function handleSyncEvent(e: SyncEvent) {
  if (e.type === "ItemFinished") {
    const d = e.data as {
      folder: string;
      item: string;
      action: string;
      type: string;
      error?: string;
    };
    if (!d?.folder || !d?.item || intern(d.folder, d.item)) return;
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
    if (!d?.folderID || !d?.path || intern(d.folderID, d.path)) return;
    addEvent({
      id: uid(),
      ts: Date.now(),
      folderId: d.folderID,
      path: d.path,
      size: 0,
      direction: "local",
      peer: "",
      action: d.action === "deleted" ? "deleted" : d.action === "added" ? "added" : "modified",
      nas: "wartet",
    });
  } else if (e.type === "RemoteChangeDetected" && false) {
    // Entfernte Änderungen zeigt ItemFinished, sobald sie hier angekommen sind —
    // RemoteChangeDetected (Strom /rest/events/disk) gäbe jede Zeile doppelt.
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
/** Einmal in App.tsx: Protokoll hört ab dem Start zu — nicht erst, wenn
 * „Aktivität“ geöffnet ist (bis v0.9.38 ging alles dazwischen verloren). */
export function useActivityListener() {
  useEffect(() => {
    ensureAttached();
  }, []);
}
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

// ── Bündeln (Marlon 11.11.2026) ──────────────────────────────────
// Eine Verteilung mit vielen Dateien (z. B. ein Plugin vom i9) soll eine
// aufklappbare Zeile sein, nicht hunderte. Gebündelt wird, was direkt
// aufeinander folgt: gleicher Ordner, gleiche Richtung, gleiche Art (gelöscht
// oder nicht), gleicher oberster Unterordner, höchstens 3 min Abstand.

export type Buendel = {
  id: string;
  folderId: string;
  /** oberster Unterordner (z. B. das Plugin), "" = Dateien im Stamm */
  oben: string;
  direction: ActivityEvent["direction"];
  geloescht: boolean;
  von: number;
  bis: number;
  events: ActivityEvent[];
};

const BUENDEL_MIN = 3;
const BUENDEL_LUECKE_MS = 3 * 60_000;

/** Oberster Teil des Pfads: der Unterordner — oder bei einem Eintrag im Stamm
 * der Name selbst (so gehört der Ordner „X“ zum Bündel seiner Dateien „X/…“). */
const obenVon = (p: string) => {
  const i = p.search(/[\\/]/);
  return i < 0 ? p : p.slice(0, i);
};

/** Events (neueste zuerst) in Einzelzeilen und Bündel aufteilen. */
export function buendeln(events: ActivityEvent[]): (ActivityEvent | Buendel)[] {
  const out: (ActivityEvent | Buendel)[] = [];
  let lauf: ActivityEvent[] = [];
  const schliessen = () => {
    if (lauf.length >= BUENDEL_MIN) {
      const e0 = lauf[0]!;
      out.push({
        id: `b-${e0.id}`,
        folderId: e0.folderId,
        oben: obenVon(e0.path),
        direction: e0.direction,
        geloescht: e0.action === "deleted",
        bis: e0.ts,
        von: lauf[lauf.length - 1]!.ts,
        events: lauf,
      });
    } else out.push(...lauf);
    lauf = [];
  };
  for (const e of events) {
    const l = lauf[lauf.length - 1];
    const passt =
      l &&
      e.direction !== "app" &&
      l.direction === e.direction &&
      l.folderId === e.folderId &&
      (l.action === "deleted") === (e.action === "deleted") &&
      obenVon(l.path) === obenVon(e.path) &&
      l.ts - e.ts <= BUENDEL_LUECKE_MS;
    if (!passt) schliessen();
    lauf.push(e);
  }
  schliessen();
  return out;
}

export const istBuendel = (x: ActivityEvent | Buendel): x is Buendel => "events" in x;
