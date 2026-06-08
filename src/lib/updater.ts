import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { useEffect, useState } from "react";

export type UpdateState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "available"; update: Update }
  | { kind: "downloading"; update: Update; downloaded: number; total: number | null }
  | { kind: "ready"; update: Update }
  | { kind: "up-to-date" }
  | { kind: "error"; message: string };

/**
 * Auto-check beim Mount (silent), plus periodisches re-check alle 6h.
 * User-initiierter Re-check + Download via Methoden.
 */
const PERIODIC_RECHECK_MS = 6 * 60 * 60 * 1000; // 6h

export function useUpdater(autoCheck = true) {
  const [state, setState] = useState<UpdateState>({ kind: "idle" });

  useEffect(() => {
    if (!autoCheck) return;
    void checkOnce(setState);
    // Re-check alle 6h damit User auch ohne App-Neustart Updates sehen.
    // Skipped wenn ein Download grad läuft oder Update schon ready ist.
    const id = setInterval(() => {
      setState((s) => {
        if (s.kind === "downloading" || s.kind === "ready") return s;
        void checkOnce(setState);
        return s;
      });
    }, PERIODIC_RECHECK_MS);
    return () => clearInterval(id);
  }, [autoCheck]);

  const recheck = () => checkOnce(setState);

  const installAndRestart = async () => {
    if (state.kind !== "available") return;
    const update = state.update;
    setState({ kind: "downloading", update, downloaded: 0, total: null });
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          setState({
            kind: "downloading",
            update,
            downloaded: 0,
            total: event.data.contentLength ?? null,
          });
        } else if (event.event === "Progress") {
          setState((s) =>
            s.kind === "downloading"
              ? { ...s, downloaded: s.downloaded + event.data.chunkLength }
              : s,
          );
        } else if (event.event === "Finished") {
          setState({ kind: "ready", update });
        }
      });
      await relaunch();
    } catch (e) {
      setState({ kind: "error", message: String(e) });
    }
  };

  return { state, recheck, installAndRestart };
}

async function checkOnce(setState: (s: UpdateState) => void) {
  setState({ kind: "checking" });
  try {
    const update = await check();
    if (update) {
      setState({ kind: "available", update });
    } else {
      setState({ kind: "up-to-date" });
    }
  } catch (e) {
    setState({ kind: "error", message: String(e) });
  }
}
