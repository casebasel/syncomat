import { KeyRound, Send, MoveRight } from "lucide-react";

export function EmptyState({
  onRedeemCode,
  onShowCode,
  onContinueAlone,
}: {
  onRedeemCode: () => void;
  onShowCode: () => void;
  onContinueAlone: () => void;
}) {
  return (
    <div className="mt-6 space-y-2">
      <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-4">
        Noch nichts eingerichtet. So legst du los:
      </p>
      <ActionRow
        icon={<KeyRound className="size-4" />}
        title="Code einlösen"
        sub="Hat dir jemand einen Einladungscode gegeben?"
        onClick={onRedeemCode}
      />
      <ActionRow
        icon={<Send className="size-4" />}
        title="Code für anderes Gerät erstellen"
        sub="Erlaube einem zweiten Rechner sich zu verbinden"
        onClick={onShowCode}
      />
      <ActionRow
        icon={<MoveRight className="size-4" />}
        title="Erstmal alleine starten"
        sub="Du kannst Geräte später hinzufügen"
        onClick={onContinueAlone}
        muted
      />
    </div>
  );
}

function ActionRow({
  icon,
  title,
  sub,
  onClick,
  muted,
}: {
  icon: React.ReactNode;
  title: string;
  sub: string;
  onClick: () => void;
  muted?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl border text-left transition-colors ${
        muted
          ? "border-dashed border-neutral-300 dark:border-neutral-800 hover:border-neutral-400 dark:hover:border-neutral-700"
          : "border-neutral-200 dark:border-neutral-800 bg-neutral-50/60 dark:bg-neutral-900 hover:bg-neutral-100 dark:hover:bg-neutral-800/60"
      }`}
    >
      <div className="size-9 rounded-lg bg-blue-600/10 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
          {title}
        </div>
        <p className="text-xs text-neutral-500 dark:text-neutral-400 truncate">
          {sub}
        </p>
      </div>
    </button>
  );
}
