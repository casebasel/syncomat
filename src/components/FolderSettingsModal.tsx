import { useEffect, useState } from "react";
import { AlertTriangle, EyeOff, Loader2, Sparkles, Trash2, XCircle } from "lucide-react";
import { PanelShell } from "./PanelShell";
import {
  applyFolderDefaults,
  folderSettingsRead,
  folderSettingsWrite,
  DEFAULT_FOLDER_DEFAULTS,
  type FolderDefaults,
} from "../lib/folderSettings";
import {
  deleteFolder,
  getConfig,
  putFolder,
  scanFolder,
  setFolderIgnores,
  tuneFolderForSize,
  type Endpoint,
  type Folder,
} from "../lib/syncthing";
import { ignoredFoldersAdd } from "../lib/ignored";
import {
  estimateIndexRamMB,
  fmtSize,
  folderEstimateSize,
  pickStignoreForWorkload,
  workloadLabel,
  type FolderEstimate,
} from "../lib/unreal";
import { TagEditor } from "./TagEditor";

export function FolderSettingsModal({
  endpoint,
  folder,
  myDeviceId,
  tagSuggestions,
  connectedPeerIds,
  onClose,
  onRemoved,
  onSaved,
}: {
  endpoint: Endpoint;
  folder: Folder;
  myDeviceId: string;
  /** Tags die bei anderen Folders verwendet werden — für Autocomplete im Editor */
  tagSuggestions: string[];
  /** Device-IDs der aktuell VERBUNDENEN Peers — für zuverlässiges Cluster-Delete */
  connectedPeerIds: string[];
  onClose: () => void;
  onRemoved?: () => void;
  /** Wird nach erfolgreichem Speichern gefeuert — Parent triggert refresh
   * von useFolderTags damit die Sidebar sofort neue Tags zeigt. */
  onSaved?: () => void;
}) {
  const [defaults, setDefaults] = useState<FolderDefaults>(DEFAULT_FOLDER_DEFAULTS);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ updatedAt: number; updatedBy: string } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [clusterWide, setClusterWide] = useState(false);
  // Sub-Status während Cluster-Delete den Marker zu den Geräten propagiert.
  const [removeStatus, setRemoveStatus] = useState<string | null>(null);
  const [tuneState, setTuneState] = useState<
    | { kind: "idle" }
    | { kind: "estimating" }
    | { kind: "ready"; estimate: FolderEstimate }
    | { kind: "applying" }
    | { kind: "done" }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  useEffect(() => {
    let cancelled = false;
    folderSettingsRead(folder.path)
      .then((file) => {
        if (cancelled) return;
        if (file) {
          setDefaults(file.settings);
          setMeta({ updatedAt: file.updated_at, updatedBy: file.updated_by });
        }
        setLoaded(true);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(String(e));
          setLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [folder.path]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      // WICHTIG: deletion_requested IMMER auf false beim normalen Save —
      // sonst bleibt ein altes Cluster-Delete-Signal aus früheren Tests
      // im File und das deletion-Banner re-triggert nach jedem Save.
      // Cluster-Delete wird ausschliesslich über remove() (mit clusterWide)
      // gesetzt, nie hier.
      const cleanedDefaults = {
        ...defaults,
        deletion_requested: false,
        deletion_requested_by: null,
      };
      // 1. Write the shared defaults file (replicated via Syncthing)
      await folderSettingsWrite(folder.path, myDeviceId, cleanedDefaults);
      // 2. Apply to local Syncthing config immediately
      await applyFolderDefaults(endpoint, folder, cleanedDefaults);
      onSaved?.();
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const runTune = async () => {
    setTuneState({ kind: "estimating" });
    try {
      const est = await folderEstimateSize(folder.path);
      setTuneState({ kind: "ready", estimate: est });
    } catch (e) {
      setTuneState({ kind: "error", message: String(e) });
    }
  };

  const applyTune = async (alsoApplyPreset: boolean) => {
    if (tuneState.kind !== "ready") return;
    const est = tuneState.estimate;
    setTuneState({ kind: "applying" });
    try {
      const fresh = await getConfig(endpoint);
      const current = fresh.folders.find((f) => f.id === folder.id);
      if (!current) throw new Error("folder no longer in config");
      const tuned = tuneFolderForSize(
        current,
        est.bytes,
        est.files,
        est.workload.kind,
      );
      await putFolder(endpoint, tuned);
      if (alsoApplyPreset) {
        const patterns = pickStignoreForWorkload(est.workload.kind);
        if (patterns.length > 0) {
          try {
            await setFolderIgnores(endpoint, folder.id, patterns);
          } catch (e) {
            console.warn("tune: setFolderIgnores failed", e);
          }
        }
      }
      setTuneState({ kind: "done" });
    } catch (e) {
      setTuneState({ kind: "error", message: String(e) });
    }
  };

  // Lokal entfernen (gemeinsamer Endteil beider Pfade).
  const removeLocally = async () => {
    await deleteFolder(endpoint, folder.id);
    await ignoredFoldersAdd(folder.id, folder.label || folder.id);
    onRemoved?.();
    onClose();
  };

  const remove = async (forceDespiteUnsynced = false) => {
    setBusy(true);
    setError(null);
    try {
      if (!clusterWide) {
        // Nur lokal — keine Propagation nötig.
        await removeLocally();
        return;
      }

      // CLUSTER-WIDE: der Marker muss die Geräte ERREICHEN bevor wir den
      // Folder lokal kappen — sonst stoppt Syncthing den Sync und der Marker
      // geht verloren. Frühere Version wartete blind 1s -> Bug (Marlon).
      const peerIds = folder.devices
        .map((d) => d.deviceID)
        .filter((id) => id !== myDeviceId);
      const onlinePeers = peerIds.filter((id) => connectedPeerIds.includes(id));

      if (peerIds.length === 0) {
        // Kein Peer am Folder — "cluster-wide" ist bedeutungslos, lokal löschen.
        await removeLocally();
        return;
      }

      if (onlinePeers.length === 0 && !forceDespiteUnsynced) {
        // Niemand online -> Marker kann nicht propagieren. Nicht blind löschen
        // (Signal ginge verloren). User entscheidet: warten oder nur-lokal.
        setError(
          "Kein verbundenes Gerät — der Löschwunsch kann gerade nicht gesendet " +
            "werden. Warte bis das andere Gerät online ist, oder entferne nur hier.",
        );
        setBusy(false);
        return;
      }

      // 1. Marker schreiben
      setRemoveStatus("Löschwunsch wird geschrieben…");
      await folderSettingsWrite(folder.path, myDeviceId, {
        ...defaults,
        deletion_requested: true,
        deletion_requested_by: myDeviceId,
      });
      // 2. Forcierter Scan: Syncthing soll die geänderte Datei SOFORT
      //    aufnehmen, nicht erst nach fsWatcherDelayS (bei Unreal 10-30s).
      try {
        await scanFolder(endpoint, folder.id);
      } catch (e) {
        console.warn("[cluster-delete] scan failed (non-fatal)", e);
      }
      // 3. Großzügige Grace, damit der Index-Austausch + Pull des winzigen
      //    JSON-Files beim verbundenen Peer durch ist. 10s reicht auf LAN
      //    locker; wir koppeln das NICHT an completion (race-anfällig).
      if (!forceDespiteUnsynced) {
        for (let i = 10; i > 0; i--) {
          setRemoveStatus(`Sende an ${onlinePeers.length} Gerät${onlinePeers.length === 1 ? "" : "e"}… ${i}s`);
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
      // 4. Jetzt lokal entfernen.
      setRemoveStatus("Entferne lokal…");
      await removeLocally();
    } catch (e) {
      setError(String(e));
      setBusy(false);
      setRemoveStatus(null);
    }
  };

  if (!loaded) {
    return (
      <PanelShell title={`Einstellungen — ${folder.label}`} onBack={onClose}>
        <div className="flex items-center gap-2 text-sm text-neutral-500 dark:text-neutral-400">
          <Loader2 className="size-4 animate-spin" />
          Lade…
        </div>
      </PanelShell>
    );
  }

  const footerNode = !confirmRemove ? (
    <div className="flex items-center gap-3">
      {meta && (
        <span className="text-[10px] text-neutral-500 dark:text-neutral-500 truncate flex-1">
          Geändert von{" "}
          <span className="font-mono">{meta.updatedBy.slice(0, 7)}</span> ·{" "}
          {fmtTime(meta.updatedAt)}
        </span>
      )}
      {!meta && <span className="flex-1" />}
      <button
        onClick={onClose}
        disabled={busy}
        className="text-xs font-medium px-3 py-1.5 rounded-lg text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 shrink-0"
      >
        Abbrechen
      </button>
      <button
        onClick={save}
        disabled={busy}
        className="text-xs font-medium px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5 shrink-0"
      >
        {busy && <Loader2 className="size-3.5 animate-spin" />}
        Speichern
      </button>
    </div>
  ) : (
    <div className="flex items-center gap-2 justify-end">
      {removeStatus && (
        <span className="text-[11px] text-neutral-500 dark:text-neutral-400 mr-auto flex items-center gap-1.5">
          <Loader2 className="size-3 animate-spin" />
          {removeStatus}
        </span>
      )}
      {/* Wenn kein Peer online war: Fallback nur-lokal-entfernen anbieten */}
      {error && clusterWide && !busy && (
        <button
          onClick={() => {
            setClusterWide(false);
            setError(null);
            void remove(true);
          }}
          className="text-xs font-medium px-3 py-1.5 rounded-lg border border-rose-300 dark:border-rose-500/40 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/30"
        >
          Nur hier entfernen
        </button>
      )}
      <button
        onClick={() => {
          setConfirmRemove(false);
          setClusterWide(false);
          setError(null);
        }}
        disabled={busy}
        className="text-xs font-medium px-3 py-1.5 rounded-lg text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800"
      >
        Abbrechen
      </button>
      <button
        onClick={() => void remove()}
        disabled={busy}
        className="text-xs font-medium px-3 py-1.5 rounded-lg bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50 flex items-center gap-1.5"
      >
        {busy ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Trash2 className="size-3.5" />
        )}
        {clusterWide ? "Überall entfernen" : "Hier entfernen"}
      </button>
    </div>
  );

  return (
    <PanelShell
      title={`Einstellungen — ${folder.label}`}
      onBack={onClose}
      dismissible={!busy && !confirmRemove}
      footer={footerNode}
    >
      <div className="space-y-4">
        {/* Tags — kommen ueber dieselbe folder-defaults.json Replikation,
            damit Gruppierung auf allen Geraeten konsistent ist. */}
        <section>
          <h3 className="text-[10px] uppercase tracking-wider text-neutral-400 dark:text-neutral-500 font-semibold mb-1.5">
            Tags
          </h3>
          <TagEditor
            tags={defaults.tags ?? []}
            onChange={(tags) => setDefaults({ ...defaults, tags })}
            suggestions={tagSuggestions}
          />
          <p className="text-[11px] text-neutral-500 dark:text-neutral-500 mt-1.5">
            Gruppieren Ordner in der Liste — synct automatisch zu allen Geräten.
          </p>
        </section>

        <ToggleRow
          icon={<EyeOff className="size-4" />}
          title="Versteckte Dateien ignorieren"
          sub="Dateien die mit Punkt beginnen (.DS_Store, .git/…), Thumbs.db, desktop.ini"
          checked={defaults.ignore_hidden}
          onChange={(v) => setDefaults({ ...defaults, ignore_hidden: v })}
        />

        <ToggleRow
          icon={<Trash2 className="size-4" />}
          title="Papierkorb für gelöschte Dateien"
          sub="Gelöschte Versionen behalten — auf jedem Gerät in .stversions/"
          checked={defaults.trashcan}
          onChange={(v) => setDefaults({ ...defaults, trashcan: v })}
        />

        {defaults.trashcan && (
          <div className="pl-9">
            <label className="block text-xs text-neutral-600 dark:text-neutral-400 mb-1">
              Aufbewahrung (Tage, 0 = unbegrenzt)
            </label>
            <input
              type="number"
              min={0}
              max={3650}
              value={defaults.trashcan_cleanout_days}
              onChange={(e) =>
                setDefaults({
                  ...defaults,
                  trashcan_cleanout_days: Math.max(
                    0,
                    Math.min(3650, parseInt(e.target.value || "0", 10)),
                  ),
                })
              }
              className="w-24 px-2 py-1 text-sm rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:border-blue-500"
            />
          </div>
        )}

        {/* Performance-Tuning für existierende Folders. Misst Größe + Workload-
            Typ, schlägt fsWatcher/Rescan/Block-/Hasher-Defaults + .stignore-
            Preset vor. Identische Logik wie im CreateFolderModal, aber für
            nachträgliches Tunen wenn der Folder gewachsen ist oder die App
            ohne Preset angelegt wurde. */}
        <details className="pt-3 border-t border-neutral-200 dark:border-neutral-800">
          <summary className="cursor-pointer text-xs text-blue-600 dark:text-blue-400 select-none hover:underline flex items-center gap-1.5">
            <Sparkles className="size-3.5" />
            Performance optimieren
          </summary>
          <div className="mt-2 space-y-2 text-xs">
            {tuneState.kind === "idle" && (
              <>
                <p className="text-neutral-500 dark:text-neutral-400 leading-relaxed">
                  Misst Ordnergröße + Datei-Anzahl, erkennt Unreal/Node-Projekt
                  und schlägt optimierte Syncthing-Settings vor (Scan-Intervall,
                  FS-Watcher, Block-/Hasher-Anzahl, optional .stignore-Preset).
                </p>
                <button
                  onClick={runTune}
                  className="text-xs font-medium px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 flex items-center gap-1.5"
                >
                  <Sparkles className="size-3.5" />
                  Analysieren
                </button>
              </>
            )}
            {tuneState.kind === "estimating" && (
              <div className="flex items-center gap-2 text-neutral-500">
                <Loader2 className="size-3.5 animate-spin" />
                Schätze Größe…
              </div>
            )}
            {tuneState.kind === "ready" && (
              <div className="space-y-2.5">
                <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50/40 dark:bg-neutral-900/40 px-3 py-2">
                  <div className="text-neutral-900 dark:text-neutral-100">
                    ~{fmtSize(tuneState.estimate.bytes)} ·{" "}
                    {tuneState.estimate.files.toLocaleString("de-DE")} Dateien
                    {tuneState.estimate.sampled && " (Schätzung)"}
                  </div>
                  <div className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-0.5">
                    Index ~
                    {estimateIndexRamMB(
                      tuneState.estimate.files,
                      tuneState.estimate.bytes,
                    )}{" "}
                    MB RAM · {workloadLabel(tuneState.estimate.workload.kind, tuneState.estimate.workload.uproject_count)}
                  </div>
                </div>
                <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
                  Tuning passt Syncthing-Ordner-Einstellungen an die gemessene
                  Größe an. Bei Unreal: optional auch das .stignore-Preset
                  (Empfehlung — spart pro Maschine 10-50 GB).
                </p>
                <div className="flex gap-1.5 flex-wrap">
                  <button
                    onClick={() => applyTune(false)}
                    className="text-[11px] font-medium px-2.5 py-1 rounded-md border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  >
                    Nur Tuning anwenden
                  </button>
                  <button
                    onClick={() => applyTune(true)}
                    className="text-[11px] font-medium px-2.5 py-1 rounded-md bg-blue-600 text-white hover:bg-blue-700"
                  >
                    Tuning + .stignore-Preset
                  </button>
                </div>
              </div>
            )}
            {tuneState.kind === "applying" && (
              <div className="flex items-center gap-2 text-neutral-500">
                <Loader2 className="size-3.5 animate-spin" />
                Wende an…
              </div>
            )}
            {tuneState.kind === "done" && (
              <p className="text-emerald-600 dark:text-emerald-400">
                ✓ Ordner optimiert. Syncthing wird die neuen Settings beim
                nächsten Scan-Zyklus übernehmen.
              </p>
            )}
            {tuneState.kind === "error" && (
              <p className="text-rose-500 dark:text-rose-400 break-words">
                {tuneState.message}
              </p>
            )}
          </div>
        </details>

        {error && (
          <p className="text-xs text-rose-500 dark:text-rose-400 break-words">{error}</p>
        )}

        {/* Danger Zone — am Ende des scrollbaren Inhalts. Confirm-Dialog
            ersetzt die ganze Section inline statt einen weiteren Modal-Push. */}
        {!confirmRemove ? (
          <details className="mt-2 pt-3 border-t border-neutral-200 dark:border-neutral-800">
            <summary className="cursor-pointer text-xs text-rose-600 dark:text-rose-400 select-none hover:underline">
              Ordner-Verknüpfung entfernen
            </summary>
            <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-2 leading-relaxed">
              Stoppt das Syncen auf diesem Gerät. Die Datei-Inhalte unter{" "}
              <code className="font-mono text-[10px]">{folder.path}</code> bleiben
              auf der Platte — nichts wird gelöscht.
            </p>
            <button
              onClick={() => setConfirmRemove(true)}
              className="mt-3 text-xs font-medium px-3 py-1.5 rounded-lg border border-rose-300 dark:border-rose-500/40 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/30 flex items-center gap-1.5"
            >
              <XCircle className="size-3.5" />
              Verknüpfung entfernen…
            </button>
          </details>
        ) : (
          <div className="mt-2 pt-3 border-t border-rose-300 dark:border-rose-500/40 space-y-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="size-4 text-rose-500 dark:text-rose-400 shrink-0 mt-0.5" />
              <div className="text-xs text-neutral-700 dark:text-neutral-300 leading-relaxed">
                <p className="font-medium text-rose-700 dark:text-rose-300 mb-1">
                  Ordner-Verknüpfung wirklich entfernen?
                </p>
                <ul className="space-y-1 text-[11px] text-neutral-600 dark:text-neutral-400">
                  <li>
                    ✓ Datei-Inhalte unter{" "}
                    <code className="font-mono text-[10px]">{folder.path}</code>{" "}
                    bleiben auf der Platte.
                  </li>
                  <li>
                    ✓ Andere Geräte machen weiter wie bisher.
                  </li>
                  <li>
                    ✓ Dieser Ordner taucht nicht mehr als „Verfügbar" auf —
                    Re-Enable über Einstellungen → Ignorierte Ordner.
                  </li>
                </ul>
              </div>
            </div>
            <label className="flex items-start gap-2 cursor-pointer select-none px-3 py-2 rounded-lg bg-rose-50/60 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-500/30">
              <input
                type="checkbox"
                checked={clusterWide}
                onChange={(e) => setClusterWide(e.target.checked)}
                className="mt-0.5 accent-rose-600"
              />
              <div className="text-[11px] text-neutral-700 dark:text-neutral-300">
                <span className="font-medium text-rose-700 dark:text-rose-400">
                  Auch auf allen anderen Geräten vorschlagen
                </span>
                <p className="text-neutral-500 dark:text-neutral-400 mt-0.5">
                  Markiert den Ordner Cluster-weit. Andere Syncomat-Instanzen
                  sehen einen Banner „auch hier entfernen?" — die User entscheiden
                  pro Gerät selbst.
                </p>
              </div>
            </label>
          </div>
        )}
      </div>
    </PanelShell>
  );
}

function ToggleRow({
  icon,
  title,
  sub,
  checked,
  onChange,
}: {
  icon: React.ReactNode;
  title: string;
  sub: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3 cursor-pointer select-none">
      <div className="size-9 rounded-lg bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center text-neutral-500 dark:text-neutral-400 shrink-0">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
          {title}
        </div>
        <p className="text-[11px] text-neutral-500 dark:text-neutral-400">{sub}</p>
      </div>
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`shrink-0 mt-1 relative w-9 h-5 rounded-full transition-colors ${
          checked ? "bg-blue-600" : "bg-neutral-300 dark:bg-neutral-700"
        }`}
      >
        <span
          className={`absolute top-0.5 size-4 rounded-full bg-white transition-transform ${
            checked ? "translate-x-4" : "translate-x-0.5"
          }`}
        />
      </button>
    </label>
  );
}

function fmtTime(unix: number): string {
  return new Date(unix * 1000).toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
