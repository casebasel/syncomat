import "./App.css";
import {
  shortDeviceID,
  useConfig,
  useConnections,
  useEndpoint,
  useStatus,
  useSyncthingReady,
} from "./lib/syncthing";

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
  const endpoint = useEndpoint();
  const ready = useSyncthingReady(endpoint);
  const status = useStatus(endpoint, ready);
  const connections = useConnections(endpoint, ready);
  const config = useConfig(endpoint, ready);

  const firstError =
    status.error || connections.error || config.error || null;

  const tone = firstError ? "off" : ready ? "ok" : "wait";
  const statusText = firstError
    ? "Verbindungsfehler"
    : ready
      ? "Syncthing bereit"
      : "Starte Syncthing…";

  const connList = connections.data
    ? Object.values(connections.data.connections)
    : [];
  const connected = connList.filter((c) => c.connected).length;
  const total = connList.length;

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 antialiased flex items-start justify-center pt-8 px-5">
      <div className="w-full max-w-md rounded-2xl border border-neutral-800 bg-neutral-900/80 shadow-xl shadow-black/40 p-5">
        <header className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <SyncMark />
            <div>
              <h1 className="text-base font-semibold tracking-tight leading-none">
                Sync
              </h1>
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
          {!endpoint ? (
            <p className="text-xs text-neutral-500">Endpoint wird geladen…</p>
          ) : (
            <dl className="text-xs space-y-1.5">
              <Row label="URL" value={endpoint.url} />
              <Row label="API-Key" value={maskKey(endpoint.api_key)} />
            </dl>
          )}
        </section>

        <section className="mt-5">
          <p className="text-[11px] uppercase tracking-wider text-neutral-500 mb-2">
            Live
          </p>
          {firstError ? (
            <p className="text-xs text-rose-400 font-mono break-all">
              {firstError.message}
            </p>
          ) : !ready ? (
            <p className="text-xs text-neutral-500">Wartet auf Syncthing…</p>
          ) : (
            <dl className="text-xs space-y-1.5">
              <Row
                label="myID"
                value={
                  status.data ? shortDeviceID(status.data.myID) : "…"
                }
                mono
              />
              <Row
                label="Geräte"
                value={`${connected} / ${total} verbunden`}
              />
              <Row
                label="Ordner"
                value={
                  config.data
                    ? config.data.folders.length === 0
                      ? "keine"
                      : config.data.folders
                          .map((f) => f.label || f.id)
                          .join(", ")
                    : "…"
                }
              />
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
              <StatusDot tone={ready ? "ok" : "wait"} /> Schritt 2 ·
              Sidecar-Lifecycle
            </li>
            <li className="flex items-center gap-2">
              <StatusDot
                tone={
                  firstError ? "off" : status.data ? "ok" : "wait"
                }
              />{" "}
              Schritt 3 · REST-Client &amp; Events
            </li>
          </ul>
        </section>

        <div className="mt-6 pt-4 border-t border-neutral-800 flex items-center justify-between text-[11px] text-neutral-500">
          <span>Nächster Schritt · UI nach §5</span>
          <span>v0.1.0</span>
        </div>
      </div>
    </main>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-neutral-500">{label}</dt>
      <dd
        className={
          mono
            ? "font-mono text-neutral-200 text-right"
            : "text-neutral-200 text-right truncate max-w-[260px]"
        }
      >
        {value}
      </dd>
    </div>
  );
}

export default App;
