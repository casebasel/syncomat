import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import {
  folderError,
  getDeviceStats,
  getFolderIgnores,
  getFolderStatus,
  getRemoteCompletion,
  type Config,
  type Connection,
  type DeviceID,
  type Endpoint,
  type Folder,
  type FolderStatus,
  type PendingFolder,
} from "./syncthing";
import { isAboFolderId } from "./datenzentrale";
import { projektFarbe, projektIdAusFolderId } from "./projektFarbe";
import { freiAufD, istInhaltOrdner, nasProjekte, type NasProjekt } from "./nasProjekte";
import { auswahlAusIgnores, schutzRegeln, type GeraeteRolle } from "./abo";
import { WUNSCH_PROTOKOLL, ladeErledigt, type WunschErgebnis } from "./wuensche";
import { fetchConflictsCoalesced } from "./conflicts";
import { notify } from "./notifications";

// ── Übersicht Projekte × Rechner ─────────────────────────────────
//
// Zeilen: Projekte auf dem NAS (Abo-Ordner dz-…) und die Plugins (Ordner „an
// alle“). Spalten: dieser Rechner zuerst, dann die anderen syncomat-Rechner.
// Den Stand der ANDEREN Rechner kennt dieser Rechner für Projekte, die er
// selbst nicht abonniert hat, nicht aus Syncthing — darum meldet jedes Gerät
// seine Abos (und Rolle, frei auf D:) über den internen Kanal
// (`.syncomat/abos/<deviceID>.json` in syncomat-intern).

export type ZellZustand = "aktuell" | "laedt" | "angehalten" | "nicht" | "unbekannt";

export type Zelle = {
  zustand: ZellZustand;
  /** 0–100 beim Laden */
  prozent?: number;
  /** nur Unterordner abonniert */
  teil?: boolean;
  /** Rechner gerade nicht verbunden (letzter bekannter Stand) */
  offline?: boolean;
  grund?: string;
  /** gewählte Unterordner ([] = ganzes Projekt; fehlt = unbekannt) */
  auswahl?: string[];
  /** Dateien hier AUSSERHALB der Auswahl — werden nicht abgeglichen, also
   * auch nicht gesichert (z. B. ein neu angelegter Ordner). */
  ungesichert?: { anzahl: number; beispiele: string[] };
  /** Konfliktkopien (.sync-conflict-…) in diesem Ordner hier */
  konflikte?: number;
  /** Dateien, die Syncthing hier nicht abgleichen kann */
  dateifehler?: number;
};

export type Zeile = {
  folderId: string;
  name: string;
  art: "projekt" | "plugin";
  farbe: string | null;
  /** auf diesem Rechner eingerichtet */
  hier: Folder | null;
  /** Angebot des NAS (noch nicht abonniert) */
  angebot: NasProjekt | null;
  zellen: Record<DeviceID, Zelle>;
  /** irgendwo angehalten */
  stoerung: boolean;
  /** Grösse der Arbeitskopie auf diesem Rechner (nur wenn hier). */
  bytes: number | null;
};

export type Spalte = {
  id: DeviceID;
  name: string;
  ich: boolean;
  online: boolean;
  rolle: GeraeteRolle | null;
  freiD: number | null;
  /** nimmt Wünsche anderer Rechner an (syncomat ≥ v0.9.27) */
  kannWuensche: boolean;
  /** zuletzt verbunden (ms), wenn gerade nicht verbunden */
  zuletzt?: number | null;
};

type AboNotizEintrag = { folder_id: string; name: string } & Zelle;
type AboNotiz = {
  by: DeviceID;
  at: number;
  rolle: GeraeteRolle;
  frei_d: number | null;
  abos: AboNotizEintrag[];
  /** Protokoll der Wünsche (fehlt = ältere Version, nimmt keine an) */
  kann_wuensche?: number;
  /** eigener Computername (für Geräte, die anderswo ohne Namen eingetragen sind) */
  name?: string;
  wuensche_erledigt?: WunschErgebnis[];
};

