import { useEffect, useState } from "react";
import {
  Check,
  ExternalLink,
  HardDriveDownload,
  Loader2,
  Server,
  Trash2,
} from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { PanelShell } from "./PanelShell";
import {
  NAS_UNREAL_IGNORES,
  remotesAdd,
  remotesList,
  remotesRemove,
  toEndpoint,
  type RemoteNode,
} from "../lib/remotes";
import {
  getPendingFolders,
  getStatus,
  putFolder,
  setFolderIgnores,
  type Endpoint,
  type PendingFolder,
} from "../lib/syncthing";

// Phase B (BETA): verwaltet eine entfernte Syncthing-Node (TrueNAS-Hub) aus
// Syncomat heraus. Nutzt die endpoint-parametrisierte API direkt gegen den NAS.
// Bekannte offene Frage: Cross-Origin — falls der Browser-fetch gegen die NAS-
// REST-API durch CORS blockt, kommt ein Rust-Proxy (tauri-plugin-http) dazu.
// Erst gegen die LIVE-NAS testbar.

export function ServerNodeModal({ onClose }: { onClose: () => void }) {
  const [nodes, setNodes] = useState<RemoteNode[] | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = () =>
    remotesList()
      .then((n) => {
        setNodes(n);
        setShowAdd(n.length === 0);
      })
      .catch((e) => setError(String(e)));
  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <PanelShell title="Server-Node (NAS)" onBack={onClose} width="form">
      <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-4 leading-relaxed">
        Eine always-on Syncthing-Node (z.B. dein TrueNAS-Hub) hier registrieren —
        dann kannst du angebotene Ordner direkt aufs NAS legen, ohne dessen Web-UI
        anzufassen. <span className="text-amber-600 dark:text-amber-400">Beta:</span>{" "}
        gegen die laufende NAS getestet werden.
      </p>

      {nodes === null ? (
        <div className="flex items-center gap-2 text-sm text-neutral-500 dark:text-neutral-400">
          <Loader2 className="size-4 animate-spin" /> Lade…
        </div>
      ) : (
        <div className="space-y-4">
          {nodes.map((n) => (
            <NodeCard
              key={n.id}
              node={n}
              onRemoved={reload}
              onError={setError}
            />
          ))}

          {showAdd ? (
            <AddForm
              onAdded={reload}
              onCancel={nodes.length > 0 ? () => setShowAdd(false) : undefined}
              onError={setError}
            />
          ) : (
            <button
              onClick={() => setShowAdd(true)}
              className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
            >
              + weitere Node hinzufügen
            </button>
          )}
        </div>
      )}

      {error && (
        <p className="text-xs text-rose-500 dark:text-rose-400 mt-3 break-words">
          {error}
        </p>
      )}
    </PanelShell>
  );
}

