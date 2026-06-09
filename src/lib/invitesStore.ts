import { invoke } from "@tauri-apps/api/core";

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
  /** Frontend-generated UUID — must match the one baked into the signed code. */
  id: string;
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

/** Atomic check-and-mark. Returns true if newly consumed, false if already. */
export const inviteConsumeOnce = (id: string) =>
  invoke<boolean>("invite_consume_once", { id });

/** Rollback for consume-once when a downstream PUT call failed. */
export const inviteReleaseConsumed = (id: string) =>
  invoke<void>("invite_release_consumed", { id });

export const invitePurgeExpired = () => invoke<number>("invite_purge_expired");

// (Sprint #2) useActiveInvites + deriveDisplayStatus entfernt — toter Code
// (null Aufrufer). Das Aktive-Einladungen-Dashboard existiert nicht.
