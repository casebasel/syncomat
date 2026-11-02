import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { notify } from "./notifications";
import {
  INTERN_FOLDER_ID,
  getRemoteCompletion,
  type DeviceID,
  type Endpoint,
  type Folder,
} from "./syncthing";
import type { UpdateState } from "./updater";

// ── „Alle Geräte aktualisieren" ──────────────────────────────────
//
// Jedes Gerät schreibt seine Version in `.syncomat/update/<deviceID>.json`
// jedes gemeinsamen Ordners (eine Datei pro Gerät → nie Merge-Konflikte, wie
// die net-hints). Drückt jemand „Alle Geräte aktualisieren", trägt sein Gerät
// zusätzlich `request: { version }` ein. Jedes Gerät mit älterer Version holt
// dann über den normalen Updater das signierte Release und installiert es.
//
// Sicherheit: Die Aufforderung kann nur ein offizielles, minisign-geprüftes
// Release auslösen, das mindestens die verlangte Version hat. Nie eine ältere
// Version, nie eine, die es nicht gibt.

const KIND = "update";
const REQUEST_LS = "syncomat.updateAll.request";
const POLL_MS = 60_000;
/** Solange eine Aufforderung offen ist: so oft neu nach dem Release fragen. */
const RECHECK_MS = 10 * 60_000;

export type UpdateNote = {
  by: DeviceID;
  at: number;
  version: string;
  request?: { version: string; at: number };
};

/** Semver-Vergleich für `x.y.z` (ohne Vorabversionen). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

function loadRequest(): { version: string; at: number } | null {
  try {
    const raw = localStorage.getItem(REQUEST_LS);
    return raw ? (JSON.parse(raw) as { version: string; at: number }) : null;
  } catch {
    return null;
  }
}

/**
 * Liest die Versionen aller Geräte, schreibt die eigene, und installiert ein
 * Update selbst, sobald irgendein Gerät eine höhere Version verlangt.
 */
