// Nur Entwicklung: Vorschau der Übersicht mit erfundenen Daten (keine Tauri-
// und Syncthing-Verbindung). Wird nicht gebaut (vite build nimmt index.html).
import React from "react";
import ReactDOM from "react-dom/client";
import "./App.css";
import { Leiste } from "./components/uebersicht/Leiste";
import { Uebersicht } from "./components/uebersicht/Uebersicht";
import { AuswahlFeld } from "./components/uebersicht/AuswahlFeld";
import { OrdnerAnAlle } from "./components/uebersicht/OrdnerAnAlle";
import { FolderInspector } from "./components/FolderInspector";
import { Statusbar } from "./components/Statusbar";
import type { Spalte, Zeile, Zelle } from "./lib/uebersicht";
import { projektFarbe } from "./lib/projektFarbe";

const rechner: [string, string, "arbeitsplatz" | "render", number, boolean][] = [
  ["I9", "i9", "arbeitsplatz", 412e9, true],
  ["ADA", "x5950", "arbeitsplatz", 1.31e12, true],
  ["X39", "x3950", "arbeitsplatz", 1.8e12, true],
  ["X79", "x7950", "render", 640e9, false],
  ["RND1", "render-01", "render", 1.1e12, true],
  ["RND2", "render-02", "render", 1.1e12, true],
  ["RND3", "render-03", "render", 980e9, true],
  ["RND4", "render-04", "render", 1.0e12, true],
  ["MAC", "MacBook-Air", "arbeitsplatz", 0, true],
  ["RND5", "render-05", "render", 1.2e12, false],
];
const spalten: Spalte[] = rechner.map(([id, name, rolle, frei, online], i) => ({
  id,
  name,
  ich: i === 0,
  online,
  rolle,
  freiD: id === "MAC" ? null : frei,
  kannWuensche: id !== "RND5",
  dFs: id === "MAC" ? null : id === "X39" ? "exFAT" : "NTFS",
}));
const namen = [
  "PM_MEDITERRANEAN", "INTERN_BURNED", "TKB_IMAGEFILM", "VERKEHRSHAUS_VR", "EXLIBRIS_SPOT", "XSENS_DEMO",
  "COASTHOUSE_5_6", "LILI_KURZFILM", "BOOM_MUSIKVIDEO", "ZUERICH_TOURISMUS", "DOBO_PRODUKT",
  "FILMSTUDIO_SHOWREEL", "IO_BUILDER_55", "STUDIO_SCAN", "GAUSSIAN_BEEBLE", "CAPELLI_SPOT",
  "RESTAURANT_ARCHIN", "VPAPP_DEMO", "BAFF_TRAILER", "TEST_SYNCOMAT",
];
let seed = 7;
const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
const projekte: Zeile[] = namen.map((n, i) => {
  const zellen: Record<string, Zelle> = {};
  for (const s of spalten) {
    const r = rnd();
    let z: Zelle = { zustand: "nicht" };
    if (r > 0.62) z = { zustand: "aktuell", teil: r > 0.93 };
    if (s.rolle === "render" && i < 3) z = { zustand: "aktuell" };
    if (!s.online && z.zustand !== "nicht") z = { ...z, offline: true };
    zellen[s.id] = z;
  }
  if (n === "VERKEHRSHAUS_VR") zellen["I9"] = { zustand: "laedt", prozent: 64 };
  if (n === "EXLIBRIS_SPOT") zellen["RND2"] = { zustand: "angehalten", grund: "Ordner-Marke .stfolder fehlt" };
  if (n === "PM_MEDITERRANEAN") {
    zellen["I9"] = { zustand: "aktuell", teil: true, konflikte: 2, auswahl: ["03_UNREAL", "04_SHOTS/SQ010/SH0010", "04_SHOTS/SQ010/SH0020"] };
    zellen["X79"] = { zustand: "aktuell", offline: true, auswahl: [] };
  }
  if (n === "TEST_SYNCOMAT") zellen["I9"] = { zustand: "nicht" };
  const hier = zellen["I9"]!.zustand !== "nicht";
  return {
    folderId: `dz-projekt-${n.toLowerCase()}-1`,
    name: n,
    art: "projekt",
    farbe: projektFarbe(`projekt-${n.toLowerCase()}`),
    hier: hier ? ({ id: "x" } as never) : null,
    angebot: hier ? null : ({ folderId: `dz-projekt-${n.toLowerCase()}-1`, name: n, anbieter: ["NAS"] } as never),
    zellen,
    stoerung: Object.values(zellen).some((c) => c.zustand === "angehalten" || !!c.konflikte),
    bytes: hier ? Math.round(rnd() * 600e9) : null,
  };
});
projekte.sort((a, b) => Number(b.stoerung) - Number(a.stoerung) || a.name.localeCompare(b.name));
const plugins: Zeile[] = ["Marketplace 5.5", "Marketplace 5.6", "Marketplace 5.7", "Marketplace 5.8"].map((n) => ({
  folderId: n,
  name: n,
  art: "plugin",
  farbe: null,
  hier: { id: n } as never,
  angebot: null,
  zellen: Object.fromEntries(spalten.map((s) => [s.id, s.id === "MAC" ? { zustand: "nicht" } : { zustand: "aktuell", offline: !s.online }])),
  stoerung: false,
  bytes: 38e9,
}));

