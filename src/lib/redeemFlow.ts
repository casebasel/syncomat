import type { InvitePayload } from "./invite";
import { reasonToHuman, decodeInvite } from "./invite";
import { inviteConsumeOnce, inviteReleaseConsumed } from "./invitesStore";
import { getConfig, patchDevice, putDevice, type Device, type Endpoint } from "./syncthing";

export type RedeemPhase = "verify" | "consume" | "add-device" | "wait-config" | "unpause";

export type RedeemProgress = {
  phase: RedeemPhase;
  message: string;
};

export type RedeemSuccess = {
  phase: "done";
  deviceId: string;
  deviceName: string;
};

export type RedeemError = {
  phase: RedeemPhase;
  message: string;
  detail?: string;
};

export type RedeemFinal = RedeemSuccess | RedeemError;

export function isSuccess(r: RedeemFinal): r is RedeemSuccess {
  return r.phase === "done";
}

/**
 * Orchestriert das Einlösen eines Einladungs-Codes auf der Empfänger-Seite.
 *
 * Schritte:
 *   1. decodeInvite (pure, no I/O — Schema + HMAC + Self-Pair + Expiry)
 *   2. inviteConsumeOnce (atomic check-and-mark) — blockiert Doppel-Einlösung
 *   3. PUT device (paused: true)
 *   4. Wait until Syncthing's config picked up the device (poll, max 5s)
 *   5. PATCH device (paused: false) — connect
 *   6. done
 *
 * Bei Fehler in Schritt 3-5: inviteReleaseConsumed rollback'd den consume-marker,
 * der User kann den Code nochmal probieren (oder den Issuer um einen neuen bitten).
 */
export async function* executeRedemption(
  rawCode: string,
  myDeviceId: string,
  ep: Endpoint,
): AsyncGenerator<RedeemProgress, RedeemFinal, void> {
  yield { phase: "verify", message: "Code prüfen…" };

  const decoded = await decodeInvite(rawCode, myDeviceId);
  if (!decoded.ok) {
    return {
      phase: "verify",
      message: reasonToHuman(decoded.reason),
      detail: decoded.detail,
    };
  }
  const payload: InvitePayload = decoded.payload;
  const peerName = payload.n || payload.iss.slice(0, 7);

  yield { phase: "consume", message: "Code reservieren…" };

  let consumed = false;
  try {
    consumed = await inviteConsumeOnce(payload.id);
  } catch (e) {
    return {
      phase: "consume",
      message: "Konnte Code-Marker nicht setzen.",
      detail: String(e),
    };
  }
  if (!consumed) {
    return {
      phase: "consume",
      message: reasonToHuman("already-consumed"),
    };
  }

  const rollback = async () => {
    try {
      await inviteReleaseConsumed(payload.id);
    } catch (e) {
      console.warn("[redeemFlow] release-consumed failed", e);
    }
  };

  yield { phase: "add-device", message: `Verbinde mit ${peerName}…` };

  const addresses = [...(payload.adr ?? []), "dynamic"];
  const device: Device = {
    deviceID: payload.iss,
    name: peerName,
    addresses,
    // introducer: false (Sprint #1) — kein Mesh; wir verbinden uns nur mit dem
    // Gerät, dessen Code wir bewusst eingelöst haben.
    introducer: false,
    autoAcceptFolders: false,
    paused: true,
  };

  try {
    await putDevice(ep, device);
  } catch (e) {
    await rollback();
    return {
      phase: "add-device",
      message: "Konnte Gerät nicht zur Syncthing-Konfiguration hinzufügen.",
      detail: String(e),
    };
  }

  yield { phase: "wait-config", message: "Konfiguration speichern…" };

  // Statt fester Sleep: poll bis Syncthing das Device in seiner Config sieht.
  const configReady = await waitForDeviceInConfig(ep, payload.iss, 5000);
  if (!configReady) {
    await rollback();
    return {
      phase: "wait-config",
      message: "Syncthing hat die Konfiguration nicht innerhalb 5s übernommen.",
    };
  }

  yield { phase: "unpause", message: "Verbindung aufbauen…" };

  try {
    await patchDevice(ep, payload.iss, { paused: false });
  } catch (e) {
    await rollback();
    return {
      phase: "unpause",
      message: "Konnte Verbindung nicht aktivieren.",
      detail: String(e),
    };
  }

  return {
    phase: "done",
    deviceId: payload.iss,
    deviceName: peerName,
  };
}

async function waitForDeviceInConfig(
  ep: Endpoint,
  deviceId: string,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const config = await getConfig(ep);
      if (config.devices.some((d) => d.deviceID === deviceId)) return true;
    } catch {
      // ignore transient errors and keep polling
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}
