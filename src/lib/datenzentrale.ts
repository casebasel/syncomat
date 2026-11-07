import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";

// ── Verbindung zur Datenzentrale ─────────────────────────────────
//
// syncomat ist Datenagent der Datenzentrale (Konzept casebasel/datenzentrale,
// Kapitel 9). Die Zugangsdaten kommen aus `datenagent-token-erzeugen.sh`
// (Repo plate-assistant) als vier Zeilen KEY=VALUE, liegen im Schlüsselbund
// (Rust: datenzentrale.rs) und gelten für genau einen Rechner.
//
// Release 1: verbinden und die Aufträge dieses Rechners LESEN und anzeigen.
// Ausgeführt wird noch nichts.

/** Präfix der Syncthing-Folder-ID eines Abo-Ordners (vergibt die
 * Datenzentrale: `dz-<projekt.id>-<n>`). Solche Ordner teilt syncomat nie
 * automatisch an alle Geräte — sie gehören nur den abonnierten Rechnern. */
export const ABO_FOLDER_PREFIX = "dz-";
export const isAboFolderId = (id: string) => id.startsWith(ABO_FOLDER_PREFIX);

const POLL_MS = 30_000;
const WARN_DAYS = 30;
/** Rolle des Datenagenten (ab Migration 0037: liest + legt eigene Berichte an). */
const ROLES = new Set(["datenagent"]);

export type DzCredentials = { url: string; anon_key: string; token: string; rechner: string };
export type TokenInfo = { role?: string; rechner?: string; exp?: number; iat?: number };

export type DzAuftrag = {
  id: string;
  rechner: string;
  art: string;
  zustand: string;
  angaben?: Record<string, unknown> | null;
  [k: string]: unknown;
};

/** JWT-Nutzlast lesen (ohne Signaturprüfung — die macht der Server). */
export function decodeJwt(token: string): TokenInfo | null {
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    return JSON.parse(json) as TokenInfo;
  } catch {
    return null;
  }
}

/** Erwarteter Rechnername (wie im Token-Skript) aus dem Computernamen.
 * Bis die Datenzentrale die Zuordnung über die Geräte-ID liefert (dz_rechner),
 * gilt diese feste Liste der Ausnahmen; sonst der Name klein geschrieben. */
export function expectedRechner(computerName: string): string {
  const n = computerName.trim().toLowerCase();
  if (n === "x5950") return "ada";
  if (n.startsWith("macbook")) return "macbook";
  return n;
}

export type CredentialCheck = { problems: string[]; warnings: string[]; exp: Date | null };

/** Zugangsdaten gegen Token-Inhalt und diesen Rechner prüfen. */
export function checkCredentials(c: DzCredentials, computerName: string): CredentialCheck {
  const problems: string[] = [];
  const warnings: string[] = [];
  const info = decodeJwt(c.token);
  if (!info) {
    problems.push("Token unlesbar.");
    return { problems, warnings, exp: null };
  }
  if (!info.role || !ROLES.has(info.role)) {
    problems.push(
      info.role === "datenagent_reader"
        ? "Token im alten Format (vor Migration 0037) — neu erzeugen."
        : `Token hat die falsche Rolle („${info.role ?? "keine"}“), erwartet „datenagent“.`,
    );
  }
  if (info.rechner && info.rechner !== c.rechner) {
    problems.push(`Token gehört zu „${info.rechner}“, die Zeilen nennen „${c.rechner}“.`);
  }
  const expected = expectedRechner(computerName);
  if (expected && c.rechner !== expected) {
    problems.push(
      `Token ist für „${c.rechner}“, dieser Rechner ist „${expected}“ (${computerName}). Token für diesen Rechner erzeugen.`,
    );
  }
  const exp = info.exp ? new Date(info.exp * 1000) : null;
  if (!exp) {
    warnings.push("Token ohne Ablaufdatum.");
  } else if (exp.getTime() <= Date.now()) {
    problems.push(`Token ist abgelaufen (${exp.toLocaleDateString("de-CH")}).`);
  } else {
    const days = Math.floor((exp.getTime() - Date.now()) / 86_400_000);
    if (days < WARN_DAYS) warnings.push(`Token läuft in ${days} Tagen ab — neu erzeugen.`);
  }
  return { problems, warnings, exp };
}

