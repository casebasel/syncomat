/**
 * Quick-Pair-Rendezvous-Client. Spricht mit dem Cloudflare Worker (siehe
 * pair-worker/) der einen 4-stelligen Code auf den vollen Invite mappt.
 *
 * Der lange Invite enthält die Syncthing-Device-ID (56 Zeichen, unkürzbar)
 * + Signatur — die 4 Ziffern sind nur ein Schlüssel zu dem Ablageort.
 */

// Cloudflare Worker (pair-worker/), deployed 2026-06-09 auf casebasel-Account.
export const RENDEZVOUS_URL = "https://syncomat-pair.casebasel.workers.dev";

/** Ist Quick-Pair konfiguriert? (false wenn URL noch Platzhalter) */
export const QUICK_PAIR_ENABLED =
  !RENDEZVOUS_URL.includes("REPLACE") && RENDEZVOUS_URL.startsWith("https://");

export type PublishResult = { code: string; expiresIn: number };

/** Legt den vollen Invite ab und gibt den 4-stelligen Code zurück. */
export async function publishInvite(invite: string): Promise<PublishResult> {
  const res = await fetch(`${RENDEZVOUS_URL}/pair`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ invite }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Rendezvous-Fehler ${res.status}${detail ? `: ${detail}` : ""}`);
  }
  const data = (await res.json()) as PublishResult;
  if (!data.code) throw new Error("Rendezvous lieferte keinen Code");
  return data;
}

/** Holt den vollen Invite zu einem 4-stelligen Code (und verbrennt ihn). */
export async function retrieveInvite(code: string): Promise<string> {
  const clean = code.trim();
  if (!/^\d{4}$/.test(clean)) {
    throw new Error("Code muss 4 Ziffern sein");
  }
  const res = await fetch(`${RENDEZVOUS_URL}/pair/${clean}`);
  if (res.status === 404) {
    throw new Error("Code abgelaufen oder schon benutzt");
  }
  if (res.status === 429) {
    throw new Error("Zu viele Versuche — kurz warten");
  }
  if (!res.ok) {
    throw new Error(`Rendezvous-Fehler ${res.status}`);
  }
  const data = (await res.json()) as { invite?: string };
  if (!data.invite) throw new Error("Rendezvous lieferte keinen Invite");
  return data.invite;
}
