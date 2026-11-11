import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  folderError,
  getConfig,
  getFolderStatus,
  getLocalChanged,
  putFolder,
  revertFolder,
  scanFolder,
  type Endpoint,
  type Folder,
} from "./syncthing";
import { mitSperre } from "./nasProjekte";
import { protokolliere } from "./activity";
import { notify } from "./notifications";

// ── Ordner-Marke selbst reparieren ───────────────────────────────
//
// Fehlt `.stfolder`, hält Syncthing den Ordner an. Im Studio passiert das nach
// „Überprüfen“ im Epic Launcher (x5950, Marketplace 5.6, 11.11.2026). Marlon:
// „Sowas darf nicht mehr passieren“ — wie bei Resilio soll der Abgleich von
// selbst weiterlaufen, alle Rechner gleichberechtigt, die neuere Datei gewinnt.
//
// Zwei Fälle, je nachdem, wie viel noch da ist (Dateien auf der Platte gegen
// die Zahl im eigenen Index):
// - vollständig (≥ 90 %): Marke neu anlegen, weiter wie vorher.
// - viel fehlt: Ein Neuanlegen würde die Lücken als Löschungen an alle anderen
//   schicken. Deshalb kurz „Nur empfangen“, Marke neu, fehlende Dateien von den
//   anderen zurückholen („Zurücksetzen“), danach wieder die alte Art. Liegen
//   dabei neue oder geänderte Dateien hier, wird nichts zurückgesetzt (das
//   würde sie verwerfen) — dann bleibt der Ordner auf „Nur empfangen“ und
//   syncomat meldet es.
// Ist der Pfad selbst weg (Laufwerk ab), wird nie etwas angefasst.

const LS = "syncomat.marke.nachfuellen";
const VOLL_ANTEIL = 0.9;
const TAKT_MS = 30_000;
const PAUSE_MS = 10 * 60_000;

type Nachfuellen = { typ: Folder["type"]; seit: number; zurueckgesetzt?: boolean; gemeldet?: boolean };

