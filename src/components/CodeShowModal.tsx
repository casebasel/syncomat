import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, Check, Loader2, QrCode } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { Modal } from "./Modal";
import { encodeInvite, isPrivateAddressHint } from "../lib/invite";
import {
  inviteCreate,
  inviteGetIssuerSecret,
  inviteMarkRedeemed,
} from "../lib/invitesStore";
import {
  putDevice,
  putFolder,
  usePendingDevices,
  type Endpoint,
  type Folder,
  type PendingDevice,
  type SystemStatus,
} from "../lib/syncthing";

type GeneratedCode = {
  raw: string;
  codeId: string;
  expiresAt: number;
};

const EXPIRY_OPTIONS: { label: string; seconds: number }[] = [
  { label: "1 Stunde", seconds: 3600 },
  { label: "4 Stunden", seconds: 4 * 3600 },
  { label: "1 Tag", seconds: 24 * 3600 },
  { label: "7 Tage", seconds: 7 * 24 * 3600 },
  { label: "30 Tage", seconds: 30 * 24 * 3600 },
];

export function CodeShowModal({
  endpoint,
  ready,
  status,
  folders,
  onClose,
}: {
  endpoint: Endpoint | null;
  ready: boolean;
  status: SystemStatus | null;
  folders: Folder[];
  onClose: () => void;
}) {
  const [rw, setRw] = useState(true);
  const [expSeconds, setExpSeconds] = useState(7 * 24 * 3600);
  const [note, setNote] = useState("");
  const [addressesRaw, setAddressesRaw] = useState("");
  const [generated, setGenerated] = useState<GeneratedCode | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showQR, setShowQR] = useState(false);

  const seenDeviceIdsRef = useRef<Set<string> | null>(null);

  const pending = usePendingDevices(endpoint, ready);
  const [acceptPrompt, setAcceptPrompt] = useState<PendingDevice | null>(null);

  // Snapshot wird erst beim generate() gezogen (siehe unten) — sonst Race:
  // wenn Modal länger offen war als der erste Poll, hätten wir verpasste Devices
  // als "schon gesehen" markiert.

  // Neue Pending-Devices nach Code-Generierung → Prompt zeigen.
  useEffect(() => {
    if (!pending.data || generated === null || acceptPrompt !== null) return;
    if (seenDeviceIdsRef.current === null) return;
    for (const pd of pending.data) {
      if (!seenDeviceIdsRef.current.has(pd.deviceID)) {
        setAcceptPrompt(pd);
        return;
      }
    }
  }, [pending.data, generated, acceptPrompt]);

  const addresses = useMemo(() => {
    return addressesRaw
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }, [addressesRaw]);

  const addressErrors = useMemo(() => {
    return addresses
      .filter((a) => !isPrivateAddressHint(a))
      .map((a) => `Nicht erlaubt: ${a}`);
  }, [addresses]);

  const canGenerate =
    ready &&
    !!status &&
    !generated &&
    !busy &&
    addressErrors.length === 0 &&
    addresses.length <= 4 &&
    note.length <= 40;

  const generate = async () => {
    if (!status) return;
    setBusy(true);
    setError(null);
    try {
      const secret = await inviteGetIssuerSecret();
      const { code, codeId, expiresAt } = await encodeInvite({
        myDeviceId: status.myID,
        myIssuerSecret: secret,
        rw,
        expSeconds,
        note: note.trim() || undefined,
        addresses: addresses.length > 0 ? addresses : undefined,
      });
      // CRITICAL: dieselbe ID rüber an Rust, damit invite_mark_redeemed + invite_revoke
      // auf demselben Record arbeiten wie der signierte Payload.
      await inviteCreate({
        id: codeId,
        options: {
          rw,
          note: note.trim() || null,
          addresses: addresses,
        },
        expires_at: expiresAt,
      });
      // Snapshot der aktuellen Pending-Devices ZIEHEN — alles was hier schon drin ist
      // zählt nicht als "neu" für unseren Auto-Accept-Prompt.
      seenDeviceIdsRef.current = new Set((pending.data ?? []).map((d) => d.deviceID));
      setGenerated({ raw: code, codeId, expiresAt });
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!generated) return;
    try {
      await navigator.clipboard.writeText(generated.raw);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      setError(`Clipboard: ${e}`);
    }
  };

  const acceptIncoming = async () => {
    if (!acceptPrompt || !endpoint || !generated) return;
    setBusy(true);
    setError(null);
    try {
      // 1) Add the device with proper settings
      await putDevice(endpoint, {
        deviceID: acceptPrompt.deviceID,
        name: acceptPrompt.name || acceptPrompt.deviceID.slice(0, 7),
        addresses: ["dynamic"],
        introducer: false,
        autoAcceptFolders: false,
        paused: false,
      });
      // 2) Auto-Share alle eigenen Folders mit dem neuen Device.
      // Promise.allSettled damit ein einzelner Folder-PUT-Fehler nicht die anderen abbricht.
      const results = await Promise.allSettled(
        folders.map((f) => {
          const alreadyShared = f.devices.some(
            (d) => d.deviceID === acceptPrompt.deviceID,
          );
          if (alreadyShared) return Promise.resolve();
          const updated: Folder = {
            ...f,
            devices: [...f.devices, { deviceID: acceptPrompt.deviceID }],
          };
          return putFolder(endpoint, updated);
        }),
      );
      const failed = results.filter((r) => r.status === "rejected").length;
      if (failed > 0) {
        console.warn(`[CodeShowModal] ${failed}/${folders.length} folder-shares failed`);
      }
      // 3) Mark invite as redeemed — IDs sind jetzt synchron (siehe generate())
      try {
        await inviteMarkRedeemed(generated.codeId, acceptPrompt.deviceID);
      } catch (e) {
        console.warn("[CodeShowModal] mark_redeemed failed", e);
      }
      // 4) Close
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  // ─── UI ───

  if (acceptPrompt && generated) {
    return (
      <Modal title="Neues Gerät möchte verbinden" onClose={onClose} dismissible={!busy}>
        <div className="space-y-4">
          <p className="text-sm text-neutral-700 dark:text-neutral-300">
            <span className="font-mono">{acceptPrompt.name || acceptPrompt.deviceID.slice(0, 7)}</span> versucht sich
            zu verbinden. Ist das dein Empfangsgerät?
          </p>
          <div className="text-xs text-neutral-500 dark:text-neutral-400 space-y-1">
            <div className="flex justify-between">
              <span>Adresse</span>
              <span className="font-mono">{acceptPrompt.address}</span>
            </div>
            <div className="flex justify-between">
              <span>Geräte-ID</span>
              <span className="font-mono text-[10px]">{acceptPrompt.deviceID.slice(0, 7)}…{acceptPrompt.deviceID.slice(-7)}</span>
            </div>
          </div>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            Wenn ja: alle deine Ordner werden mit dem Gerät geteilt (Resilio-Stil).
          </p>
          {error && (
            <p className="text-xs text-rose-500 dark:text-rose-400 break-words">{error}</p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setAcceptPrompt(null)}
              disabled={busy}
              className="text-xs font-medium px-3 py-1.5 rounded-lg text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              Nein, ignorieren
            </button>
            <button
              onClick={acceptIncoming}
              disabled={busy}
              className="text-xs font-medium px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5"
            >
              {busy && <Loader2 className="size-3.5 animate-spin" />}
              Ja, annehmen
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  if (generated) {
    return (
      <Modal title="Einladungscode" onClose={onClose}>
        <div className="space-y-3">
          <p className="text-sm text-neutral-700 dark:text-neutral-300">
            Gib diesen Code an dein anderes Gerät weiter — z.B. via AirDrop oder Signal.
            Behandle ihn wie ein Passwort.
          </p>
          {showQR ? (
            <div className="flex flex-col items-center gap-2 py-2">
              <div className="p-3 rounded-lg bg-white border border-neutral-300 dark:border-neutral-700">
                <QRCodeSVG
                  value={generated.raw}
                  size={220}
                  level="M"
                  marginSize={0}
                />
              </div>
              <p className="text-[11px] text-neutral-500 dark:text-neutral-400 text-center max-w-[260px]">
                Scan-Vorgang: auf dem anderen Gerät „Code einlösen" → der gescannte
                Text wird automatisch eingefügt.
              </p>
            </div>
          ) : (
            <textarea
              readOnly
              value={generated.raw}
              onClick={(e) => e.currentTarget.select()}
              className="w-full font-mono text-[11px] p-3 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 break-all min-h-[140px] resize-none focus:outline-none focus:border-blue-500"
            />
          )}
          <div className="flex items-center justify-between gap-2 text-xs text-neutral-500 dark:text-neutral-400">
            <span>Läuft ab {fmtExpiry(generated.expiresAt)}</span>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setShowQR((v) => !v)}
                title={showQR ? "Als Text zeigen" : "Als QR-Code zeigen"}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              >
                <QrCode className="size-3.5" />
                {showQR ? "Text" : "QR"}
              </button>
              <button
                onClick={copy}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              >
                {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
                {copied ? "Kopiert" : "Kopieren"}
              </button>
            </div>
          </div>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 pt-2">
            Lass dieses Fenster offen — sobald das andere Gerät den Code einlöst, melde ich mich.
          </p>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Einladungscode erstellen" onClose={onClose} dismissible={!busy}>
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1.5">
            Berechtigung
          </label>
          <div className="flex gap-2">
            <RadioPill checked={rw} onClick={() => setRw(true)} label="Lesen + Schreiben" />
            <RadioPill checked={!rw} onClick={() => setRw(false)} label="Nur Lesen" />
          </div>
          <p className="text-[11px] text-neutral-500 dark:text-neutral-500 mt-1">
            Lesen+Schreiben passt für deine eigenen Geräte.
          </p>
        </div>

        <div>
          <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1.5">
            Gültig für
          </label>
          <select
            value={expSeconds}
            onChange={(e) => setExpSeconds(parseInt(e.target.value, 10))}
            className="w-full px-3 py-2 text-sm rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:border-blue-500"
          >
            {EXPIRY_OPTIONS.map((o) => (
              <option key={o.seconds} value={o.seconds}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1.5">
            Notiz (optional)
          </label>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 40))}
            placeholder="z.B. „Laptop von Marlon"
            className="w-full px-3 py-2 text-sm rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:border-blue-500"
          />
        </div>

        <details className="text-xs">
          <summary className="cursor-pointer text-neutral-500 dark:text-neutral-400 select-none">
            Erweitert: Netzwerk-Adressen (z.B. ZeroTier)
          </summary>
          <div className="mt-2 space-y-1">
            <textarea
              value={addressesRaw}
              onChange={(e) => setAddressesRaw(e.target.value)}
              placeholder="tcp://10.42.0.5:22000"
              rows={2}
              className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:border-blue-500"
            />
            <p className="text-[10px] text-neutral-500 dark:text-neutral-500">
              Nur private IPs (10/8, 172.16/12, 192.168/16, 100.64/10 für ZeroTier).
            </p>
            {addressErrors.map((e) => (
              <p key={e} className="text-[10px] text-rose-500 dark:text-rose-400">
                {e}
              </p>
            ))}
          </div>
        </details>

        {error && <p className="text-xs text-rose-500 dark:text-rose-400 break-words">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="text-xs font-medium px-3 py-1.5 rounded-lg text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            Abbrechen
          </button>
          <button
            onClick={generate}
            disabled={!canGenerate}
            className="text-xs font-medium px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
          >
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            Code erstellen
          </button>
        </div>
      </div>
    </Modal>
  );
}

function RadioPill({
  checked,
  onClick,
  label,
}: {
  checked: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 text-xs font-medium px-3 py-2 rounded-lg border transition-colors ${
        checked
          ? "border-blue-500 bg-blue-50 dark:bg-blue-950/40 text-blue-900 dark:text-blue-200"
          : "border-neutral-300 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800"
      }`}
    >
      {label}
    </button>
  );
}

function fmtExpiry(unix: number): string {
  const d = new Date(unix * 1000);
  return d.toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