const KIND = "abos";
const TAKT_MS = 3_000;
const NOTIZ_MS = 15_000;
/** Eine Notiz älter als das gilt als „nicht mehr gemeldet“. */
const NOTIZ_ALT_MS = 10 * 60_000;

export function zelleAusStatus(s: FolderStatus | null, f: Folder): Zelle {
  if (f.paused) return { zustand: "angehalten", grund: "Pausiert" };
  if (!s) return { zustand: "unbekannt" };
  const err = folderError(s);
  if (err) return { zustand: "angehalten", grund: err };
  const fehler = s.errors > 0 ? { dateifehler: s.errors } : {};
  const total = s.localBytes + s.needBytes;
  if (s.needBytes > 0 || s.state === "syncing") {
    return { zustand: "laedt", prozent: total > 0 ? Math.floor((s.localBytes / total) * 100) : 0, ...fehler };
  }
  return { zustand: "aktuell", ...fehler };
}

/** Braucht diese Zelle Aufmerksamkeit? (angehalten, Konflikte, Dateifehler) */
export const zelleStoerung = (z: Zelle) => z.zustand === "angehalten" || (z.konflikte ?? 0) > 0 || (z.dateifehler ?? 0) > 0;

/** Prozent grob runden, damit die Notiz nicht bei jedem Byte neu geschrieben wird. */
const grob = (z: Zelle): Zelle => (z.prozent != null ? { ...z, prozent: Math.floor(z.prozent / 10) * 10 } : z);

