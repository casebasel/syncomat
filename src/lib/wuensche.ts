import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Config, Connection, DeviceID, Endpoint, Folder, PendingFolder } from "./syncthing";
import { auswahlAusIgnores, normalisiereAuswahl, pruefeAuswahl, type GeraeteRolle } from "./abo";
import { getFolderIgnores } from "./syncthing";
import {
  aboAbbrechen,
  aboAuswahlAendern,
  aboBeenden,
  aboStarten,
  aboVorbereiten,
  istInhaltOrdner,
  nasProjekte,
} from "./nasProjekte";

// ── Wünsche: die Auswahl eines ANDEREN Rechners ändern ───────────
//
// Jeder Rechner darf für jeden Rechner festlegen, was von einem Projekt dort
// liegt (Marlon, 07.11.2026). Ausgeführt wird aber immer am Zielrechner
// selbst, mit seinen eigenen Prüfungen (Platz, NAS hat alles, keine
// Streuner …) — nie von fern in fremde Dateien.
//
// Weg: Der Schreiber legt den Wunsch in SEINE Notiz
// `.syncomat/wunsch/<schreiberID>.json` im internen Kanal (eine Datei je
// Gerät → nie Konflikte). Der NAS-Hub trägt den Kanal mit (seit 07.11.2026),
// darum erreicht ein Wunsch auch einen Rechner, der erst später eingeschaltet
// wird — er gleicht beim Start als Erstes den Kanal ab.
// Der Zielrechner nimmt je Projekt den NEUESTEN Wunsch (über alle Schreiber),
// führt ihn einmal aus und meldet das Ergebnis in seiner Abos-Notiz
// (`wuensche_erledigt`). Sieht der Schreiber das Ergebnis, nimmt er den
// Wunsch aus seiner Notiz.

const KIND = "wunsch";
const TAKT_MS = 15_000;
/** Ältere Wünsche führt niemand mehr aus (ein Rechner, der Monate aus war,
 * soll nicht plötzlich alte Absichten umsetzen). */
export const WUNSCH_MAX_ALTER_MS = 30 * 86_400_000;
const ERLEDIGT_LS = "syncomat.wuensche.erledigt";
const ERLEDIGT_MAX = 40;
/** Version des Wunsch-Protokolls; steht in der Abos-Notiz (`kann_wuensche`). */
export const WUNSCH_PROTOKOLL = 1;

export type WunschArt = "auswahl" | "beenden";

export type Wunsch = {
  id: string;
  ziel: DeviceID;
  folder_id: string;
  name: string;
  /** auswahl: abonnieren bzw. Auswahl setzen ([] = ganzes Projekt); beenden: Abo beenden */
  art: WunschArt;
  auswahl: string[];
  /** Auswahl, die der Sender beim Ziel sah (null = nicht abonniert). Hat das
   * Ziel inzwischen eine andere, wird der Wunsch nicht ausgeführt — so läuft
   * auch nie ein alter Wunsch ein zweites Mal. */
  vorher: string[] | null;
  at: number;
};

export type WunschNotiz = {
  by: DeviceID;
  at: number;
  wuensche: Wunsch[];
  /** Vom Schreiber AUSGEFÜHRTE Wünsche anderer (dauerhaft, nicht nur im
   * Browser-Speicher: überlebt Neuinstallation). */
  erledigt?: WunschErgebnis[];
};

export type WunschErgebnis = { id: string; ok: boolean; text: string; at: number };