export function useUpdateAll({
  endpoint,
  ready,
  folders,
  myID,
  version,
  updateState,
  recheck,
  installAndRestart,
}: {
  endpoint: Endpoint | null;
  ready: boolean;
  folders: Folder[];
  myID: DeviceID | null;
  version: string | null;
  updateState: UpdateState;
  recheck: () => void;
  installAndRestart: () => void;
}) {
  const [notes, setNotes] = useState<Record<DeviceID, UpdateNote>>({});
  /** Geräte, die den internen Kanal nicht teilen (kein syncomat ≥ v0.9.17). */
  const [noChannel, setNoChannel] = useState<Set<DeviceID>>(new Set());
  const [ownRequest, setOwnRequest] = useState(loadRequest);
  const lastWrittenRef = useRef("");
  const lastRecheckRef = useRef(0);
  const installStartedRef = useRef(false);

  // Nur Ordner, deren Änderungen dieses Gerät auch verschickt.
  const writable = folders.filter((f) => !f.paused && f.type !== "receiveonly");
  const folderKey = folders.map((f) => `${f.path}:${f.type}:${f.paused ? 1 : 0}`).join(",");

  useEffect(() => {
    if (!ready || !myID || !version || folders.length === 0) return;
    let cancelled = false;
    const run = async () => {
      const own: UpdateNote = {
        by: myID,
        at: Date.now(),
        version,
        ...(ownRequest ? { request: ownRequest } : {}),
      };
      // Nur bei Änderung schreiben (`at` zählt nicht) — sonst synct jede Minute
      // eine neue Datei durch alle Ordner.
      const key = JSON.stringify({ ...own, at: 0 });
      const shouldWrite = key !== lastWrittenRef.current;
      const merged: Record<DeviceID, UpdateNote> = {};
      for (const f of folders) {
        if (cancelled) return;
        try {
          if (shouldWrite && writable.some((w) => w.id === f.id)) {
            await invoke("device_note_write", {
              folderPath: f.path,
              kind: KIND,
              deviceId: myID,
              content: JSON.stringify(own),
            });
          }
          const raws = await invoke<string[]>("device_notes_read_all", {
            folderPath: f.path,
            kind: KIND,
          });
          for (const raw of raws) {
            try {
              const n = JSON.parse(raw) as UpdateNote;
              if (!n?.by || !n.version) continue;
              const prev = merged[n.by];
              if (!prev || (n.at ?? 0) > (prev.at ?? 0)) merged[n.by] = n;
            } catch {
              /* kaputte Datei eines anderen Geräts: überspringen */
            }
          }
        } catch (e) {
          console.warn(`[update-all] ${f.label || f.id}:`, e);
        }
      }
      if (shouldWrite) lastWrittenRef.current = key;
      merged[myID] = own;
      // Wer den internen Kanal nicht teilt, hat kein (aktuelles) syncomat —
      // z. B. der NAS-Hub mit reinem Syncthing.
      const intern = folders.find((f) => f.id === INTERN_FOLDER_ID);
      const without = new Set<DeviceID>();
      if (endpoint && intern) {
        for (const d of intern.devices) {
          if (d.deviceID === myID || cancelled) continue;
          try {
            const c = await getRemoteCompletion(endpoint, INTERN_FOLDER_ID, d.deviceID);
            if (c.remoteState === "notSharing") without.add(d.deviceID);
          } catch {
            /* Gerät offline o. ä. — dann nichts behaupten */
          }
        }
      }
      if (!cancelled) {
        setNotes(merged);
        setNoChannel(without);
      }
    };
    void run();
    const id = setInterval(() => void run(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint?.url, ready, myID, version, folderKey, ownRequest?.version, ownRequest?.at]);

  // Höchste verlangte Version (von irgendeinem Gerät).
  let request: { version: string; by: DeviceID } | null = null;
  for (const n of Object.values(notes)) {
    if (!n.request?.version) continue;
    if (!request || compareVersions(n.request.version, request.version) > 0) {
      request = { version: n.request.version, by: n.by };
    }
  }
  const behind = !!(request && version && compareVersions(request.version, version) > 0);

  // Selbst aktualisieren, sobald der Updater ein passendes Release gefunden hat.
  useEffect(() => {
    if (!behind || !request || installStartedRef.current) return;
    if (
      updateState.kind === "available" &&
      compareVersions(updateState.update.version, request.version) >= 0
    ) {
      installStartedRef.current = true;
      void notify(
        "Syncomat wird aktualisiert",
        `Auf v${updateState.update.version} — angefordert von einem anderen Gerät`,
      );
      installAndRestart();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [behind, request?.version, updateState.kind]);

  // Der Updater prüft sonst nur alle 6 h — solange eine Aufforderung offen ist,
  // regelmässig nachfragen (das Release kann ein paar Minuten nach dem Knopf
  // erst fertig gebaut sein).
  const busyRef = useRef(false);
  busyRef.current =
    updateState.kind === "checking" ||
    updateState.kind === "downloading" ||
    updateState.kind === "ready";
  useEffect(() => {
    if (!behind) return;
    const tick = () => {
      if (busyRef.current || installStartedRef.current) return;
      lastRecheckRef.current = Date.now();
      recheck();
    };
    if (Date.now() - lastRecheckRef.current >= RECHECK_MS) tick();
    const id = setInterval(tick, RECHECK_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [behind, request?.version]);

  /** Alle Geräte auf die Version DIESES Geräts bringen. */
  const requestAll = useCallback(() => {
    if (!version) return;
    const r = { version, at: Date.now() };
    try {
      localStorage.setItem(REQUEST_LS, JSON.stringify(r));
    } catch {
      /* ohne localStorage gilt die Aufforderung nur bis zum Neustart */
    }
    setOwnRequest(r);
  }, [version]);

  // Die eigene Version ist immer bekannt, auch ohne einen einzigen Ordner.
  const withOwn =
    myID && version && !notes[myID]
      ? { ...notes, [myID]: { by: myID, at: Date.now(), version } }
      : notes;

  return { notes: withOwn, noChannel, request, requestAll };
}
