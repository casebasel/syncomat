import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { papierkorbVon } from "./papierkorb";

export type ConflictItem = {
  conflict_rel: string;
  original_rel: string;
  original_exists: boolean;
  conflict_size: number;
  original_size: number;
  conflict_mtime: number;
  original_mtime: number;
  peer_fragment: string;
  when: string;
};

export const conflictsList = (folderPath: string) =>
  invoke<ConflictItem[]>("conflicts_list", { folderPath });

export const conflictsKeepLocal = (folderPath: string, conflictRel: string) =>
  invoke<void>("conflicts_keep_local", { folderPath, conflictRel });

export const conflictsTakeRemote = (
  folderPath: string,
  conflictRel: string,
  originalRel: string,
) =>
  invoke<void>("conflicts_take_remote", {
    folderPath,
    conflictRel,
    originalRel,
  });

export const conflictsKeepBoth = (
  folderPath: string,
  conflictRel: string,
  peerFragment: string,
) =>
  invoke<string>("conflicts_keep_both", { folderPath, conflictRel, peerFragment });

export type ResolveAllMode = "keep_local" | "keep_remote" | "keep_newest";

/** Löst ALLE Konflikte eines Ordners in einem Rutsch auf (für den "zwei
 * befüllte Ordner verbinden"-Workflow). Gibt die Anzahl aufgelöster zurück. */
export const conflictsResolveAll = (folderPath: string, mode: ResolveAllMode) =>
  invoke<number>("conflicts_resolve_all", { folderPath, mode });

// ── Modul-level Cache + Request-Coalescing + Subscribe-Pattern ──
//
// Vor v0.1.13: jede LinkedFolderCard hatte ihren eigenen WalkDir-Poll alle 60s.
// Bei 5 Folders × 100k Files = 500k stat-calls/min — Audit-Top-Finding.
// Jetzt: ein einziger WalkDir pro folderPath, gecached 60s, geteilt zwischen
// FolderCard-Hooks und ConflictResolverModal.
//
// v0.1.21: invalidateConflictCache notifiziert alle subscribers — damit die
// FolderCard's Conflict-Badge SOFORT verschwindet wenn der User im Modal einen
// Konflikt aufloest, statt erst beim naechsten 5-min-poll.

type CacheEntry = { items: ConflictItem[]; at: number };
const conflictCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000;
const pendingFetches = new Map<string, Promise<ConflictItem[]>>();
const subscribers = new Map<string, Set<() => void>>();

export async function fetchConflictsCoalesced(folderPath: string): Promise<ConflictItem[]> {
  const existing = conflictCache.get(folderPath);
  if (existing && Date.now() - existing.at < CACHE_TTL_MS) {
    return existing.items;
  }
  const inflight = pendingFetches.get(folderPath);
  if (inflight) return inflight;
  const promise = conflictsList(folderPath)
    .then((items) => {
      conflictCache.set(folderPath, { items, at: Date.now() });
      pendingFetches.delete(folderPath);
      // Notify subscribers — andere offene Hooks bekommen frische Daten
      const subs = subscribers.get(folderPath);
      if (subs) for (const s of subs) s();
      return items;
    })
    .catch((e) => {
      pendingFetches.delete(folderPath);
      throw e;
    });
  pendingFetches.set(folderPath, promise);
  return promise;
}

/** Manuell den Cache invalidieren — z.B. nach keep_local/take_remote.
 * Triggert sofortigen re-fetch in allen subscribed hooks. */
export function invalidateConflictCache(folderPath: string) {
  conflictCache.delete(folderPath);
  // Trigger fetch — der wird die subscribers nach success benachrichtigen
  void fetchConflictsCoalesced(folderPath).catch(() => {});
}

function subscribe(folderPath: string, fn: () => void): () => void {
  let subs = subscribers.get(folderPath);
  if (!subs) {
    subs = new Set();
    subscribers.set(folderPath, subs);
  }
  subs.add(fn);
  return () => {
    const s = subscribers.get(folderPath);
    if (s) {
      s.delete(fn);
      if (s.size === 0) subscribers.delete(folderPath);
    }
  };
}

// ── Hook: pro Folder die Liste der Konflikte ──
//
// "active" mode: nur ConflictResolverModal setzt active=true. FolderCards
// pollen im sparsam-Modus (5 Min statt 60s) — bei Unreal-Scale ist Conflict-
// Detection nichts was öfter passieren muss als alle paar Minuten.

