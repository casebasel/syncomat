import { useEffect, useRef, useState } from "react";
import { Check, ChevronRight, Loader2 } from "lucide-react";
import { Modal } from "./Modal";
import { executeRedemption, isSuccess, type RedeemPhase } from "../lib/redeemFlow";
import type { Endpoint, SystemStatus } from "../lib/syncthing";

type Phase = "input" | "running" | "done" | "error";

type StepRecord = { phase: RedeemPhase; message: string; ts: number };

export function CodeRedeemModal({
  endpoint,
  ready,
  status,
  onClose,
}: {
  endpoint: Endpoint | null;
  ready: boolean;
  status: SystemStatus | null;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("input");
  const [code, setCode] = useState("");
  const [steps, setSteps] = useState<StepRecord[]>([]);
  const [error, setError] = useState<{ message: string; detail?: string } | null>(null);
  const [doneInfo, setDoneInfo] = useState<{ deviceName: string } | null>(null);
  const [clipboardHint, setClipboardHint] = useState(false);
  const submittingRef = useRef(false);

  // Auto-detect Code in Clipboard beim Öffnen.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cb = await navigator.clipboard.readText();
        if (cancelled) return;
        if (cb.trim().startsWith("syncomat1.")) {
          setCode(cb.trim());
          setClipboardHint(true);
          setTimeout(() => setClipboardHint(false), 4000);
        }
      } catch {
        // Clipboard permission denied — ignore silently.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Live-Preview parsen (ohne HMAC-Verify) damit der User früh Feedback hat.
  const preview = parsePreview(code);

  const submit = async () => {
    if (submittingRef.current) return;
    if (!endpoint || !ready || !status) {
      setError({ message: "Syncthing ist noch nicht bereit." });
      setPhase("error");
      return;
    }
    if (!code.trim()) return;
    submittingRef.current = true;
    setPhase("running");
    setSteps([]);
    setError(null);

    try {
      const gen = executeRedemption(code, status.myID, endpoint);
      let step = await gen.next();
      while (!step.done) {
        const progress = step.value;
        setSteps((prev) => [
          ...prev,
          { phase: progress.phase, message: progress.message, ts: Date.now() },
        ]);
        step = await gen.next();
      }
      const final = step.value;
      if (isSuccess(final)) {
        setDoneInfo({ deviceName: final.deviceName });
        setPhase("done");
      } else {
        setError({ message: final.message, detail: final.detail });
        setPhase("error");
      }
    } catch (e) {
      setError({ message: String(e) });
      setPhase("error");
    } finally {
      submittingRef.current = false;
    }
  };

  // ─── UI ───

  if (phase === "done") {
    return (
      <Modal title="Verbunden" onClose={onClose}>
        <div className="space-y-4 text-sm">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-full bg-emerald-100 dark:bg-emerald-950/50 flex items-center justify-center">
              <Check className="size-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <div className="font-medium text-neutral-900 dark:text-neutral-100">
                Mit {doneInfo?.deviceName} verbunden
              </div>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                Ordner-Angebote tauchen gleich in der Hauptansicht auf.
              </p>
            </div>
          </div>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            Lösche den Code jetzt aus deiner Zwischenablage — er ist verbraucht.
          </p>
          <div className="flex justify-end pt-2">
            <button
              onClick={onClose}
              className="text-xs font-medium px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700"
            >
              Schließen
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  if (phase === "error") {
    return (
      <Modal title="Einlösen fehlgeschlagen" onClose={onClose}>
        <div className="space-y-4 text-sm">
          <p className="text-rose-600 dark:text-rose-400">{error?.message}</p>
          {error?.detail && (
            <details className="text-xs">
              <summary className="cursor-pointer text-neutral-500">Details</summary>
              <pre className="mt-2 p-2 rounded bg-neutral-100 dark:bg-neutral-950 text-neutral-700 dark:text-neutral-300 overflow-x-auto">
                {error.detail}
              </pre>
            </details>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={onClose}
              className="text-xs font-medium px-3 py-1.5 rounded-lg text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              Schließen
            </button>
            <button
              onClick={() => {
                setPhase("input");
                setSteps([]);
                setError(null);
              }}
              className="text-xs font-medium px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700"
            >
              Erneut versuchen
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  if (phase === "running") {
    return (
      <Modal title="Einlösen…" onClose={onClose}>
        <div className="space-y-2">
          {steps.map((s, i) => {
            const isLast = i === steps.length - 1;
            return (
              <div
                key={`${s.phase}-${i}`}
                className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300"
              >
                {isLast ? (
                  <Loader2 className="size-3.5 animate-spin text-blue-500 shrink-0" />
                ) : (
                  <Check className="size-3.5 text-emerald-500 shrink-0" />
                )}
                <span>{s.message}</span>
              </div>
            );
          })}
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Einladungscode einlösen" onClose={onClose}>
      <div className="space-y-3">
        {clipboardHint && (
          <p className="text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30 px-3 py-2 rounded-md">
            Code aus Zwischenablage übernommen
          </p>
        )}
        <textarea
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onBlur={(e) => setCode(e.target.value.trim())}
          placeholder="syncomat1...."
          rows={5}
          className="w-full font-mono text-[11px] p-3 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 break-all resize-none focus:outline-none focus:border-blue-500"
        />

        {preview && (
          <div className="text-xs space-y-1 px-3 py-2 rounded-lg bg-neutral-50 dark:bg-neutral-950/60 border border-neutral-200 dark:border-neutral-800">
            <Row label="Von Gerät" value={preview.issuerShort} mono />
            <Row label="Berechtigung" value={preview.rw ? "Lesen + Schreiben" : "Nur Lesen"} />
            <Row label="Läuft ab" value={fmtExpiry(preview.exp)} />
            {preview.note && <Row label="Notiz" value={preview.note} />}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            className="text-xs font-medium px-3 py-1.5 rounded-lg text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            Abbrechen
          </button>
          <button
            onClick={submit}
            disabled={!code.trim() || !ready}
            className="text-xs font-medium px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
          >
            <ChevronRight className="size-3.5" />
            Einlösen
          </button>
        </div>
      </div>
    </Modal>
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
      <span className="text-neutral-500 dark:text-neutral-500">{label}</span>
      <span
        className={
          mono
            ? "font-mono text-neutral-700 dark:text-neutral-300 text-right truncate"
            : "text-neutral-700 dark:text-neutral-300 text-right truncate max-w-[200px]"
        }
      >
        {value}
      </span>
    </div>
  );
}

type Preview = { issuerShort: string; rw: boolean; exp: number; note?: string };

function parsePreview(raw: string): Preview | null {
  const code = raw.trim();
  if (!code.startsWith("syncomat1.")) return null;
  const parts = code.split(".");
  if (parts.length !== 4) return null;
  const issuerIdShort = parts[1];
  const bodyB64 = parts[2];
  if (!issuerIdShort || !bodyB64) return null;
  try {
    let t = bodyB64.replace(/-/g, "+").replace(/_/g, "/");
    while (t.length % 4) t += "=";
    const json = atob(t);
    const p = JSON.parse(json);
    if (typeof p !== "object" || p === null) return null;
    return {
      issuerShort: typeof p.iss === "string" ? p.iss.slice(0, 7) : issuerIdShort,
      rw: !!p.rw,
      exp: typeof p.exp === "number" ? p.exp : 0,
      note: typeof p.n === "string" ? p.n : undefined,
    };
  } catch {
    return null;
  }
}

function fmtExpiry(unix: number): string {
  if (!unix) return "—";
  const now = Math.floor(Date.now() / 1000);
  if (unix < now) return "abgelaufen";
  const d = new Date(unix * 1000);
  return d.toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
