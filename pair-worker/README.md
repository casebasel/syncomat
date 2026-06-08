# Syncomat Pair-Rendezvous

Winziger Cloudflare Worker der 4-stellige Quick-Pair-Codes auf volle
Einladungs-Codes mappt. Nötig damit Quick-Pair über Internet funktioniert
(getrennte NATs können sich den Invite sonst nicht zureichen).

## Deploy (einmalig)

```bash
cd pair-worker

# 1. wrangler installieren (falls nicht da)
npm install -g wrangler

# 2. bei Cloudflare einloggen (öffnet Browser)
wrangler login

# 3. KV-Namespace anlegen
wrangler kv namespace create PAIRING
# → gibt eine id aus, z.B. id = "abc123…"

# 4. die id in wrangler.toml bei [[kv_namespaces]] eintragen
#    (REPLACE_WITH_KV_NAMESPACE_ID ersetzen)

# 5. deployen
wrangler deploy
# → gibt die URL aus, z.B. https://syncomat-pair.<account>.workers.dev
```

## URL in die App eintragen

Die deploy-URL in `src/lib/rendezvous.ts` bei `RENDEZVOUS_URL` eintragen,
dann normalen App-Release bauen.

Optional: eigene Route `syncomat-pair.ca-se.ch` in `wrangler.toml`
einkommentieren (braucht die ca-se.ch Zone, hast du via Tunnel) — dann
ist die URL stabil und passt zum restlichen Naming.

## Endpoints

```
POST /pair            body: { invite: "syncomat1...." }
                      → { code: "4729", expiresIn: 600 }

GET  /pair/4729       → { invite: "syncomat1...." }   (löscht danach)
                      → 404 wenn abgelaufen/verbraucht
                      → 429 wenn rate-limited
```

## Sicherheit

- KV native TTL 600s → Code verfällt nach 10 Min von selbst
- Burn-after-read → nach erfolgreichem Abruf weg
- Rate-Limit 30 GET/IP/Min → keine plumpe Enumeration
- Eigentlicher Gate bleibt der manuelle "Annehmen"-Klick auf Issuer-Seite

## Kosten

Cloudflare free tier: 100.000 Requests/Tag + 100.000 KV-reads/Tag.
Für persönliches Pairing praktisch gratis (du machst vielleicht 10/Monat).
