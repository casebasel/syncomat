import "./App.css";

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

function App() {
  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 antialiased flex items-start justify-center pt-8 px-5">
      <div className="w-full max-w-md rounded-2xl border border-neutral-800 bg-neutral-900/80 shadow-xl shadow-black/40 p-5">
        <header className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <SyncMark />
            <div>
              <h1 className="text-base font-semibold tracking-tight leading-none">Sync</h1>
              <p className="mt-1.5 text-xs text-neutral-400 flex items-center gap-1.5">
                <span className="size-1.5 rounded-full bg-emerald-500" />
                Schritt 1 · Skelett steht
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
            Scaffolding
          </p>
          <ul className="space-y-1.5 text-sm text-neutral-200">
            <li className="flex items-center gap-2">
              <span className="size-1.5 rounded-full bg-emerald-500" />
              Tauri 2 · React · TypeScript
            </li>
            <li className="flex items-center gap-2">
              <span className="size-1.5 rounded-full bg-emerald-500" />
              Tailwind v4 aktiv
            </li>
            <li className="flex items-center gap-2">
              <span className="size-1.5 rounded-full bg-emerald-500" />
              Syncthing v2.1.1 als Sidecar konfiguriert
            </li>
            <li className="flex items-center gap-2">
              <span className="size-1.5 rounded-full bg-emerald-500" />
              tauri-plugin-shell + Capability bereit
            </li>
          </ul>
        </section>

        <div className="mt-6 pt-4 border-t border-neutral-800 flex items-center justify-between text-[11px] text-neutral-500">
          <span>Nächster Schritt · Sidecar-Lifecycle (Rust)</span>
          <span>v0.1.0</span>
        </div>
      </div>
    </main>
  );
}

export default App;
