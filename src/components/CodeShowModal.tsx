import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, Check, Loader2, QrCode, Zap } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { PanelShell } from "./PanelShell";
import { encodeInvite, isPrivateAddressHint } from "../lib/invite";
import { publishInvite, QUICK_PAIR_ENABLED } from "../lib/rendezvous";
import { acceptDevice } from "../lib/pairing";
import { armAutoAccept, autoAcceptActive } from "../lib/autoAccept";
import {
  inviteCreate,
  inviteGetIssuerSecret,
  inviteMarkRedeemed,
} from "../lib/invitesStore";
import {
  deletePendingDevice,
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
  /** Bei Quick-Pair: der 4-stellige Code vom Rendezvous (sonst undefined) */
  quickCode?: string;
};

// seconds = 600 markiert den Quick-Pair-Modus (10 Min + 4-Ziffern-Code via
// Rendezvous). Nur sichtbar wenn QUICK_PAIR_ENABLED (Worker konfiguriert).
const QUICK_PAIR_SECONDS = 600;

const EXPIRY_OPTIONS: { label: string; seconds: number; quick?: boolean }[] = [
  ...(QUICK_PAIR_ENABLED
    ? [{ label: "10 Minuten · Schnell-Pair (4 Ziffern)", seconds: QUICK_PAIR_SECONDS, quick: true }]
    : []),
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
  // ABER: ist das Auto-Accept-Fenster aktiv (nach generate() geschärft), greift
  // der App-Ebene-Auto-Accept und das Gerät joint ohne Klick → kein Prompt.
  useEffect(() => {
    if (!pending.data || generated === null || acceptPrompt !== null) return;
    if (autoAcceptActive()) return;
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

      // Quick-Pair: Invite zum Rendezvous laden, 4-Code zeigen statt langem Code.
      let quickCode: string | undefined;
      if (expSeconds === QUICK_PAIR_SECONDS && QUICK_PAIR_ENABLED) {
        const result = await publishInvite(code);
        quickCode = result.code;
      }
      // Auto-Accept-Fenster für die Code-Gültigkeit schärfen: Geräte die diesen
      // Code nutzen, verbinden sich automatisch — kein manuelles "Annehmen".
      armAutoAccept(Date.now() + expSeconds * 1000);
      setGenerated({ raw: code, codeId, expiresAt, quickCode });
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
      // Gerät annehmen (hinzufügen + Ordner teilen + Pending wegräumen) — die
      // EINE atomare Funktion, identisch zum Pending-Banner.
      await acceptDevice(endpoint, acceptPrompt, folders);
      // Invite als eingelöst markieren (Code-spezifisch).
      try {
        await inviteMarkRedeemed(generated.codeId, acceptPrompt.deviceID);
      } catch (e) {
        console.warn("[CodeShowModal] mark_redeemed failed", e);
      }
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
      <PanelShell title="Neues Gerät möchte verbinden" onBack={onClose} dismissible={!busy}>
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
            Alle deine Ordner werden mit dem Gerät geteilt.
          </p>
          {error && (
            <p className="text-xs text-rose-500 dark:text-rose-400 break-words">{error}</p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={async () => {
                // Audit-Finding: vorher hat "Nein, ignorieren" nur setAcceptPrompt(null)
                // gemacht. Der pending-device blieb in Syncthings Liste — beim nächsten
                // Poll kam der Prompt sofort wieder hoch. Endlosschleife.
                // Jetzt: Pending-device wirklich aus Syncthing-Liste entfernen.
                if (endpoint) {
                  try {
                    await deletePendingDevice(endpoint, acceptPrompt.deviceID);
                  } catch (e) {
                    console.warn("deletePendingDevice failed", e);
                  }
                }
                // seen-Set updaten damit auch der lokale Auto-detect-Loop nicht
                // sofort den gleichen device wieder als "neu" interpretiert
                if (seenDeviceIdsRef.current) {
                  seenDeviceIdsRef.current.add(acceptPrompt.deviceID);
                }
                setAcceptPrompt(null);
              }}
              disabled={busy}
              className="text-xs font-medium px-3 py-1.5 rounded-lg text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              Ablehnen
            </button>
            <button
              onClick={acceptIncoming}
              disabled={busy}
              className="text-xs font-medium px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5"
            >
              {busy && <Loader2 className="size-3.5 animate-spin" />}
              Annehmen
            </button>
          </div>
        </div>
      </PanelShell>
    );
  }

  // ── Quick-Pair-Ansicht: 4 grosse Ziffern + Countdown ──
  if (generated && generated.quickCode) {
    return (
      <PanelShell title="Schnell-Pair" onBack={onClose}>
        <div className="space-y-4">
          <p className="text-sm text-neutral-700 dark:text-neutral-300">
            Tippe diesen Code auf dem anderen Gerät bei „Code einlösen" ein.
          </p>
          <div className="flex flex-col items-center gap-2 py-2">
            <div className="flex gap-2">
              {generated.quickCode.split("").map((digit, i) => (
                <span
                  key={i}
                  className="w-14 h-16 flex items-center justify-center rounded-xl border-2 border-blue-300 dark:border-blue-500/40 bg-blue-50 dark:bg-blue-950/30 text-3xl font-bold tabular-nums text-blue-700 dark:text-blue-300"
                >
                  {digit}
                </span>
              ))}
            </div>
            <QuickPairCountdown expiresAt={generated.expiresAt} />
          </div>
          <div className="flex items-center justify-center">
            <button
              onClick={() => {
                navigator.clipboard
                  .writeText(generated.quickCode!)
                  .then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  })
                  .catch(() => {});
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-xs"
            >
              {copied ? (
                <Check className="size-3.5 text-emerald-500" />
              ) : (
                <Copy className="size-3.5" />
              )}
              {copied ? "Kopiert" : "Code kopieren"}
            </button>
          </div>
          <p className="text-[11px] text-neutral-500 dark:text-neutral-400 text-center leading-relaxed">
            Gilt nur 10 Minuten und kann einmal eingelöst werden. Das andere
            Gerät verbindet sich dann <span className="font-medium text-neutral-700 dark:text-neutral-300">automatisch</span> — kein Bestätigen nötig.
          </p>
        </div>
      </PanelShell>
    );
  }

  if (generated) {
    return (
      <PanelShell title="Einladungscode" onBack={onClose}>
        <div className="space-y-3">
          <p className="text-sm text-neutral-700 dark:text-neutral-300">
            Gib diesen Code an dein anderes Gerät weiter — z.B. via AirDrop oder Signal.
            Behandle ihn wie ein Passwort.
          </p>
          <p className="text-[11px] text-neutral-500 dark:text-neutral-400 leading-relaxed">
            Geräte mit diesem Code verbinden sich <span className="font-medium text-neutral-700 dark:text-neutral-300">automatisch</span>, solange er gültig ist — kein Bestätigen nötig.
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
            Lass dieses Fenster offen — sobald das andere Gerät den Code einlöst, erscheint hier der nächste Schritt.
          </p>
        </div>
      </PanelShell>
    );
  }

  return (
    <PanelShell title="Einladungscode erstellen" onBack={onClose} dismissible={!busy}>
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
          {expSeconds === QUICK_PAIR_SECONDS && QUICK_PAIR_ENABLED && (
            <p className="text-[11px] text-blue-600 dark:text-blue-400 mt-1.5 flex items-start gap-1">
              <Zap className="size-3 shrink-0 mt-0.5" />
              Statt des langen Codes bekommst du 4 Ziffern zum Abtippen — gültig
              10 Minuten, einmal einlösbar.
            </p>
          )}
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
    </PanelShell>
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

/** Live-Countdown bis Quick-Pair-Code abläuft (mm:ss). */
function QuickPairCountdown({ expiresAt }: { expiresAt: number }) {
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, expiresAt - Math.floor(Date.now() / 1000)),
  );
  useEffect(() => {
    const id = setInterval(() => {
      setRemaining(Math.max(0, expiresAt - Math.floor(Date.now() / 1000)));
    }, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  const mm = Math.floor(remaining / 60);
  const ss = remaining % 60;
  const expired = remaining <= 0;

  return (
    <span
      className={`text-xs tabular-nums ${expired ? "text-rose-500 dark:text-rose-400 font-medium" : "text-neutral-500 dark:text-neutral-400"}`}
    >
      {expired
        ? "abgelaufen — neuen Code erstellen"
        : `läuft ab in ${mm}:${String(ss).padStart(2, "0")}`}
    </span>
  );
}
