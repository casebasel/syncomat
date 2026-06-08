import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { AlertTriangle, FolderOpen, Loader2 } from "lucide-react";
import { Modal } from "./Modal";
import {
  putFolder,
  setFolderIgnores,
  tuneFolderForSize,
  type Endpoint,
  type Folder,
} from "../lib/syncthing";
import {
  estimateIndexRamMB,
  fmtSize,
  folderEstimateSize,
  pickStignoreForWorkload,
  workloadLabel,
  type FolderEstimate,
  type WorkloadDetection,
} from "../lib/unreal";

export function CreateFolderModal({
  endpoint,
  myDeviceId,
  ready,
  onClose,
  onCreated,
}: {
  endpoint: Endpoint | null;
  myDeviceId: string | null;
  ready: boolean;
  onClose: () => void;
  onCreated?: (folder: Folder) => void;
}) {
  const [label, setLabel] = useState("");
  const [path, setPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [estimate, setEstimate] = useState<FolderEstimate | null>(null);
  const [presetOverride, setPresetOverride] =
    useState<WorkloadDetection["kind"] | null>(null);
  const [applyPreset, setApplyPreset] = useState(true);

  const pickPath = async () => {
    setError(null);
    try {
      const chosen = await open({
        directory: true,
        title: `Ordner für „${label || "Neuer Ordner"}"`,
      });
      if (typeof chosen === "string") {
        setPath(chosen);
        // Label aus letzter Pfad-Komponente vorschlagen — Windows-`\` + POSIX-`/`
        if (!label.trim()) {
          const guess = chosen.split(/[/\\]/).filter(Boolean).pop();
          if (guess) setLabel(guess);
        }
        // Workload-Detection + Size-Estimate triggern (async, blockt nicht)
        setEstimating(true);
        setEstimate(null);
        setPresetOverride(null);
        try {
          const est = await folderEstimateSize(chosen);
          setEstimate(est);
        } catch (e) {
          console.warn("estimate failed", e);
        } finally {
          setEstimating(false);
        }
      }
    } catch (e) {
      setError(String(e));
    }
  };

  const effectivePreset =
    presetOverride ?? estimate?.workload.kind ?? "generic";
  const expectedRamMB = estimate
    ? estimateIndexRamMB(estimate.files, estimate.bytes)
    : 0;
  const isHuge = estimate && estimate.bytes > 10 * 1024 * 1024 * 1024;
  const isUnreal = effectivePreset === "unreal";

  const submit = async () => {
    if (!label.trim() || !path) return;
    if (!endpoint || !myDeviceId) {
      setError("Syncthing ist noch nicht bereit. Bitte einen Moment warten.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      let folder: Folder = {
        // Syncthing erwartet eine String-ID; UUID ist kollisionsfrei.
        id: crypto.randomUUID(),
        label: label.trim(),
        path,
        type: "sendreceive",
        paused: false,
        devices: [{ deviceID: myDeviceId }],
        // caseSensitiveFS NICHT setzen — Syncthing auto-detected pro path.
        // Hardcoded:true bricht Windows-Peer-Sync silent (NTFS = case-insensitive).
      };
      // Tuning anhand Estimate — fsWatcher, rescanInterval, copiers, etc.
      if (estimate) {
        folder = tuneFolderForSize(
          folder,
          estimate.bytes,
          estimate.files,
          effectivePreset,
        );
      }
      await putFolder(endpoint, folder);
      // .stignore-Preset NACH putFolder (das Endpoint braucht den Folder).
      if (applyPreset) {
        const patterns = pickStignoreForWorkload(effectivePreset);
        if (patterns.length > 0) {
          try {
            await setFolderIgnores(endpoint, folder.id, patterns);
          } catch (e) {
            // Preset-Fail blockt nicht den Folder-Create; nur warnen
            console.warn("setFolderIgnores failed", e);
          }
        }
      }
      onCreated?.(folder);
      onClose();
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  const notReady = !ready || !endpoint || !myDeviceId;

  return (
    <Modal title="Neuen Ordner anlegen" onClose={onClose} dismissible={!busy}>
      <div className="space-y-4">
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          Lege einen Ordner an, den du später per Einladungs-Code mit anderen
          Geräten teilen kannst.
        </p>
        {notReady && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-500/40 text-[11px] text-amber-800 dark:text-amber-300">
            <Loader2 className="size-3.5 animate-spin shrink-0 mt-0.5" />
            <div>
              Sync-Dienst startet noch. Du kannst den Ordner schon auswählen —
              "Anlegen" funktioniert sobald die Verbindung steht.
            </div>
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1.5">
            Anzeigename
          </label>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="z.B. Footage RAW"
            className="w-full px-3 py-2 text-sm rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:border-blue-500"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1.5">
            Lokaler Pfad
          </label>
          <button
            type="button"
            onClick={pickPath}
            disabled={busy || estimating}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-950 text-left hover:bg-neutral-50 dark:hover:bg-neutral-900 disabled:opacity-50"
          >
            <FolderOpen className="size-4 text-neutral-400 dark:text-neutral-500 shrink-0" />
            <span
              className={
                path
                  ? "text-neutral-900 dark:text-neutral-100 truncate"
                  : "text-neutral-500 dark:text-neutral-500"
              }
            >
              {path || "Ordner wählen…"}
            </span>
            {estimating && <Loader2 className="size-3.5 animate-spin ml-auto" />}
          </button>
          {path && !estimate && !estimating && (
            <p className="text-[11px] text-neutral-500 dark:text-neutral-500 mt-1">
              Existierende Dateien werden mitgesynct sobald ein Peer dazukommt.
            </p>
          )}
        </div>

        {/* Estimate-Banner: zeigt was die Sync-Engine an RAM braucht + Workload-Detection */}
        {estimate && (
          <div
            className={
              isHuge
                ? "rounded-lg border border-amber-300 dark:border-amber-500/40 bg-amber-50/60 dark:bg-amber-950/30 px-3 py-2.5 space-y-2"
                : "rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50/40 dark:bg-neutral-900/40 px-3 py-2.5 space-y-2"
            }
          >
            <div className="flex items-start gap-2">
              {isHuge && (
                <AlertTriangle className="size-3.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              )}
              <div className="flex-1 text-xs">
                <div className="text-neutral-900 dark:text-neutral-100">
                  ~{fmtSize(estimate.bytes)} ·{" "}
                  {estimate.files.toLocaleString("de-DE")} Dateien
                  {estimate.sampled && " (Schätzung)"}
                </div>
                <div className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-0.5">
                  Index ~{expectedRamMB} MB RAM ·{" "}
                  {workloadLabel(estimate.workload.kind)}
                  {estimate.workload.has_derived_data_cache &&
                    " · DerivedDataCache gefunden"}
                  {estimate.workload.has_intermediate &&
                    " · Intermediate gefunden"}
                </div>
              </div>
            </div>
            {isUnreal && (
              <div className="text-[11px] text-neutral-600 dark:text-neutral-300 leading-relaxed border-t border-neutral-200 dark:border-neutral-800 pt-2">
                <strong>Unreal-Projekt erkannt.</strong> DerivedDataCache
                (10-50 GB), Intermediate, Saved und Binaries werden NICHT
                synct — die bauen sich auf jeder Maschine neu. Spart pro
                Rechner massiv Speicher.
              </div>
            )}
            <div>
              <label className="block text-[11px] font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                Ignore-Preset
              </label>
              <select
                value={effectivePreset}
                onChange={(e) =>
                  setPresetOverride(
                    e.target.value as WorkloadDetection["kind"],
                  )
                }
                className="w-full px-2 py-1.5 text-xs rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:border-blue-500"
              >
                <option value="unreal">Unreal-Projekt</option>
                <option value="node">Node.js / Web</option>
                <option value="generic">Allgemein (nur OS-Müll)</option>
              </select>
              <label className="flex items-center gap-2 mt-1.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={applyPreset}
                  onChange={(e) => setApplyPreset(e.target.checked)}
                  className="size-3.5 accent-blue-600"
                />
                <span className="text-[11px] text-neutral-600 dark:text-neutral-400">
                  Preset anwenden (.stignore + Folder-Tuning)
                </span>
              </label>
            </div>
          </div>
        )}

        {error && (
          <p className="text-xs text-rose-500 dark:text-rose-400 break-words">{error}</p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="text-xs font-medium px-3 py-1.5 rounded-lg text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            Abbrechen
          </button>
          <button
            onClick={submit}
            disabled={!label.trim() || !path || busy || estimating || notReady}
            title={notReady ? "Sync-Dienst startet noch…" : undefined}
            className="text-xs font-medium px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
          >
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            Anlegen
          </button>
        </div>
      </div>
    </Modal>
  );
}
