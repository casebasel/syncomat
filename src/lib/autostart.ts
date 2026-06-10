import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

/**
 * Autostart ("Bei Anmeldung starten").
 *
 * Die Quelle der Wahrheit ist das Betriebssystem (LaunchAgent auf macOS,
 * Registry-Run-Eintrag auf Windows) — NICHT localStorage. Darum lesen wir den
 * echten Zustand beim Mount via Rust-Command und schalten ebenfalls über Rust.
 * Dadurch bleibt der Settings-Toggle konsistent mit dem Tray-Haken
 * „Bei Login starten".
 */
export function useAutostart() {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    invoke<boolean>("autostart_get")
      .then((v) => alive && setEnabled(v))
      .catch((e) => console.warn("[autostart] get failed", e))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const set = async (v: boolean) => {
    setEnabled(v); // optimistisch
    try {
      const actual = await invoke<boolean>("autostart_set", { enabled: v });
      setEnabled(actual);
    } catch (e) {
      console.warn("[autostart] set failed", e);
      // Auf den real geltenden Zustand zurückrollen
      try {
        setEnabled(await invoke<boolean>("autostart_get"));
      } catch {
        setEnabled(!v);
      }
    }
  };

  return { enabled, setEnabled: set, loading };
}
