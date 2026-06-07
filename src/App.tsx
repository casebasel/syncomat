import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./App.css";

type SyncthingEndpoint = { url: string; api_key: string };

function maskKey(k: string) {
  if (k.length <= 10) return "••••";
  return `${k.slice(0, 4)}…${k.slice(-4)}`;
}

function SyncMark() {
  return (
    <div className="size-10 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-sm shadow-blue-900/40">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="size-5"
      >
        <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
        <path d="M3 3v5h5" />
        <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
        <path d="M16 16h5v5" />
      </svg>
    </div>
  );
}

function StatusDot({ tone }: { tone: "ok" | "wait" | "off" }) {
  const cls =
    tone === "ok"
      ? "bg-emerald-500"
      : tone === "wait"
        ? "bg-amber-500 animate-pulse"
        : "bg-neutral-600";
  return <span className={`size-1.5 rounded-full ${cls}`} />;
}

function App() {
  const [endpoint, setEndpoint] = useState<SyncthingEndpoint | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    invoke<SyncthingEndpoint>("syncthing_endpoint")
      .then(setEndpoint)
      .catch((e) => setError(String(e)));

    const unlisten = listen("syncthing://ready", () => setReady(true));
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const tone = error ? "off" : ready ? "ok" : "wait";
  const statusText = error
    ? "Sidecar-Fehler"
    : ready
      ? "Syncthing bereit"
      : "Starte Syncthing…";

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 antialiased flex items-start justify-center pt-8 px-5">
      <div className="w-full max-w-md rounded-2xl border border-neutral-800 bg-neutral-900/80 shadow-xl shadow-black/40 p-5">
        <header className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <SyncMark />
            <div>
              <h1 className="text-base font-semibold tracking-tight leading-none">Sync</h1>
              <p className="mt-1.5 text-xs text-neutral-400 flex items-center gap-1.5">
                <StatusDot tone={tone} />
                {statusText}
              </p>
            </div>
          </div>
          <button
            disabled
            className="text-xs font-medium px-3 py-1.5 rounded-lg border border-neutral-700 text-neutral-400 opacity-60 cursor-not-allowed"
          >
            Jetzt syncen
          </button>
        </header>

        <section className="mt-6">
          <p className="text-[11px] uppercase tracking-wider text-neutral-500 mb-2">
            Sidecar
          </p>
          {error ? (
            <p className="text-xs text-rose-400 font-mono break-all">{error}</p>
          ) : !endpoint ? (
            <p className="text-xs text-neutral-500">Endpoint wird geladen…</p>
          ) : (
            <dl className="text-xs space-y-1.5">
              <div className="flex justify-between gap-3">
                <dt className="text-neutral-500">URL</dt>
                <dd className="font-mono text-neutral-200">{endpoint.url}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-neutral-500">API-Key</dt>
                <dd
                  className="font-mono text-neutral-200"
                  title="vollständigen Key im Tauri-State"
                >
                  {maskKey(endpoint.api_key)}
                </dd>
              </div>
            </dl>
          )}
        </section>

        <section className="mt-5">
          <p className="text-[11px] uppercase tracking-wider text-neutral-500 mb-2">
            Stand
          </p>
          <ul className="space-y-1.5 text-sm text-neutral-200">
            <li className="flex items-center gap-2">
              <StatusDot tone="ok" /> Schritt 1 · Skelett &amp; Sidecar-Slot
            </li>
            <li className="flex items-center gap-2">
              <StatusDot tone={tone} /> Schritt 2 · Sidecar-Lifecycle
            </li>
          </ul>
        </section>

        <div className="mt-6 pt-4 border-t border-neutral-800 flex items-center justify-between text-[11px] text-neutral-500">
          <span>Nächster Schritt · REST-Client (TS)</span>
          <span>v0.1.0</span>
        </div>
      </div>
    </main>
  );
}

export default App;
