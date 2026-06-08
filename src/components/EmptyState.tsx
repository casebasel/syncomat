import { FolderPlus, KeyRound, Send } from "lucide-react";

export function EmptyState({
  onCreateFolder,
  onRedeemCode,
  onShowCode,
}: {
  onCreateFolder: () => void;
  onRedeemCode: () => void;
  onShowCode: () => void;
}) {
  return (
    <div className="mt-6 space-y-2">
      <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-4">
        Noch nichts eingerichtet. So legst du los:
      </p>
      <ActionRow
        icon={<FolderPlus className="size-4" />}
        title="Ersten Ordner anlegen"
        sub="Wähle einen lokalen Pfad — Geräte können später dazukommen"
        onClick={onCreateFolder}
        primary
      />
      <ActionRow
        icon={<KeyRound className="size-4" />}
        title="Code einlösen"
        sub="Hat dir jemand einen Einladungscode gegeben?"
        onClick={onRedeemCode}
      />
      <ActionRow
        icon={<Send className="size-4" />}
        title="Code für anderes Gerät erstellen"
        sub="Lade einen zweiten Rechner ein — alle deine Ordner werden geteilt"
        onClick={onShowCode}
      />
    </div>
  );
}

function ActionRow({
  icon,
  title,
  sub,
  onClick,
  primary,
}: {
  icon: React.ReactNode;
  title: string;
  sub: string;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl border text-left transition-colors ${
        primary
          ? "border-blue-300 dark:border-blue-500/40 bg-blue-50 dark:bg-blue-950/30 hover:bg-blue-100 dark:hover:bg-blue-950/50"
          : "border-neutral-200 dark:border-neutral-800 bg-neutral-50/60 dark:bg-neutral-900 hover:bg-neutral-100 dark:hover:bg-neutral-800/60"
      }`}
    >
      <div
        className={`size-9 rounded-lg flex items-center justify-center shrink-0 ${
          primary
            ? "bg-blue-600 text-white"
            : "bg-blue-600/10 text-blue-600 dark:text-blue-400"
        }`}
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div
          className={`text-sm font-medium ${
            primary
              ? "text-blue-900 dark:text-blue-100"
              : "text-neutral-900 dark:text-neutral-100"
          }`}
        >
          {title}
        </div>
        <p
          className={`text-xs truncate ${
            primary
              ? "text-blue-700/80 dark:text-blue-200/80"
              : "text-neutral-500 dark:text-neutral-400"
          }`}
        >
          {sub}
        </p>
      </div>
    </button>
  );
}