export function useFolderConflicts(
  folderPath: string | null,
  options: { active?: boolean } = {},
) {
  const [items, setItems] = useState<ConflictItem[] | null>(null);
  const [tick, setTick] = useState(0);
  const lastFetchRef = useRef(0);
  const active = options.active ?? false;
  const intervalMs = active ? 60_000 : 5 * 60_000;

  useEffect(() => {
    if (!folderPath) {
      setItems(null);
      return;
    }
    let cancelled = false;
    const fetchOnce = () => {
      lastFetchRef.current = Date.now();
      fetchConflictsCoalesced(folderPath)
        .then((data) => !cancelled && setItems(data))
        .catch(() => !cancelled && setItems([]));
    };
    fetchOnce();
    const id = setInterval(fetchOnce, intervalMs);
    // Subscribe — wenn jemand anders invalidateConflictCache aufruft,
    // bekommen wir sofort fetchOnce (statt erst beim naechsten interval-tick).
    const unsub = subscribe(folderPath, fetchOnce);
    return () => {
      cancelled = true;
      clearInterval(id);
      unsub();
    };
  }, [folderPath, tick, intervalMs]);

  return {
    items,
    count: items?.length ?? 0,
    refresh: () => {
      if (folderPath) invalidateConflictCache(folderPath);
      setTick((t) => t + 1);
    },
  };
}

// ── Helpers für die UI ──

export function fmtConflictBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function fmtConflictWhen(when: string): string {
  // when = "YYYYMMDD-HHMMSS"
  if (when.length !== 15) return when;
  const y = when.slice(0, 4);
  const m = when.slice(4, 6);
  const d = when.slice(6, 8);
  const hh = when.slice(9, 11);
  const mm = when.slice(11, 13);
  return `${d}.${m}.${y} ${hh}:${mm}`;
}

// ── Neue Konfliktkopien wegräumen (wie Resilio ohne Archiv) ──────────
//
// maxConflicts=0 wirkt nur auf dem Rechner, dessen Fassung verliert. Der
// Gewinner lädt die unterlegene Fassung trotzdem als `.sync-conflict-…` herunter
// (K10, render/Mac 11.11.2026), und von dort geht sie an alle. Marlon: keine
// Kopien im Projekt — die neuere Fassung gewinnt. Deshalb schiebt syncomat neue
// Kopien in den lokalen Papierkorb (30 Tage, lib/papierkorb.ts), sobald das
// Original da ist; auf den anderen Rechnern landet die Kopie über Syncthings
// Papierkorb ebenfalls dort. Kopien von vor dieser Regel bleiben (erst Marlon zeigen).

const AB_LS = "syncomat.konflikte.wegraeumen.ab";
const RAEUMEN_MS = 10 * 60_000;

function abStempel(): string {
  const jetzt = () => {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  };
  try {
    const v = localStorage.getItem(AB_LS);
    if (v) return v;
    const s = jetzt();
    localStorage.setItem(AB_LS, s);
    return s;
  } catch {
    return jetzt(); // ohne Speicher nur Kopien ab jetzt
  }
}

export function useKonfliktkopienWegraeumen(
  folders: { id: string; path: string; type: string; paused: boolean }[],
  protokolliere: (folderId: string, text: string) => void,
) {
  const stand = useRef(folders);
  stand.current = folders;
  useEffect(() => {
    const ab = abStempel();
    let busy = false;
    const raeumen = async () => {
      if (busy) return;
      busy = true;
      try {
        // „Nur empfangen“: lokales Löschen ginge nicht weiter, bliebe als Abweichung.
        for (const f of stand.current.filter((x) => !x.paused && x.type !== "receiveonly")) {
          const liste = await conflictsList(f.path).catch(() => [] as ConflictItem[]);
          const neu = liste.filter((c) => c.when >= ab && c.original_exists);
          let n = 0;
          const pk = papierkorbVon(f.id);
          if (!pk) continue; // ohne Papierkorb nichts anfassen
          for (const c of neu) {
            await invoke("in_papierkorb", { folderPath: f.path, rel: c.conflict_rel, papierkorb: pk })
              .then(() => n++)
              .catch(() => {});
          }
          if (n > 0) {
            invalidateConflictCache(f.path);
            protokolliere(
              f.id,
              `${n} ältere Fassung(en) in den Papierkorb gelegt (30 Tage) — die neuere gilt (z. B. ${neu[0]!.original_rel}).`,
            );
          }
        }
      } finally {
        busy = false;
      }
    };
    const erst = setTimeout(() => void raeumen(), 60_000);
    const t = setInterval(() => void raeumen(), RAEUMEN_MS);
    return () => {
      clearTimeout(erst);
      clearInterval(t);
    };
  }, []);
}
