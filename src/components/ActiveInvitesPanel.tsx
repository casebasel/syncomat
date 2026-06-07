import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import {
  deriveDisplayStatus,
  inviteRevoke,
  useActiveInvites,
  type ActiveInvite,
} from "../lib/invitesStore";

export function ActiveInvitesPanel() {
  const { data, refresh } = useActiveInvites();

  const visible = (data ?? []).filter((inv) => {
    const s = deriveDisplayStatus(inv);
    // Show pending always; redeemed/revoked nur 24h
    if (s === "pending") return true;
    const age = Math.floor(Date.now() / 1000) - inv.issued_at;
    return age < 24 * 3600;
  });

  if (visible.length === 0) return null;

  return (
    <section className="mt-5">
      <p className="text-[11px] uppercase tracking-wider text-neutral-400 dark:text-neutral-500 mb-2">
        Einladungen
      </p>
      <div className="space-y-1.5">
        {visible.map((inv) => (
          <InviteRow key={inv.id} invite={inv} onRevoked={refresh} />
        ))}
      </div>
    </section>
  );
}

function InviteRow({
  invite,
  onRevoked,
}: {
  invite: ActiveInvite;
  onRevoked: () => void;
}) {
  const status = deriveDisplayStatus(invite);
  const isPending = status === "pending";
  const [optimisticRevoked, setOptimisticRevoked] = useState(false);
  const [busy, setBusy] = useState(false);
  const effectiveStatus = optimisticRevoked ? "revoked" : status;

  const revoke = async () => {
    const note = invite.options.note ? `"${invite.options.note}"` : "diese Einladung";
    if (!window.confirm(`${note} widerrufen? Der Code kann danach nicht mehr eingelöst werden.`)) {
      return;
    }
    setBusy(true);
    setOptimisticRevoked(true);
    try {
      await inviteRevoke(invite.id);
      onRevoked();
    } catch (e) {
      setOptimisticRevoked(false);
      console.error("[invites] revoke failed", e);
      window.alert(`Konnte nicht widerrufen: ${e}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50/40 dark:bg-neutral-900/50 text-xs">
      <StatusBadge status={effectiveStatus} />
      <div className="min-w-0 flex-1">
        <div className="text-neutral-900 dark:text-neutral-100 truncate">
          {invite.options.note || "Einladung"}
        </div>
        <p className="text-neutral-500 dark:text-neutral-400 text-[11px]">
          {invite.options.rw ? "RW" : "RO"} · {statusMeta(invite, effectiveStatus)}
        </p>
      </div>
      {isPending && !optimisticRevoked && (
        <button
          onClick={revoke}
          disabled={busy}
          title="Widerrufen"
          className="p-1.5 rounded-md text-neutral-400 hover:text-rose-500 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 disabled:opacity-50"
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
        </button>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: ReturnType<typeof deriveDisplayStatus> }) {
  const map: Record<
    ReturnType<typeof deriveDisplayStatus>,
    { label: string; cls: string }
  > = {
    pending: {
      label: "offen",
      cls: "bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300",
    },
    redeemed: {
      label: "eingelöst",
      cls: "bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400",
    },
    revoked: {
      label: "widerrufen",
      cls: "bg-neutral-200 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400",
    },
    expired: {
      label: "abgelaufen",
      cls: "bg-neutral-200 dark:bg-neutral-800 text-neutral-500 dark:text-neutral-500",
    },
  };
  const { label, cls } = map[status];
  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide ${cls}`}>
      {label}
    </span>
  );
}

function statusMeta(invite: ActiveInvite, status: ReturnType<typeof deriveDisplayStatus>): string {
  const now = Math.floor(Date.now() / 1000);
  if (status === "pending") {
    const left = invite.expires_at - now;
    if (left < 3600) return `${Math.max(0, Math.floor(left / 60))} min übrig`;
    if (left < 24 * 3600) return `${Math.floor(left / 3600)} h übrig`;
    return `${Math.floor(left / (24 * 3600))} Tage übrig`;
  }
  if (status === "redeemed" && invite.status.kind === "redeemed") {
    return `von ${invite.status.by_device_id.slice(0, 7)}`;
  }
  if (status === "revoked") return "manuell widerrufen";
  if (status === "expired") return "Code ist abgelaufen";
  return "";
}