const neueId = () => {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  return "wu-" + [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
};

export function ladeErledigt(): WunschErgebnis[] {
  try {
    const v = JSON.parse(localStorage.getItem(ERLEDIGT_LS) ?? "[]");
    return Array.isArray(v) ? (v as WunschErgebnis[]) : [];
  } catch {
    return [];
  }
}
function merkeErledigt(...neue: WunschErgebnis[]) {
  const ids = new Set(neue.map((x) => x.id));
  const liste = [...neue, ...ladeErledigt().filter((x) => !ids.has(x.id))]
    .sort((a, b) => b.at - a.at)
    .slice(0, ERLEDIGT_MAX);
  try {
    localStorage.setItem(ERLEDIGT_LS, JSON.stringify(liste));
  } catch {
    /* ohne Speicher: höchstens erneut ausgeführt — jede Ausführung ist wiederholbar */
  }
  return liste;
}

function gueltig(w: unknown): w is Wunsch {
  const x = w as Wunsch;
  return (
    !!x &&
    typeof x.id === "string" &&
    /^wu-[0-9a-f]{24}$/.test(x.id) &&
    typeof x.ziel === "string" &&
    typeof x.folder_id === "string" &&
    x.folder_id.startsWith("dz-") &&
    (x.art === "auswahl" || x.art === "beenden") &&
    Array.isArray(x.auswahl) &&
    x.auswahl.every((p) => typeof p === "string") &&
    (x.vorher === null || (Array.isArray(x.vorher) && x.vorher.every((p) => typeof p === "string"))) &&
    typeof x.at === "number"
  );
}

/** Für jedes (Ziel, Projekt) der neueste Wunsch über alle Schreiber. */
export function neuesteWuensche(notizen: WunschNotiz[]): Map<string, Wunsch & { von: DeviceID }> {
  const m = new Map<string, Wunsch & { von: DeviceID }>();
  for (const n of notizen) {
    for (const w of n.wuensche ?? []) {
      if (!gueltig(w)) continue;
      const k = `${w.ziel}|${w.folder_id}`;
      const alt = m.get(k);
      if (!alt || w.at > alt.at || (w.at === alt.at && w.id > alt.id)) m.set(k, { ...w, von: n.by });
    }
  }
  return m;
}

/**
 * Wünsche schreiben (eigene Notiz), lesen (alle Notizen) und die an DIESEN
 * Rechner gerichteten ausführen.
 */
export function useWuensche({
  ep,
  ready,
  config,
  pending,
  intern,
  myID,
  rolle,
  erledigtVon,
  connections,
}: {
  ep: Endpoint | null;
  ready: boolean;
  config: Config | null;
  pending: PendingFolder[];
  intern: Folder | null;
  myID: DeviceID | null;
  rolle: GeraeteRolle;
  /** Ergebnisse der anderen Rechner (aus ihren Abos-Notizen). */
  erledigtVon: Record<DeviceID, WunschErgebnis[]>;
  connections: Record<DeviceID, Connection>;
}) {
  const startRef = useRef(Date.now());
  const [eigene, setEigene] = useState<Wunsch[] | null>(null);
  const [alle, setAlle] = useState<WunschNotiz[]>([]);
  const [erledigt, setErledigt] = useState<WunschErgebnis[]>(ladeErledigt);
  const [laeuft, setLaeuft] = useState<string | null>(null);
  const lastWrittenRef = useRef<string | null>(null);
  const busyRef = useRef(false);
  const configRef = useRef(config);
  configRef.current = config;
  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  // Lesen (und beim ersten Mal die eigene Liste aus der Datei übernehmen)
  useEffect(() => {
    if (!ready || !myID || !intern) return;
    let cancelled = false;
    const run = async () => {
      const raws = await invoke<string[]>("device_notes_read_all", { folderPath: intern.path, kind: KIND }).catch(
        () => [] as string[],
      );
      const liste: WunschNotiz[] = [];
      for (const r of raws) {
        try {
          const n = JSON.parse(r) as WunschNotiz;
          if (n?.by && Array.isArray(n.wuensche)) liste.push(n);
        } catch {
          /* kaputte Notiz überspringen */
        }
      }
      if (cancelled) return;
      setAlle(liste);
      const meine = liste.find((n) => n.by === myID);
      setEigene((e) => e ?? (meine?.wuensche ?? []).filter(gueltig));
      // Erledigtes aus der eigenen Notiz übernehmen (falls der Browser-Speicher leer ist).
      const ausDatei = (meine?.erledigt ?? []).filter((x) => x && typeof x.id === "string");
      if (ausDatei.some((x) => !ladeErledigt().some((y) => y.id === x.id))) setErledigt(merkeErledigt(...ausDatei));
    };
    void run();
    const id = setInterval(() => void run(), TAKT_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [ready, myID, intern?.path]);

  // Erledigte eigene Wünsche aufräumen (Ziel hat das Ergebnis gemeldet) und
  // zu alte verwerfen.
  useEffect(() => {
    if (!eigene) return;
    const weg = eigene.filter(
      (w) =>
        Date.now() - w.at > WUNSCH_MAX_ALTER_MS ||
        (erledigtVon[w.ziel] ?? []).some((e) => e.id === w.id),
    );
    if (weg.length > 0) setEigene(eigene.filter((w) => !weg.includes(w)));
  }, [eigene, erledigtVon]);

  // Eigene Notiz schreiben, wenn sich die Liste ändert
  useEffect(() => {
    if (!ready || !myID || !intern || !eigene) return;
    const inhalt = JSON.stringify({ eigene, erledigt });
    if (inhalt === lastWrittenRef.current) return;
    const notiz: WunschNotiz = { by: myID, at: Date.now(), wuensche: eigene, erledigt };
    invoke("device_note_write", { folderPath: intern.path, kind: KIND, deviceId: myID, content: JSON.stringify(notiz) })
      .then(() => (lastWrittenRef.current = inhalt))
      .catch((e) => console.warn("[wunsch] Notiz schreiben", e));
  }, [ready, myID, intern?.path, eigene, erledigt]);

  /** Wunsch an einen anderen Rechner senden (ersetzt einen offenen für dasselbe Projekt). */
  const senden = useCallback(
    (w: Omit<Wunsch, "id" | "at">) => {
      pruefeAuswahl(w.auswahl);
      const neu: Wunsch = {
        ...w,
        auswahl: w.art === "auswahl" ? normalisiereAuswahl(w.auswahl) : [],
        vorher: w.vorher === null ? null : normalisiereAuswahl(w.vorher),
        id: neueId(),
        at: Date.now(),
      };
      setEigene((e) => [...(e ?? []).filter((x) => !(x.ziel === w.ziel && x.folder_id === w.folder_id)), neu]);
      return neu;
    },
    [],
  );
  const zuruecknehmen = useCallback((id: string) => setEigene((e) => (e ?? []).filter((x) => x.id !== id)), []);

  // An DIESEN Rechner gerichtete Wünsche ausführen — einzeln, nacheinander.
  const neueste = neuesteWuensche(myID && eigene ? [...alle.filter((n) => n.by !== myID), { by: myID, at: 0, wuensche: eigene }] : alle);
  const anMich = [...neueste.values()].filter(
    (w) =>
      w.ziel === myID &&
      w.von !== myID &&
      Date.now() - w.at <= WUNSCH_MAX_ALTER_MS &&
      !erledigt.some((e) => e.id === w.id),
  );
  // Erst ausführen, wenn das NAS (bzw. wer das Projekt anbietet) verbunden ist
  // — ein frisch gestarteter Rechner ist das oft noch nicht — und frühestens
  // 30 s nach dem Start (Kanal und Angebote sind dann abgeglichen).
  const gegenstellen = (w: Wunsch): DeviceID[] => {
    const f = config?.folders.find((x) => x.id === w.folder_id && !istInhaltOrdner(x));
    if (f) return f.devices.map((d) => d.deviceID).filter((d) => d !== myID);
    return nasProjekte(pending, config?.folders ?? []).find((x) => x.folderId === w.folder_id)?.anbieter ?? [];
  };
  const bereit = anMich.filter(
    (w) => w.art === "beenden" || gegenstellen(w).some((d) => connections[d]?.connected),
  );
  const anMichKey = Date.now() - startRef.current < 30_000 ? "" : bereit.map((w) => w.id).join(",");

  useEffect(() => {
    if (!ep || !ready || !myID || !anMichKey || busyRef.current) return;
    const w = [...bereit].sort((a, b) => a.at - b.at)[0];
    busyRef.current = true;
    setLaeuft(w.id);
    (async () => {
      let ergebnis: WunschErgebnis;
      try {
        const text = await ausfuehren(ep, w, myID, rolle, configRef.current, pendingRef.current);
        ergebnis = { id: w.id, ok: true, text, at: Date.now() };
      } catch (e) {
        ergebnis = { id: w.id, ok: false, text: e instanceof Error ? e.message : String(e), at: Date.now() };
      }
      setErledigt(merkeErledigt(ergebnis));
    })().finally(() => {
      busyRef.current = false;
      setLaeuft(null);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ep?.url, ready, myID, anMichKey]);

  return { eigene: eigene ?? [], neueste, erledigt, laeuft, wartet: anMich.length, senden, zuruecknehmen };
}

async function ausfuehren(
  ep: Endpoint,
  w: Wunsch,
  myID: DeviceID,
  rolle: GeraeteRolle,
  config: Config | null,
  pending: PendingFolder[],
): Promise<string> {
  const folders = (config?.folders ?? []).filter((f) => !istInhaltOrdner(f));
  const hier = folders.find((f) => f.id === w.folder_id) ?? null;
  // Stimmt der Stand noch mit dem überein, den der Sender sah?
  const jetzt = hier ? auswahlAusIgnores((await getFolderIgnores(ep, hier.id)).ignore) : null;
  if (hier && jetzt === null) throw new Error("Die Auswahl hier ist nicht lesbar — nicht ausgeführt.");
  const s = (x: string[] | null) => (x === null ? "nicht abonniert" : x.length === 0 ? "Alles" : normalisiereAuswahl(x).join(", "));
  if (s(jetzt) !== s(w.vorher)) {
    throw new Error(`Hier gilt inzwischen „${s(jetzt)}“ statt „${s(w.vorher)}“ — nicht ausgeführt. Bitte neu senden.`);
  }
  if (w.art === "beenden") {
    if (!hier) return "War hier nicht abonniert.";
    return aboBeenden(ep, hier, myID);
  }
  if (hier) return aboAuswahlAendern(ep, hier, w.auswahl, rolle, myID);
  const p = nasProjekte(pending, folders).find((x) => x.folderId === w.folder_id);
  if (!p) throw new Error("Das NAS bietet dieses Projekt hier (noch) nicht an.");
  const v = await aboVorbereiten(ep, p, myID, rolle, () => {});
  try {
    await aboStarten(ep, p, v, w.auswahl, rolle);
  } catch (e) {
    await aboAbbrechen(ep, p.folderId, v.ziel, p.anbieter);
    throw e;
  }
  return w.auswahl.length === 0 ? "Abonniert (ganzes Projekt)." : `Abonniert (${w.auswahl.length} Ordner).`;
}