async function fetchAuftraege(c: DzCredentials): Promise<DzAuftrag[]> {
  const url = `${c.url}/rest/v1/dz_auftrag?select=*&rechner=eq.${encodeURIComponent(c.rechner)}`;
  const res = await fetch(url, {
    headers: { apikey: c.anon_key, Authorization: `Bearer ${c.token}`, Accept: "application/json" },
  });
  if (res.status === 401) throw new Error("Token ungültig oder abgelaufen (401).");
  if (res.status === 403) throw new Error("Keine Leserechte auf dz_auftrag (403).");
  if (!res.ok) throw new Error(`Datenzentrale antwortet ${res.status} ${res.statusText}.`);
  const rows = (await res.json()) as DzAuftrag[];
  // Nur die eigenen (der Server filtert schon; doppelt hält besser).
  return rows.filter((r) => r.rechner === c.rechner).sort((a, b) => (a.id < b.id ? 1 : -1));
}

/** Ein Bericht für dz_bericht (Vertrag: plate-assistant docs/ABGLEICH.md,
 * „Datenagenten und Berichte (Migration 0037)“). */
export type DzBerichtWert = {
  id: string; // be- + 32 Hex
  auftrag_id: string;
  rechner: string;
  zustand: string;
  grund: string;
  stand: Record<string, unknown>;
  zeit: string; // ISO 8601 mit Zone
};

/** Ergebnis je Bericht: gespeichert (uebernommen/wiederholt), endgültig
 * abgelehnt (mit Grund) oder später erneut versuchen. */
export type DzSendeErgebnis =
  | { id: string; kind: "gespeichert" }
  | { id: string; kind: "abgelehnt"; grund: string }
  | { id: string; kind: "spaeter"; grund: string };

/** Berichte über aenderungen_anwenden als `_anlegen` in dz_bericht senden.
 * Änderungs-id = Bericht-id → erneutes Senden ist automatisch „wiederholt“. */