function lesen(): Record<string, Nachfuellen> {
  try {
    const v = JSON.parse(localStorage.getItem(LS) ?? "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}
function schreiben(v: Record<string, Nachfuellen>) {
  try {
    localStorage.setItem(LS, JSON.stringify(v));
  } catch {
    /* ohne Speicher: der Ordner bleibt auf „Nur empfangen“ und wird gemeldet */
  }
}

type MarkeStand = { vorhanden: boolean; marke: boolean; dateien: number };

const name = (f: Folder) => f.label || f.id;

async function frisch(ep: Endpoint, id: string): Promise<Folder | null> {
  return (await getConfig(ep)).folders.find((f) => f.id === id) ?? null;
}

async function reparieren(ep: Endpoint, f: Folder, melden: (t: string, b: string) => void) {
  const s = await getFolderStatus(ep, f.id);
  if (!/folder marker missing/i.test(folderError(s) ?? "")) return;
  const st = await invoke<MarkeStand>("marke_stand", { root: f.path });
  if (!st.vorhanden) return;
  if (!st.marke) {
    const erwartet = s.localFiles ?? 0;
    if (st.dateien >= erwartet * VOLL_ANTEIL) {
      await invoke("marke_anlegen", { root: f.path });
      protokolliere(
        f.id,
        `Ordner-Marke .stfolder fehlte (z. B. nach „Überprüfen“ im Epic Launcher). Ordner vollständig (${st.dateien} Dateien) — Marke neu angelegt, Abgleich läuft weiter.`,
      );
      melden(`${name(f)}: Abgleich läuft wieder`, "Die Ordner-Marke fehlte und wurde neu angelegt.");
    } else {
      const g = await frisch(ep, f.id);
      if (!g) return;
      const liste = lesen();
      liste[f.id] = { typ: g.type, seit: Date.now() };
      schreiben(liste);
      if (g.type !== "receiveonly") await putFolder(ep, { ...g, type: "receiveonly" });
      await invoke("marke_anlegen", { root: f.path });
      protokolliere(
        f.id,
        `Ordner-Marke fehlte und der Ordner ist unvollständig (${st.dateien} von ${erwartet} Dateien). Kurz „Nur empfangen“: die fehlenden Dateien kommen von den anderen zurück, dort wird nichts gelöscht.`,
      );
      melden(`${name(f)}: wird wiederhergestellt`, "Fehlende Dateien kommen von den anderen Rechnern zurück.");
    }
  }
  await scanFolder(ep, f.id).catch(() => {});
}

async function nachfuellen(ep: Endpoint, id: string, n: Nachfuellen, melden: (t: string, b: string) => void) {
  const liste = lesen();
  const f = await frisch(ep, id);
  if (!f) {
    delete liste[id];
    schreiben(liste);
    return;
  }
  const s = await getFolderStatus(ep, id);
  if (folderError(s) || s.state !== "idle") return;
  const abweichend = s.receiveOnlyTotalItems ?? 0;
  if (abweichend > 0 && !n.zurueckgesetzt) {
    // Nur zurücksetzen, wenn hier ausschliesslich etwas FEHLT. Neue oder
    // geänderte Dateien würde „Zurücksetzen“ verwerfen.
    for (let page = 1; ; page++) {
      const r = await getLocalChanged(ep, id, page, 1000);
      const files = r.files ?? [];
      if (files.some((x) => !x.deleted)) {
        if (!n.gemeldet) {
          liste[id] = { ...n, gemeldet: true };
          schreiben(liste);
          protokolliere(
            id,
            "Wiederherstellen angehalten: hier liegen neue oder geänderte Dateien. Der Ordner bleibt auf „Nur empfangen“ — bitte ansehen.",
          );
          melden(`${name(f)}: bitte ansehen`, "Wiederherstellen angehalten — hier liegen neue oder geänderte Dateien.");
        }
        return;
      }
      if (files.length < 1000) break;
    }
    await revertFolder(ep, id);
    liste[id] = { ...n, zurueckgesetzt: true };
    schreiben(liste);
    return;
  }
  if (abweichend > 0 || (s.needFiles ?? 0) > 0 || s.needBytes > 0) return;
  if (f.type !== n.typ) await putFolder(ep, { ...f, type: n.typ });
  delete liste[id];
  schreiben(liste);
  protokolliere(id, "Wiederhergestellt: alle Dateien wieder da, Abgleich wieder normal.");
  melden(`${name(f)}: wiederhergestellt`, "Alle Dateien sind wieder da.");
}

export function useMarkenWaechter({
  ep,
  ready,
  folders,
  folderErrors,
  gesperrt,
  benachrichtigen,
}: {
  ep: Endpoint | null;
  ready: boolean;
  folders: Folder[];
  folderErrors: { id: string; message: string }[];
  gesperrt: boolean;
  benachrichtigen: boolean;
}) {
  const stand = useRef({ folders, folderErrors, gesperrt, benachrichtigen });
  stand.current = { folders, folderErrors, gesperrt, benachrichtigen };
  const versucht = useRef(new Map<string, number>());
  useEffect(() => {
    if (!ep || !ready) return;
    let busy = false;
    const takt = async () => {
      if (busy) return;
      busy = true;
      const { folders, folderErrors, gesperrt, benachrichtigen } = stand.current;
      const melden = (t: string, b: string) => {
        if (benachrichtigen) void notify(t, b);
      };
      try {
        const liste = lesen();
        for (const [id, n] of Object.entries(liste)) {
          await mitSperre(id, () => nachfuellen(ep, id, n, melden)).catch((e) =>
            console.warn("[marke] nachfüllen", id, e),
          );
        }
        if (gesperrt) return; // veraltete Version: nichts Neues anfangen
        for (const e of folderErrors) {
          if (!/folder marker missing/i.test(e.message) || liste[e.id]) continue;
          const f = folders.find((x) => x.id === e.id);
          if (!f || f.paused) continue;
          if (Date.now() - (versucht.current.get(f.id) ?? 0) < PAUSE_MS) continue;
          versucht.current.set(f.id, Date.now());
          await mitSperre(f.id, () => reparieren(ep, f, melden)).catch((err) => {
            console.warn("[marke] reparieren", f.id, err);
            protokolliere(f.id, `Ordner-Marke konnte nicht repariert werden: ${String(err)}`);
          });
        }
      } finally {
        busy = false;
      }
    };
    const t = setInterval(() => void takt(), TAKT_MS);
    const erst = setTimeout(() => void takt(), 5_000);
    return () => {
      clearInterval(t);
      clearTimeout(erst);
    };
  }, [ep?.url, ready]);
}