function AddForm({
  onAdded,
  onCancel,
  onError,
}: {
  onAdded: () => void;
  onCancel?: () => void;
  onError: (e: string) => void;
}) {
  const [name, setName] = useState("TrueNAS-Hub");
  const [url, setUrl] = useState("http://192.168.100.100:8384");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [okDevice, setOkDevice] = useState<string | null>(null);

  const save = async () => {
    onError("");
    setBusy(true);
    setOkDevice(null);
    try {
      const ep: Endpoint = { url: url.trim().replace(/\/$/, ""), api_key: apiKey.trim() };
      const st = await getStatus(ep); // Verbindungstest — wirft bei falscher URL/Key
      setOkDevice(st.myID);
      await remotesAdd(name, url, apiKey);
      onAdded();
    } catch (e) {
      onError(
        `Verbindung fehlgeschlagen: ${String(e)}. URL + API-Key prüfen (Syncthing-GUI → Settings → API-Key). Tipp: nur im selben Netz erreichbar.`,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-3 space-y-2.5">
      <div className="flex items-center gap-2 text-sm font-semibold text-neutral-800 dark:text-neutral-100">
        <Server className="size-4" /> NAS verbinden
      </div>
      <Field label="Name">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-950 px-2.5 py-1.5 text-sm text-neutral-900 dark:text-neutral-100 focus:outline-none focus:border-blue-500"
          placeholder="TrueNAS-Hub"
        />
      </Field>
      <Field label="Adresse (GUI-URL)">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-950 px-2.5 py-1.5 text-sm text-neutral-900 dark:text-neutral-100 focus:outline-none focus:border-blue-500 font-mono"
          placeholder="http://192.168.100.100:8384"
        />
      </Field>
      <Field label="API-Key (NAS-GUI → Settings → API-Key)">
        <input
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-950 px-2.5 py-1.5 text-sm text-neutral-900 dark:text-neutral-100 focus:outline-none focus:border-blue-500 font-mono"
          type="password"
          placeholder="abcd…"
        />
      </Field>
      {okDevice && (
        <p className="text-[11px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
          <Check className="size-3" /> verbunden · {okDevice.slice(0, 7)}
        </p>
      )}
      <div className="flex gap-2 pt-1">
        {onCancel && (
          <button
            onClick={onCancel}
            disabled={busy}
            className="text-[11px] px-3 py-1.5 rounded-md text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            Abbrechen
          </button>
        )}
        <button
          onClick={() => void save()}
          disabled={busy || !url.trim() || !apiKey.trim()}
          className="ml-auto text-[11px] font-medium px-3 py-1.5 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1"
        >
          {busy && <Loader2 className="size-3 animate-spin" />} Verbinden & speichern
        </button>
      </div>
    </div>
  );
}

function NodeCard({
  node,
  onRemoved,
  onError,
}: {
  node: RemoteNode;
  onRemoved: () => void;
  onError: (e: string) => void;
}) {
  const ep = toEndpoint(node);
  const [deviceID, setDeviceID] = useState<string | null>(null);
  const [online, setOnline] = useState<boolean | null>(null);
  const [pending, setPending] = useState<PendingFolder[]>([]);
  const [busyFolder, setBusyFolder] = useState<string | null>(null);

  const load = async () => {
    try {
      const st = await getStatus(ep);
      setDeviceID(st.myID);
      setOnline(true);
      setPending(await getPendingFolders(ep).catch(() => []));
    } catch {
      setOnline(false);
    }
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id]);

  const accept = async (pf: PendingFolder, path: string) => {
    onError("");
    setBusyFolder(pf.folderID);
    try {
      const st = await getStatus(ep);
      const offerers = Object.keys(pf.offeredBy);
      const label = Object.values(pf.offeredBy)[0]?.label || pf.folderID;
      await putFolder(ep, {
        id: pf.folderID,
        label,
        path,
        type: "receiveonly", // NAS = Backup, schreibt nie zurück
        paused: false,
        devices: [
          { deviceID: st.myID },
          ...offerers.map((deviceID) => ({ deviceID })),
        ],
        maxConflicts: 10,
      });
      await setFolderIgnores(ep, pf.folderID, NAS_UNREAL_IGNORES).catch(() => {});
      await load();
    } catch (e) {
      onError(`Annehmen fehlgeschlagen: ${String(e)}`);
    } finally {
      setBusyFolder(null);
    }
  };

  return (
    <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 overflow-hidden">
      <div className="px-3 py-2.5 bg-neutral-50 dark:bg-neutral-800/40 flex items-center gap-2">
        <span
          className={`size-2 rounded-full shrink-0 ${
            online === null
              ? "bg-neutral-300 animate-pulse"
              : online
                ? "bg-emerald-500"
                : "bg-rose-500"
          }`}
        />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-neutral-800 dark:text-neutral-100 truncate">
            {node.name}
          </div>
          <div className="text-[10px] text-neutral-400 dark:text-neutral-500 font-mono truncate">
            {node.url}
            {deviceID ? ` · ${deviceID.slice(0, 7)}` : online === false ? " · offline" : ""}
          </div>
        </div>
        <button
          onClick={() => void openUrl(node.url)}
          title="NAS-Web-UI öffnen"
          className="p-1.5 rounded-md text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-neutral-200/60 dark:hover:bg-neutral-700"
        >
          <ExternalLink className="size-3.5" />
        </button>
        <button
          onClick={() => void remotesRemove(node.id).then(onRemoved)}
          title="Node entfernen (löscht nur die Verknüpfung in Syncomat)"
          className="p-1.5 rounded-md text-neutral-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>

      {online && (
        <div className="px-3 py-2">
          <div className="text-[10px] uppercase tracking-wider text-neutral-400 dark:text-neutral-500 font-semibold mb-1.5">
            Angebotene Ordner ({pending.length})
          </div>
          {pending.length === 0 ? (
            <p className="text-[11px] text-neutral-500 dark:text-neutral-400 py-1">
              Keine offenen Angebote. Sobald ein Desktop dem NAS einen Ordner
              anbietet, erscheint er hier.
            </p>
          ) : (
            <div className="space-y-2">
              {pending.map((pf) => (
                <PendingRow
                  key={pf.folderID}
                  pf={pf}
                  busy={busyFolder === pf.folderID}
                  onAccept={accept}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PendingRow({
  pf,
  busy,
  onAccept,
}: {
  pf: PendingFolder;
  busy: boolean;
  onAccept: (pf: PendingFolder, path: string) => void;
}) {
  const label = Object.values(pf.offeredBy)[0]?.label || pf.folderID;
  const [path, setPath] = useState(`/var/syncthing/data/${label}`);
  return (
    <div className="rounded-lg border border-amber-300/60 dark:border-amber-500/30 bg-amber-50/40 dark:bg-amber-950/15 px-2.5 py-2">
      <div className="text-[13px] font-medium text-neutral-800 dark:text-neutral-100 truncate">
        {label}
      </div>
      <div className="text-[10px] text-neutral-500 dark:text-neutral-400 mb-1.5 font-mono">
        {pf.folderID}
      </div>
      <input
        value={path}
        onChange={(e) => setPath(e.target.value)}
        className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-950 px-2.5 py-1.5 text-sm text-neutral-900 dark:text-neutral-100 focus:outline-none focus:border-blue-500 font-mono text-[11px] mb-1.5"
        placeholder="/var/syncthing/data/…"
      />
      <button
        onClick={() => onAccept(pf, path.trim())}
        disabled={busy || !path.trim()}
        className="w-full text-[11px] font-medium px-2 py-1.5 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-1"
      >
        {busy ? (
          <Loader2 className="size-3 animate-spin" />
        ) : (
          <HardDriveDownload className="size-3" />
        )}
        Als Backup annehmen (Receive-Only + Unreal-Ignore)
      </button>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wider text-neutral-400 dark:text-neutral-500 font-semibold">
        {label}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