export async function sendBerichteRpc(c: DzCredentials, berichte: DzBerichtWert[]): Promise<DzSendeErgebnis[]> {
  const body = {
    p_geraet: "syncomat",
    p_aenderungen: berichte.map((b) => ({
      id: b.id,
      tabelle: "dz_bericht",
      datensatz: b.id,
      feld: "_anlegen",
      zeit: Date.now() * 1000, // Mikrosekunden seit 1970
      wert: {
        auftrag_id: b.auftrag_id,
        rechner: b.rechner,
        zustand: b.zustand,
        grund: b.grund.slice(0, 500),
        stand: b.stand,
        zeit: b.zeit,
      },
    })),
  };
  let res: Response;
  try {
    res = await fetch(`${c.url}/rest/v1/rpc/aenderungen_anwenden`, {
      method: "POST",
      headers: {
        apikey: c.anon_key,
        Authorization: `Bearer ${c.token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return berichte.map((b) => ({ id: b.id, kind: "spaeter", grund: `Netz: ${String(e)}` }));
  }
  if (res.status === 401 || res.status === 403) {
    // Token abgelaufen/ungültig (401) oder ohne gültigen Rechner (403/28000):
    // später erneut, sobald ein neues Token eingefügt ist — nie verwerfen.
    const why = res.status === 401 ? "Token ungültig oder abgelaufen (401)" : "Token ohne gültigen Rechner (403)";
    return berichte.map((b) => ({ id: b.id, kind: "spaeter", grund: why }));
  }
  if (!res.ok) {
    return berichte.map((b) => ({ id: b.id, kind: "spaeter", grund: `Datenzentrale ${res.status}` }));
  }
  const rows = (await res.json().catch(() => null)) as
    | { id?: string; ergebnis?: string; grund?: string; wiederholt?: boolean }[]
    | null;
  if (!Array.isArray(rows) || rows.length !== berichte.length) {
    return berichte.map((b) => ({ id: b.id, kind: "spaeter", grund: "Antwort unvollständig" }));
  }
  // Eine Antwort je Änderung, in derselben Reihenfolge.
  return berichte.map((b, i) => {
    const r = rows[i] ?? {};
    if (r.ergebnis === "uebernommen") return { id: b.id, kind: "gespeichert" };
    if (r.ergebnis === "abgelehnt") return { id: b.id, kind: "abgelehnt", grund: r.grund || "abgelehnt" };
    return { id: b.id, kind: "spaeter", grund: `unbekanntes Ergebnis „${r.ergebnis ?? ""}“` };
  });
}

export type DzState = {
  /** Zugangsdaten ohne Token (für die Anzeige). */
  connection: { url: string; rechner: string } | null;
  check: CredentialCheck | null;
  computerName: string;
  auftraege: DzAuftrag[];
  lastFetch: Date | null;
  error: string | null;
};

export function useDatenzentrale() {
  const [creds, setCreds] = useState<DzCredentials | null>(null);
  const [computerName, setComputerName] = useState("");
  const [auftraege, setAuftraege] = useState<DzAuftrag[]>([]);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    invoke<string>("computer_name").then(setComputerName).catch(() => {});
    invoke<DzCredentials | null>("dz_credentials_load")
      .then(setCreds)
      .catch((e) => setError(String(e)));
  }, []);

  const refresh = useCallback(async () => {
    if (!creds) return;
    try {
      setAuftraege(await fetchAuftraege(creds));
      setLastFetch(new Date());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [creds]);

  useEffect(() => {
    if (!creds) return;
    void refresh();
    const id = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(id);
  }, [creds, refresh]);

  /** Eingefügten Text prüfen (ohne zu speichern). */
  const preview = useCallback(
    async (text: string): Promise<{ creds: DzCredentials; check: CredentialCheck } | { error: string }> => {
      try {
        const c = await invoke<DzCredentials>("dz_credentials_parse", { text });
        return { creds: c, check: checkCredentials(c, computerName) };
      } catch (e) {
        return { error: String(e) };
      }
    },
    [computerName],
  );

  /** Speichern — nur, wenn die Prüfung keine Probleme meldet. */
  const connect = useCallback(
    async (text: string): Promise<string | null> => {
      const p = await preview(text);
      if ("error" in p) return p.error;
      if (p.check.problems.length > 0) return p.check.problems.join(" ");
      try {
        setCreds(await invoke<DzCredentials>("dz_credentials_save", { text }));
        return null;
      } catch (e) {
        return String(e);
      }
    },
    [preview],
  );

  const disconnect = useCallback(async () => {
    await invoke("dz_credentials_clear");
    setCreds(null);
    setAuftraege([]);
    setLastFetch(null);
    setError(null);
  }, []);

  const state: DzState = {
    connection: creds ? { url: creds.url, rechner: creds.rechner } : null,
    check: creds ? checkCredentials(creds, computerName) : null,
    computerName,
    auftraege,
    lastFetch,
    error,
  };
  /** Berichte senden (nur mit gültigen Zugangsdaten). */
  const sendBerichte = useCallback(
    async (b: DzBerichtWert[]): Promise<DzSendeErgebnis[] | null> => {
      if (!creds || b.length === 0) return null;
      if (checkCredentials(creds, computerName).problems.length > 0) return null;
      return sendBerichteRpc(creds, b);
    },
    [creds, computerName],
  );

  return { state, preview, connect, disconnect, refresh, sendBerichte };
}