export function useUebersicht({
  ep,
  ready,
  config,
  pending,
  myID,
  myName,
  connections,
  intern,
  ohneSyncomat,
  rolle,
  erledigtHier,
}: {
  ep: Endpoint | null;
  ready: boolean;
  config: Config | null;
  pending: PendingFolder[];
  myID: DeviceID | null;
  myName: string;
  connections: Record<DeviceID, Connection>;
  intern: Folder | null;
  /** Geräte ohne syncomat (z. B. NAS-Hub) — keine Spalte. */
  ohneSyncomat: Set<DeviceID>;
  rolle: GeraeteRolle;
  /** Ergebnisse der an diesen Rechner gerichteten Wünsche (useWuensche). */
  erledigtHier?: WunschErgebnis[];
}) {
  const [status, setStatus] = useState<Record<string, FolderStatus | null>>({});
  const [remote, setRemote] = useState<Record<string, Record<DeviceID, Zelle>>>({});
  const [notizen, setNotizen] = useState<Record<DeviceID, AboNotiz>>({});
  const [frei, setFrei] = useState<{ frei: number; total: number } | null>(null);
  /** Wirklich geltende Auswahl je eigenem Abo (aus der .stignore). */
  const [auswahlHier, setAuswahlHier] = useState<Record<string, string[] | null>>({});
  const [ungesichert, setUngesichert] = useState<Record<string, { anzahl: number; beispiele: string[] }>>({});
  const [konflikte, setKonflikte] = useState<Record<string, number>>({});
  const [zuletzt, setZuletzt] = useState<Record<DeviceID, number>>({});
  const konfliktVorherRef = useRef<Record<string, number>>({});
  const lastNoteRef = useRef("");

  const folders = (config?.folders ?? []).filter((f) => f.id !== intern?.id && !istInhaltOrdner(f));
  const folderKey = folders.map((f) => `${f.id}:${f.paused ? 1 : 0}:${f.devices.length}`).join(",");

  // Eigener Stand der Ordner (schnell) + freier Platz auf D:
  useEffect(() => {
    if (!ep || !ready) return;
    let cancelled = false;
    const run = async () => {
      const next: Record<string, FolderStatus | null> = {};
      for (const f of folders) next[f.id] = await getFolderStatus(ep, f.id).catch(() => null);
      if (!cancelled) setStatus(next);
    };
    void run();
    const id = setInterval(() => void run(), TAKT_MS);
    const aw = async () => {
      const m: Record<string, string[] | null> = {};
      for (const f of folders.filter((x) => isAboFolderId(x.id))) {
        m[f.id] = await getFolderIgnores(ep, f.id)
          .then((r) => auswahlAusIgnores(r.ignore))
          .catch(() => null);
      }
      if (!cancelled) setAuswahlHier(m);
    };
    void aw();
    const id3 = setInterval(() => void aw(), NOTIZ_MS);
    // Alle 5 min: liegen hier Dateien ausserhalb der Auswahl? (Rust-Prüfung
    // „Alles statt Auswahl“: was dann neu dazukäme, wird heute nicht gesichert.)
    const ug = async () => {
      const m: Record<string, { anzahl: number; beispiele: string[] }> = {};
      for (const f of folders.filter((x) => isAboFolderId(x.id))) {
        const ign = await getFolderIgnores(ep, f.id).catch(() => null);
        const sel = ign ? auswahlAusIgnores(ign.ignore) : null;
        if (!ign || !sel || sel.length === 0) continue;
        const r = await invoke<{ streuner: string[]; streuner_anzahl: number }>("auswahl_pruefen", {
          root: f.path,
          alt: sel,
          neu: [],
          ...schutzRegeln(ign.ignore ?? []),
          index: null,
        }).catch(() => null);
        if (r && r.streuner_anzahl > 0) m[f.id] = { anzahl: r.streuner_anzahl, beispiele: r.streuner.slice(0, 5) };
      }
      if (!cancelled) setUngesichert(m);
    };
    void ug();
    const id4 = setInterval(() => void ug(), 5 * 60_000);
    // Konfliktkopien je Ordner (alle 5 min, wie früher in der Seitenleiste).
    const kf = async () => {
      const m: Record<string, number> = {};
      for (const f of folders) {
        const liste = await fetchConflictsCoalesced(f.path).catch(() => null);
        if (liste && liste.length > 0) m[f.id] = liste.length;
      }
      if (cancelled) return;
      for (const f of folders) {
        const n = m[f.id] ?? 0;
        if (n > (konfliktVorherRef.current[f.id] ?? 0)) {
          void notify("Konflikt in " + (f.label || f.id), `${n} Konfliktkopie(n) — in syncomat ansehen und auflösen.`);
        }
      }
      konfliktVorherRef.current = m;
      setKonflikte(m);
    };
    void kf();
    const id5 = setInterval(() => void kf(), 5 * 60_000);
    const zs = async () => {
      const st = await getDeviceStats(ep).catch(() => null);
      if (!st || cancelled) return;
      const m: Record<DeviceID, number> = {};
      for (const [id, v] of Object.entries(st)) {
        const t = v.lastSeen ? Date.parse(v.lastSeen) : NaN;
        // Syncthing meldet „nie“ als 1970
        if (Number.isFinite(t) && t > 86_400_000) m[id] = t;
      }
      setZuletzt(m);
    };
    void zs();
    const id6 = setInterval(() => void zs(), 60_000);
    const fd = () => void freiAufD().then((v) => !cancelled && setFrei(v));
    fd();
    const id2 = setInterval(fd, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
      clearInterval(id2);
      clearInterval(id3);
      clearInterval(id4);
      clearInterval(id5);
      clearInterval(id6);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ep?.url, ep?.api_key, ready, folderKey]);

  // Stand der anderen Rechner für Ordner, die DIESER Rechner führt (Plugins, eigene Abos)
  useEffect(() => {
    if (!ep || !ready || !myID) return;
    let cancelled = false;
    const run = async () => {
      const next: Record<string, Record<DeviceID, Zelle>> = {};
      for (const f of folders) {
        const z: Record<DeviceID, Zelle> = {};
        for (const d of f.devices) {
          if (d.deviceID === myID) continue;
          const c = await getRemoteCompletion(ep, f.id, d.deviceID).catch(() => null);
          if (!c || c.remoteState === "notSharing") z[d.deviceID] = { zustand: "nicht" };
          else if (c.remoteState === "valid")
            z[d.deviceID] =
              c.completion >= 100 && c.needItems === 0
                ? { zustand: "aktuell" }
                : { zustand: "laedt", prozent: Math.floor(c.completion) };
          else z[d.deviceID] = { zustand: "unbekannt", offline: true };
        }
        next[f.id] = z;
      }
      if (!cancelled) setRemote(next);
    };
    void run();
    const id = setInterval(() => void run(), NOTIZ_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ep?.url, ep?.api_key, ready, myID, folderKey]);

  // Eigene Abos melden + Notizen der anderen lesen (interner Kanal)
  const eigeneAbos: AboNotizEintrag[] = folders
    .filter((f) => isAboFolderId(f.id))
    .map((f) => ({
      folder_id: f.id,
      name: f.label || f.id,
      ...grob(zelleAusStatus(status[f.id] ?? null, f)),
      teil: (auswahlHier[f.id] ?? []).length > 0,
      ...(auswahlHier[f.id] ? { auswahl: auswahlHier[f.id]! } : {}),
    }));
  const erledigt = erledigtHier ?? ladeErledigt();
  const eigeneKey = JSON.stringify({ rolle, frei: frei ? Math.round(frei.frei / 1e9) : null, eigeneAbos, erledigt, myName });
  useEffect(() => {
    if (!ready || !myID || !intern) return;
    let cancelled = false;
    const run = async () => {
      if (eigeneKey !== lastNoteRef.current) {
        const notiz: AboNotiz = {
          by: myID,
          at: Date.now(),
          rolle,
          frei_d: frei?.frei ?? null,
          abos: eigeneAbos,
          kann_wuensche: WUNSCH_PROTOKOLL,
          ...(myName ? { name: myName } : {}),
          wuensche_erledigt: erledigt,
        };
        await invoke("device_note_write", {
          folderPath: intern.path,
          kind: KIND,
          deviceId: myID,
          content: JSON.stringify(notiz),
        })
          .then(() => (lastNoteRef.current = eigeneKey))
          .catch((e) => console.warn("[abos] Notiz schreiben", e));
      }
      const raws = await invoke<string[]>("device_notes_read_all", { folderPath: intern.path, kind: KIND }).catch(
        () => [] as string[],
      );
      const m: Record<DeviceID, AboNotiz> = {};
      for (const r of raws) {
        try {
          const n = JSON.parse(r) as AboNotiz;
          if (n?.by) m[n.by] = n;
        } catch {
          /* kaputte Notiz eines anderen Geräts überspringen */
        }
      }
      if (!cancelled) setNotizen(m);
    };
    void run();
    const id = setInterval(() => void run(), NOTIZ_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, myID, intern?.path, eigeneKey]);

  // ── Modell zusammensetzen ──
  const spalten: Spalte[] = [];
  if (myID) {
    spalten.push({ id: myID, name: myName || "Dieser Rechner", ich: true, online: true, rolle, freiD: frei?.frei ?? null, kannWuensche: true });
  }
  for (const d of config?.devices ?? []) {
    if (d.deviceID === myID || ohneSyncomat.has(d.deviceID)) continue;
    const n = notizen[d.deviceID];
    spalten.push({
      id: d.deviceID,
      name: d.name?.trim() || n?.name?.trim() || d.deviceID.slice(0, 7),
      ich: false,
      online: !!connections[d.deviceID]?.connected,
      rolle: n?.rolle ?? null,
      freiD: n?.frei_d ?? null,
      kannWuensche: (n?.kann_wuensche ?? 0) >= WUNSCH_PROTOKOLL,
      zuletzt: connections[d.deviceID]?.connected ? null : (zuletzt[d.deviceID] ?? null),
    });
  }

  const angebote = nasProjekte(pending, folders);
  const projekte = new Map<string, Zeile>();
  const neueZeile = (folderId: string, name: string, art: Zeile["art"]): Zeile => {
    const pid = art === "projekt" ? projektIdAusFolderId(folderId) : null;
    return { folderId, name, art, farbe: pid ? projektFarbe(pid) : null, hier: null, angebot: null, zellen: {}, stoerung: false, bytes: null };
  };
  for (const f of folders.filter((x) => isAboFolderId(x.id))) {
    const z = neueZeile(f.id, f.label || f.id, "projekt");
    z.hier = f;
    z.bytes = status[f.id]?.localBytes ?? null;
    projekte.set(f.id, z);
  }
  for (const a of angebote) {
    const z = projekte.get(a.folderId) ?? neueZeile(a.folderId, a.name, "projekt");
    z.angebot = a;
    projekte.set(a.folderId, z);
  }
  for (const n of Object.values(notizen)) {
    for (const a of n.abos ?? []) {
      if (!projekte.has(a.folder_id)) projekte.set(a.folder_id, neueZeile(a.folder_id, a.name, "projekt"));
    }
  }

  for (const z of projekte.values()) {
    for (const sp of spalten) {
      if (sp.ich) {
        z.zellen[sp.id] = z.hier
          ? {
              ...zelleAusStatus(status[z.folderId] ?? null, z.hier),
              teil: (auswahlHier[z.folderId] ?? []).length > 0,
              ...(auswahlHier[z.folderId] ? { auswahl: auswahlHier[z.folderId]! } : {}),
              ...(ungesichert[z.folderId] ? { ungesichert: ungesichert[z.folderId] } : {}),
              ...(konflikte[z.folderId] ? { konflikte: konflikte[z.folderId] } : {}),
            }
          : { zustand: "nicht" };
        continue;
      }
      const n = notizen[sp.id];
      const frisch = n && Date.now() - n.at < NOTIZ_ALT_MS;
      const eintrag = n?.abos?.find((a) => a.folder_id === z.folderId);
      let zelle: Zelle = eintrag
        ? { zustand: eintrag.zustand, prozent: eintrag.prozent, teil: eintrag.teil, grund: eintrag.grund, auswahl: eintrag.auswahl }
        : n
          ? { zustand: "nicht" }
          : { zustand: "unbekannt" };
      // Live-Stand aus Syncthing, wenn beide den Ordner führen
      const live = remote[z.folderId]?.[sp.id];
      if (live && live.zustand !== "nicht" && live.zustand !== "unbekannt") zelle = { ...zelle, ...live };
      if (!sp.online) zelle = { ...zelle, offline: true };
      else if (!frisch && !eintrag && !live) zelle = { zustand: "unbekannt" };
      z.zellen[sp.id] = zelle;
    }
    z.stoerung = Object.values(z.zellen).some(zelleStoerung);
  }

  const plugins: Zeile[] = folders
    .filter((f) => !isAboFolderId(f.id))
    .map((f) => {
      const z = neueZeile(f.id, f.label || f.id, "plugin");
      z.hier = f;
      z.bytes = status[f.id]?.localBytes ?? null;
      for (const sp of spalten) {
        if (sp.ich) {
          const zz = zelleAusStatus(status[f.id] ?? null, f);
          z.zellen[sp.id] = konflikte[f.id] ? { ...zz, konflikte: konflikte[f.id] } : zz;
        }
        else {
          const r = remote[f.id]?.[sp.id] ?? { zustand: "nicht" as const };
          z.zellen[sp.id] = sp.online ? r : { ...r, offline: true };
        }
      }
      z.stoerung = Object.values(z.zellen).some(zelleStoerung);
      return z;
    });

  const sortiert = [...projekte.values()].sort(
    (a, b) => Number(b.stoerung) - Number(a.stoerung) || a.name.localeCompare(b.name, "de"),
  );
  const hier = sortiert.filter((z) => z.hier).length;

  const erledigtVon: Record<DeviceID, WunschErgebnis[]> = {};
  for (const n of Object.values(notizen)) if (n.wuensche_erledigt) erledigtVon[n.by] = n.wuensche_erledigt;

  return {
    erledigtVon,
    spalten,
    projekte: sortiert,
    plugins,
    lage: {
      freiD: frei?.frei ?? null,
      abosHier: hier,
      stoerungen: [...sortiert, ...plugins].filter((z) => z.stoerung).length,
      ungesichert: Object.values(ungesichert).reduce((a, u) => a + u.anzahl, 0),
    },
  };
}
