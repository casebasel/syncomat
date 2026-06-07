// Einladungs-Code Format + Encoding/Decoding mit HMAC-SHA256.
// Format: syncomat1.<issuerIdShort>.<bodyB64url>.<sigB64url>
// Signed-Teil: `<issuerIdShort>.<bodyB64url>` (UTF-8)
// HMAC-Key: das im Body enthaltene `s` (Issuer-Secret, 32 zufällige Bytes b64url-codiert).
// `s` im Code mitzuführen ist bewusst: pragmatisches Trust-Model "Code IS der Token".

export type InvitePayload = {
  v: 1;
  id: string; // UUID v4 (crypto.randomUUID)
  iss: string; // full DeviceID (56 chars, dash-separated)
  s: string; // base64url(32 bytes) Issuer-Secret für HMAC
  rw: boolean;
  exp: number; // unix seconds
  n?: string; // optional note, max 40 chars
  adr?: string[]; // optional address-hints, max 4, private-IP whitelist
};

export type EncodeOptions = {
  myDeviceId: string;
  myIssuerSecret: string; // base64url
  rw: boolean;
  expSeconds: number; // delta from now; max 30 days
  note?: string;
  addresses?: string[];
};

export type DecodeReason =
  | "malformed"
  | "truncated"
  | "wrong-charset"
  | "wrong-prefix"
  | "wrong-version"
  | "schema-invalid"
  | "self-pairing-blocked"
  | "bad-signature"
  | "expired"
  | "already-consumed"
  | "bad-address-hint";

export type DecodeResult =
  | { ok: true; payload: InvitePayload }
  | { ok: false; reason: DecodeReason; detail?: string };

// ── base64url helpers ──────────────────────────────────────────

function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Uint8Array {
  let t = s.replace(/-/g, "+").replace(/_/g, "/");
  while (t.length % 4) t += "=";
  const bin = atob(t);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ── HMAC via Web Crypto ────────────────────────────────────────

async function hmacSign(secretB64: string, message: string): Promise<Uint8Array> {
  const secret = b64urlDecode(secretB64);
  const key = await crypto.subtle.importKey(
    "raw",
    secret,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return new Uint8Array(sig);
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let acc = 0;
  for (let i = 0; i < a.length; i++) acc |= a[i]! ^ b[i]!;
  return acc === 0;
}

// ── Address-Whitelist (Briefing + ZeroTier-Setup) ──────────────

const ADDR_PRIVATE_PATTERNS = [
  /^tcp:\/\/10\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d{1,5}$/,
  /^tcp:\/\/172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}:\d{1,5}$/,
  /^tcp:\/\/192\.168\.\d{1,3}\.\d{1,3}:\d{1,5}$/,
  /^tcp:\/\/100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}:\d{1,5}$/, // ZeroTier CGNAT 100.64/10
  /^tcp:\/\/\[fc[0-9a-f]{2}:.+\]:\d{1,5}$/i, // ULA fc00::/7
  /^tcp:\/\/\[fe80:.+\]:\d{1,5}$/i, // Link-local fe80::/10
];

export function isPrivateAddressHint(addr: string): boolean {
  return ADDR_PRIVATE_PATTERNS.some((p) => p.test(addr));
}

// ── Encoder ────────────────────────────────────────────────────

export async function encodeInvite(opts: EncodeOptions): Promise<{
  code: string;
  codeId: string;
  expiresAt: number;
}> {
  if (!opts.myDeviceId || opts.myDeviceId.length < 16) {
    throw new Error("invalid myDeviceId");
  }
  if (opts.expSeconds <= 0 || opts.expSeconds > 30 * 24 * 3600) {
    throw new Error("expSeconds must be 1s..30d");
  }
  if (opts.note && opts.note.length > 40) {
    throw new Error("note must be at most 40 chars");
  }
  if (opts.addresses) {
    if (opts.addresses.length > 4) throw new Error("max 4 addresses");
    for (const a of opts.addresses) {
      if (!isPrivateAddressHint(a)) throw new Error(`address not allowed: ${a}`);
    }
  }
  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const payload: InvitePayload = {
    v: 1,
    id,
    iss: opts.myDeviceId,
    s: opts.myIssuerSecret,
    rw: opts.rw,
    exp: now + opts.expSeconds,
    ...(opts.note ? { n: opts.note } : {}),
    ...(opts.addresses && opts.addresses.length > 0 ? { adr: opts.addresses } : {}),
  };

  const issuerIdShort = opts.myDeviceId.slice(0, 7);
  const bodyB64 = b64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signedPart = `${issuerIdShort}.${bodyB64}`;
  const sig = await hmacSign(opts.myIssuerSecret, signedPart);
  return {
    code: `syncomat1.${signedPart}.${b64urlEncode(sig)}`,
    codeId: id,
    expiresAt: payload.exp,
  };
}

// ── Decoder ────────────────────────────────────────────────────