function Vorschau() {
  const q = new URLSearchParams(location.search);
  const abo = q.has("abo");
  const detail = q.has("detail");
  const zelle = q.get("zelle"); // z. B. ?zelle=I9 oder ?zelle=X79
  const baum = {
    globalBytes: 1.84e12,
    baum: [
      { name: "00_PRODUKTION", pfad: "00_PRODUKTION", bytes: 2.1e9, kinder: [] },
      { name: "01_REFERENZ", pfad: "01_REFERENZ", bytes: 48e9, kinder: [] },
      { name: "02_ASSETS", pfad: "02_ASSETS", bytes: 310e9, kinder: [
        { name: "Charaktere", pfad: "02_ASSETS/Charaktere", bytes: 120e9, kinder: [] },
        { name: "Umgebung", pfad: "02_ASSETS/Umgebung", bytes: 190e9, kinder: [] },
      ] },
      { name: "03_UNREAL", pfad: "03_UNREAL", bytes: 420e9, kinder: [] },
      { name: "04_SHOTS", pfad: "04_SHOTS", bytes: 980e9, kinder: [
        { name: "SQ010", pfad: "04_SHOTS/SQ010", bytes: 410e9, kinder: [
          { name: "SH0010", pfad: "04_SHOTS/SQ010/SH0010", bytes: 120e9, kinder: [] },
          { name: "SH0020", pfad: "04_SHOTS/SQ010/SH0020", bytes: 140e9, kinder: [] },
          { name: "SH0030", pfad: "04_SHOTS/SQ010/SH0030", bytes: 150e9, kinder: [] },
        ] },
        { name: "SQ020", pfad: "04_SHOTS/SQ020", bytes: 570e9, kinder: [] },
      ] },
      { name: "05_ÜBERGABE", pfad: "05_ÜBERGABE", bytes: 80e9, kinder: [] },
    ],
  };
  const pm = projekte.find((p) => p.name === "PM_MEDITERRANEAN")!;
  const zeile = projekte.find((p) => p.name === "TEST_SYNCOMAT")!;
  return (
    <main className="h-screen flex flex-col overflow-hidden bg-[var(--sm-grund)] text-[var(--sm-text)]">
      <div className="border-b border-[var(--sm-linie)] bg-[var(--sm-blau-flaeche)] shrink-0 flex items-center gap-2 px-4 py-2.5 text-xs">
        <div className="min-w-0 flex-1">
          <div className="font-semibold truncate">render-06 möchte sich verbinden</div>
          <p className="font-mono text-[var(--sm-text2)] truncate">tcp://192.168.100.31:22000</p>
        </div>
        <button className="text-xs px-2.5 py-1 rounded-md border border-[var(--sm-linie)]">Ablehnen</button>
        <button className="text-xs font-semibold px-2.5 py-1 rounded-md bg-[var(--sm-blau)] text-white">Akzeptieren</button>
      </div>
      <div className="flex-1 flex overflow-hidden">
      <Leiste ansicht={q.has("ordner") ? "ordner" : "uebersicht"} onAnsicht={() => {}} stoerungen={1} update={false} angebote={2} />
      {q.has("ordner") ? (
        <OrdnerAnAlle
          onAnlegen={() => {}}
          ordner={plugins.map((p) => ({ id: p.folderId, name: p.name, bytes: p.bytes, stoerung: false, onOeffnen: () => {} }))}
          angebote={[
            { id: "a", name: "Marketplace 5.9", von: ["truenas-hub"], onAnnehmen: () => {}, onAblehnen: async () => {} },
            { id: "b", name: "Megascans", von: ["x5950", "truenas-hub"], onAnnehmen: () => {}, onAblehnen: async () => {} },
          ]}
        />
      ) : (
      <Uebersicht
        spalten={spalten}
        projekte={projekte}
        plugins={plugins}
        lage={{ freiD: 412e9, abosHier: projekte.filter((p) => p.hier).length, stoerungen: 1 }}
        gewaehlt={abo ? zeile.folderId : detail || zelle ? pm.folderId : null}
        gewaehltRechner={abo ? "I9" : zelle}
        onZelle={() => {}}
        ausgeblendet={new Set(["dz-projekt-coasthouse_5_6-1", "dz-projekt-xsens_demo-1"])}
        offeneWuensche={zelle === "X79" ? [{ id: "wu-1", ziel: "X79", folder_id: pm.folderId, name: pm.name, art: "auswahl", auswahl: ["03_UNREAL"], vorher: [], at: Date.now() }] : []}
        onZeile={() => {}}
        onAbonnieren={() => {}}
        onRechner={() => {}}
        onRechnerKoppeln={() => {}}
        onCodeEinloesen={() => {}}
        onNeuPruefen={() => {}}
        pruefe={false}
      />
      )}
      {(abo || zelle) && (
        <AuswahlFeld
          ep={null}
          myID="I9"
          rolle="arbeitsplatz"
          zeile={abo ? zeile : pm}
          spalte={spalten.find((x) => x.id === (abo ? "I9" : zelle))!}
          offenerWunsch={zelle === "X79" ? { id: "wu-1", ziel: "X79", folder_id: pm.folderId, name: pm.name, art: "auswahl", auswahl: ["03_UNREAL", "04_SHOTS/SQ010"], vorher: [], at: Date.now() } : null}
          ergebnisVomZiel={null}
          laeuftHier={false}
          onSenden={() => {}}
          onZuruecknehmen={() => {}}
          onSchliessen={() => {}}
          aktionen={zelle === "I9" ? { explorer: () => {}, details: () => {}, fortsetzen: null, konflikte: () => {}, fehler: null } : undefined}
          onUeberallBeenden={async () => "ok"}
          vorschauBaum={baum}
        />
      )}
      {detail && (
        <aside className="w-[380px] shrink-0 border-l border-[var(--sm-linie)] flex overflow-hidden">
          <FolderInspector
            folder={{ id: pm.folderId, label: pm.name, path: "D:\\PM_MEDITERRANEAN", type: "sendreceive", paused: false, devices: [{ deviceID: "I9" }, { deviceID: "NAS" }] } as never}
            farbe={pm.farbe}
            onSchliessen={() => {}}
            endpoint={null}
            ready={false}
            devices={[]}
            connections={{}}
            myID={"I9" as never}
            tags={[]}
            onPauseToggle={() => {}}
            onShowSettings={() => {}}
            onShowConflicts={() => {}}
            onShowErrors={() => {}}
            onAboBeenden={async () => "ok"}
          />
        </aside>
      )}
      </div>
      <div className="border-t border-[var(--sm-linie)] bg-[var(--sm-flaeche)] shrink-0 px-4">
        <Statusbar ready aggregateState="idle" needBytes={0} errorCount={0} folderErrorLabels={[]} lastSyncAt={new Date()} version="0.9.27" localFiles={120000} localBytes={2.1e12} inBps={0} outBps={0} />
      </div>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Vorschau />
  </React.StrictMode>,
);
