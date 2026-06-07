import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

export type InviteStatus =
  | { kind: "pending" }
  | { kind: "redeemed"; at: number; by_device_id: string }
  | { kind: "revoked"; at: number };

export type InviteOptions = {
  rw: boolean;
  note: string | null;
  addresses: string[];
};

export type ActiveInvite = {
  id: string;
  issued_at: number;
  expires_at: number;
  options: InviteOptions;
  status: InviteStatus;
};

export type CreateInviteInput = {
  options: InviteOptions;
  expires_at: number;
};

// ── Tauri-Command-Wrapper ──────────────────────────────────────

export const inviteCreate = (input: CreateInviteInput) =>
  invoke<ActiveInvite>("invite_create", { input });

export const inviteList = () => invoke<ActiveInvite[]>("invite_list");

export const inviteFind = (id: string) =>
  invoke<ActiveInvite | null>("invite_find", { id });

export const inviteMarkRedeemed = (id: string, peerDeviceId: string) =>
  invoke<void>("invite_mark_redeemed", { id, peerDeviceId });

export const inviteRevoke = (id: string) => invoke<void>("invite_revoke", { id });

export const inviteGetIssuerSecret = () =>
  invoke<string>("invite_get_issuer_secret");

export const inviteCheckConsumed = (id: string) =>
  invoke<boolean>("invite_check_consumed", { id });

export const inviteMarkConsumed = (id: string) =>
  invoke<void>("invite_mark_consumed", { id });

export const invitePurgeExpired = () => invoke<number>("invite_purge_expired");

// ── React-Hook ─────────────────────────────────────────────────

export type ActiveInvitesState = {
  data: ActiveInvite[] | null;
  error: Error | null;
  refresh: () => void;
};

export function useActiveInvites(pollMs = 5000): ActiveInvitesState {
  const [data, setData] = useState<ActiveInvite[] | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const fetchOnce = () => {
      inviteList()
        .then((d) => !cancelled && setData(d))
        .catch((e: Error) => !cancelled && setError(e));
    };
    fetchOnce();
    const id = setInterval(fetchOnce, pollMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [pollMs, tick]);

  return { data, error, refresh: () => setTick((t) => t + 1) };
}

// ── Helper-Funktionen ──────────────────────────────────────────

export function deriveDisplayStatus(
  inv: ActiveInvite,
  now: number = Math.floor(Date.now() / 1000),
): "pending" | "redeemed" | "revoked" | "expired" {
  if (inv.status.kind === "redeemed") return "redeemed";
  if (inv.status.kind === "revoked") return "revoked";
  if (inv.expires_at < now) return "expired";
  return "pending";
}