export async function decodeInvite(
  rawCode: string,
  myDeviceId: string,
): Promise<DecodeResult> {
  const code = rawCode.trim();
  if (code.length === 0) return { ok: false, reason: "malformed", detail: "empty" };
  if (code.length > 4096) return { ok: false, reason: "malformed", detail: "too long" };
  if (!code.startsWith("syncomat1.")) {
    return { ok: false, reason: "wrong-prefix", detail: "expected 'syncomat1.' prefix" };
  }

  const parts = code.split(".");
  if (parts.length !== 4) {
    return { ok: false, reason: "malformed", detail: `expected 4 parts, got ${parts.length}` };
  }
  const [, issuerIdShort, bodyB64, sigB64] = parts as [string, string, string, string];

  const b64urlRegex = /^[A-Za-z0-9_-]+$/;
  if (!b64urlRegex.test(issuerIdShort) || !b64urlRegex.test(bodyB64) || !b64urlRegex.test(sigB64)) {
    return { ok: false, reason: "wrong-charset" };
  }
  if (issuerIdShort.length !== 7) {
    return { ok: false, reason: "malformed", detail: "issuer-id-short length wrong" };
  }
  if (sigB64.length !== 43) {
    return { ok: false, reason: "truncated", detail: "signature length wrong (expected 43 chars)" };
  }

  let bodyBytes: Uint8Array;
  try {
    bodyBytes = b64urlDecode(bodyB64);
  } catch {
    return { ok: false, reason: "malformed", detail: "body not base64url" };
  }
  if (bodyBytes.length > 1024) {
    return { ok: false, reason: "malformed", detail: "body too large" };
  }

  let payload: unknown;
  try {
    const bodyJson = new TextDecoder().decode(bodyBytes);
    payload = JSON.parse(bodyJson, (k, v) => {
      if (k === "__proto__" || k === "constructor" || k === "prototype") return undefined;
      return v;
    });
  } catch {
    return { ok: false, reason: "malformed", detail: "body not valid JSON" };
  }

  const schemaErr = validatePayloadV1(payload);
  if (schemaErr) return { ok: false, reason: "schema-invalid", detail: schemaErr };
  const p = payload as InvitePayload;

  if (p.v !== 1) {
    return { ok: false, reason: "wrong-version", detail: `unsupported v=${p.v}` };
  }
  if (p.iss.slice(0, 7) !== issuerIdShort) {
    return { ok: false, reason: "schema-invalid", detail: "iss prefix does not match" };
  }
  if (p.iss === myDeviceId) {
    return { ok: false, reason: "self-pairing-blocked" };
  }

  let sigBytes: Uint8Array;
  try {
    sigBytes = b64urlDecode(sigB64);
  } catch {
    return { ok: false, reason: "malformed", detail: "sig not base64url" };
  }
  const signedPart = `${issuerIdShort}.${bodyB64}`;
  const expected = await hmacSign(p.s, signedPart);
  if (!constantTimeEqual(expected, sigBytes)) {
    return { ok: false, reason: "bad-signature" };
  }

  if (p.exp < Math.floor(Date.now() / 1000)) {
    return { ok: false, reason: "expired" };
  }

  // Replay-check is done in the redemption flow via atomic invite_consume_once.
  // Decode is pure (no I/O) so it can be called freely for live-preview.

  return { ok: true, payload: p };
}

function validatePayloadV1(p: unknown): string | null {
  if (typeof p !== "object" || p === null) return "not an object";
  const o = p as Record<string, unknown>;
  if (o.v !== 1) return "v must be 1";
  if (typeof o.id !== "string" || o.id.length < 16 || o.id.length > 64) return "id invalid";
  if (typeof o.iss !== "string" || o.iss.length < 16 || o.iss.length > 100) return "iss invalid";
  if (typeof o.s !== "string" || o.s.length < 40 || o.s.length > 64) return "s invalid";
  if (typeof o.rw !== "boolean") return "rw must be boolean";
  if (typeof o.exp !== "number" || !Number.isFinite(o.exp) || o.exp < 0) return "exp invalid";
  if (o.n !== undefined && (typeof o.n !== "string" || o.n.length > 40)) return "n invalid";
  if (o.adr !== undefined) {
    if (!Array.isArray(o.adr) || o.adr.length > 4) return "adr invalid";
    for (const a of o.adr) {
      if (typeof a !== "string") return "adr entries must be strings";
      if (!isPrivateAddressHint(a)) return `address not allowed: ${a}`;
    }
  }
  return null;
}

// ── Helper für UI ──────────────────────────────────────────────

export function shortDeviceIdFrom(payload: InvitePayload): string {
  return payload.iss.slice(0, 7);
}

export function reasonToHuman(r: DecodeReason): string {
  switch (r) {
    case "malformed":
      return "Code ist kaputt oder unvollständig.";
    case "truncated":
      return "Code ist abgeschnitten — kopiere ihn nochmal komplett.";
    case "wrong-charset":
      return "Ungültige Zeichen im Code — vom Kopieren her vermasselt?";
    case "wrong-prefix":
      return "Das ist kein Syncomat-Code.";
    case "wrong-version":
      return "Code ist für eine neuere Syncomat-Version. Update nötig.";
    case "schema-invalid":
      return "Code-Inhalt ist ungültig.";
    case "self-pairing-blocked":
      return "Dieser Code wurde auf diesem Gerät erstellt — lös ihn auf einem anderen Gerät ein.";
    case "bad-signature":
      return "Code-Signatur stimmt nicht — er wurde manipuliert.";
    case "expired":
      return "Code ist abgelaufen — bitte einen neuen anfordern.";
    case "already-consumed":
      return "Code wurde schon eingelöst — er ist einmalig.";
    case "bad-address-hint":
      return "Code enthält unerlaubte Netzwerkadresse.";
  }
}
