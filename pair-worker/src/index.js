/**
 * Syncomat Pair-Rendezvous — Cloudflare Worker
 *
 * Mappt einen 4-stelligen Code auf einen vollen Einladungs-Code (Invite),
 * damit zwei Geräte über Internet pairen können ohne den ~290-Zeichen-Code
 * abzutippen. Der lange Invite enthält die Syncthing-Device-ID (56 chars,
 * unkürzbar) + Signatur — der 4-Code ist nur ein Schlüssel dazu.
 *
 * Sicherheit:
 *  - KV mit nativer 10-Min-TTL (expirationTtl 600) → Eintrag verfällt von selbst
 *  - Burn-after-read: GET löscht den Eintrag sofort nach erfolgreichem Abruf
 *  - Der eigentliche Schutz ist der manuelle "Annehmen"-Klick auf der
 *    Issuer-Seite — selbst wer den 4-Code errät, löst nur eine Pairing-
 *    Anfrage aus die der Issuer ablehnen kann.
 *  - Light Rate-Limit: max RETRIEVE_LIMIT GET-Versuche pro IP pro Minute,
 *    verhindert plumpe Enumeration aller 10.000 Codes.
 *
 * KV-Namespace: PAIRING (binding)
 */

const TTL_SECONDS = 600; // 10 Minuten
const RETRIEVE_LIMIT = 30; // GET-Versuche pro IP pro Minute
const MAX_INVITE_LEN = 4096;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

function randomCode() {
  // 0000–9999, immer 4 Ziffern (mit führenden Nullen)
  return String(Math.floor(Math.random() * 10000)).padStart(4, "0");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS });
    }

    // ── POST /pair — Invite ablegen, 4-Code zurückgeben ──
    if (request.method === "POST" && url.pathname === "/pair") {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: "invalid json" }, 400);
      }
      const invite = body && body.invite;
      if (
        typeof invite !== "string" ||
        invite.length < 20 ||
        invite.length > MAX_INVITE_LEN ||
        !invite.startsWith("syncomat1.")
      ) {
        return json({ error: "invalid invite" }, 400);
      }

      // Freien Code finden (Kollisionen sind selten bei ~1 aktivem Code)
      let code = null;
      for (let i = 0; i < 20; i++) {
        const candidate = randomCode();
        const existing = await env.PAIRING.get("c:" + candidate);
        if (!existing) {
          code = candidate;
          break;
        }
      }
      if (!code) {
        return json({ error: "no free code, retry" }, 503);
      }

      await env.PAIRING.put("c:" + code, invite, {
        expirationTtl: TTL_SECONDS,
      });
      return json({ code, expiresIn: TTL_SECONDS });
    }

    // ── GET /pair/:code — Invite abrufen + verbrennen ──
    const match = url.pathname.match(/^\/pair\/(\d{4})$/);
    if (request.method === "GET" && match) {
      const code = match[1];

      // Light Rate-Limit pro IP (verhindert plumpe Enumeration)
      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      const rlKey = "rl:" + ip;
      const tries = parseInt((await env.PAIRING.get(rlKey)) || "0", 10);
      if (tries >= RETRIEVE_LIMIT) {
        return json({ error: "rate limited, try again later" }, 429);
      }
      await env.PAIRING.put(rlKey, String(tries + 1), { expirationTtl: 60 });

      const invite = await env.PAIRING.get("c:" + code);
      if (!invite) {
        return json({ error: "not found or expired" }, 404);
      }
      // Burn-after-read
      await env.PAIRING.delete("c:" + code);
      return json({ invite });
    }

    return json({ error: "not found" }, 404);
  },
};
