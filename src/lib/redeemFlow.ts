import type { InvitePayload } from "./invite";
import { reasonToHuman, decodeInvite } from "./invite";
import { inviteCheckConsumed, inviteMarkConsumed } from "./invitesStore";
import { patchDevice, putDevice, type Device, type Endpoint } from "./syncthing";

export type RedeemPhase = "verify" | "add-device" | "wait-config" | "unpause";

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
 *   1. decode + sanity check
 *   2. mark consumed locally (vor PUT, damit Race + Doppelklick blockiert ist)
 *   3. PUT device (paused: true) — damit der erste Connect erst nach config-write passiert
 *   4. PATCH device (paused: false) — jetzt darf Syncthing connecten
 *   5. done — UI zeigt "verbunden, warte auf Ordner-Angebote"
 *
 * Auto-Share-on-Pair passiert auf der Issuer-Seite (CodeShowModal) wenn der
 * Pending-Device auftaucht. Der Redeemer macht hier nichts mit folders — die
 * kommen via Pending-Folders rein, der User verknüpft sie mit Pfad-Picker (Schritt 4).
 */
export async function* executeRedemption(
  rawCode: string,
  myDeviceId: string,
  ep: Endpoint,
): AsyncGenerator<RedeemProgress, RedeemFinal, void> {
  yield { phase: "verify", message: "Code prüfen…" };

  const decoded = await decodeInvite(rawCode, myDeviceId, inviteCheckConsumed);
  if (!decoded.ok) {
    return {
      phase: "verify",
      message: reasonToHuman(decoded.reason),
      detail: decoded.detail,
    };
  }
  const payload: InvitePayload = decoded.payload;
  const peerName = payload.n || payload.iss.slice(0, 7);

  try {
    await inviteMarkConsumed(payload.id);
  } catch (e) {
    return {
      phase: "verify",
      message: "Konnte Code nicht als verbraucht markieren.",
      detail: String(e),
    };
  }

  yield { phase: "add-device", message: `Verbinde mit ${peerName}…` };

  const addresses = [...(payload.adr ?? []), "dynamic"];
  const device: Device = {
    deviceID: payload.iss,
    name: peerName,
    addresses,
    introducer: false,
    autoAcceptFolders: false,
    paused: true,
  };

  try {
    await putDevice(ep, device);
  } catch (e) {
    return {
      phase: "add-device",
      message: "Konnte Gerät nicht zur Syncthing-Konfiguration hinzufügen.",
      detail: String(e),
    };
  }

  yield { phase: "wait-config", message: "Konfiguration speichern…" };

  await new Promise((r) => setTimeout(r, 600));

  yield { phase: "unpause", message: "Verbindung aufbauen…" };

  try {
    await patchDevice(ep, payload.iss, { paused: false });
  } catch (e) {
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
