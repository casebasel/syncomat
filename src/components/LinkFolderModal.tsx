import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { AlertTriangle, FolderOpen, Loader2 } from "lucide-react";
import type { PendingFolder } from "../lib/syncthing";
import { Modal } from "./Modal";
import {
  estimateIndexRamMB,
  fmtSize,
  folderEstimateSize,
  workloadLabel,
  type FolderEstimate,
  type WorkloadDetection,
} from "../lib/unreal";

export type LinkConfirmOptions = {
  preset: WorkloadDetection["kind"];
  applyPreset: boolean;
  estimate: FolderEstimate | null;
};

export function LinkFolderModal({
  pending,
  onConfirm,
  onClose,
}: {
  pending: PendingFolder;
  onConfirm: (
    label: string,
    localPath: string,
    options: LinkConfirmOptions,
  ) => Promise<void>;
  onClose: () => void;
}) {
  const firstOfferer = Object.values(pending.offeredBy)[0];
  const defaultLabel = firstOfferer?.label || pending.folderID;

  const [label, setLabel] = useState(defaultLabel);
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
        title: `Ziel-Ordner für „${label}"`,
      });
      if (typeof chosen === "string") {
        setPath(chosen);
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
    setBusy(true);
    setError(null);
    try {
      await onConfirm(label.trim(), path, {
        preset: effectivePreset,
        applyPreset,
        estimate,
      });
      onClose();
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  return (
    <Modal title="Ordner verknüpfen" onClose={onClose} dismissible={!busy}>
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1.5">
            Anzeigename
          </label>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="w-full px-3 py-2 text-sm rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:border-blue-500"
            placeholder="z.B. Footage RAW"
          />
          <p className="text-[11px] text-neutral-500 dark:text-neutral-500 mt-1">
            Nur lokal. Andere Geräte sehen ihren eigenen Namen.
          </p>
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
        </div>

        {/* Wenn der Empfänger einen Folder mit existierenden Files wählt
            (z.B. wo das Unreal-Projekt schon liegt), zeigen wir denselben
            Workload-Detection-Banner wie im CreateFolderModal. Ist der gewählte
            Pfad leer (= frischer Empfangsordner), kommt nichts — User wählt
            das Preset über das Dropdown selber.  */}
        {estimate && (estimate.files > 0 || estimate.workload.kind !== "generic") && (
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
                </div>
              </div>
            </div>
            {isUnreal && (
              <div className="text-[11px] text-neutral-600 dark:text-neutral-300 leading-relaxed border-t border-neutral-200 dark:border-neutral-800 pt-2">
                <strong>Unreal-Projekt erkannt.</strong> DerivedDataCache,
                Intermediate, Saved und Binaries werden NICHT mitgesynct —
                spart pro Maschine 10-50 GB.
              </div>
            )}
          </div>
        )}

        {/* Preset-Selector ist immer sichtbar wenn ein Pfad gewählt ist,
            auch ohne Estimate (= leerer Empfangsordner). Der User kann
            vorab das Preset wählen damit es greift sobald die ersten Files
            vom Peer ankommen. */}
        {path && (
          <div>
            <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1.5">
              Ignore-Preset
            </label>
            <select
              value={effectivePreset}
              onChange={(e) =>
                setPresetOverride(e.target.value as WorkloadDetection["kind"])
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
            <p className="text-[11px] text-neutral-500 dark:text-neutral-500 mt-1">
              Beim Empfangen eines Unreal-Projekts vom Peer wirst du sonst
              DerivedDataCache (10-50 GB) komplett mit syncen.
            </p>
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
            disabled={!label.trim() || !path || busy || estimating}
            className="text-xs font-medium px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
          >
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            {busy ? "Verknüpfe…" : "Verknüpfen"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
